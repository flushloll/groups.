import { ensureIdentity } from "../api";
import type { RoomObject } from "../assets";
import type {
  MovementInput,
  Participant,
  Patch,
  RoomMessage,
  RoomPatch,
  WorkspaceDelta,
} from "../types";
import { liveFrame, useApp } from "./store";
import { applyDelta, applyPatch, liveRoom } from "./sync";
import { record } from "./history";

type Turn = {
  type: "chat" | "transcript";
  id: string;
  roomId: string;
  text: string;
  toLuna?: boolean;
};

let socket: WebSocket | null = null;
let joined = false;
let disposed = true;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentSpace = "";
let presence: Partial<Participant> = { muted: true, speaking: false };
let presenceTimer: ReturnType<typeof setTimeout> | null = null;
let lastPresenceAt = 0;
const pendingTurns = new Map<string, Turn>();
let signalHandler: (peerId: string, data: unknown) => void = () => {};

export function onSignal(handler: (peerId: string, data: unknown) => void) {
  signalHandler = handler;
}

function raw(message: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !joined) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function profileColor() {
  try {
    return localStorage.getItem("groups-avatar-color") || undefined;
  } catch {
    return undefined;
  }
}

function newMessages(messages: RoomMessage[]) {
  const state = useApp.getState();
  if (!messages.length) return;
  if (state.panel !== "chat")
    useApp.setState({ unread: state.unread + messages.length });
}

function handle(message: any) {
  const app = useApp.getState();
  switch (message.type) {
    case "joined": {
      joined = true;
      attempt = 0;
      app.setConfirmed(message.workspace, message.seq);
      useApp.setState({
        status: "connected",
        selfId: message.selfId,
        selfName:
          (message.peers as Participant[]).find((peer) => peer.id === message.selfId)?.name || "You",
        access: message.access,
        peers: (message.peers as Participant[]).filter(
          (peer) => peer.id !== message.selfId,
        ),
        luna: message.lunaBusy
          ? { status: "thinking", message: "" }
          : app.luna.status === "thinking" || app.luna.status === "shaping"
            ? { status: "idle", message: "" }
            : app.luna,
      });
      // Replay unacknowledged edits and speech; the server ignores duplicates.
      for (const [patchId, patch] of useApp.getState().pending)
        raw({ type: "patch", patchId, patch });
      for (const turn of pendingTurns.values()) raw(turn);
      raw({ type: "presence", presence });
      return;
    }
    case "delta": {
      const delta = message.delta as WorkspaceDelta | null;
      if (delta) {
        if (message.seq !== app.seq + 1) {
          raw({ type: "resync" });
          return;
        }
        const confirmed = app.confirmed && applyDelta(app.confirmed, delta);
        if (confirmed) app.setConfirmed(confirmed, message.seq);
        newMessages(
          delta.rooms.flatMap((room) =>
            (room.messages?.upserts || []).filter(
              (item) => item.role === "ai" || !pendingTurns.has(item.id),
            ),
          ),
        );
      }
      if (message.patchId && message.peerId === app.selfId)
        useApp.getState().dropPending(message.patchId);
      return;
    }
    case "workspace":
      app.setConfirmed(message.workspace, message.seq);
      return;
    case "simulation":
      if (message.roomId === liveRoom(app.confirmed)?.id) {
        liveFrame.simulation = message;
        liveFrame.receivedAt = performance.now();
      }
      return;
    case "presence":
      useApp.setState({
        peers: (message.peers as Participant[]).filter(
          (peer) => peer.id !== app.selfId,
        ),
        selfName:
          (message.peers as Participant[]).find((peer) => peer.id === app.selfId)?.name ||
          app.selfName,
      });
      return;
    case "access":
      useApp.setState({ access: message.access });
      return;
    case "ack":
      pendingTurns.delete(message.id);
      return;
    case "development": {
      const running = ["thinking", "shaping"].includes(message.status);
      useApp.setState({
        luna: { status: message.status, message: message.message || "" },
      });
      if (message.status === "error" && message.message)
        app.notify(message.message);
      if (message.status === "restored" && message.message)
        app.notify(message.message);
      if (["complete", "restored"].includes(message.status))
        useApp.setState({ historyVersion: useApp.getState().historyVersion + 1 });
      if (!running && message.status === "complete")
        useApp.setState({ selectedId: null });
      return;
    }
    case "signal":
      signalHandler(message.peerId, message.data);
      return;
    case "error":
      if (message.code === "turn_rejected" && message.turnId)
        pendingTurns.delete(message.turnId);
      if (message.code === "patch_rejected" && message.patchId) {
        app.dropPending(message.patchId);
        if (message.workspace) app.setConfirmed(message.workspace, message.seq);
      }
      if (message.code === "full") useApp.setState({ status: "full" });
      if (message.code === "access_denied")
        useApp.setState({ status: "denied" });
      if (message.message) app.notify(message.message);
      return;
  }
}

/**
 * The server says where its realtime socket lives (it may be on another
 * origin when the site is served by Vercel) and issues a short-lived ticket,
 * so cookies never have to cross origins.
 */
async function socketUrl() {
  const local = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  const response = await fetch("/api/ws-ticket", { cache: "no-store" });
  if (response.status === 401) throw new Error("Could not authorise the live connection.");
  if (!response.ok) return `${local}/ws`;
  const { ticket, url } = (await response.json()) as { ticket: string; url?: string | null };
  const base = (url || import.meta.env.VITE_GROUPS_REALTIME_URL || local).replace(/\/$/, "");
  return `${base}/ws?ticket=${encodeURIComponent(ticket)}`;
}

async function open() {
  if (disposed) return;
  useApp.setState({ status: "connecting" });
  try {
    await ensureIdentity();
  } catch (error) {
    if (disposed) return;
    useApp.getState().notify(
      error instanceof Error ? error.message : "Could not connect your session.",
    );
    useApp.setState({ status: "denied" });
    return;
  }
  if (disposed) return;
  let url: string;
  try {
    url = await socketUrl();
  } catch {
    if (disposed) return;
    useApp.setState({ status: "connecting" });
    reconnectTimer = setTimeout(open, Math.min(15000, 700 * 2 ** attempt++));
    return;
  }
  if (disposed) return;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    if (disposed || socket !== ws) return ws.close();
    ws.send(
      JSON.stringify({
        type: "join",
        workspace: { id: currentSpace },
        color: profileColor(),
      }),
    );
  };
  ws.onmessage = (event) => {
    if (disposed || socket !== ws) return;
    try {
      handle(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  };
  ws.onclose = (event) => {
    if (disposed || socket !== ws) return;
    joined = false;
    liveFrame.simulation = null;
    const status = useApp.getState().status;
    useApp.setState({ peers: [] });
    if (status === "full" || status === "denied") return;
    if (/deleted|access/i.test(event.reason)) {
      useApp.setState({ status: "denied" });
      useApp.getState().notify(
        /deleted/i.test(event.reason)
          ? "This space was deleted."
          : "Your access to this space changed.",
      );
      return;
    }
    useApp.setState({ status: "connecting" });
    reconnectTimer = setTimeout(
      open,
      Math.min(15000, 700 * 2 ** attempt++) + Math.random() * 300,
    );
  };
  ws.onerror = () => {
    /* onclose schedules reconnection. */
  };
}

export function connect(spaceId: string) {
  disconnect();
  disposed = false;
  attempt = 0;
  currentSpace = spaceId;
  presence = { muted: true, speaking: false };
  void open();
}

export function disconnect() {
  disposed = true;
  joined = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (presenceTimer) clearTimeout(presenceTimer);
  reconnectTimer = presenceTimer = null;
  pendingTurns.clear();
  liveFrame.simulation = null;
  const ws = socket;
  socket = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
}

// --- Edits ---------------------------------------------------------------

export function sendPatch(patch: Patch, remember = true) {
  const app = useApp.getState();
  if (!app.access?.canEdit) return null;
  if (remember && app.workspace && patch.rooms.some((room) => room.objects)) {
    const before = liveRoom(app.workspace)?.objects || [];
    const after = liveRoom(applyPatch(app.workspace, patch))?.objects || [];
    record(before, after);
  }
  const patchId = crypto.randomUUID();
  app.addPending(patchId, patch);
  raw({ type: "patch", patchId, patch });
  return patchId;
}
function roomId() {
  return liveRoom(useApp.getState().workspace)?.id || "";
}
export function editRoom(change: Omit<RoomPatch, "id">, remember = true) {
  return sendPatch({ rooms: [{ id: roomId(), ...change }] }, remember);
}
export function addObjects(objects: RoomObject[]) {
  return editRoom({ objects: { upserts: objects } });
}
export function updateObject(
  id: string,
  fields: Partial<RoomObject>,
  remember = true,
) {
  return editRoom({ objects: { updates: [{ id, fields }] } }, remember);
}
export function removeObjects(ids: string[]) {
  return editRoom({ objects: { removes: ids } });
}
export function replaceObjects(objects: RoomObject[], removes: string[] = []) {
  return editRoom({ objects: { upserts: objects, removes } });
}

// --- Conversation ------------------------------------------------------------

function sendTurn(turn: Turn) {
  if (!turn.text.trim()) return;
  if (pendingTurns.size >= 100) {
    useApp
      .getState()
      .notify("You’re offline. New messages will send once you reconnect.");
    return;
  }
  pendingTurns.set(turn.id, turn);
  raw(turn);
}
export function sendChat(text: string, toLuna = false) {
  sendTurn({
    type: "chat",
    id: crypto.randomUUID(),
    roomId: roomId(),
    text: text.trim().slice(0, 4000),
    toLuna,
  });
}
export function sendTranscript(text: string) {
  sendTurn({
    type: "transcript",
    id: crypto.randomUUID(),
    roomId: roomId(),
    text: text.trim().slice(0, 10000),
  });
}
export function requestLuna() {
  return raw({ type: "develop", roomId: roomId() });
}

// --- Presence, movement and signalling ------------------------------------------

export function sendPresence(update: Partial<Participant>) {
  presence = { ...presence, ...update };
  if (presenceTimer) return;
  const flush = () => {
    presenceTimer = null;
    lastPresenceAt = Date.now();
    raw({ type: "presence", presence });
  };
  const wait = 60 - (Date.now() - lastPresenceAt);
  if (wait <= 0) flush();
  else presenceTimer = setTimeout(flush, wait);
}
export function sendMovement(input: MovementInput) {
  raw({ type: "move", roomId: roomId(), input });
}
export function sendSignal(target: string, data: unknown) {
  raw({ type: "signal", target, data });
}
export function sendProfile() {
  raw({ type: "profile" });
}
