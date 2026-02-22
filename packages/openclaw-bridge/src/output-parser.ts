const jsonPattern = /\{[\s\S]*\}|\[[\s\S]*\]/g;

export function extractJsonFromMixedOutput<T>(text: string): T {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("No output to parse.");
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Continue and attempt extraction from banner/log noise.
  }

  const matches = trimmed.match(jsonPattern) ?? [];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const candidate = matches[index];
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Ignore and continue.
    }
  }

  // Final pass: per-line JSON payloads.
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || (!line.startsWith("{") && !line.startsWith("["))) {
      continue;
    }
    try {
      return JSON.parse(line) as T;
    } catch {
      // Ignore and continue.
    }
  }

  throw new Error("Could not locate JSON payload in command output.");
}

export function sanitizeCliText(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim();
}
