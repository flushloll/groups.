import "./excalidrawAssets";
import { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, reconcileElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { ArrowLeft } from "lucide-react";
import { BOARD_LIMITS } from "../../../shared/board.mjs";
import type { BoardElement } from "../../assets";
import { useApp } from "../../state/store";
import { liveRoom } from "../../state/sync";
import { updateObject } from "../../state/connection";

type API = {
  getSceneElementsIncludingDeleted: () => readonly BoardElement[];
  getAppState: () => unknown;
  updateScene: (scene: { elements: readonly unknown[]; captureUpdate?: unknown }) => void;
};

function boardElements(id: string) {
  const object = liveRoom(useApp.getState().workspace)?.objects.find((item) => item.id === id);
  return object?.board?.elements;
}

/** Focused, shared editor for one board. Changes stream to the room as element deltas. */
export default function BoardEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const canEdit = useApp((state) => Boolean(state.access?.canEdit) && state.status === "connected");
  const title = useApp(
    (state) => liveRoom(state.workspace)?.objects.find((item) => item.id === id)?.text || "Board",
  );
  const notify = useApp((state) => state.notify);
  const [api, setApi] = useState<API | null>(null);
  const sent = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initial = useRef(boardElements(id) || []);
  useEffect(() => {
    for (const element of initial.current) sent.current.set(element.id, element.version);
  }, []);

  const flush = () => {
    timer.current = null;
    if (!api || !canEdit) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const changed = elements.filter((element) => sent.current.get(element.id) !== element.version);
    if (!changed.length) return;
    if (JSON.stringify(elements).length > BOARD_LIMITS.bytes) {
      notify("This board is full. Remove a few things or start another board.");
      return;
    }
    for (const element of changed) sent.current.set(element.id, element.version);
    updateObject(id, { board: { elements: changed.map((element) => ({ ...element })) } }, false);
  };

  // Bring in other people's edits without disturbing what you're drawing.
  useEffect(() => {
    if (!api) return;
    let previous = boardElements(id);
    return useApp.subscribe((state) => {
      const next = liveRoom(state.workspace)?.objects.find((item) => item.id === id)?.board?.elements;
      if (!next || next === previous) return;
      previous = next;
      const local = api.getSceneElementsIncludingDeleted();
      const known = new Map(local.map((element) => [element.id, element.version]));
      const remote = next.filter((element) => (known.get(element.id) ?? -1) < element.version);
      if (!remote.length) return;
      for (const element of remote) sent.current.set(element.id, element.version);
      const reconciled = reconcileElements(
        local as never,
        remote as never,
        api.getAppState() as never,
      );
      api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
    });
  }, [api, id]);

  // Close if the board disappears (deleted or restored away).
  useEffect(
    () =>
      useApp.subscribe((state) => {
        if (!liveRoom(state.workspace)?.objects.some((item) => item.id === id)) onClose();
      }),
    [id, onClose],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="board-editor" role="dialog" aria-modal="true" aria-label={title}>
      <header>
        <button
          className="secondary-button"
          onClick={() => {
            if (timer.current) {
              clearTimeout(timer.current);
              flush();
            }
            onClose();
          }}
        >
          <ArrowLeft size={15} /> Back to the room
        </button>
        <strong>{title}</strong>
        <span className="fine-print">{canEdit ? "Everyone here sees changes live." : "View only"}</span>
      </header>
      <div className="board-canvas">
        <Excalidraw
          excalidrawAPI={(value) => setApi(value as unknown as API)}
          initialData={{
            elements: initial.current as never,
            appState: { viewBackgroundColor: "#fdfcf8" },
            scrollToContent: true,
          }}
          viewModeEnabled={!canEdit}
          name={title}
          UIOptions={{
            tools: { image: false },
            canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false },
          }}
          onChange={() => {
            if (!canEdit) return;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flush, 300);
          }}
        />
      </div>
    </div>
  );
}
