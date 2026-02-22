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

export class OpenClawBridge {
  private readonly config: OpenClawBridgeConfig;

  public constructor(config: Partial<OpenClawBridgeConfig>) {
    if (!config.binary) {
      throw new BridgeError("CONFIG_ERROR", "OpenClaw binary path is required.");
    }

    if (!config.gatewayUrl) {
      throw new BridgeError("CONFIG_ERROR", "Gateway URL is required.");
    }

    const normalized: OpenClawBridgeConfig = {
      binary: config.binary,
      gatewayUrl: config.gatewayUrl,
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: config.retries ?? DEFAULT_RETRIES
    };

    if (config.gatewayToken) {
      normalized.gatewayToken = config.gatewayToken;
    }

    this.config = normalized;
  }

  public async agentTurn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
    const args = [
      "agent",
      "--session-id",
      request.sessionKey,
      "--message",
      request.text,
      "--json"
    ];

    const result = await this.runWithRetry(args, { timeoutMs: 120_000 });
    const payload = this.parseJson<{ response?: string; text?: string; toolSummary?: string; raw?: unknown }>(result.stdout);

    const normalized = {
      text: payload.response ?? payload.text ?? "",
      toolSummary: payload.toolSummary,
      riskLevel: this.inferRiskLevel(payload.response ?? payload.text ?? ""),
      raw: payload.raw ?? payload
    };

    return agentTurnResponseSchema.parse(normalized);
  }

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

  public async getStatus(): Promise<string> {
    const result = await this.runWithRetry(["status"], { timeoutMs: 40_000 });
    return sanitizeCliText(result.stdout);
  }

  public async listPlugins(): Promise<string> {
    const result = await this.runWithRetry(["plugins", "list"], { timeoutMs: 40_000 });
    return sanitizeCliText(result.stdout);
  }

  public async listNodesStatus(): Promise<string> {
    const result = await this.runWithRetry(["nodes", "status"], { timeoutMs: 40_000 });
    return sanitizeCliText(result.stdout);
  }

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

  public async endCall(callId: string): Promise<string> {
    const result = await this.runWithRetry(["voicecall", "end", "--call-id", callId], {
      timeoutMs: 30_000
    });
    return sanitizeCliText(result.stdout || result.stderr);
  }

  public async addAllowlistEntry(commandPattern: string, agent = "*"): Promise<string> {
    const args = ["approvals", "allowlist", "add", "--agent", agent, commandPattern];
    const result = await this.runWithRetry(args, { timeoutMs: 30_000 });
    return sanitizeCliText(result.stdout || result.stderr);
  }

  public async removeAllowlistEntry(commandPattern: string, agent = "*"): Promise<string> {
    const args = ["approvals", "allowlist", "remove", "--agent", agent, commandPattern];
    const result = await this.runWithRetry(args, { timeoutMs: 30_000 });
    return sanitizeCliText(result.stdout || result.stderr);
  }

  public async getApprovalsSnapshot(): Promise<string> {
    const result = await this.runWithRetry(["approvals", "get"], { timeoutMs: 30_000 });
    return sanitizeCliText(result.stdout);
  }

  private parseJson<T>(text: string): T {
    try {
      return extractJsonFromMixedOutput<T>(sanitizeCliText(text));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "JSON parse failure";
      throw new BridgeError("PARSE_ERROR", reason, text);
    }
  }

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

  private runCommand(args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env
      };

      if (this.config.gatewayUrl) {
        env.OPENCLAW_GATEWAY_URL = this.config.gatewayUrl;
      }

      if (this.config.gatewayToken) {
        env.OPENCLAW_GATEWAY_TOKEN = this.config.gatewayToken;
      }

      const child = spawn(this.config.binary, args, {
        cwd: process.cwd(),
        windowsHide: true,
        shell: true,
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
          reject(
            new BridgeError(
              "NON_ZERO_EXIT",
              `OpenClaw exited with code ${normalizedExit} (${token}).`,
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
}
