import { readFileSync } from "node:fs";
import path from "node:path";

import {
  workspacesFileSchema,
  type WorkspaceConfig,
  type WorkspacesFile
} from "@voice-dev-agent/contracts";

export class WorkspaceRegistry {
  private readonly file: WorkspacesFile;

  public constructor(workspacesFilePath: string) {
    const absolute = path.resolve(workspacesFilePath);
    const raw = readFileSync(absolute, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    this.file = workspacesFileSchema.parse(parsed);
  }

  public list(): WorkspaceConfig[] {
    return [...this.file.workspaces];
  }

  public get(workspaceId: string): WorkspaceConfig {
    const found = this.file.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!found) {
      throw new Error(`Workspace not allowlisted: ${workspaceId}`);
    }

    return found;
  }

  public isWindowsPathAllowed(targetPath: string): boolean {
    const normalizedTarget = path.resolve(targetPath).toLowerCase();

    return this.file.workspaces.some((workspace) => {
      const normalizedWorkspace = path.resolve(workspace.windowsPath).toLowerCase();
      return normalizedTarget === normalizedWorkspace || normalizedTarget.startsWith(`${normalizedWorkspace}${path.sep}`);
    });
  }

  public resolveWorkspaceFromWindowsPath(targetPath: string): WorkspaceConfig | null {
    const normalizedTarget = path.resolve(targetPath).toLowerCase();

    for (const workspace of this.file.workspaces) {
      const normalizedWorkspace = path.resolve(workspace.windowsPath).toLowerCase();
      if (
        normalizedTarget === normalizedWorkspace ||
        normalizedTarget.startsWith(`${normalizedWorkspace}${path.sep}`)
      ) {
        return workspace;
      }
    }

    return null;
  }
}
