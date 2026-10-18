import { create } from "zustand";
import type { RoomObject } from "../assets";
import type { ObjectEdit } from "../objectHistory";
import { replayEdit } from "../objectHistory";

type History = { undo: ObjectEdit[]; redo: ObjectEdit[] };
export const useHistory = create<History>()(() => ({ undo: [], redo: [] }));

/** Record one of your own edits as the affected objects before and after. */
export function record(before: RoomObject[], after: RoomObject[]) {
  const ids = new Set([...before, ...after].map((object) => object.id));
  const pick = (list: RoomObject[]) => list.filter((object) => ids.has(object.id));
  const edit = { before: pick(before), after: pick(after) };
  if (JSON.stringify(edit.before) === JSON.stringify(edit.after)) return;
  useHistory.setState((state) => ({ undo: [...state.undo.slice(-49), edit], redo: [] }));
}
export function clearHistory() {
  useHistory.setState({ undo: [], redo: [] });
}

/** Compute the object changes that reverse (or reapply) the latest edit. */
export function step(direction: "undo" | "redo", objects: RoomObject[]) {
  const state = useHistory.getState();
  const stack = direction === "undo" ? state.undo : state.redo;
  const edit = stack.at(-1);
  if (!edit) return null;
  const next = replayEdit(objects, edit, direction);
  const before = new Map(objects.map((object) => [object.id, object]));
  const after = new Map(next.map((object) => [object.id, object]));
  const upserts = next.filter(
    (object) => JSON.stringify(object) !== JSON.stringify(before.get(object.id)),
  );
  const removes = objects.filter((object) => !after.has(object.id)).map((object) => object.id);
  useHistory.setState(
    direction === "undo"
      ? { undo: state.undo.slice(0, -1), redo: [...state.redo, edit] }
      : { redo: state.redo.slice(0, -1), undo: [...state.undo, edit] },
  );
  return { upserts, removes };
}
