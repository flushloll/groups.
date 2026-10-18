import * as THREE from "three";
import type { BoardElement } from "../../assets";

const FONT = '"Excalifont", "Comic Sans MS", "DM Sans", sans-serif';

/**
 * A lightweight drawing of a board for the 3D room. It covers the common
 * Excalidraw shapes, so visitors see boards without loading the editor.
 */
export function boardTexture(elements: BoardElement[], title: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1000;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fdfcf8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const visible = elements.filter((element) => !element.isDeleted);
  if (!visible.length) {
    context.fillStyle = "#9aa39b";
    context.textAlign = "center";
    context.font = `500 64px "DM Sans", sans-serif`;
    context.fillText(title || "Board", canvas.width / 2, canvas.height / 2 - 10);
    context.font = `400 36px "DM Sans", sans-serif`;
    context.fillText("Double-click to sketch together", canvas.width / 2, canvas.height / 2 + 56);
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const element of visible) {
      const xs = element.points?.length ? element.points.map(([x]) => element.x + x) : [element.x, element.x + element.width];
      const ys = element.points?.length ? element.points.map(([, y]) => element.y + y) : [element.y, element.y + element.height];
      minX = Math.min(minX, ...xs);
      maxX = Math.max(maxX, ...xs);
      minY = Math.min(minY, ...ys);
      maxY = Math.max(maxY, ...ys);
    }
    const pad = 70;
    const scale = Math.min(
      (canvas.width - pad * 2) / Math.max(1, maxX - minX),
      (canvas.height - pad * 2) / Math.max(1, maxY - minY),
      4,
    );
    const offsetX = (canvas.width - (maxX - minX) * scale) / 2 - minX * scale;
    const offsetY = (canvas.height - (maxY - minY) * scale) / 2 - minY * scale;
    context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const element of visible) {
      context.save();
      context.globalAlpha = (element.opacity ?? 100) / 100;
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      context.translate(cx, cy);
      context.rotate(element.angle || 0);
      context.translate(-cx, -cy);
      const stroke = element.strokeColor && element.strokeColor !== "transparent" ? element.strokeColor : null;
      const fill = element.backgroundColor && element.backgroundColor !== "transparent" ? element.backgroundColor : null;
      context.lineWidth = (element.strokeWidth || 1) * 1.5;
      context.strokeStyle = stroke || "transparent";
      context.fillStyle = fill || "transparent";
      const { x, y, width: w, height: h } = element;
      if (element.type === "rectangle" || element.type === "frame") {
        context.beginPath();
        context.roundRect(x, y, w, h, element.roundness ? Math.min(24, Math.min(w, h) * 0.12) : 0);
        if (fill) context.fill();
        if (stroke) context.stroke();
      } else if (element.type === "ellipse") {
        context.beginPath();
        context.ellipse(cx, cy, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        if (fill) context.fill();
        if (stroke) context.stroke();
      } else if (element.type === "diamond") {
        context.beginPath();
        context.moveTo(cx, y);
        context.lineTo(x + w, cy);
        context.lineTo(cx, y + h);
        context.lineTo(x, cy);
        context.closePath();
        if (fill) context.fill();
        if (stroke) context.stroke();
      } else if (["line", "arrow", "freedraw"].includes(element.type) && element.points?.length) {
        context.beginPath();
        element.points.forEach(([px, py], index) =>
          index ? context.lineTo(x + px, y + py) : context.moveTo(x + px, y + py),
        );
        context.strokeStyle = stroke || "#1e1e1e";
        if (element.type === "freedraw") context.lineWidth = Math.max(2, (element.strokeWidth || 1) * 2);
        context.stroke();
        if (element.type === "arrow" && element.points.length > 1) {
          const [ax, ay] = element.points[element.points.length - 1];
          const [bx, by] = element.points[element.points.length - 2];
          const angle = Math.atan2(ay - by, ax - bx);
          context.beginPath();
          for (const side of [-1, 1]) {
            context.moveTo(x + ax, y + ay);
            context.lineTo(x + ax - Math.cos(angle + side * 0.45) * 18, y + ay - Math.sin(angle + side * 0.45) * 18);
          }
          context.stroke();
        }
      } else if (element.type === "text" && element.text) {
        const size = element.fontSize || 20;
        context.fillStyle = stroke || "#1e1e1e";
        context.font = `${size}px ${FONT}`;
        context.textBaseline = "top";
        const lines = String(element.text).split("\n");
        const lineHeight = size * 1.25;
        const align = element.textAlign === "center" ? "center" : element.textAlign === "right" ? "right" : "left";
        context.textAlign = align;
        const tx = align === "center" ? x + w / 2 : align === "right" ? x + w : x;
        const top = element.verticalAlign === "middle" ? cy - (lines.length * lineHeight) / 2 : y;
        lines.forEach((line, index) => context.fillText(line, tx, top + index * lineHeight));
      }
      context.restore();
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
