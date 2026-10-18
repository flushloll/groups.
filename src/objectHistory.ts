import type { RoomObject } from "./assets";

export type ObjectEdit = { before: RoomObject[]; after: RoomObject[] };
function equivalent(a?: RoomObject, b?: RoomObject) {
  const visible = (object?: RoomObject) => {
    if (!object) return undefined;
    const { assetId, assetRevision, physics = "fixed", ...fields } = object;
    return Object.entries({ ...fields, physics })
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
  };
  return JSON.stringify(visible(a)) === JSON.stringify(visible(b));
}

/** Reverse just this edit, retaining unrelated additions and rejecting conflicts. */
export function replayEdit(
  objects: RoomObject[],
  edit: ObjectEdit,
  direction: "undo" | "redo",
): RoomObject[] {
  const expected = new Map(
    (direction === "undo" ? edit.after : edit.before).map((object) => [
      object.id,
      object,
    ]),
  );
  const desired = new Map(
    (direction === "undo" ? edit.before : edit.after).map((object) => [
      object.id,
      object,
    ]),
  );
  const current = new Map(objects.map((object) => [object.id, object]));
  for (const id of new Set([...expected.keys(), ...desired.keys()])) {
    if (equivalent(expected.get(id), desired.get(id))) continue;
    if (!equivalent(current.get(id), expected.get(id)))
      throw new Error(
        "Someone changed this object after your edit. Its newer changes have been kept.",
      );
    const next = desired.get(id);
    const existing = current.get(id);
    if (!next) current.delete(id);
    else
      current.set(id, {
        ...next,
        ...(existing
          ? { assetId: existing.assetId, assetRevision: existing.assetRevision }
          : {}),
      });
  }
  return [...current.values()];
}
