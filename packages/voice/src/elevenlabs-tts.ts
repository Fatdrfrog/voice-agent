import type { ElevenLabsConfig } from "@voice-dev-agent/contracts";

interface ElevenLabsSynthesisOptions {
  modelId?: string;
  outputFormat?: string;
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  };
}

export class ElevenLabsTtsClient {
  private readonly config: ElevenLabsConfig;

  public constructor(config: ElevenLabsConfig) {
    this.config = config;
  }

  public async synthesize(text: string, options: ElevenLabsSynthesisOptions = {}): Promise<Buffer> {
    const endpoint = `${this.config.baseUrl}/v1/text-to-speech/${this.config.voiceId}/stream`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        "xi-api-key": this.config.apiKey
      },
      body: JSON.stringify({
        text,
        model_id: options.modelId ?? this.config.modelId,
        output_format: options.outputFormat ?? "mp3_44100_128",
        voice_settings: {
          stability: options.voiceSettings?.stability ?? 0.45,
          similarity_boost: options.voiceSettings?.similarityBoost ?? 0.75,
          style: options.voiceSettings?.style ?? 0.2,
          use_speaker_boost: options.voiceSettings?.useSpeakerBoost ?? true
        }
      })
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`ElevenLabs synthesis failed (${response.status}): ${message}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  }
}
