import { describe, expect, it } from "vitest";

import { assessRisk } from "./risk-assessor.js";

describe("assessRisk", () => {
  it("flags confirmation when pattern matches", () => {
    const risk = assessRisk("please run rm -rf /", {
      host: "node",
      security: "allowlist",
      ask: "on-miss",
      allowlistedBins: [],
      blockedPatterns: ["rm\\s+-rf"],
      confirmationRequiredPatterns: []
    });

    expect(risk.requiresConfirmation).toBe(true);
  });

  it("stays low risk for regular coding text", () => {
    const risk = assessRisk("implement button component", {
      host: "node",
      security: "allowlist",
      ask: "on-miss",
      allowlistedBins: [],
      blockedPatterns: ["rm\\s+-rf"],
      confirmationRequiredPatterns: ["drop database"]
    });

    expect(risk.requiresConfirmation).toBe(false);
  });
});
