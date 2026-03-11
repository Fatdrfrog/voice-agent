import { describe, expect, it } from "vitest";

import {
  isDuplicateTranscriptSegment,
  joinTranscriptSegments,
  sanitizeTranscriptSegment
} from "./transcript-coalescer.js";

describe("transcript coalescer", () => {
  it("drops duplicate committed sentences with punctuation variance", () => {
    expect(isDuplicateTranscriptSegment("Open Chrome", "Open Chrome.")).toBe(true);
  });

  it("keeps the longer segment when a later fragment extends the earlier one", () => {
    expect(
      joinTranscriptSegments([
        "I want to see something amazing and fast",
        "I want to see something amazing and fast that you can do."
      ])
    ).toBe("I want to see something amazing and fast that you can do.");
  });

  it("collapses a transcript that repeats the same sentence twice", () => {
    expect(
      sanitizeTranscriptSegment(
        "I want to see something amazing and fast that you can do. I want to see something amazing and fast that you can do."
      )
    ).toBe("I want to see something amazing and fast that you can do.");
  });

  it("merges adjacent word fragments without duplicating the phrase", () => {
    expect(joinTranscriptSegments(["it's", "all", "good"])).toBe("it's all good");
  });

  it("drops repeated halves without punctuation", () => {
    expect(
      sanitizeTranscriptSegment("show me something amazing right now show me something amazing right now")
    ).toBe("show me something amazing right now");
  });
});
