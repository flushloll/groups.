import { MODELS } from "../shared/catalog.mjs";
import type { BoardElement } from "../shared/board.mjs";
export type { BoardElement };

export type Vector3 = [number, number, number];
export type PhysicsProfile =
  | "fixed"
  | "kinematic"
  | "dynamic"
  | "sensor"
  | "none";
export type AssetKind = "prop" | "model" | "document" | "image" | "drawing" | "board";
export type PrimitiveKind = "cube" | "sphere" | "pyramid" | "cylinder" | "cone";

export type AssetContent =
  | { type: "prop"; shape: PrimitiveKind }
  | { type: "model"; model: string; label: string }
  | { type: "document"; format: "text" | "note"; text: string }
  | { type: "image"; dataUrl: string; title: string }
  | { type: "drawing"; points: Vector3[] };

export type Asset = {
  id: string;
  kind: AssetKind;
  revision: number;
  content: AssetContent;
};

/** Renderer projection. Content is persisted on Asset; placement on the instance. */
export type RoomObject = {
  id: string;
  kind: PrimitiveKind | "model" | "text" | "note" | "image" | "stroke" | "board";
  model?: string;
  position: Vector3;
  rotation?: Vector3;
  scale?: number;
  stretch?: Vector3;
  color: string;
  text?: string;
  image?: string;
  points?: Vector3[];
  board?: { elements: BoardElement[] };
  assetId?: string;
  assetRevision?: number;
  physics?: PhysicsProfile;
};

export const PRIMITIVE_KINDS: PrimitiveKind[] = [
  "cube",
  "sphere",
  "pyramid",
  "cylinder",
  "cone",
];

export function objectLabel(object: RoomObject) {
  if (object.kind === "model")
    return object.text?.split("\n")[0].slice(0, 40) ||
      MODELS[object.model || ""]?.label ||
      "Object";
  if (object.kind === "stroke") return "Drawing";
  if (object.kind === "board") return object.text || "Board";
  if (object.kind === "image") return object.text || "Image";
  if (object.kind === "note" || object.kind === "text")
    return object.text?.split("\n")[0].slice(0, 40) ||
      (object.kind === "note" ? "Note" : "Text");
  return object.kind[0].toUpperCase() + object.kind.slice(1);
}

/** Objects whose text field is shown in the room. */
export function hasWriting(object: RoomObject) {
  return (
    object.kind === "note" ||
    object.kind === "text" ||
    (object.kind === "model" && Boolean(MODELS[object.model || ""]?.surface))
  );
}
