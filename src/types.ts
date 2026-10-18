import type { Asset, RoomObject, Vector3 } from "./assets";
export type { RoomObject, Vector3 };
export type SpaceRole = "owner" | "moderator" | "contributor" | "viewer";
export type Visibility = "public" | "unlisted" | "private";
export type SpaceAccess = {
  role: SpaceRole;
  owned?: boolean;
  canEdit: boolean;
  canManage: boolean;
  visibility: Visibility;
};
export type SpaceSettings = {
  name: string;
  description: string;
  joinRole: "viewer" | "contributor";
  visibility: Visibility;
  color: string;
};
export type Checkpoint = {
  id: string;
  roomId: string;
  title: string;
  createdAt: string;
  actor: string;
  objectCount: number;
};
export type RoomMessage = {
  id: string;
  role: "you" | "ai";
  text: string;
  time: string;
  author?: string;
  canDirectLuna?: boolean;
  source?: "voice" | "text";
  toLuna?: boolean;
  status?: "changed" | "unchanged" | "error";
  checkpointId?: string;
};
export type Soundscape = "quiet" | "garden" | "ocean" | "studio" | "cosmic";
export type RoomEnvironment = {
  background: string;
  floor: string;
  walls: string;
  light: string;
  soundscape: Soundscape;
  setting?: "room" | "open";
};
export type RoomVersion = {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  objects: RoomObject[];
  messages: RoomMessage[];
  changes: string[];
  prompt: string;
  createdAt: string;
  sourceTurnIds?: string[];
  environment?: RoomEnvironment;
  autoBuild?: boolean;
};
export type ServerListing = {
  id: string;
  name: string;
  description: string;
  roomId: string;
  members: number;
  capacity: number;
  color: string;
  theme: Soundscape;
  visibility: Visibility;
  role?: SpaceRole;
  owned?: boolean;
  member?: boolean;
};
export type Workspace = {
  id: string;
  name: string;
  rooms: RoomVersion[];
  currentId: string;
  schemaVersion?: 2;
  assets?: Asset[];
};
export type Member = { id: string; name: string; role: SpaceRole; self: boolean };
export type Participant = {
  id: string;
  name: string;
  position: Vector3;
  roomId: string;
  muted: boolean;
  speaking: boolean;
  yaw?: number;
  grounded?: boolean;
  color?: string;
};
export type CameraMode = "third" | "first" | "overview";
export type MovementInput = {
  x: number;
  z: number;
  yaw: number;
  jump: boolean;
};
export type SimulationFrame = {
  roomId: string;
  tick: number;
  players: {
    id: string;
    position: Vector3;
    yaw: number;
    grounded: boolean;
  }[];
  objects: {
    id: string;
    position: Vector3;
    quaternion: [number, number, number, number];
  }[];
};
export type ItemChanges<T> = {
  upserts?: T[];
  removes?: string[];
  updates?: { id: string; fields: Partial<T> }[];
};
export type RoomPatch = {
  id: string;
  fields?: Partial<Pick<RoomVersion, "title" | "description" | "environment" | "autoBuild">>;
  objects?: ItemChanges<RoomObject>;
};
export type Patch = { name?: string; rooms: RoomPatch[] };
export type RoomDelta = {
  id: string;
  create?: RoomVersion;
  fields?: Partial<RoomVersion>;
  objects?: { upserts: RoomObject[]; removes: string[] };
  messages?: { upserts: RoomMessage[]; removes: string[] };
};
export type WorkspaceDelta = {
  name?: string;
  rooms: RoomDelta[];
  removedRooms?: string[];
};
export type LunaStatus =
  | "idle"
  | "thinking"
  | "shaping"
  | "complete"
  | "unchanged"
  | "error"
  | "restored";
