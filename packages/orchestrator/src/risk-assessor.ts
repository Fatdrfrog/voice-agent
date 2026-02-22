import type { ExecutionPolicy, RiskAssessment } from "@voice-dev-agent/contracts";

export function assessRisk(text: string, policy: ExecutionPolicy): RiskAssessment {
  const normalized = text.toLowerCase();

  for (const blocked of policy.blockedPatterns) {
    const regex = new RegExp(blocked, "i");
    if (regex.test(normalized)) {
      return {
        requiresConfirmation: true,
        matchedPattern: blocked,
        reason: `Blocked pattern matched: ${blocked}`
      };
    }
  }

  for (const pattern of policy.confirmationRequiredPatterns) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(normalized)) {
      return {
        requiresConfirmation: true,
        matchedPattern: pattern,
        reason: `Confirmation required by policy: ${pattern}`
      };
    }
  }

  return {
    requiresConfirmation: false,
    reason: "No high-risk patterns detected."
  };
}
