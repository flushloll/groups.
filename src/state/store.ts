import { create } from "zustand";
import type {
  CameraMode,
  LunaStatus,
  Participant,
  Patch,
  RoomEnvironment,
  SimulationFrame,
  SpaceAccess,
  SpaceSettings,
  Workspace,
} from "../types";
import type { RoomObject } from "../assets";
import { applyPatch } from "./sync";

export type Tool =
  | { type: "select" }
  | { type: "place"; object: Omit<RoomObject, "id" | "position"> }
  | { type: "brush" };
export type Panel = "chat" | "history" | "people" | null;
export type Dialog =
  | "invite"
  | "settings"
  | "profile"
  | "help"
  | "write"
  | "library"
  | null;
export type ConnectionStatus =
  | "offline"
  | "connecting"
  | "connected"
  | "full"
  | "denied";

const storedCamera = (): CameraMode => {
  try {
    const value = localStorage.getItem("groups-camera");
    if (value === "first" || value === "third" || value === "overview")
      return value;
  } catch {
    /* Storage can be unavailable in private windows. */
  }
  return "third";
};

type State = {
  // Space session
  spaceId: string | null;
  confirmed: Workspace | null;
  pending: [string, Patch][];
  workspace: Workspace | null;
  seq: number;
  access: SpaceAccess | null;
  settings: SpaceSettings | null;
  status: ConnectionStatus;
  selfId: string;
  selfName: string;
  peers: Participant[];
  luna: { status: LunaStatus; message: string };
  builderOnline: boolean;
  transcription: boolean;
  iceServers: RTCIceServer[];
  // Interface
  tool: Tool;
  color: string;
  selectedId: string | null;
  panel: Panel;
  dialog: Dialog;
  writing: { id: string | null; kind: "note" | "text" | "model"; model?: string } | null;
  cameraMode: CameraMode;
  grid: boolean;
  toast: { id: number; text: string } | null;
  unread: number;
  preview: CheckpointPreview | null;
  historyVersion: number;
  boardId: string | null;
};
export type CheckpointPreview = {
  id: string;
  title: string;
  createdAt: string;
  actor: string;
  objects: RoomObject[];
  environment?: RoomEnvironment;
};
type Actions = {
  set: (partial: Partial<State>) => void;
  setConfirmed: (workspace: Workspace, seq: number) => void;
  addPending: (id: string, patch: Patch) => void;
  dropPending: (id: string) => void;
  notify: (text: string) => void;
  setCameraMode: (mode: CameraMode) => void;
  reset: () => void;
};

const initial: State = {
  spaceId: null,
  confirmed: null,
  pending: [],
  workspace: null,
  seq: 0,
  access: null,
  settings: null,
  status: "offline",
  selfId: "",
  selfName: "You",
  peers: [],
  luna: { status: "idle", message: "" },
  builderOnline: false,
  transcription: false,
  iceServers: [],
  tool: { type: "select" },
  color: "#a99bd3",
  selectedId: null,
  panel: null,
  dialog: null,
  writing: null,
  cameraMode: storedCamera(),
  grid: false,
  toast: null,
  unread: 0,
  preview: null,
  historyVersion: 0,
  boardId: null,
};

function view(confirmed: Workspace | null, pending: [string, Patch][]) {
  if (!confirmed) return null;
  return pending.reduce((workspace, [, patch]) => {
    try {
      return applyPatch(workspace, patch);
    } catch {
      return workspace;
    }
  }, confirmed);
}

let toastId = 0;
export const useApp = create<State & Actions>()((set, get) => ({
  ...initial,
  set: (partial) => set(partial),
  setConfirmed: (confirmed, seq) =>
    set({ confirmed, seq, workspace: view(confirmed, get().pending) }),
  addPending: (id, patch) => {
    const pending = [...get().pending, [id, patch] as [string, Patch]];
    set({ pending, workspace: view(get().confirmed, pending) });
  },
  dropPending: (id) => {
    const pending = get().pending.filter(([key]) => key !== id);
    set({ pending, workspace: view(get().confirmed, pending) });
  },
  notify: (text) => set({ toast: { id: ++toastId, text } }),
  setCameraMode: (cameraMode) => {
    try {
      localStorage.setItem("groups-camera", cameraMode);
    } catch {
      /* Preference only. */
    }
    set({ cameraMode });
  },
  reset: () =>
    set({
      ...initial,
      cameraMode: get().cameraMode,
      color: get().color,
      builderOnline: get().builderOnline,
      transcription: get().transcription,
      iceServers: get().iceServers,
    }),
}));

/** Per-frame state kept outside React to avoid re-rendering at 60 Hz. */
export const liveFrame = {
  simulation: null as SimulationFrame | null,
  receivedAt: 0,
  selfPosition: [0, 0, 3] as [number, number, number],
  lookYaw: 0,
  lookPitch: -0.18,
  voiceLevels: new Map<string, number>(),
  keys: new Set<string>(),
  dragging: null as string | null,
};
