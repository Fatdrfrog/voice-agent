import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  agentTurnResponseSchema,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type OpenClawHealth
} from "@voice-dev-agent/contracts";

import { extractJsonFromMixedOutput, sanitizeCliText } from "./output-parser.js";
import {
  BridgeError,
  type CallStatusResponse,
  type CommandResult,
  type OpenClawBridgeConfig
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 1;

/**
 * Wraps the OpenClaw CLI behind a typed API for the desktop app and orchestrator.
 */
export class OpenClawBridge {
  private readonly config: OpenClawBridgeConfig;

  /**
   * Normalizes bridge configuration and rejects incomplete startup state early.
   */
  public constructor(config: Partial<OpenClawBridgeConfig>) {
    if (!config.binary) {
      throw new BridgeError("CONFIG_ERROR", "OpenClaw binary path is required.");
    }

    if (!config.gatewayUrl) {
      throw new BridgeError("CONFIG_ERROR", "Gateway URL is required.");
    }

    const normalized: OpenClawBridgeConfig = {
      binary: config.binary,
      binaryArgs: config.binaryArgs ?? [],
      gatewayUrl: config.gatewayUrl,
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: config.retries ?? DEFAULT_RETRIES
    };

    if (config.gatewayToken) {
      normalized.gatewayToken = config.gatewayToken;
    }

    this.config = normalized;
  }

  /**
   * Executes a single OpenClaw agent turn and maps the JSON reply into app contracts.
   */
  public async agentTurn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
    const result = await this.runAgentTurnCommand(request);
    const payload = this.parseJson<Record<string, unknown>>(result.stdout);
    const text = this.extractAgentText(payload);
    const toolSummary = this.extractToolSummary(payload);

    const normalized = {
      text,
      toolSummary,
      riskLevel: this.inferRiskLevel(text),
      raw: payload
    };

    return agentTurnResponseSchema.parse(normalized);
  }

  /**
   * Chooses the correct CLI form for a turn based on the stable session key shape.
   */
  private async runAgentTurnCommand(request: AgentTurnRequest): Promise<CommandResult> {
    const agentId = this.extractAgentIdFromSessionKey(request.sessionKey);
    if (agentId) {
      return this.runWithRetry(["agent", "--agent", agentId, "--message", request.text, "--json"], {
        timeoutMs: 120_000
      });
    }

    return this.runWithRetry(
      ["agent", "--session-id", request.sessionKey, "--message", request.text, "--json"],
      { timeoutMs: 120_000 }
    );
  }

  /**
   * Checks whether the configured OpenClaw gateway is reachable and returns a normalized health object.
   */
  public async getHealth(): Promise<OpenClawHealth> {
    const args = ["gateway", "health", "--url", this.config.gatewayUrl];
    const token = this.config.gatewayToken;
    if (token) {
      args.push("--token", token);
    }

    try {
      const result = await this.runWithRetry(args, { timeoutMs: 15_000 });
      return {
        reachable: true,
        url: this.config.gatewayUrl,
        detail: sanitizeCliText(result.stdout)
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown health check error";
      return {
        reachable: false,
        url: this.config.gatewayUrl,
        detail
      };
    }
  }

  /**
   * Returns the plain-text output of `openclaw status`.
   */
  public async getStatus(): Promise<string> {
    return this.runTextCommand(["status"], { timeoutMs: 40_000 });
  }

  /**
   * Lists enabled OpenClaw plugins for diagnostics and setup checks.
   */
  public async listPlugins(): Promise<string> {
    return this.runTextCommand(["plugins", "list"], { timeoutMs: 40_000 });
  }

  /**
   * Returns node/provider status from OpenClaw for operational visibility.
   */
  public async listNodesStatus(): Promise<string> {
    return this.runTextCommand(["nodes", "status"], { timeoutMs: 40_000 });
  }

  /**
   * Fetches OpenClaw voice-call status and preserves the raw payload for debugging.
   */
  public async callStatus(callId: string): Promise<CallStatusResponse> {
    const result = await this.runWithRetry(
      ["voicecall", "status", "--call-id", callId, "--json"],
      { timeoutMs: 30_000 }
    );

    const payload = this.parseJson<{ found?: boolean; call?: unknown }>(result.stdout);
    return {
      found: Boolean(payload.found),
      call: payload.call,
      raw: payload
    };
  }

  /**
   * Ends an OpenClaw-managed voice call and returns the CLI confirmation text.
   */
  public async endCall(callId: string): Promise<string> {
    return this.runTextCommand(["voicecall", "end", "--call-id", callId], {
      timeoutMs: 30_000,
      includeStderrFallback: true
    });
  }

  /**
   * Adds an approvals allowlist entry for a specific agent or for all agents.
   */
  public async addAllowlistEntry(commandPattern: string, agent = "*"): Promise<string> {
    return this.runTextCommand(["approvals", "allowlist", "add", "--agent", agent, commandPattern], {
      timeoutMs: 30_000,
      includeStderrFallback: true
    });
  }

  /**
   * Removes an approvals allowlist entry for a specific agent or for all agents.
   */
  public async removeAllowlistEntry(commandPattern: string, agent = "*"): Promise<string> {
    return this.runTextCommand(["approvals", "allowlist", "remove", "--agent", agent, commandPattern], {
      timeoutMs: 30_000,
      includeStderrFallback: true
    });
  }

  /**
   * Reads the current approvals snapshot so the UI can surface policy state.
   */
  public async getApprovalsSnapshot(): Promise<string> {
    return this.runTextCommand(["approvals", "get"], { timeoutMs: 30_000 });
  }

  /**
   * Runs a text-oriented CLI command and returns sanitized stdout, with optional stderr fallback.
   */
  private async runTextCommand(
    args: string[],
    options: { timeoutMs: number; includeStderrFallback?: boolean }
  ): Promise<string> {
    const result = await this.runWithRetry(args, { timeoutMs: options.timeoutMs });
    return sanitizeCliText(options.includeStderrFallback ? result.stdout || result.stderr : result.stdout);
  }

  /**
   * Extracts the JSON portion of mixed CLI output and wraps parser failures in a bridge error.
   */
  private parseJson<T>(text: string): T {
    try {
      return extractJsonFromMixedOutput<T>(sanitizeCliText(text));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "JSON parse failure";
      throw new BridgeError("PARSE_ERROR", reason, text);
    }
  }

  /**
   * Infers a coarse risk level from the agent response text for downstream UI hints.
   */
  private inferRiskLevel(text: string): "low" | "medium" | "high" {
    const normalized = text.toLowerCase();
    if (/\brm\s+-rf\b|\bdel\s+\/f\b|\bformat\b|\bshutdown\b/.test(normalized)) {
      return "high";
    }

    if (/\bdelete\b|\bremove\b|\bdrop\b|\boverwrite\b/.test(normalized)) {
      return "medium";
    }

    return "low";
  }

  /**
   * Pulls the best available human-readable reply text from OpenClaw's variable JSON shapes.
   */
  private extractAgentText(payload: Record<string, unknown>): string {
    const response = payload.response;
    if (typeof response === "string" && response.trim()) {
      return response.trim();
    }

    const text = payload.text;
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }

    const result = payload.result;
    if (result && typeof result === "object") {
      const payloads = (result as { payloads?: unknown }).payloads;
      if (Array.isArray(payloads)) {
        const texts = payloads
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return "";
            }

            const value = (entry as { text?: unknown }).text;
            return typeof value === "string" ? value.trim() : "";
          })
          .filter(Boolean);

        if (texts.length > 0) {
          return texts.join("\n\n");
        }
      }
    }

    return "";
  }

  /**
   * Finds an optional tool summary from either the top-level or nested result payload.
   */
  private extractToolSummary(payload: Record<string, unknown>): string | undefined {
    const direct = payload.toolSummary;
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }

    const result = payload.result;
    if (!result || typeof result !== "object") {
      return undefined;
    }

    const nested = (result as { toolSummary?: unknown }).toolSummary;
    return typeof nested === "string" && nested.trim() ? nested.trim() : undefined;
  }

  /**
   * Derives the agent id from session keys shaped like `agent:<id>:<workspace>`.
   */
  private extractAgentIdFromSessionKey(sessionKey: string): string | null {
    const match = /^agent:([^:]+):/.exec(sessionKey);
    return match?.[1] ?? null;
  }

  /**
   * Retries transient CLI failures before surfacing the final bridge error.
   */
  private async runWithRetry(
    args: string[],
    options: { timeoutMs?: number; retries?: number }
  ): Promise<CommandResult> {
    const maxAttempts = (options.retries ?? this.config.retries) + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.runCommand(args, options.timeoutMs ?? this.config.defaultTimeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) {
          throw error;
        }
      }
    }

    throw new BridgeError(
      "PROCESS_ERROR",
      `Command failed after retries: ${args.join(" ")}`,
      "",
      String(lastError)
    );
  }

  /**
   * Spawns the OpenClaw CLI with gateway context injected into the child environment.
   */
  private runCommand(args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        OPENCLAW_GATEWAY_URL: this.config.gatewayUrl
      };

      if (this.config.gatewayToken) {
        env.OPENCLAW_GATEWAY_TOKEN = this.config.gatewayToken;
      }

      const commandArgs = [...(this.config.binaryArgs ?? []), ...args];
      const child = process.platform === "win32"
        ? spawn(this.buildWindowsShellCommand(this.config.binary, commandArgs), {
            cwd: process.cwd(),
            windowsHide: true,
            shell: true,
            env
          })
        : spawn(this.config.binary, commandArgs, {
            cwd: process.cwd(),
            windowsHide: true,
            shell: false,
            env
          });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const token = randomUUID();

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(
          new BridgeError(
            "PROCESS_ERROR",
            `Failed to spawn OpenClaw process (${token}): ${error.message}`,
            stdout,
            stderr
          )
        );
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(
            new BridgeError(
              "TIMEOUT",
              `OpenClaw command timed out after ${timeoutMs}ms (${token}).`,
              stdout,
              stderr
            )
          );
          return;
        }

        const normalizedExit = exitCode ?? -1;
        if (normalizedExit !== 0) {
          const detail = this.extractFailureDetail(stdout, stderr);
          reject(
            new BridgeError(
              "NON_ZERO_EXIT",
              detail
                ? `OpenClaw exited with code ${normalizedExit} (${token}): ${detail}`
                : `OpenClaw exited with code ${normalizedExit} (${token}).`,
              stdout,
              stderr
            )
          );
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: normalizedExit
        });
      });
    });
  }

  /**
   * Builds a single shell-safe command string for Windows `shell: true` execution.
   */
  private buildWindowsShellCommand(binary: string, args: string[]): string {
    return [binary, ...args].map((part) => this.quoteWindowsShellArg(part)).join(" ");
  }

  /**
   * Quotes a Windows shell argument when whitespace or quotes would otherwise break parsing.
   */
  private quoteWindowsShellArg(value: string): string {
    if (!value) {
      return "\"\"";
    }

    if (!/[\s"]/u.test(value)) {
      return value;
    }

    return `"${value.replace(/"/g, '\\"')}"`;
  }

  /**
   * Reduces noisy CLI output to the last few meaningful lines for surfaced errors.
   */
  private extractFailureDetail(stdout: string, stderr: string): string {
    const normalized = sanitizeCliText(stderr || stdout);
    if (!normalized) {
      return "";
    }

    const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.slice(-3).join(" | ");
  }
}
