import { contextBridge, ipcRenderer } from "electron";

const api = {
  startListening: () => ipcRenderer.invoke("voice:start-listening"),
  stopListening: () => ipcRenderer.invoke("voice:stop-listening"),
  pauseListening: () => ipcRenderer.invoke("voice:pause-listening"),
  resumeListening: () => ipcRenderer.invoke("voice:resume-listening"),
  submitTranscript: (text) => ipcRenderer.invoke("voice:submit-transcript", text),
  pushAudioChunk: (chunk) => ipcRenderer.invoke("voice:audio-chunk", chunk),
  flushAudio: () => ipcRenderer.invoke("voice:flush-audio"),
  listWorkspaces: () => ipcRenderer.invoke("workspace:list"),
  switchWorkspace: (workspaceId) => ipcRenderer.invoke("workspace:switch", workspaceId),
  fetchGatewayHealth: () => ipcRenderer.invoke("gateway:health"),
  fetchGatewayStatus: () => ipcRenderer.invoke("gateway:status"),
  addAllowlist: (pattern) => ipcRenderer.invoke("allowlist:add", pattern),
  removeAllowlist: (pattern) => ipcRenderer.invoke("allowlist:remove", pattern),
  fetchApprovals: () => ipcRenderer.invoke("approvals:fetch"),
  getAcpSnippets: () => ipcRenderer.invoke("acp:snippets"),
  getCallStatus: (callId) => ipcRenderer.invoke("call:status", callId),
  endCall: (callId) => ipcRenderer.invoke("call:end", callId),
  onVoiceEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("voice:event", listener);
    return () => ipcRenderer.removeListener("voice:event", listener);
  },
  onTtsAudio: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("voice:tts-audio", listener);
    return () => ipcRenderer.removeListener("voice:tts-audio", listener);
  }
};

contextBridge.exposeInMainWorld("voiceApi", api);
