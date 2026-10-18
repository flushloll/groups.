import { useEffect, useRef } from "react";

/**
 * Fallback for browsers without speech recognition: record each spoken
 * phrase (detected by microphone level) and have the server transcribe it.
 */
export function useServerTranscription({
  stream,
  level,
  enabled,
  spaceId,
  onText,
  onError,
}: {
  stream: MediaStream | null;
  level: number;
  enabled: boolean;
  spaceId: string | null;
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const levelRef = useRef(level);
  levelRef.current = level;
  const callbacks = useRef({ onText, onError });
  callbacks.current = { onText, onError };
  useEffect(() => {
    if (!enabled || !stream || !spaceId || typeof MediaRecorder === "undefined") return;
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((value) =>
      MediaRecorder.isTypeSupported(value),
    );
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let startedAt = 0;
    let lastLoud = 0;
    let failures = 0;
    const send = async (blob: Blob, duration: number) => {
      if (duration < 600 || blob.size < 2000) return;
      try {
        const response = await fetch(`/api/spaces/${spaceId}/transcribe`, {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm" },
          body: blob,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Transcription failed.");
        failures = 0;
        if (typeof data.text === "string" && data.text.trim()) callbacks.current.onText(data.text.trim());
      } catch (error) {
        if (++failures === 3)
          callbacks.current.onError(
            error instanceof Error ? error.message : "Voice transcription isn’t working right now.",
          );
      }
    };
    const stop = () => {
      if (!recorder || recorder.state === "inactive") return;
      const duration = performance.now() - startedAt;
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder?.mimeType || type });
        chunks = [];
        void send(blob, duration);
      };
      recorder.stop();
    };
    const timer = setInterval(() => {
      const now = performance.now();
      const loud = levelRef.current > 0.05;
      if (loud) lastLoud = now;
      if (!recorder || recorder.state === "inactive") {
        if (!loud) return;
        recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        chunks = [];
        recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
        recorder.start();
        startedAt = now;
        return;
      }
      if (now - lastLoud > 900 || now - startedAt > 15000) stop();
    }, 100);
    return () => {
      clearInterval(timer);
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
    };
  }, [enabled, stream, spaceId]);
}
