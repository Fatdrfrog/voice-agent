import { describe, expect, it } from "vitest";

import { float32ToInt16 } from "./audio.js";

describe("float32ToInt16", () => {
  it("converts float samples into PCM16 range", () => {
    const pcm = float32ToInt16(new Float32Array([0, 0.5, -0.5, 1, -1]));

    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBeGreaterThan(0);
    expect(pcm[2]).toBeLessThan(0);
    expect(pcm[3]).toBe(32767);
    expect(pcm[4]).toBe(-32768);
  });
});
