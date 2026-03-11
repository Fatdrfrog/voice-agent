import { describe, expect, it } from "vitest";

import { normalizeSpeechText, splitSpeechText } from "./tts-text.js";

describe("normalizeSpeechText", () => {
  it("strips markdown emphasis and links for cleaner speech", () => {
    const normalized = normalizeSpeechText("Check **this** [guide](https://example.com) now.");

    expect(normalized).toBe("Check this guide now.");
  });

  it("turns markdown lists into natural spoken sentences", () => {
    const normalized = normalizeSpeechText([
      "A couple more things:",
      "1. **Vibe** - casual or formal?",
      "2. **Channels** - web chat only?"
    ].join("\n"));

    expect(normalized).toContain("A couple more things:");
    expect(normalized).toContain("Vibe - casual or formal?");
    expect(normalized).toContain("Channels - web chat only?");
  });
});

describe("splitSpeechText", () => {
  it("keeps the opening chunk short so speech can start sooner", () => {
    const chunks = splitSpeechText(
      "Nice to meet you, Sam! Let me save that. Alright Sam, we're locked in. A couple more things to make this work well."
    );

    expect(chunks[0]).toBe("Nice to meet you, Sam! Let me save that.");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("caps chunk size on long paragraphs", () => {
    const chunks = splitSpeechText(
      "This is a deliberately long reply that should be split into multiple chunks so the first audio packet can start quickly, and the rest of the answer can continue synthesizing while the user already hears Jarvis speaking back."
    );

    expect(chunks.every((chunk) => chunk.length <= 140)).toBe(true);
  });
});
