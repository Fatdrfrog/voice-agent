import { useCallback, useRef } from "react";

const WORKLET_CHUNK_SIZE = 2048;
const WORKLET_MODULE_URL = new URL("../worklets/microphone-processor.js", import.meta.url).toString();

interface WorkletMessage {
  type?: "chunk" | "flush-complete";
  chunk?: Int16Array | ArrayBuffer | number[];
}

function toChunkArray(chunk: WorkletMessage["chunk"]): number[] | null {
  if (!chunk) {
    return null;
  }

  if (chunk instanceof Int16Array) {
    return Array.from(chunk);
  }

  if (chunk instanceof ArrayBuffer) {
    return Array.from(new Int16Array(chunk));
  }

  if (Array.isArray(chunk)) {
    return chunk;
  }

  return null;
}

interface UseMicrophoneOptions {
  onChunk: (chunk: number[]) => void;
  onError: (message: string) => void;
}

export function useMicrophone(options: UseMicrophoneOptions): {
  startMic: () => Promise<void>;
  stopMic: () => Promise<void>;
} {
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const flushResolverRef = useRef<(() => void) | null>(null);

  const stopMic = useCallback(async () => {
    if (processorRef.current) {
      const processor = processorRef.current;

      try {
        const flushPromise = new Promise<void>((resolve) => {
          flushResolverRef.current = resolve;
        });
        processor.port.postMessage({ type: "flush" });
        await Promise.race([
          flushPromise,
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 75);
          })
        ]);
      } catch {
        // Best-effort flush before teardown.
      } finally {
        flushResolverRef.current = null;
      }

      processor.port.onmessage = null;
      processor.disconnect();
      processorRef.current = null;
    }

    sourceRef.current?.disconnect();
    sourceRef.current = null;

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const startMic = useCallback(async () => {
    try {
      if (streamRef.current) {
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24_000,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true
        }
      });

      const audioContext = new AudioContext({ sampleRate: 24_000 });
      await audioContext.audioWorklet.addModule(WORKLET_MODULE_URL);
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);
      const processor = new AudioWorkletNode(audioContext, "microphone-pcm-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: {
          chunkSize: WORKLET_CHUNK_SIZE
        }
      });

      processor.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        const payload = event.data;
        if (payload?.type === "flush-complete") {
          if (flushResolverRef.current) {
            flushResolverRef.current();
            flushResolverRef.current = null;
          }
          return;
        }

        if (payload?.type !== "chunk") {
          return;
        }

        const normalizedChunk = toChunkArray(payload.chunk);
        if (normalizedChunk && normalizedChunk.length > 0) {
          options.onChunk(normalizedChunk);
        }
      };

      source.connect(processor);

      streamRef.current = stream;
      sourceRef.current = source;
      audioContextRef.current = audioContext;
      processorRef.current = processor;
    } catch (error) {
      options.onError(error instanceof Error ? error.message : "Microphone initialization failed");
    }
  }, [options]);

  return {
    startMic,
    stopMic
  };
}
