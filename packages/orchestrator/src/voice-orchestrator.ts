import { EventEmitter } from "node:events";

import type {
  AgentTurnRequest,
  AppConfig,
  ControlIntent,
  VoiceEvent,
  WorkspaceConfig
} from "@voice-dev-agent/contracts";
import { OpenClawBridge, type OpenClawBridgeConfig } from "@voice-dev-agent/openclaw-bridge";

import { buildAcpSnippets } from "./acp-snippets.js";
import { parseControlIntent } from "./control-intent-parser.js";
import { assessRisk } from "./risk-assessor.js";
import { SessionManager } from "./session-manager.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

interface PendingAction {
  workspaceId: string;
  text: string;
}

/**
 * Coordinates transcript handling, policy checks, workspace state, and OpenClaw handoff.
 */
export class VoiceOrchestrator extends EventEmitter {
  private readonly bridge: OpenClawBridge;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly sessionManager: SessionManager;
  private readonly config: AppConfig;

  private currentWorkspaceId: string;
  private listening = false;
  private paused = false;
  private pendingAction: PendingAction | null = null;

  /**
   * Builds the workspace/session state and the OpenClaw bridge used by the desktop app.
   */
  public constructor(config: AppConfig) {
    super();
    this.config = config;
    this.workspaceRegistry = new WorkspaceRegistry(config.workspacesFilePath);
    const workspaces = this.workspaceRegistry.list();
    this.sessionManager = new SessionManager(workspaces);

    const bridgeConfig: Partial<OpenClawBridgeConfig> = {
      binary: config.gateway.binary,
      gatewayUrl: config.gateway.gatewayUrl,
      retries: 1,
      defaultTimeoutMs: 20_000
    };

    if (config.gateway.gatewayToken) {
      bridgeConfig.gatewayToken = config.gateway.gatewayToken;
    }

    this.bridge = new OpenClawBridge(bridgeConfig);

    this.currentWorkspaceId = workspaces[0]?.id ?? "";
  }

  /**
   * Returns the currently selected workspace configuration.
   */
  public getCurrentWorkspace(): WorkspaceConfig {
    return this.workspaceRegistry.get(this.currentWorkspaceId);
  }

  /**
   * Lists all configured workspaces exposed to the app.
   */
  public listWorkspaces(): WorkspaceConfig[] {
    return this.workspaceRegistry.list();
  }

  /**
   * Emits normalized gateway health details for the UI diagnostics surface.
   */
  public async getGatewayHealth(): Promise<void> {
    const health = await this.bridge.getHealth();
    this.emitStateChanged({
      health
    });
  }

  /**
   * Collects OpenClaw status output and publishes it as a single state update event.
   */
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

    this.emitStateChanged({
      status,
      plugins,
      nodes
    });
  }

  /**
   * Marks the orchestrator as actively listening and not paused.
   */
  public startListening(): void {
    this.listening = true;
    this.paused = false;
    this.emitListeningState();
  }

  /**
   * Marks the orchestrator as no longer listening and clears paused state.
   */
  public stopListening(): void {
    this.listening = false;
    this.paused = false;
    this.emitListeningState();
  }

  /**
   * Preserves the listening session while pausing transcript processing.
   */
  public pause(): void {
    this.paused = true;
    this.emitListeningState();
  }

  /**
   * Resumes transcript handling after a paused period.
   */
  public resume(): void {
    this.paused = false;
    this.emitListeningState();
  }

  /**
   * Switches the active workspace after validating that the requested id exists.
   */
  public switchWorkspace(workspaceId: string): void {
    this.workspaceRegistry.get(workspaceId);
    this.currentWorkspaceId = workspaceId;
    this.emitStateChanged({
      workspaceId: this.currentWorkspaceId
    });
  }

  /**
   * Handles a finalized transcript by resolving control intents, approvals, or agent turns.
   */
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

  /**
   * Adds a command pattern to the OpenClaw approvals allowlist and emits the updated output.
   */
  public async addAllowlistCommand(commandPattern: string): Promise<void> {
    const output = await this.bridge.addAllowlistEntry(commandPattern, "*");
    this.emitStateChanged({
      allowlist: output
    });
  }

  /**
   * Removes a command pattern from the OpenClaw approvals allowlist.
   */
  public async removeAllowlistCommand(commandPattern: string): Promise<void> {
    const output = await this.bridge.removeAllowlistEntry(commandPattern, "*");
    this.emitStateChanged({
      allowlist: output
    });
  }

  /**
   * Fetches the current approvals snapshot for diagnostics and auditing.
   */
  public async fetchApprovalsSnapshot(): Promise<void> {
    const output = await this.bridge.getApprovalsSnapshot();
    this.emitStateChanged({
      approvals: output
    });
  }

  /**
   * Requests the status of an active call when call mode is enabled.
   */
  public async getCallStatus(callId: string): Promise<void> {
    if (!this.ensureCallModeEnabled()) {
      return;
    }

    const status = await this.bridge.callStatus(callId);
    this.emitVoiceEvent("call.status", status);
  }

  /**
   * Ends an active call when the runtime is configured for call mode.
   */
  public async endCall(callId: string): Promise<void> {
    if (!this.ensureCallModeEnabled()) {
      return;
    }

    const output = await this.bridge.endCall(callId);
    this.emitStateChanged({ callEnd: output });
  }

  /**
   * Returns ACP connection snippets for the currently selected workspace.
   */
  public getAcpSnippets(): ReturnType<typeof buildAcpSnippets> {
    const workspace = this.getCurrentWorkspace();
    return buildAcpSnippets(workspace, this.config.gateway.gatewayUrl, this.config.gateway.gatewayToken);
  }

  /**
   * Checks whether a Windows path is inside the configured workspace allowlist.
   */
  public isWindowsPathAllowed(targetPath: string): boolean {
    return this.workspaceRegistry.isWindowsPathAllowed(targetPath);
  }

  /**
   * Resolves voice control commands like confirm, cancel, status, and workspace switching.
   */
  private async handleControlIntent(intent: ControlIntent, workspaceId?: string): Promise<void> {
    switch (intent) {
      case "start_listening":
        this.startListening();
        this.emitStateChanged({ message: "Listening started." });
        return;
      case "stop_listening":
        this.stopListening();
        this.emitStateChanged({ message: "Listening stopped." });
        return;
      case "pause":
        this.pause();
        this.emitStateChanged({ message: "Listening paused." });
        return;
      case "resume":
        this.resume();
        this.emitStateChanged({ message: "Listening resumed." });
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
          this.emitStateChanged({ message: "No pending action to confirm." });
          return;
        }
        await this.runAgentTurn(this.pendingAction.workspaceId, this.pendingAction.text, "voice");
        this.pendingAction = null;
        return;
      case "cancel":
        this.pendingAction = null;
        this.emitStateChanged({ message: "Pending action canceled." });
        return;
      case "call_status":
        this.emitStateChanged(this.config.featureFlags.callMode
          ? { message: "Call status requires call ID in the UI diagnostics panel." }
          : { message: "Call mode is disabled." });
        return;
      default:
        this.emitVoiceEvent("error", { message: `Unhandled control intent: ${intent}` });
    }
  }

  /**
   * Executes one agent turn for the target workspace and emits either a reply or a normalized error.
   */
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

  /**
   * Emits the current listening and paused flags as a single state update payload.
   */
  private emitListeningState(): void {
    this.emitStateChanged({
      listening: this.listening,
      paused: this.paused
    });
  }

  /**
   * Emits a `state.changed` voice event with the active workspace/session context attached.
   */
  private emitStateChanged(payload: Record<string, unknown>): void {
    this.emitVoiceEvent("state.changed", payload);
  }

  /**
   * Guards call-specific operations when the runtime is configured for microphone-only mode.
   */
  private ensureCallModeEnabled(): boolean {
    if (this.config.featureFlags.callMode) {
      return true;
    }

    this.emitStateChanged({ message: "Call mode is disabled." });
    return false;
  }

  /**
   * Stamps payloads with session metadata before forwarding them to orchestrator listeners.
   */
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
