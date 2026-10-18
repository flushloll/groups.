import * as THREE from "three";

export type WritingStyle = "note" | "panel" | "board" | "screen" | "sign";
const FONT = '"DM Sans", system-ui, -apple-system, sans-serif';

function wrap(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const bullet = /^\s*[-•*]\s+/.test(paragraph);
    const words = paragraph.replace(/^\s*[-•*]\s+/, "").split(/\s+/);
    let line = bullet ? "• " : "";
    for (const word of words) {
      const next = line && line !== "• " ? `${line} ${word}` : `${line}${word}`;
      if (context.measureText(next).width > width && line && line !== "• ") {
        lines.push(line);
        line = bullet ? `   ${word}` : word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Draws readable text onto a canvas sized to the surface aspect ratio. The
 * first line becomes a heading when more lines follow. The font shrinks until
 * everything fits.
 */
export function writingTexture(
  text: string,
  width: number,
  height: number,
  style: WritingStyle,
  background: string,
) {
  const scale = 1024 / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(64, Math.round(width * scale));
  canvas.height = Math.max(64, Math.round(height * scale));
  const context = canvas.getContext("2d")!;
  const dark = style === "screen";
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (style === "note") {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "rgba(255,255,255,.18)");
    gradient.addColorStop(1, "rgba(0,0,0,.05)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const pad = Math.round(canvas.width * (style === "sign" ? 0.06 : 0.08));
  const area = { w: canvas.width - pad * 2, h: canvas.height - pad * 2 };
  const trimmed = text.trim();
  const [first, ...rest] = trimmed.split("\n");
  const heading = rest.length > 0 && first.length <= 60 ? first : "";
  const body = heading ? rest.join("\n").replace(/^\n+/, "") : trimmed;
  let size = Math.round(canvas.height / (style === "sign" ? 2.4 : 7));
  let lines: string[] = [];
  let headingLines: string[] = [];
  for (; size > 10; size = Math.floor(size * 0.9)) {
    context.font = `600 ${Math.round(size * 1.22)}px ${FONT}`;
    headingLines = heading ? wrap(context, heading, area.w) : [];
    context.font = `450 ${size}px ${FONT}`;
    lines = wrap(context, body, area.w);
    const total =
      headingLines.length * size * 1.5 +
      (heading ? size * 0.5 : 0) +
      lines.length * size * 1.32;
    if (total <= area.h) break;
  }
  const ink = dark ? "#f4f6fb" : "#2f333a";
  let y = pad + size;
  const centred = style === "sign";
  context.textAlign = centred ? "center" : "left";
  const x = centred ? canvas.width / 2 : pad;
  if (centred && !heading) {
    y = canvas.height / 2 - ((lines.length - 1) * size * 1.32) / 2 + size * 0.35;
  }
  context.fillStyle = ink;
  context.font = `600 ${Math.round(size * 1.22)}px ${FONT}`;
  for (const line of headingLines) {
    context.fillText(line, x, y);
    y += size * 1.5;
  }
  if (heading) y += size * 0.5;
  context.font = `450 ${size}px ${FONT}`;
  context.fillStyle = dark ? "rgba(244,246,251,.92)" : "rgba(47,51,58,.88)";
  for (const line of lines) {
    if (y > canvas.height - pad * 0.5) break;
    context.fillText(line, x, y);
    y += size * 1.32;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
