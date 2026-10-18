import { useEffect, useState } from "react";
import { Bookmark, Eye, MicOff, AudioLines, RotateCcw, UserPlus } from "lucide-react";
import type { Checkpoint, Participant, RoomVersion } from "../../types";
import { useApp } from "../../state/store";
import { api } from "../../api";
import { restoreCheckpoint } from "./ChatPanel";
import { avatarColor } from "../scene/Avatars";

function ago(value: string) {
  const seconds = Math.max(1, (Date.now() - Date.parse(value)) / 1000);
  const units: [number, string][] = [
    [86400 * 7, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [size, unit] of units) if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  return "just now";
}

export function HistoryPanel({ room }: { room: RoomVersion }) {
  const spaceId = useApp((state) => state.spaceId);
  const version = useApp((state) => state.historyVersion);
  const canEdit = useApp((state) => Boolean(state.access?.canEdit));
  const preview = useApp((state) => state.preview);
  const { set, notify } = useApp.getState();
  const [items, setItems] = useState<Checkpoint[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ checkpoints: Checkpoint[] }>(`/api/spaces/${spaceId}/checkpoints?room=${room.id}`)
      .then((data) => alive && setItems(data.checkpoints))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [spaceId, room.id, version]);
  const open = async (checkpoint: Checkpoint) => {
    try {
      const data = await api<{ checkpoint: Checkpoint & Pick<RoomVersion, "objects" | "environment"> }>(
        `/api/spaces/${spaceId}/checkpoints/${checkpoint.id}`,
      );
      set({
        preview: {
          id: checkpoint.id,
          title: data.checkpoint.title,
          createdAt: checkpoint.createdAt,
          actor: checkpoint.actor,
          objects: data.checkpoint.objects,
          environment: data.checkpoint.environment,
        },
        selectedId: null,
        tool: { type: "select" },
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "That version couldn’t be opened.");
    }
  };
  return (
    <section className="panel-section" aria-label="History">
      <div className="panel-intro">
        <p>Every Luna change and restore saves the scene before it. Preview any version, then restore it if you like.</p>
        {canEdit && (
          <button
            className="secondary-button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api(`/api/spaces/${spaceId}/checkpoints`, { roomId: room.id });
                set({ historyVersion: useApp.getState().historyVersion + 1 });
                notify("Saved a version of the room.");
              } catch (error) {
                notify(error instanceof Error ? error.message : "Couldn’t save a version.");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Bookmark size={14} /> Save this version
          </button>
        )}
      </div>
      {items === null ? (
        <p className="empty-note">Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty-note">No saved versions yet.</p>
      ) : (
        <ol className="history-list">
          {items.map((item) => (
            <li key={item.id} className={preview?.id === item.id ? "is-active" : ""}>
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.actor} · {ago(item.createdAt)} · {item.objectCount} object{item.objectCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="history-actions">
                <button className="icon-button" title="Preview" aria-label={`Preview ${item.title}`} onClick={() => void open(item)}>
                  <Eye size={15} />
                </button>
                {canEdit && (
                  <button
                    className="icon-button"
                    title="Restore"
                    aria-label={`Restore ${item.title}`}
                    onClick={() => void restoreCheckpoint(item.id)}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function PeoplePanel({ self }: { self: Participant | null }) {
  const peers = useApp((state) => state.peers);
  const access = useApp((state) => state.access);
  const set = useApp((state) => state.set);
  const everyone = self ? [self, ...peers] : peers;
  return (
    <section className="panel-section" aria-label="People">
      <ul className="people-list">
        {everyone.map((person) => (
          <li key={person.id}>
            <span className={`avatar-dot ${person.speaking && !person.muted ? "is-speaking" : ""}`} style={{ background: avatarColor(person) }}>
              {person.name.replace(/^Guest /, "").charAt(0)}
            </span>
            <div>
              <strong>
                {person.name}
                {person.id === self?.id && " (you)"}
              </strong>
              <span>{person.speaking && !person.muted ? "Speaking" : person.muted ? "Muted" : "Listening"}</span>
            </div>
            {person.muted ? <MicOff size={14} /> : <AudioLines size={14} />}
          </li>
        ))}
      </ul>
      <p className="fine-print">Up to 10 people can be in a room at once.</p>
      <button className="secondary-button" onClick={() => set({ dialog: "invite" })}>
        <UserPlus size={14} /> Invite someone
      </button>
      {access?.canManage && (
        <button className="text-button" onClick={() => set({ dialog: "settings" })}>
          Manage members and access
        </button>
      )}
    </section>
  );
}
