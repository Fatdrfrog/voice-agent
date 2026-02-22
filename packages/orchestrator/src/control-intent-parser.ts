import type { ControlIntent } from "@voice-dev-agent/contracts";

export interface ParsedIntent {
  intent: ControlIntent;
  workspaceId?: string;
}

const startListeningPatterns = [/\bstart listening\b/i, /\blisten now\b/i, /^start$/i];
const stopListeningPatterns = [/\bstop listening\b/i, /^stop$/i, /\bmute mic\b/i];
const pausePatterns = [/\bpause\b/i, /\bhold on\b/i];
const resumePatterns = [/\bresume\b/i, /\bcontinue listening\b/i];
const confirmPatterns = [/\bconfirm\b/i, /^yes$/i, /\bgo ahead\b/i, /\bapprove\b/i];
const cancelPatterns = [/\bcancel\b/i, /^no$/i, /\bnever mind\b/i, /\babort\b/i];
const statusPatterns = [/\bstatus\b/i, /\bhealth check\b/i, /\bwhat\'?s going on\b/i];
const callStatusPatterns = [/\bcall status\b/i, /\bphone status\b/i];
const switchWorkspacePattern = /\bswitch workspace\s+([a-z0-9-]+)\b/i;

function matches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function parseControlIntent(text: string): ParsedIntent | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const switchMatch = normalized.match(switchWorkspacePattern);
  if (switchMatch?.[1]) {
    return {
      intent: "switch_workspace",
      workspaceId: switchMatch[1]
    };
  }

  if (matches(normalized, callStatusPatterns)) {
    return { intent: "call_status" };
  }

  if (matches(normalized, startListeningPatterns)) {
    return { intent: "start_listening" };
  }

  if (matches(normalized, stopListeningPatterns)) {
    return { intent: "stop_listening" };
  }

  if (matches(normalized, pausePatterns)) {
    return { intent: "pause" };
  }

  if (matches(normalized, resumePatterns)) {
    return { intent: "resume" };
  }

  if (matches(normalized, confirmPatterns)) {
    return { intent: "confirm" };
  }

  if (matches(normalized, cancelPatterns)) {
    return { intent: "cancel" };
  }

  if (matches(normalized, statusPatterns)) {
    return { intent: "status" };
  }

  return null;
}
