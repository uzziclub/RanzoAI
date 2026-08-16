// VoicePicker — renders ONLY the curated natural voices, grouped male/female,
// each with a "listen" preview so the user hears it before committing.

import { useRef, useState } from "react";
import { ranzo } from "../bridge";
import { CURATED_VOICES, type VoiceGender } from "../../shared/voices";

export function VoicePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function listen(id: string) {
    audioRef.current?.pause();
    if (playing === id) { setPlaying(null); return; }
    setPlaying(id);
    setError("");
    const res = await ranzo.previewVoice(id);
    if (!res.ok || !res.audioBase64) {
      setPlaying(null);
      setError(res.error ?? "Couldn't play the sample.");
      return;
    }
    const audio = new Audio(`data:audio/mp3;base64,${res.audioBase64}`);
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    void audio.play().catch(() => setPlaying(null));
  }

  const groups: { gender: VoiceGender; title: string }[] = [
    { gender: "male", title: "Male voices" },
    { gender: "female", title: "Female voices" },
  ];

  return (
    <div className="stack" style={{ gap: 12 }}>
      {groups.map((g) => (
        <div key={g.gender}>
          <label className="field-label">{g.title}</label>
          <div className="stack" style={{ gap: 6 }}>
            {CURATED_VOICES.filter((v) => v.gender === g.gender).map((v) => (
              <div
                key={v.id}
                className="spread clay-card"
                style={{
                  padding: "8px 12px",
                  boxShadow: value === v.id ? "var(--clay-pressed)" : "var(--clay-sm)",
                  background: value === v.id ? "var(--blue-ghost)" : "var(--cream-soft)",
                  cursor: "pointer",
                }}
                onClick={() => onChange(v.id)}
              >
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ width: 16, textAlign: "center" }}>{value === v.id ? "●" : "○"}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{v.label.split(" — ")[0]}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{v.label.split(" — ")[1]}</div>
                  </div>
                </div>
                <button
                  className={`clay-btn subtle ${playing === v.id ? "on" : ""}`}
                  style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }}
                  onClick={(e) => { e.stopPropagation(); void listen(v.id); }}
                  title="Hear a sample"
                >
                  {playing === v.id ? "◼ Stop" : "▶ Listen"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {error && <p className="small muted">{error}</p>}
      <p className="small muted">
        Voices marked "speaks every language" keep the same natural voice in English, Urdu, Arabic, and Hindi. The classic English voices hand off to an equally natural native voice of the same gender for other languages.
      </p>
    </div>
  );
}
