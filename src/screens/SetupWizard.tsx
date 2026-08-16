import { useEffect, useState } from "react";
import { ranzo, isDesktop } from "../bridge";
import type { EngineStatus, SystemInfo } from "../../shared/types";
import logo from "../../resources/icon-256.png";

const STEPS = ["Welcome", "Your machine", "Local brain", "Voice & language", "Ready"] as const;

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [ttsVoice, setTtsVoice] = useState("en-US-GuyNeural");
  const [language, setLanguage] = useState<"auto" | "en" | "ur" | "ar" | "hi">("auto");

  useEffect(() => {
    void ranzo.systemInfo().then(setSys);
    void ranzo.engineStatus().then(setEngine);
    const off = ranzo.on("engine-status", (s) => setEngine(s as EngineStatus));
    return off;
  }, []);

  async function startEngine() {
    setStarting(true);
    const s = await ranzo.startEngine();
    setEngine(s);
    setStarting(false);
  }

  async function finish() {
    await ranzo.saveSettings({ ttsVoice, language });
    await ranzo.completeSetup();
    onDone();
  }

  return (
    <div className="center-screen">
      <div className="clay-card" style={{ width: 620, padding: 36 }}>
        <div className="row" style={{ marginBottom: 20 }}>
          <img src={logo} width={44} height={44} style={{ borderRadius: 14 }} alt="" />
          <div>
            <h2 style={{ fontSize: 18 }}>Set up Ranzo</h2>
            <p className="small muted">Step {step + 1} of {STEPS.length} — {STEPS[step]}</p>
          </div>
        </div>

        <div style={{ minHeight: 260 }}>
          {step === 0 && (
            <div className="stack">
              <p>Ranzo is a desktop assistant that runs on <b>your</b> machine. It talks, remembers, and can operate the computer for you — and it works offline.</p>
              <p>This one-time setup checks your hardware, gets the local brain running, and picks a voice. It takes about two minutes (plus a one-time model download).</p>
              <p className="small muted">Nothing you do here is uploaded anywhere.</p>
            </div>
          )}

          {step === 1 && (
            <div className="stack">
              {sys ? (
                <>
                  <div className="clay-card" style={{ padding: 16, boxShadow: "var(--clay-sm)" }}>
                    <p><b>Processor:</b> {sys.cpuName}</p>
                    <p><b>Memory:</b> {sys.totalRamGb} GB</p>
                    <p><b>Performance tier:</b> {sys.hardwareTier}</p>
                  </div>
                  <p className="small">{sys.tierReason}</p>
                  <p className="small muted">You can override the tier later in Settings → Performance.</p>
                </>
              ) : <p className="muted">Checking your hardware…</p>}
            </div>
          )}

          {step === 2 && (
            <div className="stack">
              <p>Ranzo's offline brain is <b>Ollama</b> running <b>Llama 3.1</b> locally. It's free and private — your questions never leave the machine when it answers.</p>
              {engine && (
                <div className="clay-card" style={{ padding: 16, boxShadow: "var(--clay-sm)" }}>
                  <div className="row">
                    <span className={`badge-dot ${engine.state === "ready" ? "ok" : engine.state === "downloading-model" || engine.state === "starting" ? "warn" : "bad"}`} />
                    <b>{engine.state === "ready" ? "Local brain ready" : engine.state === "downloading-model" ? "Downloading model" : engine.state === "starting" ? "Starting…" : engine.state === "not-installed" ? "Ollama not installed" : "Engine stopped"}</b>
                  </div>
                  <p className="small muted" style={{ marginTop: 6 }}>{engine.detail}</p>
                </div>
              )}
              {engine?.state === "not-installed" && (
                <p className="small">
                  Install it from{" "}
                  <a href="https://ollama.com/download/windows" target="_blank" rel="noreferrer" style={{ color: "var(--blue-deep)", fontWeight: 700 }}>ollama.com/download</a>{" "}
                  (one click, free), then press the button below.
                </p>
              )}
              {engine?.state !== "ready" && (
                <button className="clay-btn primary" onClick={startEngine} disabled={starting}>
                  {starting ? "Starting…" : "Start engine"}
                </button>
              )}
              <p className="small muted">
                You can also skip this — Ranzo will fall back to its free cloud brains when online, and you can start the engine any time from the header.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="stack">
              <div>
                <label className="field-label">Voice</label>
                <select className="clay-input" value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)}>
                  <option value="en-US-GuyNeural">Guy — natural male (English)</option>
                  <option value="en-US-JennyNeural">Jenny — natural female (English)</option>
                  <option value="en-GB-RyanNeural">Ryan — British male</option>
                  <option value="ur-PK-AsadNeural">Asad — Urdu</option>
                  <option value="ar-SA-HamedNeural">Hamed — Arabic</option>
                  <option value="hi-IN-MadhurNeural">Madhur — Hindi</option>
                </select>
              </div>
              <div>
                <label className="field-label">Language</label>
                <select className="clay-input" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                  <option value="auto">Auto-detect (recommended)</option>
                  <option value="en">English only</option>
                  <option value="ur">Urdu only</option>
                  <option value="ar">Arabic only</option>
                  <option value="hi">Hindi only</option>
                </select>
              </div>
              <p className="small muted">Auto-detect replies in whatever language you use — including mid-conversation switches and mixed Urdu-English.</p>
            </div>
          )}

          {step === 4 && (
            <div className="stack">
              <p><b>You're set.</b> A few things worth knowing:</p>
              <p>• Hold <kbd>Ctrl</kbd>+<kbd>Space</kbd> to talk. Release to send.</p>
              <p>• <b>Mic</b> is push-to-talk, <b>Live</b> keeps listening, <b>Copilot</b> minimizes Ranzo to a floating bar.</p>
              <p>• Anything destructive — deleting files, running commands — always asks you first, in plain words.</p>
              <p>• The Memory Viewer shows everything Ranzo remembers. Say “forget this” anytime.</p>
              {!isDesktop && <p className="small muted">(You're in the browser preview — voice and system control activate in the installed Windows app.)</p>}
            </div>
          )}
        </div>

        <div className="spread" style={{ marginTop: 24 }}>
          <button className="clay-btn subtle" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</button>
          {step < STEPS.length - 1
            ? <button className="clay-btn primary" onClick={() => setStep(step + 1)}>Continue</button>
            : <button className="clay-btn primary" onClick={finish}>Open Ranzo</button>}
        </div>
      </div>
    </div>
  );
}
