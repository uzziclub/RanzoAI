// VoiceService — TTS via Edge-TTS (msedge-tts, free, no key). Audio is
// synthesized in the main process and handed to the renderer as base64 so the
// renderer never needs network access. STT runs in the renderer through the
// Web Speech layer where available; the offline faster-whisper sidecar is an
// optional add-on installed by the setup wizard (see README — voice section).

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { getSettings } from "./settings";
import { log } from "./logger";

let activeTts: MsEdgeTTS | null = null;

const VOICE_BY_LANG: Record<string, string> = {
  en: "en-US-GuyNeural",
  ur: "ur-PK-AsadNeural",
  ar: "ar-SA-HamedNeural",
  hi: "hi-IN-MadhurNeural",
};

function detectLanguage(text: string): string {
  if (/[\u0600-\u06FF]/.test(text)) {
    // Arabic script — could be Urdu or Arabic. Urdu-specific letters:
    return /[\u0679\u0688\u0691\u06BA\u06BE\u06C1\u06D2]/.test(text) ? "ur" : "ar";
  }
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  return "en";
}

export async function synthesize(text: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }> {
  const s = getSettings();
  try {
    const lang = s.language === "auto" ? detectLanguage(text) : s.language;
    const voice = s.language === "auto" && lang !== "en" ? (VOICE_BY_LANG[lang] ?? s.ttsVoice) : s.ttsVoice;
    const tts = new MsEdgeTTS();
    activeTts = tts;
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const rate = s.whisperMode ? Math.min(s.ttsRate, 0.9) : s.ttsRate;
    const ratePct = `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;
    const pitchHz = `${s.ttsPitch >= 0 ? "+" : ""}${s.ttsPitch}Hz`;
    const volume = s.whisperMode ? "-40%" : "+0%";
    const { audioStream } = tts.toStream(text, { rate: ratePct, pitch: pitchHz, volume });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (c: Buffer) => chunks.push(c));
      audioStream.on("end", () => resolve());
      audioStream.on("error", (e: Error) => reject(e));
    });
    activeTts = null;
    return { ok: true, audioBase64: Buffer.concat(chunks).toString("base64") };
  } catch (err) {
    activeTts = null;
    log("warn", "voice", `Edge-TTS failed: ${String(err)}`);
    return {
      ok: false,
      error: "I couldn't produce speech just now — it usually means the voice service is unreachable. Text replies keep working either way.",
    };
  }
}

export function stopSynthesis() {
  try { activeTts?.close(); } catch { /* fine */ }
  activeTts = null;
}
