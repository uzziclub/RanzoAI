// Mini mode — a small floating orb-only window. Click to expand back.

import { useEffect, useState } from "react";
import { ranzo } from "../bridge";
import type { AgentState } from "../../shared/types";

export function MiniOrb() {
  const [agentState, setAgentState] = useState<AgentState>("idle");

  useEffect(() => {
    const off = ranzo.on("agent-state", (s) => setAgentState(s as AgentState));
    return off;
  }, []);

  return (
    <div className="mini-orb-window">
      <div
        className={`orb ${agentState}`}
        title="Click to open Ranzo"
        onClick={() => void ranzo.restoreMainWindow()}
      />
    </div>
  );
}
