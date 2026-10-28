import { ROAD, WORLD } from "./config";
import { arcLengths, LOCAL_EDIT, type LocalDrag } from "./local-edit";
import type { Point } from "./geometry";

// Canvas-only presentation. No Phaser textures or geometry validation here.
export function renderLocal(
  c: CanvasRenderingContext2D,
  paper: HTMLCanvasElement,
  base: readonly Point[],
  current: readonly Point[],
  visible: readonly Point[],
  selection: LocalDrag | null,
  error?: Point,
  invalid = false,
) {
  c.clearRect(0, 0, WORLD.width, WORLD.height);
  c.drawImage(paper, 0, 0, WORLD.width, WORLD.height);
  c.lineJoin = "round";
  c.lineCap = "round";
  const path = (p: readonly Point[]) => {
    c.beginPath();
    p.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
  };
  const road = (p: readonly Point[], color: string, width: number) => {
    path(p);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  };
  road(base, "#a39a8e55", ROAD.width);
  road(current, "#93998c88", ROAD.width);
  if (selection) {
    c.beginPath();
    selection.base.forEach((p, i) => {
      if (
        selection.weights[i] > 0 ||
        selection.weights[(i + 1) % selection.weights.length] > 0
      ) {
        c.moveTo(p.x, p.y);
        const b = selection.base[(i + 1) % selection.base.length];
        c.lineTo(b.x, b.y);
      }
    });
    c.strokeStyle = "#e5b54488";
    c.lineWidth = ROAD.width + 14;
    c.stroke();
  }
  road(visible, invalid ? "#dca08e99" : "#91aa9d99", ROAD.width);
  road(visible, invalid ? "#a84d36" : "#326c62", 3);
  c.save();
  c.setLineDash([10, 9]);
  road(base, "#6f655bd9", 2);
  c.restore();
  const arcs = arcLengths(current),
    total = arcs.at(-1)!;
  c.beginPath();
  current.forEach((p, i) => {
    if (
      arcs[i] <= Math.max(LOCAL_EDIT.guard, arcs[1]) ||
      arcs[i + 1] >=
        Math.min(total - LOCAL_EDIT.guard, arcs[current.length - 1])
    ) {
      c.moveTo(p.x, p.y);
      const b = current[(i + 1) % current.length];
      c.lineTo(b.x, b.y);
    }
  });
  c.strokeStyle = "#716b7077";
  c.lineWidth = ROAD.width + 5;
  c.stroke();
  const start = current[0],
    next = current[1];
  c.save();
  c.translate(start.x, start.y);
  c.rotate(Math.atan2(next.y - start.y, next.x - start.x));
  c.strokeStyle = "#434f57";
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(0, -ROAD.width / 2);
  c.lineTo(0, ROAD.width / 2);
  c.moveTo(18, 0);
  c.lineTo(46, 0);
  c.lineTo(36, -8);
  c.moveTo(46, 0);
  c.lineTo(36, 8);
  c.stroke();
  c.restore();
  c.font = "16px sans-serif";
  c.fillStyle = "#4c5358";
  c.fillText("起点 · 保护", start.x - 45, start.y + ROAD.width / 2 + 25);
  if (selection) {
    c.strokeStyle = "#a7742d";
    c.fillStyle = "#fff7db";
    c.lineWidth = 2;
    for (let i = 1; i < selection.weights.length; i++) {
      if (
        selection.weights[i] === 0 &&
        (selection.weights[i - 1] > 0 ||
          selection.weights[(i + 1) % selection.weights.length] > 0)
      ) {
        const p = selection.base[i];
        c.beginPath();
        c.arc(p.x, p.y, 8, 0, Math.PI * 2);
        c.stroke();
      }
    }
    c.beginPath();
    c.arc(selection.anchor.x, selection.anchor.y, 9, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  if (error) {
    c.strokeStyle = "#a43e2b";
    c.lineWidth = 4;
    c.beginPath();
    c.arc(error.x, error.y, 22, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "#a43e2b";
    c.font = "bold 26px sans-serif";
    c.fillText("!", error.x - 4, error.y + 9);
  }
}
