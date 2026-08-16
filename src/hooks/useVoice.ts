// Voice input/output for the renderer.
// - Speech synthesis: audio comes from the main process (Edge-TTS) as base64.
// - Speech recognition: uses the browser SpeechRecognition engine when the
//   platform provides one. If it isn't available (offline or unsupported),
//   Ranzo says so once and stays in text mode — no fake listening.

import { useCallback, useEffect, useRef, useState } from "react";
import { ranzo } from "../bridge";

type SR = {
  new (): {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
    onend: (() => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
  };
};

function getRecognizer(): SR | null {
  const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoice(opts: {
  onTranscript: (text: string) => void;
  onStateChange: (s: "listening" | "idle" | "speaking") => void;
}) {
  const [micAvailable, setMicAvailable] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const recRef = useRef<InstanceType<SR> | null>(null);
  const liveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [outputLevel, setOutputLevel] = useState(0);

  useEffect(() => {
    const Rec = getRecognizer();
    if (!Rec) { setMicAvailable(false); return; }
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then((stream) => { stream.getTracks().forEach((t) => t.stop()); setMicAvailable(true); })
      .catch(() => setMicAvailable(false));
  }, []);

  const stopListening = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
    opts.onStateChange("idle");
  }, [opts]);

  const startListening = useCallback((continuous: boolean) => {
    const Rec = getRecognizer();
    if (!Rec || micAvailable === false) return false;
    try {
      const rec = new Rec();
      recRef.current = rec;
      rec.lang = "";
      rec.continuous = continuous;
      rec.interimResults = false;
      rec.onresult = (e) => {
        const chunk = Array.from({ length: e.results.length - e.resultIndex }, (_, i) =>
          e.results[e.resultIndex + i][0].transcript).join(" ").trim();
        if (chunk) opts.onTranscript(chunk);
      };
      rec.onend = () => {
        setListening(false);
        if (liveRef.current) {
          // Live mode: keep the ears open.
          setTimeout(() => { if (liveRef.current) startListening(true); }, 300);
        } else {
          opts.onStateChange("idle");
        }
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") setMicAvailable(false);
        setListening(false);
      };
      rec.start();
      setListening(true);
      opts.onStateChange("listening");
      return true;
    } catch {
      setMicAvailable(false);
      return false;
    }
  }, [micAvailable, opts]);

  const toggleLive = useCallback(() => {
    const next = !liveRef.current;
    liveRef.current = next;
    setLiveMode(next);
    if (next) startListening(true);
    else stopListening();
    return next;
  }, [startListening, stopListening]);

  const speak = useCallback(async (text: string) => {
    const res = await ranzo.speak(text);
    if (!res.ok || !res.audioBase64) return res.error ?? null;
    opts.onStateChange("speaking");
    const audio = new Audio(`data:audio/mp3;base64,${res.audioBase64}`);
    audioRef.current = audio;
    const pulse = setInterval(() => setOutputLevel(0.3 + Math.random() * 0.7), 90);
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
    clearInterval(pulse);
    setOutputLevel(0);
    opts.onStateChange("idle");
    return null;
  }, [opts]);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setOutputLevel(0);
    void ranzo.stopSpeaking();
    opts.onStateChange("idle");
  }, [opts]);

  return { micAvailable, listening, liveMode, startListening, stopListening, toggleLive, speak, stopSpeaking, outputLevel };
}
