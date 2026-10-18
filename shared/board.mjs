// Collaborative board content (Excalidraw elements), shared by server and browser.
// Concurrent edits merge per element: the higher version wins and ties go to
// the lower versionNonce, the same rule Excalidraw uses for collaboration.

export const BOARD_LIMITS = { elements: 4000, bytes: 1_500_000 };

function newer(candidate, existing) {
  if (!existing) return true;
  const a = Number(candidate.version) || 0;
  const b = Number(existing.version) || 0;
  if (a !== b) return a > b;
  return (Number(candidate.versionNonce) || 0) < (Number(existing.versionNonce) || 0);
}

/** Merge incoming element changes into the current list, preserving order. */
export function mergeBoardElements(current = [], incoming = []) {
  const merged = new Map(current.map((element) => [element.id, element]));
  for (const element of incoming)
    if (newer(element, merged.get(element.id))) merged.set(element.id, element);
  return [...merged.values()];
}

/** Readable text on a board, for previews and Luna's context. */
export function boardText(elements = []) {
  return elements
    .filter((element) => !element.isDeleted && element.type === "text" && element.text)
    .map((element) => String(element.text).slice(0, 300))
    .slice(0, 80);
}

const NOTE_COLORS = ["#ffec99", "#b2f2bb", "#a5d8ff", "#ffc9c9", "#d0bfff", "#ffd8a8"];
let counter = 0;
const uid = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const seed = () => Math.floor(Math.random() * 2 ** 31);

function base(type, x, y, width, height) {
  return {
    id: uid(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

/** Sticky notes laid out in a grid, plus an optional heading. */
export function notesToElements(notes = [], title = "") {
  const elements = [];
  let top = 0;
  if (title) {
    elements.push({
      ...base("text", 0, 0, Math.min(900, title.length * 22), 45),
      text: title,
      originalText: title,
      fontSize: 36,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    });
    top = 80;
  }
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(notes.length))));
  notes.slice(0, 24).forEach((note, index) => {
    const x = (index % columns) * 260;
    const y = top + Math.floor(index / columns) * 200;
    const rect = {
      ...base("rectangle", x, y, 230, 170),
      backgroundColor: NOTE_COLORS[index % NOTE_COLORS.length],
      strokeColor: "transparent",
      roundness: { type: 3 },
    };
    const text = {
      ...base("text", x + 15, y + 15, 200, 140),
      text: String(note).slice(0, 280),
      originalText: String(note).slice(0, 280),
      fontSize: 20,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: rect.id,
      autoResize: true,
      lineHeight: 1.25,
    };
    rect.boundElements = [{ id: text.id, type: "text" }];
    elements.push(rect, text);
  });
  return elements;
}
