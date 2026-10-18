// Optional server transcription for browsers without speech recognition.
// Off unless GROUPS_TRANSCRIPTION=openai; uses an OpenAI-compatible endpoint.
import { AccessError } from "./store.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const recent = new Map();

export function transcriptionStatus() {
  const enabled = process.env.GROUPS_TRANSCRIPTION === "openai";
  const key = process.env.GROUPS_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY;
  return { available: Boolean(enabled && key?.trim()) };
}

/** Bounded per-user rate: 40 clips per minute. */
function allow(userId) {
  const now = Date.now();
  const times = (recent.get(userId) || []).filter((time) => now - time < 60000);
  if (times.length >= 40) return false;
  times.push(now);
  recent.set(userId, times);
  if (recent.size > 5000) recent.delete(recent.keys().next().value);
  return true;
}

export async function transcribe(request, userId) {
  if (!transcriptionStatus().available)
    throw new AccessError("Voice transcription isn’t enabled on this server.", 503);
  if (!allow(userId)) throw new AccessError("Too many voice clips. Wait a moment.", 429);
  const type = String(request.headers["content-type"] || "audio/webm").split(";")[0];
  if (!/^audio\/(webm|ogg|mp4|mpeg|wav|x-wav)$/.test(type))
    throw new AccessError("Unsupported audio format.", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new AccessError("That voice clip is too long.", 413);
    chunks.push(chunk);
  }
  const extension = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3" }[type] || "wav";
  const form = new FormData();
  form.append("file", new Blob([Buffer.concat(chunks)], { type }), `speech.${extension}`);
  form.append("model", process.env.GROUPS_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
  const base = (process.env.GROUPS_TRANSCRIPTION_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROUPS_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY}`,
    },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    console.error("Transcription failed:", response.status);
    throw new AccessError("Voice transcription failed. Check the server’s model connection.", 502);
  }
  const data = await response.json();
  return { text: String(data.text || "").slice(0, 10000) };
}
