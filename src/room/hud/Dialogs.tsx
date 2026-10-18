import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle, Trash2 } from "lucide-react";
import { MODELS } from "../../../shared/catalog.mjs";
import type { Member, SpaceSettings, Visibility } from "../../types";
import Modal from "../../ui/Modal";
import { useApp } from "../../state/store";
import { addObjects, sendProfile, sendPresence, updateObject } from "../../state/connection";
import { liveRoom } from "../../state/sync";
import { api, currentUser, updateName } from "../../api";
import { AVATAR_COLORS } from "../scene/Avatars";

const close = () => useApp.getState().set({ dialog: null, writing: null });

export function InviteDialog() {
  const spaceId = useApp((state) => state.spaceId);
  const access = useApp((state) => state.access);
  const [role, setRole] = useState<"viewer" | "contributor">("contributor");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const url = new URL(location.origin);
      url.searchParams.set("space", spaceId || "");
      if (access?.canManage) {
        const data = await api<{ token: string }>(`/api/spaces/${spaceId}/invites`, { role });
        url.searchParams.set("invite", data.token);
      }
      setLink(url.toString());
      await navigator.clipboard?.writeText(url.toString()).then(() => setCopied(true), () => {});
    } catch (error) {
      useApp.getState().notify(error instanceof Error ? error.message : "Couldn’t create an invitation.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Invite people" eyebrow="SHARE THIS SPACE" onClose={close}>
      {access?.canManage ? (
        <>
          <p className="modal-copy">Invitation links work for seven days. Anyone who opens one joins with the role you choose.</p>
          <div className="segmented" role="radiogroup" aria-label="Invitation role">
            {(
              [
                ["contributor", "Can build", "Edit the room and ask Luna"],
                ["viewer", "Can visit", "Explore and talk, no editing"],
              ] as const
            ).map(([value, label, hint]) => (
              <button key={value} role="radio" aria-checked={role === value} className={role === value ? "is-active" : ""} onClick={() => { setRole(value); setLink(""); setCopied(false); }}>
                <strong>{label}</strong>
                <span>{hint}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="modal-copy">Share the link to this space. Visitors get the access its owner allows.</p>
      )}
      {link ? (
        <div className="copy-field">
          <input readOnly value={link} aria-label="Invitation link" onFocus={(event) => event.target.select()} />
          <button
            className="primary-button"
            onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <button className="primary-button wide" disabled={busy} onClick={() => void create()}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <Copy size={15} />}
          Create and copy link
        </button>
      )}
    </Modal>
  );
}

export function SettingsDialog({ onDeleted }: { onDeleted: () => void }) {
  const spaceId = useApp((state) => state.spaceId);
  const access = useApp((state) => state.access);
  const initial = useApp((state) => state.settings);
  const { set, notify } = useApp.getState();
  const [tab, setTab] = useState<"general" | "members">("general");
  const [form, setForm] = useState<SpaceSettings | null>(initial);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  useEffect(() => {
    if (tab !== "members") return;
    api<{ members: Member[] }>(`/api/spaces/${spaceId}/members`)
      .then((data) => setMembers(data.members))
      .catch((error) => notify(error.message));
  }, [tab, spaceId, notify]);
  if (!form) return null;
  const save = async () => {
    setSaving(true);
    try {
      const data = await api<{ settings: SpaceSettings }>(`/api/spaces/${spaceId}/settings`, form, "PATCH");
      set({ settings: data.settings });
      notify("Settings saved.");
      close();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Settings couldn’t be saved.");
    } finally {
      setSaving(false);
    }
  };
  const changeMember = async (member: Member, role: string | null) => {
    try {
      const data = await api<{ members: Member[] }>(
        `/api/spaces/${spaceId}/members/${member.id}`,
        role ? { role } : undefined,
        role ? "PATCH" : "DELETE",
      );
      setMembers(data.members);
    } catch (error) {
      notify(error instanceof Error ? error.message : "That change couldn’t be made.");
    }
  };
  return (
    <Modal title="Space settings" eyebrow={form.name.toUpperCase()} size="wide" onClose={close}>
      <div className="chip-row" role="tablist">
        {(["general", "members"] as const).map((value) => (
          <button key={value} role="tab" aria-selected={tab === value} className={`chip ${tab === value ? "is-active" : ""}`} onClick={() => setTab(value)}>
            {value === "general" ? "General" : "Members"}
          </button>
        ))}
      </div>
      {tab === "general" ? (
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Name
            <input value={form.name} maxLength={80} required onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Description
            <textarea rows={2} maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label>
            Who can find it
            <select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value as Visibility })}>
              <option value="private">Private · invitation only</option>
              <option value="unlisted">Unlisted · anyone with the link</option>
              <option value="public">Public · listed in the directory</option>
            </select>
          </label>
          <label>
            Visitors without an invitation
            <select
              value={form.joinRole}
              disabled={form.visibility === "private"}
              onChange={(event) => setForm({ ...form, joinRole: event.target.value as "viewer" | "contributor" })}
            >
              <option value="viewer">Can visit and talk</option>
              <option value="contributor">Can build and ask Luna</option>
            </select>
          </label>
          <label>
            Colour
            <div className="palette">
              {["#de865f", "#789b7e", "#9b8cb8", "#6f9fc4", "#d9b44a", "#c97a8f", "#5f8f8a"].map((color) => (
                <button type="button" key={color} className={form.color === color ? "is-active" : ""} style={{ background: color }} aria-label={`Colour ${color}`} onClick={() => setForm({ ...form, color })} />
              ))}
            </div>
          </label>
          <div className="form-actions">
            <button className="primary-button" disabled={saving}>
              {saving && <LoaderCircle className="spin" size={15} />} Save changes
            </button>
          </div>
          {access?.owned && (
            <div className="danger-zone">
              <strong>Delete this space</strong>
              <p>Everyone is disconnected and its room and history are removed permanently. Type the space name to confirm.</p>
              <div className="copy-field">
                <input value={confirmDelete} placeholder={form.name} aria-label="Type the space name to confirm" onChange={(event) => setConfirmDelete(event.target.value)} />
                <button
                  type="button"
                  className="danger-button"
                  disabled={confirmDelete !== initial?.name}
                  onClick={async () => {
                    try {
                      await api(`/api/spaces/${spaceId}`, undefined, "DELETE");
                      close();
                      onDeleted();
                    } catch (error) {
                      notify(error instanceof Error ? error.message : "The space couldn’t be deleted.");
                    }
                  }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          )}
        </form>
      ) : members === null ? (
        <p className="empty-note">Loading members…</p>
      ) : (
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.id}>
              <div>
                <strong>
                  {member.name}
                  {member.self && " (you)"}
                </strong>
              </div>
              {member.role === "owner" || member.self ? (
                <span className="tag">{member.role}</span>
              ) : (
                <>
                  <select value={member.role} aria-label={`Role for ${member.name}`} onChange={(event) => void changeMember(member, event.target.value)}>
                    <option value="viewer">Visitor</option>
                    <option value="contributor">Builder</option>
                    {access?.role === "owner" && <option value="moderator">Moderator</option>}
                  </select>
                  <button className="icon-button" title="Remove from space" aria-label={`Remove ${member.name}`} onClick={() => void changeMember(member, null)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
          {members.length <= 1 && <p className="empty-note">Nobody else has joined through an invitation yet.</p>}
        </ul>
      )}
    </Modal>
  );
}

export function ProfileDialog() {
  const notify = useApp((state) => state.notify);
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => {
    try {
      return localStorage.getItem("groups-avatar-color") || "";
    } catch {
      return "";
    }
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void currentUser().then((user) => user && setName(user.name));
  }, []);
  return (
    <Modal title="Your profile" eyebrow="HOW OTHERS SEE YOU" onClose={close}>
      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            if (name.trim()) await updateName(name);
            try {
              if (color) localStorage.setItem("groups-avatar-color", color);
            } catch {
              /* Preference only. */
            }
            sendProfile();
            if (color) sendPresence({ color });
            notify("Profile updated.");
            close();
          } catch (error) {
            notify(error instanceof Error ? error.message : "Profile couldn’t be saved.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Display name
          <input autoFocus value={name} maxLength={40} required onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Avatar colour
          <div className="palette">
            {AVATAR_COLORS.map((value) => (
              <button type="button" key={value} className={color === value ? "is-active" : ""} style={{ background: value }} aria-label={`Colour ${value}`} onClick={() => setColor(value)} />
            ))}
          </div>
        </label>
        <p className="fine-print">You’re signed in as a guest on this browser. Keep its cookies to keep your spaces.</p>
        <div className="form-actions">
          <button className="primary-button" disabled={saving}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function HelpDialog() {
  const rows: [string, string][] = [
    ["W A S D / arrows", "Walk"],
    ["Space", "Jump"],
    ["Drag empty space", "Look around (or orbit in overview)"],
    ["Scroll", "Zoom the camera"],
    ["Click / drag an object", "Select / move it"],
    ["Double-click", "Write on a note, sign or board"],
    ["Q / E", "Turn the selection"],
    ["Delete", "Remove the selection"],
    ["Ctrl+D", "Duplicate"],
    ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo your edits"],
    ["Enter or /", "Write a message"],
    ["1 / 2 / 3", "Third person / first person / overview"],
    ["L", "Open the library"],
  ];
  return (
    <Modal title="How Groups works" eyebrow="QUICK GUIDE" onClose={close}>
      <p className="modal-copy">
        Talk or type with the people here. When you ask, or when the conversation pauses, <strong>Luna</strong> turns
        ideas into things in the room: furniture, gardens, whiteboards with your plans, whole scenes. Every change can be
        undone from the chat or the history panel.
      </p>
      <dl className="shortcut-list">
        {rows.map(([keys, action]) => (
          <div key={keys}>
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function WriteDialog() {
  const writing = useApp((state) => state.writing);
  const workspace = useApp((state) => state.workspace);
  const color = useApp((state) => state.color);
  const object = writing?.id ? liveRoom(workspace)?.objects.find((item) => item.id === writing.id) : undefined;
  const [text, setText] = useState(object?.text || "");
  if (!writing) return null;
  const title = object
    ? `Write on ${object.kind === "model" ? MODELS[object.model || ""]?.label.toLowerCase() : object.kind === "note" ? "the note" : "the panel"}`
    : writing.kind === "note"
      ? "New sticky note"
      : "New text panel";
  return (
    <Modal title={title} eyebrow="WRITING" onClose={close}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const value = text.trim();
          if (object) updateObject(object.id, { text: value, assetRevision: object.assetRevision });
          else if (value) {
            const id = crypto.randomUUID();
            const [x, , z] = [(Math.random() - 0.5) * 4, 0, -2 + Math.random()];
            addObjects([
              {
                id,
                kind: writing.kind === "note" ? "note" : "text",
                color: writing.kind === "note" ? "#f1dc8f" : color,
                text: value,
                position: [x, 0, z],
                physics: "fixed",
              },
            ]);
            useApp.getState().set({ selectedId: id });
          }
          close();
        }}
      >
        <textarea
          autoFocus
          className="writing-area"
          rows={8}
          maxLength={4000}
          value={text}
          placeholder={"A heading on the first line\n- then a point\n- and another"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
          }}
        />
        <p className="fine-print">The first line becomes a heading. Start lines with “- ” for bullets. Ctrl+Enter saves.</p>
        <div className="form-actions">
          <button className="primary-button">{object ? "Save" : "Add to the room"}</button>
        </div>
      </form>
    </Modal>
  );
}
