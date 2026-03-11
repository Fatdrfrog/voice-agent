function normalizeTranscriptComparisonWord(word) {
  return word
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function normalizeTranscriptComparisonText(text) {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeTranscriptBoundaryText(text) {
  return normalizeTranscriptComparisonText(text).replace(/[.!?]+$/u, "");
}

function splitTranscriptSentences(text) {
  return text.match(/[^\r\n.!?]+[.!?]?/gu) ?? [text];
}

function collapseDuplicateSentences(text) {
  const sentences = splitTranscriptSentences(text)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length < 2) {
    return text.trim();
  }

  const compacted = [];

  for (const sentence of sentences) {
    const previous = compacted.at(-1);
    const normalizedSentence = normalizeTranscriptBoundaryText(sentence);
    const normalizedPrevious = previous ? normalizeTranscriptBoundaryText(previous) : "";
    const wordCount = sentence.split(/\s+/u).filter(Boolean).length;

    if (previous && wordCount >= 4 && normalizedSentence === normalizedPrevious) {
      continue;
    }

    compacted.push(sentence);
  }

  return compacted.join(" ").trim();
}

function collapseRepeatedHalves(text) {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length < 8 || words.length % 2 !== 0) {
    return text.trim();
  }

  const half = words.length / 2;
  if (half < 4) {
    return text.trim();
  }

  const normalizedWords = words.map(normalizeTranscriptComparisonWord);
  const firstHalf = normalizedWords.slice(0, half).join(" ");
  const secondHalf = normalizedWords.slice(half).join(" ");

  if (!firstHalf || firstHalf !== secondHalf) {
    return text.trim();
  }

  return words.slice(0, half).join(" ").trim();
}

export function sanitizeTranscriptSegment(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  return collapseRepeatedHalves(collapseDuplicateSentences(trimmed));
}

export function isDuplicateTranscriptSegment(previousText, nextText) {
  return normalizeTranscriptBoundaryText(previousText) === normalizeTranscriptBoundaryText(nextText);
}

function getTranscriptWordOverlap(baseText, nextText) {
  const baseWords = baseText.split(/\s+/u).map(normalizeTranscriptComparisonWord).filter(Boolean);
  const nextWords = nextText.split(/\s+/u).map(normalizeTranscriptComparisonWord).filter(Boolean);
  const maxOverlap = Math.min(baseWords.length, nextWords.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const baseSlice = baseWords.slice(-overlap).join(" ");
    const nextSlice = nextWords.slice(0, overlap).join(" ");
    if (baseSlice && baseSlice === nextSlice) {
      return overlap;
    }
  }

  return 0;
}

export function mergeTranscriptSegment(existingText, nextSegment) {
  const sanitizedNext = sanitizeTranscriptSegment(nextSegment);
  if (!existingText) {
    return sanitizedNext;
  }

  if (!sanitizedNext) {
    return existingText;
  }

  const normalizedExisting = normalizeTranscriptBoundaryText(existingText);
  const normalizedNext = normalizeTranscriptBoundaryText(sanitizedNext);

  if (!normalizedNext || normalizedExisting === normalizedNext || normalizedExisting.endsWith(normalizedNext)) {
    return existingText;
  }

  if (normalizedNext.startsWith(normalizedExisting)) {
    return sanitizedNext;
  }

  const overlap = getTranscriptWordOverlap(existingText, sanitizedNext);
  if (overlap > 0) {
    const nextWords = sanitizedNext.split(/\s+/u);
    return `${existingText} ${nextWords.slice(overlap).join(" ")}`.trim();
  }

  const shouldAttachWithoutSpace =
    /^[,.;!?)]/u.test(sanitizedNext) ||
    /^['"-]/u.test(sanitizedNext) ||
    /^[a-z]$/iu.test(sanitizedNext);

  return shouldAttachWithoutSpace ? `${existingText}${sanitizedNext}` : `${existingText} ${sanitizedNext}`;
}

export function joinTranscriptSegments(segments) {
  let combined = "";

  for (const segment of segments) {
    const normalized = sanitizeTranscriptSegment(segment ?? "");
    if (!normalized) {
      continue;
    }

    combined = mergeTranscriptSegment(combined, normalized);
  }

  return combined;
}
