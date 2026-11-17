import { WORLD } from "./config";
import type { Point } from "./geometry";

export interface ViewportSnapshot {
  x: number;
  y: number;
  zoom: number;
}

// A view transform only: changing the view never changes track coordinates.
export class EditViewport implements ViewportSnapshot {
  x = 0;
  y = 0;
  zoom = 1;
  readonly minZoom = 0.12;
  readonly maxZoom = 3;
  constructor(
    readonly width = WORLD.width,
    readonly height = WORLD.height,
  ) {}
  snapshot(): ViewportSnapshot {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
  screenToWorld(p: Point): Point {
    return { x: this.x + p.x / this.zoom, y: this.y + p.y / this.zoom };
  }
  worldToScreen(p: Point): Point {
    return { x: (p.x - this.x) * this.zoom, y: (p.y - this.y) * this.zoom };
  }
  pan(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }
  zoomAt(factor: number, screenPoint: Point) {
    const anchor = this.screenToWorld(screenPoint);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.x = anchor.x - screenPoint.x / this.zoom;
    this.y = anchor.y - screenPoint.y / this.zoom;
  }
  center(p: Point) {
    this.x = p.x - this.width / (2 * this.zoom);
    this.y = p.y - (this.height / 2 + 15) / this.zoom;
  }
  fit(points: readonly Point[], padding = 100) {
    if (!points.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    this.zoom = Math.min(
      1,
      Math.max(this.minZoom, Math.min(
        (this.width - 100) / (maxX - minX + padding * 2),
        (this.height - 340) / (maxY - minY + padding * 2),
      )),
    );
    this.center({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }
}
