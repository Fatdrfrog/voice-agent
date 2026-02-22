import { describe, expect, it } from "vitest";

import { parseControlIntent } from "./control-intent-parser.js";

describe("parseControlIntent", () => {
  it("parses switch workspace command", () => {
    const parsed = parseControlIntent("switch workspace ice-core-ai");
    expect(parsed?.intent).toBe("switch_workspace");
    expect(parsed?.workspaceId).toBe("ice-core-ai");
  });

  it("parses confirm aliases", () => {
    const parsed = parseControlIntent("go ahead");
    expect(parsed?.intent).toBe("confirm");
  });

  it("returns null for non-control text", () => {
    expect(parseControlIntent("create a migration for billing")).toBeNull();
  });
});
