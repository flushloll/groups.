import { mergeBoardElements } from "../../shared/board.mjs";
import type {
  ItemChanges,
  Patch,
  RoomVersion,
  Workspace,
  WorkspaceDelta,
} from "../types";

function mergeItems<T extends { id: string }>(
  items: T[],
  delta?: ItemChanges<T>,
): T[] {
  if (!delta) return items;
  const map = new Map(items.map((item) => [item.id, item]));
  delta.removes?.forEach((id) => map.delete(id));
  delta.upserts?.forEach((item) => map.set(item.id, item));
  delta.updates?.forEach(({ id, fields }) => {
    const existing = map.get(id) as (T & { board?: { elements: [] } }) | undefined;
    if (!existing) return;
    const board = (fields as { board?: { elements: [] } }).board;
    map.set(id, {
      ...existing,
      ...fields,
      ...(board
        ? { board: { elements: mergeBoardElements(existing.board?.elements, board.elements) } }
        : {}),
    });
  });
  return [...map.values()];
}

/** Apply an authoritative server delta to the confirmed workspace. */
export function applyDelta(
  workspace: Workspace,
  delta: WorkspaceDelta | null,
): Workspace {
  if (!delta) return workspace;
  const rooms = new Map(workspace.rooms.map((room) => [room.id, room]));
  for (const change of delta.rooms) {
    if (change.create) {
      rooms.set(change.id, change.create);
      continue;
    }
    const old = rooms.get(change.id);
    if (!old) continue;
    rooms.set(change.id, {
      ...old,
      ...(change.fields as Partial<RoomVersion>),
      objects: mergeItems(old.objects, change.objects),
      messages: mergeItems(old.messages, change.messages),
    });
  }
  for (const id of delta.removedRooms || []) rooms.delete(id);
  return {
    ...workspace,
    ...(delta.name === undefined ? {} : { name: delta.name }),
    rooms: [...rooms.values()],
  };
}

/** Apply a local, not yet acknowledged edit on top of the confirmed state. */
export function applyPatch(workspace: Workspace, patch: Patch): Workspace {
  return {
    ...workspace,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    rooms: workspace.rooms.map((room) => {
      const change = patch.rooms.find((item) => item.id === room.id);
      if (!change) return room;
      return {
        ...room,
        ...change.fields,
        objects: mergeItems(room.objects, change.objects),
      };
    }),
  };
}

export function liveRoom(workspace: Workspace | null) {
  if (!workspace) return null;
  return (
    workspace.rooms.find((room) => room.id === workspace.currentId) ||
    workspace.rooms[0]
  );
}
