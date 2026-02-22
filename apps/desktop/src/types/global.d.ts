import type { AcpSnippet, FeatureFlags, VoiceEvent, WorkspaceConfig } from "@voice-dev-agent/contracts";

declare global {
  interface Window {
    voiceApi: {
      startListening(): Promise<void>;
      stopListening(): Promise<void>;
      pauseListening(): Promise<void>;
      resumeListening(): Promise<void>;
      submitTranscript(text: string): Promise<void>;
      pushAudioChunk(chunk: number[]): Promise<void>;
      flushAudio(): Promise<void>;
      listWorkspaces(): Promise<WorkspaceConfig[]>;
      switchWorkspace(workspaceId: string): Promise<void>;
      fetchGatewayHealth(): Promise<void>;
      fetchGatewayStatus(): Promise<void>;
      addAllowlist(pattern: string): Promise<void>;
      removeAllowlist(pattern: string): Promise<void>;
      fetchApprovals(): Promise<void>;
      getAcpSnippets(): Promise<AcpSnippet[]>;
      getFeatureFlags(): Promise<FeatureFlags>;
      getCallStatus(callId: string): Promise<void>;
      endCall(callId: string): Promise<void>;
      onVoiceEvent(handler: (event: VoiceEvent) => void): () => void;
      onTtsAudio(handler: (payload: { mimeType: string; base64: string }) => void): () => void;
    };
  }
}

export {};
