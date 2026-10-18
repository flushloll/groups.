import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Circle,
  Eye,
  Footprints,
  Grid2X2,
  HelpCircle,
  History,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  MessageCircle,
  MousePointer2,
  Presentation,
  Paintbrush,
  Redo2,
  Settings2,
  StickyNote,
  Type,
  Undo2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useApp, liveFrame } from "../state/store";
import type { Panel } from "../state/store";
import { liveRoom } from "../state/sync";
import { onSignal, removeObjects, sendPresence, sendSignal, sendTranscript, addObjects, updateObject, editRoom } from "../state/connection";
import { useHistory, step, clearHistory } from "../state/history";
import { useVoiceRoom } from "../hooks/useVoiceRoom";
import { useServerTranscription } from "../hooks/useServerTranscription";
import type { CameraMode, Participant } from "../types";
import type { RoomObject } from "../assets";
import Inspector, { duplicate, PALETTE } from "./hud/Inspector";
import ChatPanel, { Composer, restoreCheckpoint } from "./hud/ChatPanel";
import { HistoryPanel, PeoplePanel } from "./hud/SidePanels";
import { HelpDialog, InviteDialog, ProfileDialog, SettingsDialog, WriteDialog } from "./hud/Dialogs";
import { avatarColor } from "./scene/Avatars";
import { hasWriting } from "../assets";
import "./room.css";

const Scene = lazy(() => import("./scene/Scene"));
const Library = lazy(() => import("./hud/Library"));
const BoardEditor = lazy(() => import("./hud/BoardEditor"));

export const NEW_BOARD = {
  kind: "board",
  color: "#d8cfc0",
  physics: "fixed",
  text: "Board",
  scale: 1,
  board: { elements: [] },
} as Omit<RoomObject, "id" | "position">;

const CAMERA_LABELS: Record<CameraMode, string> = {
  third: "Third person",
  first: "First person",
  overview: "Overview",
};

function Toast() {
  const toast = useApp((state) => state.toast);
  const set = useApp((state) => state.set);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => set({ toast: null }), 4200);
    return () => clearTimeout(timer);
  }, [toast, set]);
  return toast ? (
    <div className="toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  ) : null;
}

function TouchPad() {
  const press = (key: string, down: boolean) => {
    if (down) liveFrame.keys.add(key);
    else liveFrame.keys.delete(key);
  };
  return (
    <div className="touch-pad" aria-label="Movement controls">
      {(
        [
          ["w", "Forward", "↑", "up"],
          ["a", "Left", "←", "left"],
          ["s", "Back", "↓", "down"],
          ["d", "Right", "→", "right"],
          [" ", "Jump", "⤒", "jump"],
        ] as const
      ).map(([key, label, glyph, area]) => (
        <button
          key={key}
          aria-label={label}
          className={`pad-${area}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            press(key, true);
          }}
          onPointerUp={() => press(key, false)}
          onPointerCancel={() => press(key, false)}
          onLostPointerCapture={() => press(key, false)}
        >
          {glyph}
        </button>
      ))}
    </div>
  );
}

async function imageObject(file: File): Promise<RoomObject> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 15_000_000) throw new Error("Choose an image smaller than 15 MB.");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const aspect = bitmap.width / bitmap.height;
  bitmap.close();
  let quality = 0.85;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > 1_900_000 && quality > 0.4) data = canvas.toDataURL("image/jpeg", (quality -= 0.1));
  const panelAspect = 1.85 / 1.55;
  return {
    id: crypto.randomUUID(),
    kind: "image",
    text: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
    color: "#ffffff",
    image: data,
    position: [(Math.random() - 0.5) * 3, 1.4, -3 + Math.random()],
    scale: 1.2,
    stretch: [Math.min(3, Math.max(0.4, aspect / panelAspect)), 1, 1],
    physics: "fixed",
  };
}

export default function RoomView({
  voiceOnEntry,
  onLeave,
}: {
  voiceOnEntry: boolean;
  onLeave: (message?: string) => void;
}) {
  const workspace = useApp((state) => state.workspace);
  const status = useApp((state) => state.status);
  const access = useApp((state) => state.access);
  const peers = useApp((state) => state.peers);
  const selfId = useApp((state) => state.selfId);
  const selfName = useApp((state) => state.selfName);
  const selectedId = useApp((state) => state.selectedId);
  const tool = useApp((state) => state.tool);
  const color = useApp((state) => state.color);
  const panel = useApp((state) => state.panel);
  const dialog = useApp((state) => state.dialog);
  const cameraMode = useApp((state) => state.cameraMode);
  const grid = useApp((state) => state.grid);
  const unread = useApp((state) => state.unread);
  const preview = useApp((state) => state.preview);
  const boardId = useApp((state) => state.boardId);
  const iceServers = useApp((state) => state.iceServers);
  const set = useApp((state) => state.set);
  const notify = useApp((state) => state.notify);
  const setCameraMode = useApp((state) => state.setCameraMode);
  const history = useHistory();
  const [ready, setReady] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const room = liveRoom(workspace);
  const canEdit = Boolean(access?.canEdit) && status === "connected";
  const objects = preview ? preview.objects : room?.objects || [];
  const selected = room?.objects.find((object) => object.id === selectedId);
  const touch = useMemo(() => matchMedia("(pointer: coarse)").matches, []);

  // --- Voice ---------------------------------------------------------------
  const roomPeers = useMemo(() => peers.filter((peer) => peer.roomId === room?.id), [peers, room?.id]);
  const voice = useVoiceRoom({
    peers: roomPeers,
    selfId,
    sendSignal,
    soundscape: room?.environment?.soundscape || "quiet",
    iceServers,
    onTranscript: (text) => sendTranscript(text),
    onError: (message) => notify(message),
  });
  const serverTranscription = useApp((state) => state.transcription);
  const spaceId = useApp((state) => state.spaceId);
  useServerTranscription({
    stream: voice.stream,
    level: voice.level,
    enabled: serverTranscription && !voice.supported && voice.joined && !voice.muted,
    spaceId,
    onText: (text) => sendTranscript(text),
    onError: (message) => notify(message),
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  useEffect(() => onSignal((peerId, data) => voiceRef.current.handleSignal(peerId, data as never)), []);
  const speaking = voice.joined && !voice.muted && voice.level > 0.035;
  useEffect(() => {
    sendPresence({ muted: voice.muted || !voice.joined, speaking });
  }, [voice.muted, voice.joined, speaking]);
  useEffect(() => {
    liveFrame.voiceLevels.set(selfId, voice.level);
  }, [voice.level, selfId]);
  const entered = useRef(false);
  useEffect(() => {
    if (status === "connected" && voiceOnEntry && !entered.current) {
      entered.current = true;
      void voiceRef.current.join();
    }
  }, [status, voiceOnEntry]);
  useEffect(() => () => voiceRef.current.leave(), []);
  // People nearby sound louder than people across the room.
  useEffect(() => {
    const timer = setInterval(() => {
      const frame = liveFrame.simulation;
      if (!frame) return;
      const [x, , z] = liveFrame.selfPosition;
      for (const player of frame.players) {
        if (player.id === selfId) continue;
        const distance = Math.hypot(player.position[0] - x, player.position[2] - z);
        voiceRef.current.setPeerVolume(player.id, 1 - Math.min(0.75, Math.max(0, (distance - 2.5) / 16)));
      }
    }, 250);
    return () => clearInterval(timer);
  }, [selfId]);

  // --- Status ----------------------------------------------------------------
  useEffect(() => {
    if (status === "full") onLeave("That room is full right now. Try again when a place opens.");
    if (status === "denied") onLeave();
  }, [status, onLeave]);
  useEffect(() => {
    clearHistory();
  }, [room?.id]);
  useEffect(() => {
    if (!canEdit && tool.type !== "select") set({ tool: { type: "select" } });
  }, [canEdit, tool.type, set]);

  const openObject = useCallback(
    (id: string) => {
      const object = liveRoom(useApp.getState().workspace)?.objects.find((item) => item.id === id);
      if (object?.kind === "board") {
        set({ boardId: id, selectedId: id });
        return;
      }
      if (!object || !hasWriting(object) || !useApp.getState().access?.canEdit) return;
      set({
        selectedId: id,
        dialog: "write",
        writing: { id, kind: object.kind === "model" ? "model" : (object.kind as "note"), model: object.model },
      });
    },
    [set],
  );
  const closeBoard = useCallback(() => set({ boardId: null }), [set]);
  const undo = (direction: "undo" | "redo") => {
    if (!room || !canEdit) return;
    try {
      const change = step(direction, room.objects);
      if (change) editRoom({ objects: change }, false);
    } catch (error) {
      notify((error as Error).message);
    }
  };

  // --- Keyboard ------------------------------------------------------------------
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input, textarea, select, [role='dialog']")) return;
      const state = useApp.getState();
      if (state.boardId) return;
      const key = event.key.toLowerCase();
      const current = liveRoom(state.workspace)?.objects.find((item) => item.id === state.selectedId);
      const editable = Boolean(state.access?.canEdit) && state.status === "connected";
      if (key === "escape") {
        if (state.preview) set({ preview: null });
        else if (state.tool.type !== "select") set({ tool: { type: "select" } });
        else set({ selectedId: null });
      }
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        undo(event.shiftKey ? "redo" : "undo");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "y") {
        event.preventDefault();
        undo("redo");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "d" && current && editable) {
        event.preventDefault();
        duplicate(current);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((key === "delete" || key === "backspace") && current && editable) {
        event.preventDefault();
        removeObjects([current.id]);
        set({ selectedId: null });
      }
      if ((key === "q" || key === "e") && current && editable && current.kind !== "stroke") {
        const [x, y, z] = current.rotation || [0, 0, 0];
        updateObject(current.id, { rotation: [x, y + (key === "q" ? 1 : -1) * (Math.PI / 8), z] });
      }
      if (key === "1") setCameraMode("third");
      if (key === "2") setCameraMode("first");
      if (key === "3") setCameraMode("overview");
      if (key === "g") set({ grid: !state.grid });
      if (key === "l" && editable) set({ dialog: "library" });
      if (key === "?") set({ dialog: "help" });
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });

  if (!workspace || !room)
    return (
      <div className="room-loading">
        <LoaderCircle className="spin" size={22} />
        <span>{status === "connecting" ? "Opening the space…" : "Connecting…"}</span>
        <button className="text-button" onClick={() => onLeave()}>
          Back to the lobby
        </button>
      </div>
    );

  const self = peers.length >= 0 && selfId
    ? ({
        id: selfId,
        name: selfName,
        roomId: room.id,
        position: liveFrame.selfPosition,
        muted: voice.muted || !voice.joined,
        speaking,
        color: (() => {
          try {
            return localStorage.getItem("groups-avatar-color") || undefined;
          } catch {
            return undefined;
          }
        })(),
      } as Participant)
    : null;
  const participants = self ? [...roomPeers, self] : roomPeers;
  const togglePanel = (value: Panel) => set({ panel: panel === value ? null : value, ...(value === "chat" ? { unread: 0 } : {}) });
  const placing = (kind: RoomObject["kind"]) =>
    set({
      selectedId: null,
      tool: { type: "place", object: { kind, color, physics: "dynamic", scale: 1 } },
    });

  return (
    <div className={`room ${panel ? "has-panel" : ""} ${preview ? "is-previewing" : ""}`}>
      <div className="room-stage">
        <Suspense fallback={null}>
          <Scene
            objects={objects}
            environment={preview ? preview.environment : room.environment}
            participants={preview ? [] : participants}
            roomId={room.id}
            onOpen={openObject}
            onReady={() => setReady(true)}
          />
        </Suspense>
      </div>

      <header className="topbar">
        <button className="brand" onClick={() => onLeave()} title="Back to the lobby" aria-label="Back to the lobby">
          <span className="brand-blocks" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
        <div className="space-title">
          <strong>{workspace.name}</strong>
          <span className={`role-chip role-${access?.role || "viewer"}`}>
            {access?.role === "owner" ? "Owner" : access?.canEdit ? "Builder" : "Visitor"}
          </span>
          {status !== "connected" && (
            <span className="status-chip">
              <LoaderCircle className="spin" size={12} /> Reconnecting
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <button className="presence-stack" onClick={() => togglePanel("people")} aria-label={`${participants.length} people here`}>
            {participants.slice(0, 4).map((person) => (
              <span key={person.id} style={{ background: avatarColor(person) }} className={person.speaking && !person.muted ? "is-speaking" : ""}>
                {person.name.replace(/^Guest /, "").charAt(0)}
              </span>
            ))}
            <small>{participants.length}</small>
          </button>
          <button className="pill-button" onClick={() => set({ dialog: "invite" })}>
            <UserPlus size={15} />
            <span>Invite</span>
          </button>
          {access?.canManage && (
            <button className="icon-button" title="Space settings" aria-label="Space settings" onClick={() => set({ dialog: "settings" })}>
              <Settings2 size={17} />
            </button>
          )}
          <button className="icon-button" title="Your profile" aria-label="Your profile" onClick={() => set({ dialog: "profile" })}>
            <span className="self-dot" style={{ background: self ? avatarColor(self) : undefined }} />
          </button>
          <button className="icon-button" title="Leave" aria-label="Leave the space" onClick={() => onLeave()}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      {canEdit && !preview && (
        <nav className="build-dock" aria-label="Build tools">
          <button className={tool.type === "select" ? "is-active" : ""} title="Select and move (Esc)" aria-label="Select and move" onClick={() => set({ tool: { type: "select" } })}>
            <MousePointer2 size={18} />
          </button>
          <button title="Library (L)" aria-label="Open the library" className={tool.type === "place" && tool.object.kind === "model" ? "is-active" : ""} onClick={() => set({ dialog: "library" })}>
            <LayoutGrid size={18} />
          </button>
          <button title="Cube" aria-label="Place a cube" className={tool.type === "place" && tool.object.kind === "cube" ? "is-active" : ""} onClick={() => placing("cube")}>
            <Box size={18} />
          </button>
          <button title="Sphere" aria-label="Place a sphere" className={tool.type === "place" && tool.object.kind === "sphere" ? "is-active" : ""} onClick={() => placing("sphere")}>
            <Circle size={18} />
          </button>
          <span className="dock-divider" />
          <button title="Sticky note" aria-label="Add a sticky note" onClick={() => set({ dialog: "write", writing: { id: null, kind: "note" } })}>
            <StickyNote size={18} />
          </button>
          <button title="Text panel" aria-label="Add a text panel" onClick={() => set({ dialog: "write", writing: { id: null, kind: "text" } })}>
            <Type size={18} />
          </button>
          <button
            title="Board"
            aria-label="Place a board"
            className={tool.type === "place" && tool.object.kind === "board" ? "is-active" : ""}
            onClick={() => set({ selectedId: null, tool: { type: "place", object: NEW_BOARD } })}
          >
            <Presentation size={18} />
          </button>
          <button title="Image" aria-label="Add an image" onClick={() => file.current?.click()}>
            <ImagePlus size={18} />
          </button>
          <button title="Paint on the floor" aria-label="Paint on the floor" className={tool.type === "brush" ? "is-active" : ""} onClick={() => set({ tool: { type: "brush" }, selectedId: null })}>
            <Paintbrush size={18} />
          </button>
          <div className="dock-color">
            <button title="Colour" aria-label="Choose colour" className="color-dot" style={{ background: color }} onClick={() => setShowColors(!showColors)} />
            {showColors && (
              <div className="palette popover">
                {PALETTE.map((value) => (
                  <button
                    key={value}
                    className={color === value ? "is-active" : ""}
                    style={{ background: value }}
                    aria-label={`Colour ${value}`}
                    onClick={() => {
                      set({ color: value });
                      setShowColors(false);
                      if (tool.type === "place" && tool.object.kind !== "model")
                        set({ tool: { type: "place", object: { ...tool.object, color: value } } });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <span className="dock-divider" />
          <button title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!history.undo.length} onClick={() => undo("undo")}>
            <Undo2 size={17} />
          </button>
          <button title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!history.redo.length} onClick={() => undo("redo")}>
            <Redo2 size={17} />
          </button>
        </nav>
      )}

      <div className="view-controls">
        <div className="segmented-mini" role="radiogroup" aria-label="Camera">
          {(["third", "first", "overview"] as CameraMode[]).map((mode, index) => (
            <button
              key={mode}
              role="radio"
              aria-checked={cameraMode === mode}
              className={cameraMode === mode ? "is-active" : ""}
              title={`${CAMERA_LABELS[mode]} (${index + 1})`}
              onClick={() => setCameraMode(mode)}
            >
              {mode === "overview" ? <Eye size={15} /> : <Footprints size={15} />}
              <span>{mode === "third" ? "3rd" : mode === "first" ? "1st" : "Top"}</span>
            </button>
          ))}
        </div>
        <button className={`icon-button ${grid ? "is-active" : ""}`} title="Grid and snapping (G)" aria-label="Toggle grid" aria-pressed={grid} onClick={() => set({ grid: !grid })}>
          <Grid2X2 size={16} />
        </button>
        <button className="icon-button" title="Help (?)" aria-label="Help" onClick={() => set({ dialog: "help" })}>
          <HelpCircle size={16} />
        </button>
      </div>

      {tool.type !== "select" && (
        <div className="tool-hint" role="status">
          {tool.type === "brush" ? "Drag on the floor to paint." : "Click the floor to place it. Shift-click to place several."}
          <button className="icon-button" aria-label="Stop" onClick={() => set({ tool: { type: "select" } })}>
            <X size={14} />
          </button>
        </div>
      )}

      {selected && !preview && <Inspector object={selected} />}

      <div className="panel-tabs" role="tablist" aria-label="Panels">
        {(
          [
            ["chat", MessageCircle, "Conversation"],
            ["people", Users, "People"],
            ["history", History, "History"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button key={value} role="tab" aria-selected={panel === value} className={panel === value ? "is-active" : ""} title={label} aria-label={label} onClick={() => togglePanel(value)}>
            <Icon size={17} />
            {value === "chat" && unread > 0 && panel !== "chat" && <b className="badge">{Math.min(unread, 9)}</b>}
          </button>
        ))}
      </div>
      {panel && (
        <aside className="side-panel" aria-label={panel}>
          <header>
            <h2>{panel === "chat" ? "Conversation" : panel === "people" ? "People here" : "History"}</h2>
            <button className="icon-button" aria-label="Close panel" onClick={() => set({ panel: null })}>
              <X size={16} />
            </button>
          </header>
          {panel === "chat" && <ChatPanel messages={room.messages} />}
          {panel === "people" && <PeoplePanel self={self} />}
          {panel === "history" && <HistoryPanel room={room} />}
        </aside>
      )}

      {preview ? (
        <div className="preview-banner" role="status">
          <div>
            <span className="eyebrow">PREVIEWING AN EARLIER VERSION</span>
            <strong>{preview.title}</strong>
          </div>
          {canEdit && (
            <button className="primary-button" onClick={() => void restoreCheckpoint(preview.id)}>
              Restore this version
            </button>
          )}
          <button className="secondary-button" onClick={() => set({ preview: null })}>
            Back to live
          </button>
        </div>
      ) : (
        <Composer voice={voice} />
      )}

      {touch && cameraMode !== "overview" && !preview && <TouchPad />}
      {!ready && (
        <div className="room-loading overlay">
          <LoaderCircle className="spin" size={22} />
          <span>Making a little space…</span>
        </div>
      )}

      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (!chosen) return;
          try {
            const object = await imageObject(chosen);
            addObjects([object]);
            set({ selectedId: object.id });
          } catch (error) {
            notify(error instanceof Error ? error.message : "That image couldn’t be opened.");
          }
        }}
      />
      {dialog === "invite" && <InviteDialog />}
      {dialog === "settings" && <SettingsDialog onDeleted={() => onLeave("The space was deleted.")} />}
      {dialog === "profile" && <ProfileDialog />}
      {dialog === "help" && <HelpDialog />}
      {dialog === "write" && <WriteDialog />}
      {boardId && (
        <Suspense
          fallback={
            <div className="room-loading overlay">
              <LoaderCircle className="spin" size={22} />
              <span>Opening the board…</span>
            </div>
          }
        >
          <BoardEditor id={boardId} onClose={closeBoard} />
        </Suspense>
      )}
      {dialog === "library" && (
        <Suspense fallback={null}>
          <Library />
        </Suspense>
      )}
      <Toast />
    </div>
  );
}
