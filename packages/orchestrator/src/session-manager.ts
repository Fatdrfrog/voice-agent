import type { WorkspaceConfig } from "@voice-dev-agent/contracts";

export class SessionManager {
  private readonly sessionMap = new Map<string, string>();

  public constructor(workspaces: WorkspaceConfig[]) {
    for (const workspace of workspaces) {
      this.sessionMap.set(workspace.id, workspace.defaultSessionKey);
    }
  }

  public getSessionKey(workspaceId: string): string {
    const session = this.sessionMap.get(workspaceId);
    if (!session) {
      throw new Error(`No session registered for workspace: ${workspaceId}`);
    }

    return session;
  }

  public setSessionKey(workspaceId: string, sessionKey: string): void {
    this.sessionMap.set(workspaceId, sessionKey);
  }
}
