export type Vec3 = [number, number, number];
export type ColorRole = string;
type PartBase = {
  p: Vec3;
  c: ColorRole;
  rot?: Vec3;
  k?: Vec3;
  seg?: number;
  glow?: number;
  opacity?: number;
  anim?: "spin" | "bob" | "flicker";
};
export type ModelPart =
  | (PartBase & { g: "box" | "prism" | "wedge"; s: Vec3 })
  | (PartBase & { g: "cyl"; r: number; h: number; r2?: number })
  | (PartBase & { g: "cone"; r: number; h: number })
  | (PartBase & { g: "capsule"; r: number; h: number })
  | (PartBase & { g: "sphere" | "ico" | "dodeca"; r: number })
  | (PartBase & { g: "torus"; r: number; t: number })
  | (PartBase & { g: "star"; r: number; t: number });
export type Collider =
  | { type: "box" | "prism" | "wedge"; p: Vec3; s: Vec3 }
  | { type: "cyl"; p: Vec3; r: number; h: number }
  | { type: "ball"; p: Vec3; r: number };
export type ModelDefinition = {
  label: string;
  category: "nature" | "furniture" | "work" | "structure" | "fun";
  color: string;
  size: Vec3;
  physics?: "fixed" | "dynamic" | "none" | "kinematic" | "sensor";
  colliders?: Collider[];
  surface?: { p: Vec3; w: number; h: number; rot?: Vec3; flat?: boolean; light?: boolean };
  parts: ModelPart[];
};
export const ROOM: { halfX: number; halfZ: number; wallHeight: number };
export const PRIMITIVES: Record<"cube" | "sphere" | "pyramid" | "cylinder" | "cone", { label: string; size: Vec3 }>;
export const PANELS: Record<"text" | "note" | "image" | "board", { label: string; size: Vec3 }>;
export const MODELS: Record<string, ModelDefinition>;
export const MODEL_NAMES: string[];
export const PRIMITIVE_NAMES: string[];
export const PANEL_NAMES: string[];
type Sized = { kind: string; model?: string; scale?: number; stretch?: Vec3 };
export function baseSize(object: Sized): Vec3;
export function objectSize(object: Sized): Vec3;
export function restHeight(object: Sized): number;
export function catalogGuide(): string;
