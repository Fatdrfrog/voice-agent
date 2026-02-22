import { EventEmitter } from "node:events";

import type {
  AgentTurnRequest,
  AppConfig,
  VoiceEvent,
  WorkspaceConfig
} from "@voice-dev-agent/contracts";
import { OpenClawBridge } from "@voice-dev-agent/openclaw-bridge";

import { buildAcpSnippets } from "./acp-snippets.js";
import { parseControlIntent } from "./control-intent-parser.js";
import { assessRisk } from "./risk-assessor.js";
import { SessionManager } from "./session-manager.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

interface PendingAction {
  workspaceId: string;
  text: string;
}

export class VoiceOrchestrator extends EventEmitter {
  private readonly bridge: OpenClawBridge;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly sessionManager: SessionManager;
  private readonly config: AppConfig;

  private currentWorkspaceId: string;
  private listening = false;
  private paused = false;
  private pendingAction: PendingAction | null = null;

  public constructor(config: AppConfig) {
    super();
    this.config = config;
    this.workspaceRegistry = new WorkspaceRegistry(config.workspacesFilePath);
    this.sessionManager = new SessionManager(this.workspaceRegistry.list());
    const bridgeConfig: {
      binary: string;
      gatewayUrl: string;
      retries: number;
      defaultTimeoutMs: number;
      gatewayToken?: string;
    } = {
      binary: config.gateway.binary,
      gatewayUrl: config.gateway.gatewayUrl,
      retries: 1,
      defaultTimeoutMs: 20_000
    };

    if (config.gateway.gatewayToken) {
      bridgeConfig.gatewayToken = config.gateway.gatewayToken;
    }

    this.bridge = new OpenClawBridge(bridgeConfig);

    this.currentWorkspaceId = this.workspaceRegistry.list()[0]?.id ?? "";
  }

  public getCurrentWorkspace(): WorkspaceConfig {
    return this.workspaceRegistry.get(this.currentWorkspaceId);
  }

  public listWorkspaces(): WorkspaceConfig[] {
    return this.workspaceRegistry.list();
  }

  public async getGatewayHealth(): Promise<void> {
    const health = await this.bridge.getHealth();
    this.emitVoiceEvent("state.changed", {
      health
    });
  }

  public async getGatewayStatus(): Promise<void> {
    const [status, plugins, nodes] = await Promise.all([
      this.bridge.getStatus(),
      this.bridge.listPlugins(),
      this.bridge.listNodesStatus().catch((error) => {
        if (error instanceof Error) {
          return `nodes status unavailable: ${error.message}`;
        }
        return "nodes status unavailable";
      })
    ]);

    this.emitVoiceEvent("state.changed", {
      status,
      plugins,
      nodes
    });
  }

  public startListening(): void {
    this.listening = true;
    this.paused = false;
    this.emitVoiceEvent("state.changed", {
      listening: this.listening,
      paused: this.paused
    });
  }

  public stopListening(): void {
    this.listening = false;
    this.paused = false;
    this.emitVoiceEvent("state.changed", {
      listening: this.listening,
      paused: this.paused
    });
  }

  public pause(): void {
    this.paused = true;
    this.emitVoiceEvent("state.changed", {
      listening: this.listening,
      paused: this.paused
    });
  }

  public resume(): void {
    this.paused = false;
    this.emitVoiceEvent("state.changed", {
      listening: this.listening,
      paused: this.paused
    });
  }

  public switchWorkspace(workspaceId: string): void {
    this.workspaceRegistry.get(workspaceId);
    this.currentWorkspaceId = workspaceId;
    this.emitVoiceEvent("state.changed", {
      workspaceId: this.currentWorkspaceId
    });
  }

  public async handleTranscript(text: string): Promise<void> {
    const transcript = text.trim();
    if (!transcript) {
      return;
    }

    this.emitVoiceEvent("transcript.final", {
      text: transcript
    });

    const intent = parseControlIntent(transcript);
    if (intent) {
      await this.handleControlIntent(intent.intent, intent.workspaceId);
      return;
    }

    if (this.pendingAction) {
      this.emitVoiceEvent("approval.required", {
        message: "Pending risky action exists. Say confirm or cancel."
      });
      return;
    }

    const risk = assessRisk(transcript, this.config.executionPolicy);
    if (risk.requiresConfirmation) {
      this.pendingAction = {
        workspaceId: this.currentWorkspaceId,
        text: transcript
      };

      this.emitVoiceEvent("approval.required", {
        reason: risk.reason,
        pattern: risk.matchedPattern,
        prompt: "Say confirm to proceed or cancel to discard."
      });
      return;
    }

    await this.runAgentTurn(this.currentWorkspaceId, transcript, "voice");
  }

  public async addAllowlistCommand(commandPattern: string): Promise<void> {
    const output = await this.bridge.addAllowlistEntry(commandPattern, "*");
    this.emitVoiceEvent("state.changed", {
      allowlist: output
    });
  }

  public async removeAllowlistCommand(commandPattern: string): Promise<void> {
    const output = await this.bridge.removeAllowlistEntry(commandPattern, "*");
    this.emitVoiceEvent("state.changed", {
      allowlist: output
    });
  }

  public async fetchApprovalsSnapshot(): Promise<void> {
    const output = await this.bridge.getApprovalsSnapshot();
    this.emitVoiceEvent("state.changed", {
      approvals: output
    });
  }

  public async getCallStatus(callId: string): Promise<void> {
    const status = await this.bridge.callStatus(callId);
    this.emitVoiceEvent("call.status", status);
  }

  public async endCall(callId: string): Promise<void> {
    const output = await this.bridge.endCall(callId);
    this.emitVoiceEvent("state.changed", { callEnd: output });
  }

  public getAcpSnippets(): ReturnType<typeof buildAcpSnippets> {
    const workspace = this.getCurrentWorkspace();
    return buildAcpSnippets(workspace, this.config.gateway.gatewayUrl, this.config.gateway.gatewayToken);
  }

  public isWindowsPathAllowed(targetPath: string): boolean {
    return this.workspaceRegistry.isWindowsPathAllowed(targetPath);
  }

  private async handleControlIntent(intent: import("@voice-dev-agent/contracts").ControlIntent, workspaceId?: string): Promise<void> {
    switch (intent) {
      case "start_listening":
        this.startListening();
        this.emitVoiceEvent("state.changed", { message: "Listening started." });
        return;
      case "stop_listening":
        this.stopListening();
        this.emitVoiceEvent("state.changed", { message: "Listening stopped." });
        return;
      case "pause":
        this.pause();
        this.emitVoiceEvent("state.changed", { message: "Listening paused." });
        return;
      case "resume":
        this.resume();
        this.emitVoiceEvent("state.changed", { message: "Listening resumed." });
        return;
      case "status":
        await this.getGatewayStatus();
        return;
      case "switch_workspace":
        if (!workspaceId) {
          this.emitVoiceEvent("error", { message: "Workspace id is required." });
          return;
        }
        this.switchWorkspace(workspaceId);
        return;
      case "confirm":
        if (!this.pendingAction) {
          this.emitVoiceEvent("state.changed", { message: "No pending action to confirm." });
          return;
        }
        await this.runAgentTurn(this.pendingAction.workspaceId, this.pendingAction.text, "voice");
        this.pendingAction = null;
        return;
      case "cancel":
        this.pendingAction = null;
        this.emitVoiceEvent("state.changed", { message: "Pending action canceled." });
        return;
      case "call_status":
        this.emitVoiceEvent("state.changed", {
          message: "Call status requires call ID in the UI diagnostics panel."
        });
        return;
      default:
        this.emitVoiceEvent("error", { message: `Unhandled control intent: ${intent}` });
    }
  }

  private async runAgentTurn(
    workspaceId: string,
    text: string,
    mode: AgentTurnRequest["mode"]
  ): Promise<void> {
    const sessionKey = this.sessionManager.getSessionKey(workspaceId);
    try {
      const response = await this.bridge.agentTurn({
        sessionKey,
        workspaceId,
        text,
        mode
      });
      this.emitVoiceEvent("agent.reply", response);
    } catch (error) {
      this.emitVoiceEvent("error", {
        message: error instanceof Error ? error.message : "Agent turn failed"
      });
    }
  }

  private emitVoiceEvent(type: VoiceEvent["type"], payload: unknown): void {
    const event: VoiceEvent = {
      type,
      sessionId: this.sessionManager.getSessionKey(this.currentWorkspaceId),
      workspaceId: this.currentWorkspaceId,
      timestamp: new Date().toISOString(),
      payload
    };

    this.emit("voice:event", event);
  }
}

