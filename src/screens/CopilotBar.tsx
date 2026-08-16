// Copilot mode — the floating always-on-top bar shown when the main window is
// minimized, like Windows Copilot: mic, live, expand, quit.

import { useEffect, useState } from "react";
import { ranzo } from "../bridge";
import type { AgentState } from "../../shared/types";
import { useVoice } from "../hooks/useVoice";

export function CopilotBar() {
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [lastReply, setLastReply] = useState("");

  const voice = useVoice({
    onTranscript: (text) => {
      void (async () => {
        setAgentState("thinking");
        const res = await ranzo.ask(null, text);
        setLastReply(res.content);
        setAgentState("idle");
        void voice.speak(res.content);
      })();
    },
    onStateChange: setAgentState,
  });

  useEffect(() => {
    const off = ranzo.on("agent-state", (s) => setAgentState(s as AgentState));
    return off;
  }, []);

  return (
    <div style={{ padding: 4 }}>
      <div className="copilot-bar">
        <div className={`orb ${agentState}`} style={{ width: 40, height: 40, flexShrink: 0 }} />
        <button
          className={`clay-btn ${voice.listening && !voice.liveMode ? "on" : ""}`}
          onMouseDown={() => voice.startListening(false)}
          onMouseUp={() => { if (!voice.liveMode) voice.stopListening(); }}
          title="Hold to talk"
        >
          🎙
        </button>
        <button className={`clay-btn ${voice.liveMode ? "on" : ""}`} onClick={() => voice.toggleLive()} title="Live listening">⦿</button>
        <span className="small muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {agentState === "listening" ? "Listening…" : agentState === "thinking" ? "Thinking…" : agentState === "speaking" ? "Speaking…" : lastReply || "Ranzo is here"}
        </span>
        <button className="clay-btn" onClick={() => void ranzo.restoreMainWindow()} title="Open the full window">⤢</button>
      </div>
    </div>
  );
}
