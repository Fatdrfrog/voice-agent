class MicrophonePcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const configuredChunkSize = options?.processorOptions?.chunkSize;
    this.chunkSize = Number.isInteger(configuredChunkSize) && configuredChunkSize > 0
      ? configuredChunkSize
      : 2048;
    this.buffer = new Int16Array(this.chunkSize);
    this.writeIndex = 0;

    this.port.onmessage = (event) => {
      if (event?.data?.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flush-complete" });
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];
    if (!channel) {
      return true;
    }

    for (let index = 0; index < channel.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channel[index] ?? 0));
      this.buffer[this.writeIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.writeIndex += 1;

      if (this.writeIndex >= this.chunkSize) {
        this.emitChunk(this.buffer);
        this.buffer = new Int16Array(this.chunkSize);
        this.writeIndex = 0;
      }
    }

    return true;
  }

  emitChunk(chunk) {
    this.port.postMessage(
      { type: "chunk", chunk },
      [chunk.buffer]
    );
  }

  flush() {
    if (this.writeIndex === 0) {
      return;
    }

    const tailChunk = this.buffer.slice(0, this.writeIndex);
    this.emitChunk(tailChunk);
    this.buffer = new Int16Array(this.chunkSize);
    this.writeIndex = 0;
  }
}

registerProcessor("microphone-pcm-processor", MicrophonePcmProcessor);
