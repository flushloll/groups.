import { createHash } from "node:crypto";
import { z } from "zod";
import { MODEL_NAMES } from "../shared/catalog.mjs";
import { BOARD_LIMITS } from "../shared/board.mjs";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const vector = z.tuple([
  z.number().min(-100).max(100),
  z.number().min(-100).max(100),
  z.number().min(-100).max(100),
]);
const stretchSchema = z.tuple([
  z.number().min(0.05).max(20),
  z.number().min(0.05).max(20),
  z.number().min(0.05).max(20),
]);
export const PROP_SHAPES = ["cube", "sphere", "pyramid", "cylinder", "cone"];
export const physicsSchema = z.enum([
  "fixed",
  "kinematic",
  "dynamic",
  "sensor",
  "none",
]);
const contentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("prop"),
      shape: z.enum(PROP_SHAPES),
    })
    .strict(),
  z
    .object({
      type: z.literal("model"),
      model: z.enum(MODEL_NAMES),
      label: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("document"),
      format: z.enum(["text", "note"]),
      text: z.string().max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      dataUrl: z
        .string()
        .max(2 * 1024 * 1024)
        .regex(/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/),
      title: z.string().max(10000),
    })
    .strict(),
  z
    .object({ type: z.literal("drawing"), points: z.array(vector).max(5000) })
    .strict(),
  z
    .object({
      type: z.literal("board"),
      title: z.string().max(200),
      elements: z
        .array(
          z
            .object({ id: z.string().min(1).max(80), type: z.string().max(40), version: z.number() })
            .passthrough(),
        )
        .max(BOARD_LIMITS.elements),
    })
    .strict(),
]);
export const assetSchema = z
  .object({
    id: identifier,
    kind: z.enum(["prop", "model", "document", "image", "drawing", "board"]),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    content: contentSchema,
  })
  .strict()
  .refine(
    (asset) => asset.kind === asset.content.type,
    "Asset content does not match its type.",
  );
export const instanceSchema = z
  .object({
    id: identifier,
    assetId: identifier,
    position: vector,
    rotation: vector.optional(),
    scale: z.number().min(0.05).max(20).optional(),
    stretch: stretchSchema.optional(),
    color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    physics: physicsSchema,
  })
  .strict();

export function objectContent(object) {
  if (PROP_SHAPES.includes(object.kind))
    return { type: "prop", shape: object.kind };
  if (object.kind === "model")
    return { type: "model", model: object.model, label: object.text || "" };
  if (["text", "note"].includes(object.kind))
    return { type: "document", format: object.kind, text: object.text || "" };
  if (object.kind === "board")
    return {
      type: "board",
      title: object.text || "",
      elements: object.board?.elements || [],
    };
  if (object.kind === "image")
    return {
      type: "image",
      dataUrl: object.image || "",
      title: object.text || "",
    };
  return { type: "drawing", points: object.points || [] };
}
function contentFields(content) {
  if (content.type === "prop") return { kind: content.shape };
  if (content.type === "model")
    return { kind: "model", model: content.model, text: content.label };
  if (content.type === "document")
    return { kind: content.format, text: content.text };
  if (content.type === "image")
    return { kind: "image", image: content.dataUrl, text: content.title };
  if (content.type === "board")
    return {
      kind: "board",
      text: content.title,
      board: { elements: content.elements },
    };
  return { kind: "stroke", points: content.points };
}
export function instanceOf(object) {
  return instanceSchema.parse({
    id: object.id,
    assetId: object.assetId,
    position: object.position,
    ...(object.rotation ? { rotation: object.rotation } : {}),
    ...(object.scale !== undefined ? { scale: object.scale } : {}),
    ...(object.stretch ? { stretch: object.stretch } : {}),
    color: object.color,
    physics: object.physics || "fixed",
  });
}
export function projectInstance(instance, assets) {
  const parsed = instanceSchema.parse(instance);
  const asset = assets.get(parsed.assetId);
  if (!asset) throw new Error("An instance references an unavailable asset.");
  return {
    ...parsed,
    ...contentFields(asset.content),
    assetRevision: asset.revision,
  };
}
export function attachAssets(workspace, initial = []) {
  const assets = new Map(
    initial.map((value) => {
      const asset = assetSchema.parse(value);
      return [asset.id, asset];
    }),
  );
  if (assets.size !== initial.length)
    throw new Error("Duplicate asset identifier.");
  const rooms = workspace.rooms.map((room) => ({
    ...room,
    objects: room.objects.map((object) => {
      const assetId =
        object.assetId ||
        `asset_${createHash("sha256").update(`${room.id}:${object.id}`).digest("hex").slice(0, 32)}`;
      const content = objectContent(object);
      let asset = assets.get(assetId);
      if (asset && JSON.stringify(asset.content) !== JSON.stringify(content))
        throw new Error(
          "Asset content must be edited through its room command.",
        );
      if (!asset) {
        asset = assetSchema.parse({
          id: assetId,
          kind: content.type,
          revision: 1,
          content,
        });
        assets.set(assetId, asset);
      }
      return projectInstance(instanceOf({ ...object, assetId }), assets);
    }),
  }));
  if (assets.size > 10000) throw new Error("Workspace asset limit reached.");
  return {
    ...workspace,
    schemaVersion: 2,
    assets: [...assets.values()],
    rooms,
  };
}

/** Compatibility command adapter: spatial edits never rewrite asset content. */
export function editRoomObjects(workspace, roomId, objects) {
  const assets = new Map(workspace.assets.map((asset) => [asset.id, asset]));
  const source = workspace.rooms.find((room) => room.id === roomId);
  const previous = new Map(source.objects.map((object) => [object.id, object]));
  const edited = objects.map((object) => {
    const old = previous.get(object.id);
    // New instances are independent copies unless a dedicated linking command is used.
    const assetId =
      old?.assetId ||
      `asset_${createHash("sha256").update(`${roomId}:${object.id}`).digest("hex").slice(0, 32)}`;
    const content = objectContent(object);
    const asset = assets.get(assetId);
    if (!asset || JSON.stringify(asset.content) !== JSON.stringify(content)) {
      if (
        old &&
        object.assetRevision !== undefined &&
        object.assetRevision !== asset.revision
      )
        throw new Error(
          "This asset changed. Read its latest version before editing.",
        );
      assets.set(
        assetId,
        assetSchema.parse({
          id: assetId,
          kind: content.type,
          revision: (asset?.revision || 0) + 1,
          content,
        }),
      );
    }
    return { ...object, assetId };
  });
  return {
    ...workspace,
    assets: [...assets.values()],
    rooms: workspace.rooms.map((room) => ({
      ...room,
      objects: (room.id === roomId ? edited : room.objects).map((object) =>
        projectInstance(instanceOf(object), assets),
      ),
    })),
  };
}

/** Persist content once; expanded objects exist only at the legacy renderer boundary. */
export function serializeWorkspace(workspace) {
  return {
    ...workspace,
    rooms: workspace.rooms.map(({ objects, ...room }) => ({
      ...room,
      instances: objects.map(instanceOf),
    })),
  };
}
