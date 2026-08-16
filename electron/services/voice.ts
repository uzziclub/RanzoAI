// VoiceService — TTS via Edge-TTS (msedge-tts, free, no key). Audio is
// synthesized in the main process and handed to the renderer as base64 so the
// renderer never needs network access.
//
// Voice policy (owner's rule): ONLY the most natural neural voices ship, male
// and female, curated in shared/voices.ts. Multilingual voices speak Urdu,
// Arabic, and Hindi themselves; classic voices hand off to the most natural
// native voice of the SAME GENDER so Ranzo never changes character
// mid-conversation. If a voice fails at runtime, one same-gender fallback is
// tried before giving up honestly.
//
// STT runs in the renderer through the platform speech engine where available;
// the offline faster-whisper sidecar is an optional add-on (see README).

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { getSettings } from "./settings";
import { resolveVoiceForLanguage, fallbackVoice, DEFAULT_VOICE, voiceById } from "../../shared/voices";
import { log } from "./logger";

let activeTts: MsEdgeTTS | null = null;

function detectLanguage(text: string): string {
  if (/[\u0600-\u06FF]/.test(text)) {
    // Arabic script — could be Urdu or Arabic. Urdu-specific letters:
    return /[\u0679\u0688\u0691\u06BA\u06BE\u06C1\u06D2]/.test(text) ? "ur" : "ar";
  }
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  return "en";
}

async function synthesizeWith(voice: string, text: string): Promise<Buffer> {
  const s = getSettings();
  const tts = new MsEdgeTTS();
  activeTts = tts;
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const rate = s.whisperMode ? Math.min(s.ttsRate, 0.9) : s.ttsRate;
    const ratePct = `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;
    const pitchHz = `${s.ttsPitch >= 0 ? "+" : ""}${s.ttsPitch}Hz`;
    const volume = s.whisperMode ? "-40%" : "+0%";
    const { audioStream } = tts.toStream(text, { rate: ratePct, pitch: pitchHz, volume });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TTS timed out")), 30_000);
      audioStream.on("data", (c: Buffer) => chunks.push(c));
      audioStream.on("end", () => { clearTimeout(timer); resolve(); });
      audioStream.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });
    const audio = Buffer.concat(chunks);
    if (audio.length === 0) throw new Error("TTS returned empty audio");
    return audio;
  } finally {
    try { tts.close(); } catch { /* fine */ }
    if (activeTts === tts) activeTts = null;
  }
}

export async function synthesize(text: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }> {
  const s = getSettings();
  const chosen = voiceById(s.ttsVoice) ? s.ttsVoice : DEFAULT_VOICE;
  const lang = s.language === "auto" ? detectLanguage(text) : s.language;
  const voice = resolveVoiceForLanguage(chosen, lang);
  try {
    const audio = await synthesizeWith(voice, text);
    return { ok: true, audioBase64: audio.toString("base64") };
  } catch (err) {
    log("warn", "voice", `Voice ${voice} failed (${String(err)}), trying same-gender fallback.`);
    try {
      const audio = await synthesizeWith(fallbackVoice(chosen), text);
      return { ok: true, audioBase64: audio.toString("base64") };
    } catch (err2) {
      log("warn", "voice", `Fallback voice also failed: ${String(err2)}`);
      return {
        ok: false,
        error: "I couldn't produce speech just now — it usually means the voice service is unreachable. Text replies keep working either way.",
      };
    }
  }
}

/** Speak a short sample line so the user can hear a voice before choosing it. */
export async function synthesizeSample(voiceId: string, lang: string, sampleText: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }> {
  try {
    const voice = resolveVoiceForLanguage(voiceId, lang);
    const audio = await synthesizeWith(voice, sampleText);
    return { ok: true, audioBase64: audio.toString("base64") };
  } catch (err) {
    log("warn", "voice", `Sample failed for ${voiceId}: ${String(err)}`);
    return { ok: false, error: "Couldn't play the sample — the voice service looks unreachable right now." };
  }
}

export function stopSynthesis() {
  try { activeTts?.close(); } catch { /* fine */ }
  activeTts = null;
}
