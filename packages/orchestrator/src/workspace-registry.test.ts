import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { WorkspaceRegistry } from "./workspace-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspacesPath = path.resolve(__dirname, "../../../config/workspaces.json");

describe("WorkspaceRegistry", () => {
  const registry = new WorkspaceRegistry(workspacesPath);

  it("allows path inside configured workspace", () => {
    const allowed = registry.isWindowsPathAllowed(
      "C:/Users/User/OneDrive/Desktop/indie/ice-core-ai/apps/web"
    );
    expect(allowed).toBe(true);
  });

  it("rejects outside path", () => {
    const allowed = registry.isWindowsPathAllowed("C:/Users/User/Desktop/not-allowlisted");
    expect(allowed).toBe(false);
  });
});
