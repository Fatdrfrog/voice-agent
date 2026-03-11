export type VoiceOrbState = "idle" | "listening" | "thinking" | "talking" | "error";

interface VoiceOrbProps {
  state: VoiceOrbState;
}

export function VoiceOrb({ state }: VoiceOrbProps) {
  return (
    <div className={`voice-orb voice-orb--${state}`} aria-hidden="true">
      <div className="voice-orb__halo voice-orb__halo--outer" />
      <div className="voice-orb__halo voice-orb__halo--inner" />
      <div className="voice-orb__core">
        <div className="voice-orb__swirl voice-orb__swirl--primary" />
        <div className="voice-orb__swirl voice-orb__swirl--secondary" />
        <div className="voice-orb__shine" />
      </div>
    </div>
  );
}
