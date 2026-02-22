import { describe, expect, it } from "vitest";

import { extractJsonFromMixedOutput } from "./output-parser.js";

describe("extractJsonFromMixedOutput", () => {
  it("parses clean JSON payload", () => {
    const value = extractJsonFromMixedOutput<{ ok: boolean }>("{\"ok\":true}");
    expect(value.ok).toBe(true);
  });

  it("parses JSON from noisy OpenClaw output", () => {
    const text = `
🦞 OpenClaw banner noise
Plugins loaded
{"response":"Done","toolSummary":"none"}
`;

    const value = extractJsonFromMixedOutput<{ response: string }>(text);
    expect(value.response).toBe("Done");
  });

  it("throws if no json exists", () => {
    expect(() => extractJsonFromMixedOutput("no json here")).toThrow();
  });
});
