function replaceMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function normalizeLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/u, "")
    .replace(/^\s*>\s+/u, "")
    .replace(/^\s*[-*+]\s+/u, "")
    .replace(/^\s*\d+\.\s+/u, "")
    .trim();
}

function splitLongSegment(segment: string, maxChars: number): string[] {
  const clauseParts = segment.split(/(?<=[,;:])\s+/u).filter(Boolean);
  if (clauseParts.length > 1) {
    const chunks: string[] = [];
    let current = "";

    for (const part of clauseParts) {
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length <= maxChars || !current) {
        current = candidate;
        continue;
      }

      chunks.push(current.trim());
      current = part;
    }

    if (current) {
      chunks.push(current.trim());
    }

    return chunks.flatMap((chunk) => {
      if (chunk.length <= maxChars) {
        return [chunk];
      }

      const words = chunk.split(/\s+/u).filter(Boolean);
      const wordChunks: string[] = [];
      let currentWords = "";

      for (const word of words) {
        const candidate = currentWords ? `${currentWords} ${word}` : word;
        if (candidate.length <= maxChars || !currentWords) {
          currentWords = candidate;
          continue;
        }

        wordChunks.push(currentWords.trim());
        currentWords = word;
      }

      if (currentWords) {
        wordChunks.push(currentWords.trim());
      }

      return wordChunks;
    });
  }

  return segment.length <= maxChars
    ? [segment]
    : (segment.match(new RegExp(`.{1,${maxChars}}(?:\\s|$)`, "gu")) ?? [segment]).map((part) => part.trim());
}

export function normalizeSpeechText(text: string): string {
  const normalized = replaceMarkdownLinks(text)
    .replace(/\r/g, "")
    .replace(/\n(?=\s*(?:[-*+]|\d+\.))/gu, ". ")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .join(" ")
    .replace(/[*_~`]+/gu, "")
    .replace(/\s+[—–]\s+/gu, ", ")
    .replace(/\s{2,}/gu, " ")
    .trim();

  return normalized;
}

export function splitSpeechText(text: string, maxChars = 140): string[] {
  const normalized = normalizeSpeechText(text);
  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/gu)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [normalized];
  const chunks: string[] = [];
  let current = "";
  const firstChunkMaxChars = Math.min(maxChars, 60);

  for (const [index, sentence] of sentences.entries()) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    const currentMaxChars = chunks.length === 0 && index < sentences.length - 1 ? firstChunkMaxChars : maxChars;
    if (candidate.length <= currentMaxChars || !current) {
      current = candidate;
      continue;
    }

    chunks.push(current.trim());
    current = sentence;
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks.flatMap((chunk) => splitLongSegment(chunk, maxChars)).filter(Boolean);
}
