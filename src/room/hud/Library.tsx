import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { MODELS, PRIMITIVES } from "../../../shared/catalog.mjs";
import type { RoomObject } from "../../assets";
import Modal from "../../ui/Modal";
import { useApp } from "../../state/store";
import { thumbnail } from "./thumbnails";

const CATEGORIES = [
  ["all", "Everything"],
  ["furniture", "Furniture"],
  ["nature", "Nature"],
  ["work", "Work & ideas"],
  ["structure", "Structures"],
  ["fun", "Playful"],
  ["shapes", "Shapes"],
] as const;

function Thumb({ kind, label }: { kind: string; label: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    void thumbnail(kind).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [kind]);
  return src ? <img src={src} alt="" draggable={false} /> : <span className="thumb-wait" aria-hidden>{label[0]}</span>;
}

/** Browse everything that can be placed in the room. */
export default function Library() {
  const set = useApp((state) => state.set);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("all");
  const items = useMemo(() => {
    const models = Object.entries(MODELS).map(([name, model]) => ({
      kind: name,
      label: model.label,
      category: model.category as string,
      object: {
        kind: "model",
        model: name,
        color: model.color,
        physics: model.physics || "fixed",
        scale: 1,
      } as Omit<RoomObject, "id" | "position">,
    }));
    const shapes = Object.entries(PRIMITIVES).map(([kind, shape]) => ({
      kind,
      label: shape.label,
      category: "shapes",
      object: {
        kind: kind as RoomObject["kind"],
        color: useApp.getState().color,
        physics: "dynamic",
        scale: 1,
      } as Omit<RoomObject, "id" | "position">,
    }));
    const board = {
      kind: "board",
      label: "Board",
      category: "work",
      object: {
        kind: "board",
        color: "#d8cfc0",
        physics: "fixed",
        text: "Board",
        scale: 1,
        board: { elements: [] },
      } as Omit<RoomObject, "id" | "position">,
    };
    const needle = query.trim().toLowerCase();
    return [board, ...models, ...shapes].filter(
      (item) =>
        (category === "all" || item.category === category) &&
        (!needle ||
          item.label.toLowerCase().includes(needle) ||
          item.kind.includes(needle.replace(/\s+/g, "_"))),
    );
  }, [query, category]);
  return (
    <Modal title="Add to the room" eyebrow="LIBRARY" size="wide" onClose={() => set({ dialog: null })}>
      <div className="library">
        <label className="search-field">
          <Search size={15} />
          <input
            autoFocus
            placeholder="Search tables, trees, whiteboards…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="chip-row" role="tablist" aria-label="Categories">
          {CATEGORIES.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={category === value}
              className={`chip ${category === value ? "is-active" : ""}`}
              onClick={() => setCategory(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="library-grid">
          {items.map((item) => (
            <button
              key={item.kind}
              className="library-item"
              onClick={() =>
                set({
                  dialog: null,
                  selectedId: null,
                  tool: { type: "place", object: item.object },
                })
              }
            >
              <Thumb kind={item.kind} label={item.label} />
              <span>{item.label}</span>
            </button>
          ))}
          {!items.length && <p className="empty-note">Nothing matches “{query}”. Try asking Luna to build it.</p>}
        </div>
        <p className="fine-print">Click an item, then click the floor to place it. Hold Shift to place several.</p>
      </div>
    </Modal>
  );
}
