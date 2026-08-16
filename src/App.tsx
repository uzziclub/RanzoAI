import { useEffect, useState } from "react";
import { ranzo } from "./bridge";
import type { UserAccount } from "../shared/types";
import { AuthScreen } from "./screens/AuthScreen";
import { SetupWizard } from "./screens/SetupWizard";
import { MainShell } from "./screens/MainShell";
import { CopilotBar } from "./screens/CopilotBar";
import { MiniOrb } from "./screens/MiniOrb";
import { QuickCapture } from "./screens/QuickCapture";

type Phase = "loading" | "auth" | "setup" | "main";

export function App() {
  const route = window.location.hash.replace(/^#/, "") || "/";
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<UserAccount | null>(null);

  useEffect(() => {
    if (route !== "/") {
      document.body.classList.add("transparent");
      return;
    }
    void (async () => {
      const u = await ranzo.currentUser();
      if (!u) { setPhase("auth"); return; }
      setUser(u);
      const done = await ranzo.isSetupComplete();
      setPhase(done ? "main" : "setup");
    })();
  }, [route]);

  if (route === "/copilot-bar") return <CopilotBar />;
  if (route === "/mini-orb") return <MiniOrb />;
  if (route === "/quick-capture") return <QuickCapture />;

  if (phase === "loading") {
    return (
      <div className="center-screen">
        <div className="orb starting" style={{ width: 120, height: 120 }} />
      </div>
    );
  }
  if (phase === "auth") {
    return (
      <AuthScreen
        onAuthed={async (u) => {
          setUser(u);
          const done = await ranzo.isSetupComplete();
          setPhase(done ? "main" : "setup");
        }}
      />
    );
  }
  if (phase === "setup") {
    return <SetupWizard onDone={() => setPhase("main")} />;
  }
  return (
    <MainShell
      user={user!}
      onLogout={async () => {
        await ranzo.logout();
        setUser(null);
        setPhase("auth");
      }}
    />
  );
}
