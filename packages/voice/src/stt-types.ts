export interface RealtimeTranscriptPartial {
  type: "partial";
  text: string;
  languageCode?: string;
}

export interface RealtimeTranscriptFinal {
  type: "final";
  text: string;
  languageCode?: string;
}

export interface RealtimeTranscriptError {
  type: "error";
  message: string;
}

export interface RealtimeTranscriptState {
  type: "state";
  state: "connecting" | "connected" | "closed";
}

export type RealtimeTranscriptEvent =
  | RealtimeTranscriptPartial
  | RealtimeTranscriptFinal
  | RealtimeTranscriptError
  | RealtimeTranscriptState;
