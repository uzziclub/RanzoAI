// Curated voice catalog — ONLY the most natural Edge neural voices, male and
// female. Nothing robotic ships in this list, and the pickers in Setup and
// Settings render exclusively from here so no legacy voice can be selected.
//
// The "multilingual" voices are Microsoft's newest generation: one voice that
// speaks English, Urdu, Arabic, Hindi (and ~40 more) natively with the same
// natural timbre — which is exactly what Ranzo's auto language switching needs.

export type VoiceGender = "male" | "female";

export interface VoiceDef {
  id: string;
  label: string;
  gender: VoiceGender;
  multilingual: boolean;
}

export const CURATED_VOICES: VoiceDef[] = [
  // ---- male ----
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew — deep and warm, speaks every language", gender: "male", multilingual: true },
  { id: "en-US-BrianMultilingualNeural", label: "Brian — easy and conversational, speaks every language", gender: "male", multilingual: true },
  { id: "en-GB-RyanMultilingualNeural", label: "Ryan — British, calm and polished, speaks every language", gender: "male", multilingual: true },
  { id: "en-US-GuyNeural", label: "Guy — classic natural narrator (English)", gender: "male", multilingual: false },
  // ---- female ----
  { id: "en-US-AvaMultilingualNeural", label: "Ava — expressive and lifelike, speaks every language", gender: "female", multilingual: true },
  { id: "en-US-EmmaMultilingualNeural", label: "Emma — friendly and clear, speaks every language", gender: "female", multilingual: true },
  { id: "en-GB-AdaMultilingualNeural", label: "Ada — British, soft and precise, speaks every language", gender: "female", multilingual: true },
  { id: "en-US-JennyNeural", label: "Jenny — warm classic assistant (English)", gender: "female", multilingual: false },
];

export const DEFAULT_VOICE = "en-US-AndrewMultilingualNeural";

// Best native voice per language for NON-multilingual selections, kept in the
// same gender as the user's chosen voice so Ranzo never suddenly changes
// character mid-conversation.
export const LANGUAGE_VOICES: Record<string, { male: string; female: string }> = {
  ur: { male: "ur-PK-AsadNeural", female: "ur-PK-UzmaNeural" },
  ar: { male: "ar-SA-HamedNeural", female: "ar-SA-ZariyahNeural" },
  hi: { male: "hi-IN-MadhurNeural", female: "hi-IN-SwaraNeural" },
};

export function voiceById(id: string): VoiceDef | undefined {
  return CURATED_VOICES.find((v) => v.id === id);
}

export function genderOf(id: string): VoiceGender {
  const v = voiceById(id);
  if (v) return v.gender;
  // Per-language voices: infer from the known map.
  for (const pair of Object.values(LANGUAGE_VOICES)) {
    if (pair.male === id) return "male";
    if (pair.female === id) return "female";
  }
  return "male";
}

/**
 * Resolve which concrete voice should speak `lang` given the user's chosen
 * voice. Multilingual voices handle every language themselves; classic ones
 * hand off to the natural native voice of the same gender.
 */
export function resolveVoiceForLanguage(chosenId: string, lang: string): string {
  const chosen = voiceById(chosenId);
  if (lang === "en" || !LANGUAGE_VOICES[lang]) return chosenId;
  if (chosen?.multilingual) return chosenId;
  return LANGUAGE_VOICES[lang][genderOf(chosenId)];
}

/** Reliable last-resort voice per gender if the chosen one fails at runtime. */
export function fallbackVoice(chosenId: string): string {
  return genderOf(chosenId) === "female" ? "en-US-JennyNeural" : "en-US-GuyNeural";
}

export const SAMPLE_LINES: Record<string, string> = {
  en: "Hey, I'm Ranzo. This is how I'll sound — natural, clear, and easy to live with.",
  ur: "سلام، میں رینزو ہوں۔ میں آپ کی مدد کے لیے ہمیشہ تیار ہوں۔",
  ar: "مرحباً، أنا رانزو. أنا هنا لمساعدتك في أي وقت.",
  hi: "नमस्ते, मैं रैंज़ो हूँ। मैं आपकी मदद के लिए हमेशा तैयार हूँ।",
};
