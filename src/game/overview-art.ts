import { WORLD, COLORS } from "./config";
import type { Point, TrackData } from "./geometry";

export interface MapView { x: number; y: number; zoom: number }

// A viewport-sized drawing, independent of the map's area.
export function fitMap(points: readonly Point[], padding = 120): MapView {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs) - padding, maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding, maxY = Math.max(...ys) + padding;
  const zoom = Math.min(1, WORLD.width / (maxX - minX), (WORLD.height - 300) / (maxY - minY));
  return {
    x: (minX + maxX) / 2 - WORLD.width / (2 * zoom),
    y: (minY + maxY) / 2 - (WORLD.height / 2 + 10) / zoom,
    zoom,
  };
}

export function drawOverview(canvas: HTMLCanvasElement, data: TrackData, view: MapView) {
  const c = canvas.getContext("2d")!;
  c.setTransform(canvas.width / WORLD.width, 0, 0, canvas.height / WORLD.height, 0, 0);
  c.clearRect(0, 0, WORLD.width, WORLD.height);
  c.save();
  c.scale(view.zoom, view.zoom);
  c.translate(-view.x, -view.y);
  const path = () => {
    c.beginPath();
    data.track.points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
    c.closePath();
  };
  c.lineJoin = "round";
  c.lineCap = "round";
  path(); c.strokeStyle = COLORS.pencil; c.lineWidth = data.track.width + 4; c.stroke();
  path(); c.strokeStyle = COLORS.road; c.lineWidth = data.track.width; c.stroke();
  c.setLineDash([18, 24]);
  path(); c.strokeStyle = COLORS.pale; c.lineWidth = 3; c.stroke();
  c.setLineDash([]);
  const g = data.gates[0];
  c.translate(g.center.x, g.center.y);
  c.rotate(Math.atan2(g.tangent.y, g.tangent.x));
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
    c.fillStyle = (i + j) % 2 ? COLORS.pale : COLORS.ink;
    c.fillRect(j * 9 - 9, -g.halfWidth + i * g.halfWidth / 4, 9, g.halfWidth / 4);
  }
  c.restore();
}

export function overviewArt(data: TrackData, view: MapView) {
  const canvas = document.createElement("canvas");
  canvas.width = WORLD.width;
  canvas.height = WORLD.height;
  drawOverview(canvas, data, view);
  return canvas;
}
