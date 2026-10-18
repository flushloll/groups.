import {
  assetSchema,
  attachAssets,
  editRoomObjects,
  physicsSchema,
  projectInstance,
  serializeWorkspace,
} from "./assets.mjs";
import { MODELS } from "../shared/catalog.mjs";
import { BOARD_LIMITS, mergeBoardElements } from "../shared/board.mjs";

// Allow only the data used by the room renderer and shared graph.
export const LIMITS = {
  rooms: 200,
  objects: 500,
  messages: 2000,
  points: 5000,
  // A join carries the full workspace plus its message envelope.
  payload: 36 * 1024 * 1024,
  workspaceBytes: 32 * 1024 * 1024,
};

const kinds = new Set([
  "cube",
  "sphere",
  "pyramid",
  "cylinder",
  "cone",
  "model",
  "text",
  "note",
  "image",
  "stroke",
  "board",
]);
// Fields a partial update may change. Identity, type and content binding are fixed.
const updatable = new Set([
  "position",
  "rotation",
  "scale",
  "stretch",
  "color",
  "text",
  "points",
  "physics",
  "assetRevision",
  "board",
]);
export function assert(condition, message = "Invalid workspace data.") {
  if (!condition) throw new Error(message);
}
export function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function id(value) {
  assert(
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value),
    "Invalid identifier.",
  );
  return value;
}
export function text(value, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  assert(
    typeof value === "string" && value.length <= max,
    "Text exceeds the supported size.",
  );
  return value;
}
function vector(value, bound = 100) {
  assert(
    Array.isArray(value) &&
      value.length === 3 &&
      value.every((n) => Number.isFinite(n) && Math.abs(n) <= bound),
    "Invalid spatial coordinates.",
  );
  return [...value];
}
function list(value, limit, parse) {
  assert(
    Array.isArray(value) && value.length <= limit,
    "Room exceeds the supported size.",
  );
  return value.map(parse);
}
function unique(items) {
  assert(
    new Set(items.map((item) => item.id)).size === items.length,
    "Duplicate identifier.",
  );
  return items;
}
function timestamp(value) {
  assert(
    typeof value === "string" &&
      value.length <= 40 &&
      Number.isFinite(Date.parse(value)),
    "Invalid timestamp.",
  );
  return value;
}
export function object(value) {
  assert(record(value) && kinds.has(value.kind), "Invalid room object.");
  const result = {
    id: id(value.id),
    kind: value.kind,
    position: vector(value.position),
    color: text(value.color, 7),
  };
  assert(/^#[a-fA-F0-9]{6}$/.test(result.color), "Invalid object color.");
  if (value.kind === "model") {
    assert(
      typeof value.model === "string" && Object.hasOwn(MODELS, value.model),
      "Unknown model.",
    );
    result.model = value.model;
  }
  if (value.rotation !== undefined) result.rotation = vector(value.rotation);
  if (value.scale !== undefined) {
    assert(
      Number.isFinite(value.scale) && value.scale >= 0.05 && value.scale <= 20,
      "Invalid object scale.",
    );
    result.scale = value.scale;
  }
  if (value.stretch !== undefined) {
    result.stretch = vector(value.stretch);
    assert(
      result.stretch.every((n) => n >= 0.05 && n <= 20),
      "Invalid object proportions.",
    );
  }
  if (value.text !== undefined) result.text = text(value.text, 10000);
  if (value.image !== undefined) {
    result.image = text(value.image, 2 * 1024 * 1024);
    assert(
      /^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(result.image),
      "Invalid room image.",
    );
  }
  if (value.points !== undefined)
    result.points = list(value.points, LIMITS.points, (point) => vector(point));
  if (value.kind === "board") {
    const board = value.board ?? { elements: [] };
    assert(
      record(board) &&
        Array.isArray(board.elements) &&
        board.elements.length <= BOARD_LIMITS.elements &&
        board.elements.every(
          (element) =>
            record(element) &&
            typeof element.id === "string" &&
            element.id.length <= 80 &&
            typeof element.type === "string" &&
            Number.isFinite(element.version),
        ),
      "Invalid board.",
    );
    assert(
      Buffer.byteLength(JSON.stringify(board.elements)) <= BOARD_LIMITS.bytes,
      "This board is full. Remove a few things or start another board.",
    );
    result.board = { elements: board.elements };
  }
  if (value.assetId !== undefined) result.assetId = id(value.assetId);
  if (value.assetRevision !== undefined) {
    assert(
      Number.isSafeInteger(value.assetRevision) && value.assetRevision > 0,
      "Invalid asset revision.",
    );
    result.assetRevision = value.assetRevision;
  }
  if (value.physics !== undefined)
    result.physics = physicsSchema.parse(value.physics);
  return result;
}
export function message(value) {
  assert(
    record(value) && ["you", "ai"].includes(value.role),
    "Invalid room message.",
  );
  const result = {
    id: id(value.id),
    role: value.role,
    text: text(value.text, 10000),
    time: timestamp(value.time),
  };
  if (value.author !== undefined) result.author = text(value.author, 80);
  if (value.canDirectLuna !== undefined) {
    assert(
      typeof value.canDirectLuna === "boolean",
      "Invalid conversation permission.",
    );
    result.canDirectLuna = value.canDirectLuna;
  }
  if (value.source !== undefined) {
    assert(["voice", "text"].includes(value.source), "Invalid message source.");
    result.source = value.source;
  }
  if (value.toLuna !== undefined) {
    assert(typeof value.toLuna === "boolean", "Invalid message target.");
    result.toLuna = value.toLuna;
  }
  if (value.status !== undefined) {
    assert(
      ["changed", "unchanged", "error"].includes(value.status),
      "Invalid reply status.",
    );
    result.status = value.status;
  }
  if (value.checkpointId !== undefined)
    result.checkpointId = id(value.checkpointId);
  return result;
}
export function room(value) {
  assert(record(value), "Invalid room.");
  const result = {
    id: id(value.id),
    parentId: value.parentId === null ? null : id(value.parentId),
    title: text(value.title, 200),
    description: text(value.description, 4000),
    objects: unique(list(value.objects, LIMITS.objects, object)),
    messages: unique(list(value.messages, LIMITS.messages, message)),
    changes: list(value.changes, 100, (item) => text(item, 2000)),
    prompt: text(value.prompt, 100000),
    createdAt: timestamp(value.createdAt),
  };
  if (value.sourceTurnIds !== undefined)
    result.sourceTurnIds = list(value.sourceTurnIds, LIMITS.messages * 4, id);
  if (value.environment !== undefined)
    result.environment = environment(value.environment);
  if (value.autoBuild !== undefined) {
    assert(typeof value.autoBuild === "boolean", "Invalid Luna setting.");
    result.autoBuild = value.autoBuild;
  }
  return result;
}
export const SOUNDSCAPES = ["quiet", "garden", "ocean", "studio", "cosmic"];
export const SETTINGS = ["room", "open"];
export function environment(value) {
  assert(record(value), "Invalid room atmosphere.");
  const result = {};
  for (const key of ["background", "floor", "walls", "light"]) {
    assert(
      typeof value[key] === "string" && /^#[a-fA-F0-9]{6}$/.test(value[key]),
      "Invalid atmosphere color.",
    );
    result[key] = value[key];
  }
  assert(SOUNDSCAPES.includes(value.soundscape), "Invalid soundscape.");
  result.soundscape = value.soundscape;
  if (value.setting !== undefined) {
    assert(SETTINGS.includes(value.setting), "Invalid room setting.");
    result.setting = value.setting;
  }
  return result;
}
export function workspace(value) {
  assert(record(value), "Invalid workspace.");
  const assets =
    value.assets === undefined
      ? []
      : list(value.assets, 10000, (asset) => assetSchema.parse(asset));
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const result = {
    id: id(value.id),
    name: text(value.name, 200),
    rooms: unique(
      list(value.rooms, LIMITS.rooms, (entry) =>
        room(
          entry.objects !== undefined
            ? entry
            : {
                ...entry,
                objects: list(entry.instances, LIMITS.objects, (instance) =>
                  projectInstance(instance, assetMap),
                ),
              },
        ),
      ),
    ),
    currentId: id(value.currentId),
  };
  assert(result.rooms.length > 0, "A workspace needs a room.");
  const rooms = new Map(result.rooms.map((item) => [item.id, item]));
  assert(rooms.has(result.currentId), "Unknown current room.");
  for (const item of result.rooms) {
    const visited = new Set([item.id]);
    let parentId = item.parentId;
    while (parentId !== null) {
      assert(
        rooms.has(parentId) && !visited.has(parentId),
        "Invalid room history.",
      );
      visited.add(parentId);
      parentId = rooms.get(parentId).parentId;
    }
  }
  const normalized = attachAssets(result, assets);
  assert(
    Buffer.byteLength(JSON.stringify(serializeWorkspace(normalized))) <=
      LIMITS.workspaceBytes,
    "Workspace storage limit reached.",
  );
  return normalized;
}

function merge(items, delta, parse, limit) {
  if (delta === undefined) return items;
  assert(record(delta), "Invalid room patch.");
  const removes = list(delta.removes || [], limit, id);
  const upserts = unique(list(delta.upserts || [], limit, parse));
  const merged = new Map(items.map((item) => [item.id, item]));
  removes.forEach((key) => merged.delete(key));
  upserts.forEach((item) => merged.set(item.id, item));
  // Partial updates merge into the latest object, so concurrent edits to
  // different fields of one object both survive.
  for (const update of list(delta.updates || [], limit, (entry) => entry)) {
    assert(record(update) && record(update.fields), "Invalid object update.");
    const existing = merged.get(id(update.id));
    if (!existing) continue;
    for (const key of Object.keys(update.fields))
      assert(updatable.has(key), "This object field cannot be changed.");
    const fields = { ...update.fields };
    // Board edits carry only changed elements; merge them by version.
    if (fields.board !== undefined) {
      assert(existing.kind === "board" && record(fields.board), "Invalid board update.");
      assert(
        Array.isArray(fields.board.elements) &&
          fields.board.elements.length <= BOARD_LIMITS.elements,
        "Invalid board update.",
      );
      fields.board = {
        elements: mergeBoardElements(
          existing.board?.elements,
          fields.board.elements,
        ),
      };
    }
    merged.set(existing.id, parse({ ...existing, ...fields }));
  }
  assert(merged.size <= limit, "Room storage limit reached.");
  return [...merged.values()];
}
export function applyPatch(current, patch) {
  assert(
    record(patch) &&
      Array.isArray(patch.rooms) &&
      patch.rooms.length <= LIMITS.rooms,
    "Invalid workspace patch.",
  );
  let updated = current;
  const rooms = new Map(current.rooms.map((item) => [item.id, item]));
  for (const change of patch.rooms) {
    assert(record(change), "Invalid room patch.");
    const roomId = id(change.id);
    const previous = rooms.get(roomId);
    // Each space has one live room. History is kept as checkpoints, not branches.
    assert(previous, "This room could not be found.");
    const next = { ...previous };
    if (change.fields !== undefined) {
      assert(record(change.fields), "Invalid room fields.");
      for (const key of ["title", "description", "environment", "autoBuild"])
        if (change.fields[key] !== undefined) next[key] = change.fields[key];
    }
    next.objects = merge(
      previous.objects,
      change.objects,
      object,
      LIMITS.objects,
    );
    next.messages = merge(
      previous.messages,
      change.messages,
      message,
      LIMITS.messages,
    );
    rooms.set(roomId, next);
  }
  // Apply content changes through the asset adapter before schema validation.
  for (const change of patch.rooms) {
    if (!change.objects) continue;
    updated = editRoomObjects(updated, change.id, rooms.get(change.id).objects);
  }
  return workspace({
    ...updated,
    name: patch.name === undefined ? current.name : patch.name,
    rooms: [...rooms.values()].map((next) => ({
      ...next,
      objects:
        updated.rooms.find((entry) => entry.id === next.id)?.objects ||
        next.objects,
    })),
  });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function itemDelta(before, after) {
  const previous = new Map(before.map((item) => [item.id, item]));
  const ids = new Set(after.map((item) => item.id));
  const upserts = after.filter((item) => !same(item, previous.get(item.id)));
  const removes = before
    .filter((item) => !ids.has(item.id))
    .map((item) => item.id);
  return upserts.length || removes.length ? { upserts, removes } : undefined;
}
const roomFields = [
  "title",
  "description",
  "changes",
  "prompt",
  "environment",
  "sourceTurnIds",
  "autoBuild",
];
/** Minimal description of what changed between two canonical workspaces. */
export function workspaceDelta(before, after) {
  const previous = new Map(before.rooms.map((item) => [item.id, item]));
  const delta = { rooms: [] };
  if (before.name !== after.name) delta.name = after.name;
  for (const next of after.rooms) {
    const old = previous.get(next.id);
    if (!old) {
      delta.rooms.push({ id: next.id, create: next });
      continue;
    }
    const fields = {};
    for (const key of roomFields)
      if (!same(old[key], next[key])) fields[key] = next[key];
    const objects = itemDelta(old.objects, next.objects);
    const messages = itemDelta(old.messages, next.messages);
    if (Object.keys(fields).length || objects || messages)
      delta.rooms.push({
        id: next.id,
        ...(Object.keys(fields).length ? { fields } : {}),
        ...(objects ? { objects } : {}),
        ...(messages ? { messages } : {}),
      });
  }
  const ids = new Set(after.rooms.map((item) => item.id));
  const removed = before.rooms.filter((item) => !ids.has(item.id));
  if (removed.length) delta.removedRooms = removed.map((item) => item.id);
  return delta.name !== undefined || delta.rooms.length || delta.removedRooms
    ? delta
    : null;
}

export function presence(value, previous) {
  assert(record(value), "Invalid participant presence.");
  const result = { ...previous };
  if (value.roomId !== undefined) result.roomId = id(value.roomId);
  // Position belongs to the physics world. Presence can only navigate or change audio state.
  for (const key of ["muted", "speaking"]) {
    if (value[key] === undefined) continue;
    assert(typeof value[key] === "boolean", "Invalid audio presence.");
    result[key] = value[key];
  }
  if (result.muted) result.speaking = false;
  return result;
}
