import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  PenLine,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { restHeight } from "../../../shared/catalog.mjs";
import type { RoomObject } from "../../assets";
import { hasWriting, objectLabel } from "../../assets";
import { useApp } from "../../state/store";
import { addObjects, removeObjects, updateObject } from "../../state/connection";

export const PALETTE = [
  "#f4f1ea",
  "#2f333a",
  "#e0a96d",
  "#d98f9f",
  "#b59ad6",
  "#7fa7d4",
  "#7fb3a3",
  "#9cbf6e",
  "#e6c35c",
  "#c86f5a",
  "#a07a55",
  "#8d939b",
];

const physicsLabels = {
  fixed: "Anchored",
  dynamic: "Physical",
  none: "Pass through",
  kinematic: "Positioned solid",
  sensor: "Sensor",
} as const;

export function duplicate(object: RoomObject) {
  const copy: RoomObject = {
    ...object,
    id: crypto.randomUUID(),
    assetId: undefined,
    assetRevision: undefined,
    position: [
      Math.min(9.5, object.position[0] + 1.2),
      object.position[1],
      Math.min(7.5, object.position[2] + 0.6),
    ],
  };
  addObjects([copy]);
  useApp.getState().set({ selectedId: copy.id });
}

export default function Inspector({ object }: { object: RoomObject }) {
  const set = useApp((state) => state.set);
  const canEdit = useApp((state) => Boolean(state.access?.canEdit) && state.status === "connected");
  const [advanced, setAdvanced] = useState(false);
  const label = objectLabel(object);
  const update = (fields: Partial<RoomObject>) => updateObject(object.id, fields);
  const scale = object.scale ?? 1;
  const stretch = object.stretch || [1, 1, 1];
  const lift = (amount: number) => {
    const rest = restHeight(object);
    const y = Math.max(rest, object.position[1] || rest) + amount;
    update({ position: [object.position[0], y <= rest + 0.01 ? 0 : y, object.position[2]] });
  };
  const turn = (amount: number) => {
    const [x, y, z] = object.rotation || [0, 0, 0];
    update({ rotation: [x, y + amount, z] });
  };
  if (!canEdit)
    return (
      <aside className="inspector" aria-label="Selected object">
        <header>
          <span className="swatch" style={{ background: object.color }} />
          <strong>{label}</strong>
          <button className="icon-button" aria-label="Deselect" onClick={() => set({ selectedId: null })}>
            <X size={15} />
          </button>
        </header>
        {object.text && hasWriting(object) && <p className="inspector-text">{object.text}</p>}
        {object.kind === "board" && (
          <button className="secondary-button" onClick={() => set({ boardId: object.id })}>
            Open board
          </button>
        )}
        <p className="fine-print">You’re viewing. Ask the owner for an editing invitation to change things.</p>
      </aside>
    );
  return (
    <aside className="inspector" aria-label="Selected object">
      <header>
        <span className="swatch" style={{ background: object.color }} />
        <strong title={label}>{label}</strong>
        <button className="icon-button" aria-label="Deselect" onClick={() => set({ selectedId: null })}>
          <X size={15} />
        </button>
      </header>
      {object.kind !== "image" && (
        <div className="palette" role="group" aria-label="Colour">
          {PALETTE.map((color) => (
            <button
              key={color}
              className={object.color === color ? "is-active" : ""}
              style={{ background: color }}
              aria-label={`Colour ${color}`}
              onClick={() => update({ color })}
            />
          ))}
          <label className="palette-custom" aria-label="Custom colour">
            <input type="color" value={object.color} onChange={(event) => update({ color: event.target.value })} />
          </label>
        </div>
      )}
      <div className="inspector-row">
        <span>Size</span>
        <div className="stepper">
          <button aria-label="Smaller" onClick={() => update({ scale: Math.max(0.2, +(scale - 0.1).toFixed(2)) })}>
            −
          </button>
          <output>{Math.round(scale * 100)}%</output>
          <button aria-label="Bigger" onClick={() => update({ scale: Math.min(6, +(scale + 0.1).toFixed(2)) })}>
            +
          </button>
        </div>
      </div>
      {object.kind !== "stroke" && (
        <div className="inspector-actions">
          <button title="Turn left (Q)" aria-label="Turn left" onClick={() => turn(Math.PI / 8)}>
            <RotateCcw size={15} />
          </button>
          <button title="Turn right (E)" aria-label="Turn right" onClick={() => turn(-Math.PI / 8)}>
            <RotateCw size={15} />
          </button>
          <button title="Lift" aria-label="Lift" onClick={() => lift(0.25)}>
            <ArrowUp size={15} />
          </button>
          <button title="Lower" aria-label="Lower" onClick={() => lift(-0.25)}>
            <ArrowDown size={15} />
          </button>
          <button title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => duplicate(object)}>
            <Copy size={15} />
          </button>
          {object.kind === "board" && (
            <button title="Open board" aria-label="Open board" onClick={() => set({ boardId: object.id })}>
              <PenLine size={15} />
            </button>
          )}
          {hasWriting(object) && (
            <button
              title="Write"
              aria-label="Edit writing"
              onClick={() =>
                set({
                  dialog: "write",
                  writing: { id: object.id, kind: object.kind === "model" ? "model" : (object.kind as "note"), model: object.model },
                })
              }
            >
              <PenLine size={15} />
            </button>
          )}
          <button
            className={advanced ? "is-active" : ""}
            title="Proportions"
            aria-label="Proportions"
            aria-pressed={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <SlidersHorizontal size={15} />
          </button>
          <button className="danger" title="Remove (Delete)" aria-label="Remove" onClick={() => {
            removeObjects([object.id]);
            set({ selectedId: null });
          }}>
            <Trash2 size={15} />
          </button>
        </div>
      )}
      {advanced && object.kind !== "stroke" && (
        <div className="proportions">
          {(["Width", "Height", "Depth"] as const).map((name, axis) => (
            <label key={name}>
              <span>{name}</span>
              <input
                type="range"
                min={0.2}
                max={5}
                step={0.05}
                value={stretch[axis]}
                onChange={(event) => {
                  const next = [...stretch] as [number, number, number];
                  next[axis] = Number(event.target.value);
                  update({ stretch: next });
                }}
              />
              <output>{stretch[axis].toFixed(2)}×</output>
            </label>
          ))}
          <button className="text-button" onClick={() => update({ stretch: [1, 1, 1] })}>
            Reset proportions
          </button>
        </div>
      )}
      {object.kind !== "stroke" && (
        <div className="inspector-row">
          <span>Behaviour</span>
          <select
            aria-label="Physics"
            value={object.physics || "fixed"}
            onChange={(event) => update({ physics: event.target.value as RoomObject["physics"] })}
          >
            {(["fixed", "dynamic", "none"] as const).map((value) => (
              <option key={value} value={value}>
                {physicsLabels[value]}
              </option>
            ))}
            {(object.physics === "kinematic" || object.physics === "sensor") && (
              <option value={object.physics}>{physicsLabels[object.physics]}</option>
            )}
          </select>
        </div>
      )}
    </aside>
  );
}
