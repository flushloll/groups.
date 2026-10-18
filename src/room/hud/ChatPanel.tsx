import { useEffect, useRef, useState } from "react";
import { ArrowUp, AudioLines, Mic, MicOff, Sparkles, Undo2 } from "lucide-react";
import type { RoomMessage } from "../../types";
import { useApp } from "../../state/store";
import { requestLuna, sendChat } from "../../state/connection";
import { api } from "../../api";

function time(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export async function restoreCheckpoint(checkpointId: string) {
  const { spaceId, notify, set } = useApp.getState();
  try {
    await api(`/api/spaces/${spaceId}/checkpoints/${checkpointId}/restore`, {});
    set({ preview: null });
  } catch (error) {
    notify(error instanceof Error ? error.message : "That version couldn’t be restored.");
  }
}

function Message({ message, canEdit }: { message: RoomMessage; canEdit: boolean }) {
  const luna = message.role === "ai";
  return (
    <li className={`message ${luna ? "from-luna" : ""}`}>
      <div className="message-meta">
        {luna ? <Sparkles size={12} /> : message.source === "voice" ? <AudioLines size={12} /> : null}
        <strong>{luna ? "Luna" : message.author || "Someone"}</strong>
        <time dateTime={message.time}>{time(message.time)}</time>
        {message.toLuna && !luna && <span className="tag">to Luna</span>}
        {message.canDirectLuna === false && <span className="tag">viewer</span>}
      </div>
      <p>{message.text}</p>
      {luna && message.status === "changed" && message.checkpointId && canEdit && (
        <button className="text-button" onClick={() => void restoreCheckpoint(message.checkpointId!)}>
          <Undo2 size={12} /> Undo this change
        </button>
      )}
    </li>
  );
}

export function LunaIndicator() {
  const luna = useApp((state) => state.luna);
  const online = useApp((state) => state.builderOnline);
  const busy = luna.status === "thinking" || luna.status === "shaping";
  if (!online)
    return <div className="luna-state is-offline">Luna is offline · add a model connection to enable building</div>;
  if (!busy) return null;
  return (
    <div className="luna-state is-busy" role="status">
      <span className="luna-orb" />
      {luna.status === "shaping" ? "Luna is building…" : "Luna is thinking…"}
    </div>
  );
}

export default function ChatPanel({ messages }: { messages: RoomMessage[] }) {
  const canEdit = useApp((state) => Boolean(state.access?.canEdit));
  const list = useRef<HTMLOListElement>(null);
  const set = useApp((state) => state.set);
  useEffect(() => {
    set({ unread: 0 });
  }, [messages.length, set]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);
  const recent = messages.slice(-200);
  return (
    <section className="panel-section chat-panel" aria-label="Conversation">
      {recent.length === 0 ? (
        <div className="empty-state">
          <Sparkles size={20} />
          <h3>Talk, and the room takes shape</h3>
          <p>
            Type below or turn on your microphone. Ask Luna for anything: “a cosy reading corner”, “a whiteboard
            with our plan for Friday”, “turn this into a night garden”.
          </p>
        </div>
      ) : (
        <ol ref={list} className="messages">
          {recent.map((message) => (
            <Message key={message.id} message={message} canEdit={canEdit} />
          ))}
        </ol>
      )}
      <LunaIndicator />
    </section>
  );
}

export function Composer({
  voice,
}: {
  voice: {
    joined: boolean;
    joining: boolean;
    muted: boolean;
    level: number;
    interim: string;
    join: () => void;
    toggleMute: () => void;
  };
}) {
  const [text, setText] = useState("");
  const alone = useApp((state) => state.peers.length === 0);
  const [lunaChoice, setLunaChoice] = useState<boolean | null>(null);
  const toLuna = lunaChoice ?? alone;
  const status = useApp((state) => state.status);
  const canEdit = useApp((state) => Boolean(state.access?.canEdit));
  const busy = useApp((state) => ["thinking", "shaping"].includes(state.luna.status));
  const online = useApp((state) => state.builderOnline);
  const field = useRef<HTMLTextAreaElement>(null);
  const narrow = useRef(matchMedia("(max-width: 640px)").matches).current;
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "/") return;
      if ((event.target as HTMLElement).closest("input, textarea, select, [role='dialog']")) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  const submit = () => {
    if (!text.trim()) return;
    sendChat(text, toLuna && canEdit);
    setText("");
  };
  const live = voice.joined && !voice.muted;
  return (
    <div className="composer-wrap">
      {voice.interim && live && <div className="caption" aria-live="polite">{voice.interim}</div>}
      <form
        className={`composer ${toLuna && canEdit ? "to-luna" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <button
          type="button"
          className={`mic ${live ? "is-live" : ""}`}
          style={{ "--level": Math.min(1, voice.level * 6) } as React.CSSProperties}
          aria-label={voice.joined ? (voice.muted ? "Unmute microphone" : "Mute microphone") : "Turn on microphone"}
          title={voice.joined ? (voice.muted ? "Unmute" : "Mute") : "Join with your voice"}
          disabled={status !== "connected" || voice.joining}
          onClick={() => (voice.joined ? voice.toggleMute() : voice.join())}
        >
          {live ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        {canEdit && (
          <button
            type="button"
            className={`luna-toggle ${toLuna ? "is-on" : ""}`}
            aria-pressed={toLuna}
            title={toLuna ? "Messages go to Luna" : "Messages go to the room; Luna listens in"}
            onClick={() => setLunaChoice(!toLuna)}
          >
            <Sparkles size={14} />
            Luna
          </button>
        )}
        <textarea
          ref={field}
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={
            !canEdit
              ? "Say something to the room…"
              : toLuna
                ? online
                  ? narrow
                    ? "Ask Luna…"
                    : "Ask Luna to build something…"
                  : "Luna is offline · message the room…"
                : "Message the room…"
          }
          aria-label="Message"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") field.current?.blur();
          }}
        />
        {canEdit && online && !text && (
          <button
            type="button"
            className="icon-button build-now"
            title="Have Luna act on the recent conversation now"
            aria-label="Build from the conversation now"
            disabled={busy || status !== "connected"}
            onClick={() => requestLuna()}
          >
            <Sparkles size={16} />
          </button>
        )}
        <button type="submit" className="send" aria-label="Send" disabled={!text.trim() || status !== "connected"}>
          <ArrowUp size={17} />
        </button>
      </form>
    </div>
  );
}
