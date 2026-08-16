import { useEffect, useState } from "react";
import { ranzo } from "../bridge";
import type { AppSettings, DiagnosticsInfo, KnowledgeStatus } from "../../shared/types";
import { VoicePicker } from "../components/VoicePicker";

const TABS = ["Voice", "Language", "AI Providers", "Memory", "Permissions", "Performance", "Privacy", "Notifications", "Shortcuts", "Advanced & Diagnostics"] as const;
type Tab = (typeof TABS)[number];

export function SettingsModal({ onClose, onSpeakRepliesChange }: { onClose: () => void; onSpeakRepliesChange: (v: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("Voice");
  const [s, setS] = useState<AppSettings | null>(null);
  const [diag, setDiag] = useState<DiagnosticsInfo | null>(null);
  const [know, setKnow] = useState<KnowledgeStatus | null>(null);
  const [saveNote, setSaveNote] = useState("");

  useEffect(() => {
    void ranzo.getSettings().then(setS);
    void ranzo.knowledgeStatus().then(setKnow);
  }, []);
  useEffect(() => {
    if (tab === "Advanced & Diagnostics") void ranzo.diagnostics().then(setDiag);
  }, [tab]);

  async function patch(p: Partial<AppSettings>) {
    const next = await ranzo.saveSettings(p);
    setS(next);
    if (p.speakReplies !== undefined) onSpeakRepliesChange(p.speakReplies);
    setSaveNote("Saved");
    setTimeout(() => setSaveNote(""), 1200);
  }

  if (!s) return null;

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)} aria-pressed={value} />
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="clay-card modal" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 18 }}>Settings {saveNote && <span className="small muted">· {saveNote}</span>}</h2>
          <button className="clay-btn subtle" onClick={onClose}>Close</button>
        </div>
        <div className="tab-row" style={{ marginBottom: 18 }}>
          {TABS.map((t) => (
            <button key={t} className={`clay-btn ${t === tab ? "on" : "subtle"}`} style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {tab === "Voice" && (
          <div className="stack">
            <VoicePicker value={s.ttsVoice} onChange={(id) => void patch({ ttsVoice: id })} />
            <p className="small muted">These voices are free. When the internet is down, spoken replies pause but text keeps working.</p>
            <div>
              <label className="field-label">Speed: {s.ttsRate.toFixed(2)}×</label>
              <input type="range" min={0.5} max={2} step={0.05} value={s.ttsRate} onChange={(e) => void patch({ ttsRate: Number(e.target.value) })} style={{ width: "100%" }} />
            </div>
            <div>
              <label className="field-label">Pitch: {s.ttsPitch > 0 ? "+" : ""}{s.ttsPitch} Hz</label>
              <input type="range" min={-50} max={50} step={5} value={s.ttsPitch} onChange={(e) => void patch({ ttsPitch: Number(e.target.value) })} style={{ width: "100%" }} />
            </div>
            <div className="spread"><span>Speak replies out loud</span><Toggle value={s.speakReplies} onChange={(v) => void patch({ speakReplies: v })} /></div>
            <div className="spread">
              <span>Whisper mode <span className="small muted">(quieter, shorter, for shared rooms)</span></span>
              <Toggle value={s.whisperMode} onChange={(v) => void patch({ whisperMode: v })} />
            </div>
            <div>
              <label className="field-label">Wake-word sensitivity: {Math.round(s.wakeWordSensitivity * 100)}%</label>
              <input type="range" min={0.1} max={1} step={0.05} value={s.wakeWordSensitivity} onChange={(e) => void patch({ wakeWordSensitivity: Number(e.target.value) })} style={{ width: "100%" }} />
              <p className="small muted">The "Ranzo" wake word needs a free Picovoice key — add it under AI Providers. Until then, use push-to-talk or Live mode.</p>
            </div>
          </div>
        )}

        {tab === "Language" && (
          <div className="stack">
            <div>
              <label className="field-label">Language</label>
              <select className="clay-input" value={s.language} onChange={(e) => void patch({ language: e.target.value as AppSettings["language"] })}>
                <option value="auto">Auto-detect (recommended)</option>
                <option value="en">English</option>
                <option value="ur">اردو — Urdu</option>
                <option value="ar">العربية — Arabic</option>
                <option value="hi">हिन्दी — Hindi</option>
              </select>
            </div>
            <div className="spread">
              <span>Language lock <span className="small muted">(always reply in the chosen language)</span></span>
              <Toggle value={s.languageLock} onChange={(v) => void patch({ languageLock: v })} />
            </div>
            <p className="small muted">With auto-detect, Ranzo follows you mid-conversation — including mixed Urdu-English.</p>
          </div>
        )}

        {tab === "AI Providers" && (
          <div className="stack">
            <div className="spread">
              <span><b>Force offline</b> <span className="small muted">— never touch the cloud, even as fallback</span></span>
              <Toggle value={s.forceOffline} onChange={(v) => void patch({ forceOffline: v })} />
            </div>
            <div>
              <label className="field-label">Ollama URL</label>
              <input className="clay-input" value={s.ollamaUrl} onChange={(e) => setS({ ...s, ollamaUrl: e.target.value })} onBlur={() => void patch({ ollamaUrl: s.ollamaUrl })} />
            </div>
            <div>
              <label className="field-label">Local model</label>
              <select className="clay-input" value={s.ollamaModel} onChange={(e) => void patch({ ollamaModel: e.target.value })}>
                <option value="llama3.1:8b-instruct-q4_K_M">Llama 3.1 8B (standard)</option>
                <option value="qwen2.5:3b-instruct-q4_K_M">Qwen 2.5 3B (weak hardware)</option>
                <option value="phi3:mini">Phi-3 mini (weak hardware)</option>
              </select>
            </div>
            <p className="small muted">Free cloud fallbacks (all optional — leave blank to skip a provider):</p>
            {([
              ["geminiKey", "Google AI Studio key (Gemini, free tier)"],
              ["openrouterKey", "OpenRouter key (free models)"],
              ["huggingfaceKey", "Hugging Face token"],
              ["tavilyKey", "Tavily key (live web search)"],
              ["picovoiceKey", "Picovoice key (wake word)"],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className="field-label">{label}</label>
                <input className="clay-input" type="password" value={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.value })} onBlur={() => void patch({ [key]: s[key] } as Partial<AppSettings>)} placeholder="not set" />
              </div>
            ))}
            <p className="small muted">Licensing (for centrally managing user access — optional):</p>
            <div>
              <label className="field-label">Supabase URL</label>
              <input className="clay-input" value={s.supabaseUrl} onChange={(e) => setS({ ...s, supabaseUrl: e.target.value })} onBlur={() => void patch({ supabaseUrl: s.supabaseUrl })} placeholder="https://xxxx.supabase.co" />
            </div>
            <div>
              <label className="field-label">Supabase anon key</label>
              <input className="clay-input" type="password" value={s.supabaseAnonKey} onChange={(e) => setS({ ...s, supabaseAnonKey: e.target.value })} onBlur={() => void patch({ supabaseAnonKey: s.supabaseAnonKey })} placeholder="not set" />
            </div>
          </div>
        )}

        {tab === "Memory" && (
          <div className="stack">
            <div className="spread"><span>Remember useful facts automatically</span><Toggle value={s.memoryEnabled} onChange={(v) => void patch({ memoryEnabled: v })} /></div>
            <div className="spread">
              <span>Pause memory <span className="small muted">(this session isn't remembered)</span></span>
              <Toggle value={s.memoryPaused} onChange={(v) => void patch({ memoryPaused: v })} />
            </div>
            <div className="row">
              <button className="clay-btn" onClick={() => void ranzo.exportMemories()}>Export memories…</button>
              <button className="clay-btn" onClick={() => void ranzo.importMemories()}>Import…</button>
            </div>
            <p className="small muted">Everything Ranzo remembers is visible in the Memory Viewer. Passwords and keys are never stored, by rule.</p>
            <hr style={{ border: "none", borderTop: "1px solid var(--blue-ghost)" }} />
            <div>
              <label className="field-label">Your documents — local knowledge base (offline Q&A)</label>
              <p className="small muted" style={{ marginBottom: 8 }}>Point Ranzo at folders and it can answer questions about your own files. Indexing is fully local — nothing is uploaded, ever.</p>
              {know && know.folders.length > 0 && (
                <div className="stack" style={{ gap: 6, marginBottom: 8 }}>
                  {know.folders.map((f) => (
                    <div key={f} className="spread clay-card" style={{ padding: "6px 12px", boxShadow: "var(--clay-sm)" }}>
                      <span className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
                      <button className="clay-btn subtle" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => void ranzo.removeKnowledgeFolder(f).then(setKnow)}>Remove</button>
                    </div>
                  ))}
                  <p className="small muted">{know.chunks} chunks indexed{know.indexedAt ? ` · last refreshed ${new Date(know.indexedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""} · auto-refreshes as files change</p>
                </div>
              )}
              <div className="row">
                <button className="clay-btn" onClick={() => void ranzo.addKnowledgeFolder().then(setKnow)}>Add folder…</button>
                {know && know.folders.length > 0 && (
                  <button className="clay-btn subtle" onClick={() => void ranzo.rebuildKnowledge().then(setKnow)}>Re-index now</button>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "Permissions" && (
          <div className="stack">
            <div className="spread">
              <span>Confirm destructive actions <span className="small muted">(always on — core safety rule)</span></span>
              <Toggle value={true} onChange={() => undefined} />
            </div>
            <div>
              <label className="field-label">Safe zones — folders that always require confirmation</label>
              <textarea
                className="clay-input"
                rows={3}
                value={s.safeZones.join("\n")}
                onChange={(e) => setS({ ...s, safeZones: e.target.value.split("\n").filter(Boolean) })}
                onBlur={() => void patch({ safeZones: s.safeZones })}
                placeholder={"C:\\Users\\you\\Documents\\Private"}
              />
            </div>
            <p className="small muted">How the tiers work: read-only actions just run; reversible ones run and get logged; destructive ones always ask first, in plain words. Say "undo that" for anything reversible.</p>
          </div>
        )}

        {tab === "Performance" && (
          <div className="stack">
            <div>
              <label className="field-label">Hardware tier</label>
              <select className="clay-input" value={s.hardwareTierOverride} onChange={(e) => void patch({ hardwareTierOverride: e.target.value as AppSettings["hardwareTierOverride"] })}>
                <option value="auto">Automatic (benchmark decides)</option>
                <option value="low">Force low — save battery / old hardware</option>
                <option value="mid">Force mid</option>
                <option value="high">Force high</option>
              </select>
            </div>
            <div>
              <label className="field-label">Release idle model after (minutes): {s.idleModelReleaseMinutes}</label>
              <input type="range" min={0} max={60} step={5} value={s.idleModelReleaseMinutes} onChange={(e) => void patch({ idleModelReleaseMinutes: Number(e.target.value) })} style={{ width: "100%" }} />
              <p className="small muted">Frees RAM on weak machines when Ranzo hasn't been used for a while. 0 = keep loaded forever.</p>
            </div>
          </div>
        )}

        {tab === "Privacy" && (
          <div className="stack">
            <p><b>What leaves this machine:</b> nothing, unless you allow it.</p>
            <p className="small">• Questions answered by the local brain stay local. Cloud fallback only runs when the local brain can't answer and you haven't forced offline.<br />• Files, screenshots, clipboard, and voice are never uploaded silently.<br />• There is no telemetry endpoint in this app at all. Diagnostics exports are files you choose to share by hand.</p>
            <div className="spread">
              <span>Telemetry</span>
              <span className="clay-chip">Off — not built in</span>
            </div>
          </div>
        )}

        {tab === "Notifications" && (
          <div className="stack">
            <div className="spread"><span>Morning briefing (8:00 AM, one notification)</span><Toggle value={s.briefingEnabled} onChange={(v) => void patch({ briefingEnabled: v })} /></div>
            <div>
              <label className="field-label">Briefing hour: {s.briefingHour}:00</label>
              <input type="range" min={5} max={12} step={1} value={s.briefingHour} onChange={(e) => void patch({ briefingHour: Number(e.target.value) })} style={{ width: "100%" }} />
            </div>
            <p className="small muted">All alerts funnel through one queue — Ranzo never spams separate Windows popups.</p>
          </div>
        )}

        {tab === "Shortcuts" && (
          <div className="stack small">
            <div className="spread"><span>Push to talk</span><kbd>{s.pushToTalkHotkey}</kbd></div>
            <div className="spread"><span>Command palette</span><kbd>{s.commandPaletteHotkey}</kbd></div>
            <div className="spread"><span>Quick capture</span><kbd>{s.quickCaptureHotkey}</kbd></div>
            <p className="muted">Hotkey remapping lands in a future update; these are the current bindings.</p>
          </div>
        )}

        {tab === "Advanced & Diagnostics" && (
          <div className="stack">
            <div>
              <label className="field-label">Persona</label>
              <select className="clay-input" value={s.persona} onChange={(e) => void patch({ persona: e.target.value as AppSettings["persona"] })}>
                <option value="natural">Natural — plain, everyday, human</option>
                <option value="professional">Professional — concise and formal</option>
                <option value="witty">Witty — dry humor, still useful</option>
                <option value="focused">Focused — no small talk</option>
                <option value="custom">Custom…</option>
              </select>
              {s.persona === "custom" && (
                <input className="clay-input" style={{ marginTop: 8 }} placeholder="Describe the tone you want…" value={s.customPersona} onChange={(e) => setS({ ...s, customPersona: e.target.value })} onBlur={() => void patch({ customPersona: s.customPersona })} />
              )}
              <p className="small muted" style={{ marginTop: 4 }}>
                Preview: {s.persona === "natural" && `"Sure — done. Anything else?"`}
                {s.persona === "professional" && `"Completed. The file has been moved as requested."`}
                {s.persona === "witty" && `"Done. That folder won't know what hit it."`}
                {s.persona === "focused" && `"Done."`}
                {s.persona === "custom" && `(Ranzo adopts whatever tone you describe.)`}
              </p>
            </div>
            <button className="clay-btn" onClick={() => void ranzo.exportDiagnostics()}>Export diagnostics bundle…</button>
            {diag && (
              <>
                <p className="small"><b>Recent providers:</b> {diag.providerLog.length === 0 ? "none yet" : diag.providerLog.slice(0, 6).map((p) => `${p.provider} ${p.ok ? "✓" : "✗"} ${(p.latencyMs / 1000).toFixed(1)}s`).join(" · ")}</p>
                <div className="clay-card" style={{ padding: 12, boxShadow: "var(--clay-pressed)", maxHeight: 160, overflowY: "auto" }}>
                  <pre className="small muted" style={{ whiteSpace: "pre-wrap", fontFamily: "Consolas, monospace", fontSize: 10.5 }}>
                    {diag.logTail.join("\n") || "Log is empty."}
                  </pre>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
