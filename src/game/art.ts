import { COLORS, WORLD } from "./config";
import { nearest, type Point, type TrackData } from "./geometry";

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(w = WORLD.width, h = WORLD.height, scale = 2) {
  const el = document.createElement("canvas");
  el.width = w * scale;
  el.height = h * scale;
  const c = el.getContext("2d")!;
  c.scale(scale, scale);
  c.lineCap = "round";
  c.lineJoin = "round";
  return { el, c };
}
function line(c: CanvasRenderingContext2D, ps: Point[], close = false) {
  c.beginPath();
  ps.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  if (close) c.closePath();
}
export function paperArt() {
  const { el, c } = canvas();
  c.fillStyle = COLORS.paper;
  c.fillRect(0, 0, WORLD.width, WORLD.height);
  const random = rng(843);
  c.strokeStyle = "#a5b7c1";
  c.lineWidth = 0.7;
  c.globalAlpha = 0.43;
  for (let x = 18; x < WORLD.width; x += 34) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, WORLD.height);
    c.stroke();
  }
  for (let y = 20; y < WORLD.height; y += 34) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(WORLD.width, y);
    c.stroke();
  }
  c.globalAlpha = 1;
  for (let i = 0; i < 85000; i++) {
    c.fillStyle =
      random() > 0.48 ? "rgba(104,81,52,.045)" : "rgba(255,255,255,.19)";
    const s = random() * 1.2 + 0.2;
    c.fillRect(random() * WORLD.width, random() * WORLD.height, s, s);
  }
  const v = c.createRadialGradient(720, 400, 220, 720, 430, 850);
  v.addColorStop(0, "rgba(255,255,255,.04)");
  v.addColorStop(1, "rgba(112,78,35,.06)");
  c.fillStyle = v;
  c.fillRect(0, 0, WORLD.width, WORLD.height);
  return el;
}
function grass(c: CanvasRenderingContext2D, x: number, y: number, s = 1) {
  c.beginPath();
  c.moveTo(x - 7 * s, y);
  c.lineTo(x - 9 * s, y - 7 * s);
  c.moveTo(x - 2 * s, y);
  c.quadraticCurveTo(x - 1 * s, y - 9 * s, x + 3 * s, y - 13 * s);
  c.moveTo(x + 5 * s, y);
  c.quadraticCurveTo(x + 7 * s, y - 6 * s, x + 11 * s, y - 7 * s);
  c.stroke();
}
function tree(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  pine: boolean,
) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.strokeStyle = COLORS.pencil;
  c.lineWidth = 1.8;
  if (pine) {
    line(
      c,
      [
        { x: 0, y: -60 },
        { x: -12, y: -35 },
        { x: -5, y: -38 },
        { x: -20, y: -17 },
        { x: -8, y: -22 },
        { x: -23, y: 0 },
        { x: 0, y: -7 },
        { x: 23, y: 0 },
        { x: 9, y: -23 },
        { x: 20, y: -17 },
        { x: 5, y: -38 },
        { x: 12, y: -35 },
      ],
      true,
    );
    c.stroke();
  } else {
    c.beginPath();
    c.moveTo(-4, -9);
    c.bezierCurveTo(-32, -12, -27, -35, -18, -40);
    c.bezierCurveTo(-17, -61, 1, -68, 11, -52);
    c.bezierCurveTo(30, -47, 22, -35, 27, -26);
    c.bezierCurveTo(30, -14, 14, -4, 3, -8);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(0, 10);
  c.lineTo(0, -42);
  c.moveTo(3, 10);
  c.lineTo(3, -32);
  c.moveTo(0, -16);
  c.lineTo(-12, -30);
  c.moveTo(2, -25);
  c.lineTo(14, -38);
  c.stroke();
  c.globalAlpha = 0.23;
  c.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    c.beginPath();
    const xx = (i % 5) * 7 - 16,
      yy = Math.floor(i / 5) * 9 - 42;
    c.moveTo(xx, yy + 9);
    c.lineTo(xx + 9, yy - 2);
    c.stroke();
  }
  c.restore();
}
function cone(c: CanvasRenderingContext2D, x: number, y: number) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = "#bb664d";
  c.fillStyle = "rgba(203,106,70,.17)";
  c.lineWidth = 1.8;
  c.beginPath();
  c.ellipse(0, 0, 10, 3, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  line(
    c,
    [
      { x: -6, y: -1 },
      { x: -2, y: -20 },
      { x: 2, y: -20 },
      { x: 7, y: -1 },
    ],
    true,
  );
  c.fill();
  c.stroke();
  c.fillStyle = COLORS.pale;
  c.fillRect(-3, -12, 7, 4);
  c.restore();
}
export function sceneryArt(data: TrackData) {
  const { el, c } = canvas(),
    seed = parseInt(data.track.id.slice(6), 16) || 12,
    random = rng(seed);
  c.strokeStyle = COLORS.pencil;
  c.lineWidth = 1.6;
  let placed = 0;
  for (let i = 0; i < 600 && placed < 64; i++) {
    const x = 38 + random() * (WORLD.width - 76),
      y = 145 + random() * (WORLD.height - 255),
      d = nearest({ x, y }, data.track.points).distance;
    if (d < data.track.width / 2 + 40) continue;
    const kind = random();
    if (kind < 0.22 && d > 105) {
      const s = 0.65 + random() * 0.3;
      if (
        [
          { x, y: y - 62 * s },
          { x: x - 25 * s, y: y - 30 * s },
          { x: x + 25 * s, y: y - 30 * s },
        ].every(
          (p) =>
            nearest(p, data.track.points).distance > data.track.width / 2 + 12,
        )
      )
        tree(c, x, y, s, random() > 0.55);
    } else if (kind < 0.31) {
      line(
        c,
        [
          { x: x - 9, y: y + 3 },
          { x: x - 11, y: y - 1 },
          { x: x - 1, y: y - 10 },
          { x: x + 7, y: y - 11 },
          { x: x + 13, y: y - 1 },
          { x: x + 9, y: y + 3 },
        ],
        true,
      );
      c.stroke();
    } else grass(c, x, y, 0.65 + random() * 0.35);
    placed++;
  }
  // A small blue pencil pond appears only where the whole footprint clears the road.
  const pond = { x: 550, y: 510 };
  if (nearest(pond, data.track.points).distance > 158) {
    c.save();
    c.translate(pond.x, pond.y);
    c.strokeStyle = "#849eab";
    c.fillStyle = "rgba(144,181,196,.20)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-74, -16);
    c.bezierCurveTo(-84, -45, -30, -40, -11, -49);
    c.bezierCurveTo(38, -72, 81, -34, 58, -10);
    c.bezierCurveTo(48, 9, 104, 12, 82, 36);
    c.bezierCurveTo(65, 63, 20, 48, 4, 49);
    c.bezierCurveTo(-22, 51, -22, 28, -50, 27);
    c.bezierCurveTo(-72, 25, -96, 0, -74, -16);
    c.fill();
    c.stroke();
    c.globalAlpha = 0.4;
    c.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      const x = random() * 118 - 60,
        y = random() * 50 - 25;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + 12, y - 5);
      c.stroke();
    }
    c.globalAlpha = 0.8;
    c.lineWidth = 1.5;
    for (const [x, y] of [
      [-35, -2],
      [10, 17],
      [-3, -26],
    ]) {
      line(c, [
        { x, y },
        { x: x + 6, y: y - 3 },
        { x: x + 12, y: y + 1 },
        { x: x + 18, y: y - 2 },
        { x: x + 24, y },
      ]);
      c.stroke();
    }
    c.restore();
  }
  const n = data.track.points.length;
  for (const i of [
    Math.floor(n * 0.18),
    Math.floor(n * 0.48),
    Math.floor(n * 0.77),
  ]) {
    const p = data.track.points[i],
      q = data.track.points[(i + 1) % n],
      a = Math.atan2(q.y - p.y, q.x - p.x),
      d = data.track.width / 2 + 21;
    for (let k = 0; k < 2; k++) {
      const x = p.x - Math.sin(a) * d + Math.cos(a) * k * 34,
        y = p.y + Math.cos(a) * d + Math.sin(a) * k * 34;
      if (x > 25 && x < 1410 && y > 130 && y < 755) cone(c, x, y);
    }
  }
  return el;
}
export function roadArt(data: TrackData) {
  const { el, c } = canvas(),
    p = data.track.points,
    random = rng(4551),
    w = data.track.width;
  const tile = canvas(80, 80, 1);
  tile.c.fillStyle = COLORS.road;
  tile.c.fillRect(0, 0, 80, 80);
  for (let i = 0; i < 1600; i++) {
    tile.c.fillStyle =
      random() > 0.5 ? "rgba(246,237,218,.17)" : "rgba(72,75,78,.09)";
    tile.c.fillRect(random() * 80, random() * 80, random() * 2 + 0.3, 0.65);
  }
  tile.c.strokeStyle = "rgba(244,235,216,.09)";
  tile.c.lineWidth = 0.7;
  for (let i = 0; i < 100; i++) {
    const x = random() * 80,
      y = random() * 80;
    tile.c.beginPath();
    tile.c.moveTo(x, y);
    tile.c.lineTo(x + random() * 8, y - random() * 6);
    tile.c.stroke();
  }
  line(c, p, true);
  c.strokeStyle = "#74777a";
  c.lineWidth = w + 3;
  c.stroke();
  c.strokeStyle = c.createPattern(tile.el, "repeat")!;
  c.lineWidth = w;
  c.stroke();
  for (let side = -1; side <= 1; side += 2)
    for (let pass = 0; pass < 2; pass++) {
      const edge = p.map((a, i) => {
        const b = p[(i + 1) % p.length],
          t = Math.atan2(b.y - a.y, b.x - a.x),
          d = w / 2 + (random() - 0.5) * 2 + pass;
        return {
          x: a.x - Math.sin(t) * side * d,
          y: a.y + Math.cos(t) * side * d,
        };
      });
      line(c, edge, true);
      c.strokeStyle = pass ? "rgba(65,75,83,.26)" : "rgba(70,76,82,.45)";
      c.lineWidth = pass ? 0.7 : 1.1;
      c.stroke();
    }
  line(c, p, true);
  c.setLineDash([22, 32]);
  c.strokeStyle = "rgba(245,235,216,.62)";
  c.lineWidth = 3;
  c.stroke();
  c.setLineDash([]);
  const g = data.gates[0];
  c.save();
  c.translate(g.center.x, g.center.y);
  c.rotate(Math.atan2(g.tangent.y, g.tangent.x));
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 10; j++) {
      c.fillStyle = (i + j) % 2 ? "#f3e9d7" : "#555e65";
      c.fillRect(i * 12 - 12, (j * w) / 10 - w / 2, 12, w / 10 + 0.3);
    }
  c.strokeStyle = "rgba(247,238,219,.7)";
  c.lineWidth = 2;
  for (const sign of [-1, 1]) {
    c.beginPath();
    c.moveTo(-23, sign * (w / 2 - 4));
    c.lineTo(-28, sign * (w / 2 - 4));
    c.lineTo(-28, sign * (w / 2 - 13));
    c.moveTo(23, sign * (w / 2 - 4));
    c.lineTo(28, sign * (w / 2 - 4));
    c.lineTo(28, sign * (w / 2 - 13));
    c.stroke();
  }
  c.translate(83, 0);
  c.strokeStyle = "rgba(244,235,218,.6)";
  c.lineWidth = 3;
  for (let i = 0; i < 2; i++) {
    c.beginPath();
    c.moveTo(i * 18 - 6, -9);
    c.lineTo(i * 18 + 4, 0);
    c.lineTo(i * 18 - 6, 9);
    c.stroke();
  }
  c.restore();
  return el;
}
export function carArt() {
  const { el, c } = canvas(88, 56, 3);
  c.translate(44, 28);
  c.shadowColor = "rgba(38,35,30,.32)";
  c.shadowBlur = 5;
  c.shadowOffsetY = 3;
  c.fillStyle = "#344049";
  for (const x of [-21, 13])
    for (const y of [-20, 13]) {
      c.beginPath();
      c.roundRect(x, y, 13, 7, 2);
      c.fill();
    }
  c.shadowBlur = 0;
  c.shadowOffsetY = 0;
  c.fillStyle = "#d95c33";
  c.strokeStyle = "#3c4a54";
  c.lineWidth = 1.7;
  c.beginPath();
  c.moveTo(-31, -11);
  c.quadraticCurveTo(-29, -17, -20, -17);
  c.lineTo(21, -16);
  c.quadraticCurveTo(34, -14, 34, -7);
  c.lineTo(34, 7);
  c.quadraticCurveTo(34, 14, 21, 16);
  c.lineTo(-20, 17);
  c.quadraticCurveTo(-30, 17, -31, 11);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = "#e98557";
  c.beginPath();
  c.roundRect(15, -12, 13, 24, 5);
  c.fill();
  c.fillStyle = "#f4ead4";
  c.strokeStyle = "#46515a";
  c.lineWidth = 1.3;
  c.beginPath();
  c.moveTo(8, -12);
  c.lineTo(14, -9);
  c.lineTo(14, 9);
  c.lineTo(8, 12);
  c.lineTo(3, 10);
  c.lineTo(3, -10);
  c.closePath();
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(-17, -11);
  c.lineTo(-21, -8);
  c.lineTo(-21, 8);
  c.lineTo(-17, 11);
  c.lineTo(-13, 9);
  c.lineTo(-13, -9);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = "#ee7750";
  c.beginPath();
  c.roundRect(-12, -10, 14, 20, 2);
  c.fill();
  c.strokeStyle = "#f6c3a0";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(-10, -13);
  c.lineTo(20, -12);
  c.moveTo(-10, 13);
  c.lineTo(20, 12);
  c.stroke();
  c.fillStyle = "#f9e8b8";
  c.fillRect(29, -10, 3, 5);
  c.fillRect(29, 5, 3, 5);
  c.fillStyle = "#8e3b30";
  c.fillRect(-31, -9, 3, 5);
  c.fillRect(-31, 5, 3, 5);
  c.strokeStyle = "#374553";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(20, -17);
  c.lineTo(22, -20);
  c.moveTo(20, 17);
  c.lineTo(22, 20);
  c.stroke();
  return el;
}
