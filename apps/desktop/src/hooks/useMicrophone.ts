import { useCallback, useRef } from "react";

function float32ToInt16(input: Float32Array): number[] {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return Array.from(output);
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const stopMic = useCallback(async () => {
    processorRef.current?.disconnect();
    processorRef.current = null;

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
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);

      processor.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        options.onChunk(float32ToInt16(channelData));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      streamRef.current = stream;
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
