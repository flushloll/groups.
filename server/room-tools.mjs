import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import * as schema from "./schema.mjs";
import {
  MODEL_NAMES,
  MODELS,
  ROOM,
  catalogGuide,
  objectSize,
} from "../shared/catalog.mjs";
import { boardText, notesToElements } from "../shared/board.mjs";

const round = (n) => Math.round(n * 100) / 100;
const vector = z.tuple([
  z.number().min(-ROOM.halfX).max(ROOM.halfX),
  z.number().min(0).max(20),
  z.number().min(-ROOM.halfZ).max(ROOM.halfZ),
]);
const rotation = z.tuple([
  z.number().min(-7).max(7),
  z.number().min(-7).max(7),
  z.number().min(-7).max(7),
]);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const fields = {
  kind: z
    .enum([
      "model",
      "cube",
      "sphere",
      "pyramid",
      "cylinder",
      "cone",
      "text",
      "note",
      "board",
      "stroke",
    ])
    .describe(
      "model uses the catalog; primitives are cube/sphere/pyramid/cylinder/cone; text and note are readable panels; board is a collaborative sticky-note board people can draw on; stroke is a floor drawing.",
    ),
  model: z
    .enum(MODEL_NAMES)
    .optional()
    .describe("Required when kind is model."),
  position: vector.describe(
    "Centre [x, y, z]. y = 0 rests the object on the floor automatically.",
  ),
  rotation: rotation.optional().describe("Euler radians; usually [0, yaw, 0]."),
  scale: z.number().min(0.05).max(8).optional(),
  stretch: z
    .tuple([
      z.number().min(0.05).max(12),
      z.number().min(0.05).max(12),
      z.number().min(0.05).max(12),
    ])
    .optional()
    .describe(
      "Per-axis proportions [x, y, z] applied after scale, e.g. a cube with [4, 0.1, 3] is a slab.",
    ),
  physics: z
    .enum(["fixed", "kinematic", "dynamic", "sensor", "none"])
    .optional()
    .describe(
      "fixed: anchored solid (default); dynamic: falls and can be pushed; none: visual only, people walk through.",
    ),
  color,
  text: z
    .string()
    .max(10000)
    .optional()
    .describe(
      "Text for text/note panels, or a short label/written content for models marked [text].",
    ),
  points: z.array(vector).min(2).max(1000).optional(),
  notes: z
    .array(z.string().max(280))
    .max(24)
    .optional()
    .describe("Boards only: sticky notes to put on the board (new notes are added to existing ones). text is the board title."),
};
export const environmentSchema = z.object({
  background: color,
  floor: color,
  walls: color,
  light: color,
  soundscape: z.enum(schema.SOUNDSCAPES),
  setting: z
    .enum(schema.SETTINGS)
    .optional()
    .describe("room: walled interior; open: open-air island without walls."),
});
export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), object: z.object(fields) }),
  z.object({
    type: z.literal("update"),
    id: z.string().max(80),
    fields: z.object(fields).partial(),
  }),
  z.object({ type: z.literal("remove"), id: z.string().max(80) }),
]);
export const planSchema = z.object({
  revision: z
    .string()
    .describe("The exact source revision returned by get_room_context."),
  title: z.string().min(1).max(200),
  description: z.string().max(4000),
  changes: z.array(z.string().max(2000)).min(1).max(30),
  operations: z.array(operationSchema).max(200),
  environment: environmentSchema.optional(),
});

/**
 * Stable description of what an object means rather than where physics has
 * carried it. Dynamic props roll around constantly; that should not
 * invalidate a plan made a few seconds earlier.
 */
export function objectFingerprint(object) {
  const { position, rotation, assetId, ...rest } = object;
  return JSON.stringify(
    object.physics === "dynamic" ? rest : { ...rest, position, rotation },
  );
}
export function revision(room) {
  const spatial = {
    title: room.title,
    description: room.description,
    environment: room.environment,
    objects: room.objects.map(objectFingerprint),
  };
  return createHash("sha256").update(JSON.stringify(spatial)).digest("hex");
}

function describeObject({ image, points, assetId, assetRevision, board, ...object }) {
  const size = objectSize(object);
  const result = {
    ...object,
    position: object.position.map(round),
    ...(object.rotation ? { rotation: object.rotation.map(round) } : {}),
    size: size.map(round),
    top: round(
      (object.position[1] === 0 ? size[1] / 2 : object.position[1]) +
        size[1] / 2,
    ),
  };
  if (image) result.imageAttached = true;
  if (board) result.boardText = boardText(board.elements);
  if (points)
    result.points =
      points.length > 40
        ? points
            .filter((_, i) => i % Math.ceil(points.length / 40) === 0)
            .map((point) => point.map(round))
        : points.map((point) => point.map(round));
  return result;
}

export const SPATIAL_GUIDE = `Y is up; metres. The floor spans x ${-ROOM.halfX}..${ROOM.halfX}, z ${-ROOM.halfZ}..${ROOM.halfZ}; walls (when setting is room) stand at the back (z=${-ROOM.halfZ}) and left (x=${-ROOM.halfX}). Visitors spawn near (0, 3) looking toward -z, so the area around z=-3..0 is the natural focal point. A person is 1.7 m tall.
Position is an object's centre. Use y = 0 to rest anything on the floor. To place something on a surface, set y = surface top + object height / 2 (each listed object reports size [w,h,d] and top). Rotation [0, yaw, 0] turns an object; models face +z by default (chairs face +z, so a chair at z=+1 facing a table at z=0 needs yaw Math.PI).
Sizes below are at scale 1. scale multiplies uniformly; stretch multiplies per axis (cube stretched [3, 0.08, 2] is a 3.9 x 0.1 x 2.6 m slab).
Primitives: cube 1.3, sphere 1.44, pyramid 1.34x1.65, cylinder 1.2x1.5, cone 1.3x1.6. Panels: text 2.5x1.25, note 1.85x1.55, board 3.2x2 (stand upright; fixed; a board's centre is usually at y 1.4).
Use a board for brainstorms, retros and option lists people will keep editing; use notes/whiteboards for short fixed text.
Catalog models (name w x h x d; [text] shows the object's text on its surface):
${catalogGuide()}`;

export function roomContext(workspace, roomId) {
  const room = workspace.rooms.find((item) => item.id === roomId);
  schema.assert(room, "This room no longer exists.");
  return {
    space: workspace.name,
    roomId,
    revision: revision(room),
    title: room.title,
    description: room.description,
    environment: room.environment,
    guide: SPATIAL_GUIDE,
    objects: room.objects.map(describeObject),
    conversation: room.messages.slice(-60).map((item) => ({
      id: item.id,
      speaker: item.role === "ai" ? "Luna" : item.author || "Someone",
      text: item.text,
      ...(item.role === "you" && item.canDirectLuna === false
        ? { viewer: true }
        : {}),
    })),
  };
}
export function attachedImages(room) {
  return room.objects
    .filter((object) => object.kind === "image" && object.image)
    .slice(-4)
    .map((object) => ({ id: object.id, image: object.image }));
}

function normalize(object, previous) {
  // Floor contact is resolved by the renderer and physics service.
  const { notes, ...result } = object;
  if (result.kind === "board") {
    const existing = previous?.kind === "board" ? previous.board?.elements || [] : [];
    const added = notes?.length
      ? notesToElements(notes, existing.length ? "" : result.text || "")
      : [];
    if (existing.length && added.length) {
      // Place new notes below what is already on the board.
      const bottom = Math.max(...existing.filter((e) => !e.isDeleted).map((e) => e.y + e.height), 0);
      for (const element of added) element.y += bottom + 60;
    }
    result.board = { elements: [...existing, ...added] };
    result.physics ||= "fixed";
  } else delete result.board;
  if (result.kind !== "model") delete result.model;
  if (result.kind === "model") {
    schema.assert(result.model, "A model object needs a catalog model.");
    if (!result.physics && MODELS[result.model].physics)
      result.physics = MODELS[result.model].physics;
  }
  return result;
}

/**
 * Apply a validated plan to a room. baseline maps object ids to the
 * fingerprints the planner saw; with it, unrelated edits made while the model
 * was thinking are merged instead of rejected.
 */
export function applyPlan(workspace, roomId, input, turnIds = [], baseline) {
  const plan = planSchema.parse(input);
  const source = workspace.rooms.find((item) => item.id === roomId);
  schema.assert(source, "This room no longer exists.");
  const objects = new Map(source.objects.map((object) => [object.id, object]));
  if (revision(source) !== plan.revision) {
    schema.assert(
      baseline,
      "The room changed while I was building. Try again with its latest state.",
    );
    for (const operation of plan.operations) {
      if (operation.type === "add") continue;
      const current = objects.get(operation.id);
      schema.assert(
        current && objectFingerprint(current) === baseline.get(operation.id),
        "Someone changed the same objects while I was building. Try again with the latest room.",
      );
    }
  }
  const consumed = new Set(source.sourceTurnIds || []);
  schema.assert(
    !turnIds.some((id) => consumed.has(id)),
    "These thoughts are already developed.",
  );
  schema.assert(
    turnIds.every((id) =>
      source.messages.some((item) => item.id === id && item.role === "you"),
    ),
    "Some source thoughts are unavailable.",
  );
  for (const operation of plan.operations) {
    if (operation.type === "add") {
      const object = schema.object(
        normalize({ ...operation.object, id: randomUUID() }),
      );
      objects.set(object.id, object);
    } else {
      schema.assert(
        objects.has(operation.id),
        "An edited object no longer exists.",
      );
      if (operation.type === "remove") objects.delete(operation.id);
      else {
        const previous = objects.get(operation.id);
        objects.set(
          operation.id,
          schema.object(
            normalize(
              {
                ...previous,
                ...operation.fields,
                id: operation.id,
                // Kind changes create new content; keep the asset binding coherent.
                ...(operation.fields.kind &&
                operation.fields.kind !== previous.kind
                  ? { assetRevision: undefined }
                  : {}),
              },
              previous,
            ),
          ),
        );
      }
    }
  }
  const environment = plan.environment
    ? { ...source.environment, ...plan.environment }
    : source.environment;
  schema.assert(
    JSON.stringify([...objects.values()]) !== JSON.stringify(source.objects) ||
      JSON.stringify(environment) !== JSON.stringify(source.environment),
    "The model did not make a spatial change. Your thoughts are saved; try a more specific request.",
  );
  return {
    title: plan.title,
    description: plan.description,
    changes: plan.changes,
    objects: [...objects.values()],
    environment,
    prompt: source.messages
      .filter((item) => turnIds.includes(item.id))
      .map((item) => item.text)
      .join(" ")
      .slice(0, 100000),
  };
}
