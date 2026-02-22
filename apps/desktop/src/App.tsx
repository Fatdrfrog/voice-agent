import { useEffect, useMemo, useRef, useState } from "react";

import type { AcpSnippet, VoiceEvent, WorkspaceConfig } from "@voice-dev-agent/contracts";

import { useMicrophone } from "./hooks/useMicrophone";

function useVoiceEvents(): [VoiceEvent[], React.Dispatch<React.SetStateAction<VoiceEvent[]>>] {
  const [events, setEvents] = useState<VoiceEvent[]>([]);

  useEffect(() => {
    const unsubscribe = window.voiceApi.onVoiceEvent((event) => {
      setEvents((current) => [event, ...current].slice(0, 200));
    });

    return unsubscribe;
  }, []);

  return [events, setEvents];
}

export function App() {
  const [events, setEvents] = useVoiceEvents();
  const [workspaces, setWorkspaces] = useState<WorkspaceConfig[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [transcriptInput, setTranscriptInput] = useState("");
  const [allowlistInput, setAllowlistInput] = useState("");
  const [callId, setCallId] = useState("");
  const [acpSnippets, setAcpSnippets] = useState<AcpSnippet[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Idle");

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { startMic, stopMic } = useMicrophone({
    onChunk: (chunk: number[]) => {
      void window.voiceApi.pushAudioChunk(chunk);
    },
    onError: (message: string) => {
      setStatusMessage(`Mic error: ${message}`);
    }
  });

  useEffect(() => {
    void window.voiceApi.listWorkspaces().then((items) => {
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id ?? "");
    });

    void window.voiceApi.getAcpSnippets().then((snippets) => {
      setAcpSnippets(snippets);
    });
  }, []);

  useEffect(() => {
    const unsubscribe = window.voiceApi.onTtsAudio((payload) => {
      const src = `data:${payload.mimeType};base64,${payload.base64}`;
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      audioRef.current.src = src;
      void audioRef.current.play();
    });

    return unsubscribe;
  }, []);

  const latestReply = useMemo(() => {
    const reply = events.find((event) => event.type === "agent.reply");
    if (!reply) {
      return "";
    }

    const payload = reply.payload as { text?: string };
    return payload.text ?? "";
  }, [events]);

  async function handleStartListening(): Promise<void> {
    await window.voiceApi.startListening();
    await startMic();
    setIsListening(true);
    setStatusMessage("Listening");
  }

  async function handleStopListening(): Promise<void> {
    await stopMic();
    await window.voiceApi.flushAudio();
    await window.voiceApi.stopListening();
    setIsListening(false);
    setStatusMessage("Stopped");
  }

  async function handlePause(): Promise<void> {
    await stopMic();
    await window.voiceApi.pauseListening();
    setStatusMessage("Paused");
  }

  async function handleResume(): Promise<void> {
    await startMic();
    await window.voiceApi.resumeListening();
    setStatusMessage("Listening");
  }

  async function handleSubmitTranscript(): Promise<void> {
    if (!transcriptInput.trim()) {
      return;
    }
    await window.voiceApi.submitTranscript(transcriptInput.trim());
    setTranscriptInput("");
  }

  async function handleSwitchWorkspace(nextWorkspaceId: string): Promise<void> {
    setWorkspaceId(nextWorkspaceId);
    await window.voiceApi.switchWorkspace(nextWorkspaceId);
    setStatusMessage(`Workspace switched to ${nextWorkspaceId}`);
    const snippets = await window.voiceApi.getAcpSnippets();
    setAcpSnippets(snippets);
  }

  async function handleAddAllowlist(): Promise<void> {
    if (!allowlistInput.trim()) {
      return;
    }
    await window.voiceApi.addAllowlist(allowlistInput.trim());
    setAllowlistInput("");
  }

  async function handleRemoveAllowlist(): Promise<void> {
    if (!allowlistInput.trim()) {
      return;
    }
    await window.voiceApi.removeAllowlist(allowlistInput.trim());
    setAllowlistInput("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1>Voice Dev Agent</h1>
        <p>{statusMessage}</p>
      </header>

      <section className="panel-grid">
        <article className="panel">
          <h2>Voice Controls</h2>
          <div className="actions">
            <button onClick={() => void handleStartListening()} disabled={isListening}>
              Start Listening
            </button>
            <button onClick={() => void handleStopListening()} disabled={!isListening}>
              Stop Listening
            </button>
            <button onClick={() => void handlePause()} disabled={!isListening}>
              Pause
            </button>
            <button onClick={() => void handleResume()} disabled={!isListening}>
              Resume
            </button>
          </div>
          <textarea
            value={transcriptInput}
            onChange={(event) => setTranscriptInput(event.target.value)}
            placeholder="Type a transcript if you want to test without microphone"
          />
          <button onClick={() => void handleSubmitTranscript()}>Submit Transcript</button>
          <div className="reply-box">
            <strong>Latest Reply</strong>
            <p>{latestReply || "No agent reply yet."}</p>
          </div>
        </article>

        <article className="panel">
          <h2>Workspace + ACP</h2>
          <label htmlFor="workspace-select">Workspace</label>
          <select
            id="workspace-select"
            value={workspaceId}
            onChange={(event) => void handleSwitchWorkspace(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.id}
              </option>
            ))}
          </select>

          <div className="snippet-list">
            {acpSnippets.map((snippet) => (
              <div key={snippet.title} className="snippet-item">
                <h3>{snippet.title}</h3>
                <pre>{snippet.content}</pre>
                <button
                  onClick={() => void navigator.clipboard.writeText(snippet.content)}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>Execution Guardrails</h2>
          <input
            value={allowlistInput}
            onChange={(event) => setAllowlistInput(event.target.value)}
            placeholder="Command path pattern, e.g. /usr/bin/git"
          />
          <div className="actions">
            <button onClick={() => void handleAddAllowlist()}>Add Allowlist</button>
            <button onClick={() => void handleRemoveAllowlist()}>Remove Allowlist</button>
            <button onClick={() => void window.voiceApi.fetchApprovals()}>Fetch Approvals Snapshot</button>
          </div>

          <div className="actions">
            <button onClick={() => void window.voiceApi.fetchGatewayHealth()}>Gateway Health</button>
            <button onClick={() => void window.voiceApi.fetchGatewayStatus()}>Gateway Status</button>
          </div>
        </article>

        <article className="panel">
          <h2>Call Diagnostics</h2>
          <input
            value={callId}
            onChange={(event) => setCallId(event.target.value)}
            placeholder="OpenClaw callId"
          />
          <div className="actions">
            <button onClick={() => void window.voiceApi.getCallStatus(callId)} disabled={!callId.trim()}>
              Get Call Status
            </button>
            <button onClick={() => void window.voiceApi.endCall(callId)} disabled={!callId.trim()}>
              End Call
            </button>
          </div>
        </article>
      </section>

      <section className="panel events-panel">
        <div className="events-header">
          <h2>Voice Event Log</h2>
          <button onClick={() => setEvents([])}>Clear</button>
        </div>
        <ul>
          {events.map((event, index) => (
            <li key={`${event.timestamp}-${event.type}-${index}`}>
              <strong>{event.type}</strong>
              <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
              <pre>{JSON.stringify(event.payload, null, 2)}</pre>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

