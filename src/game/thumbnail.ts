import type { Track } from "./geometry";

// Numeric, validated geometry only. No name/UID interpolation or persistent image data.
export function trackThumbnail(track: Track): string {
  const xs = track.points.map((p) => p.x),
    ys = track.points.map((p) => p.y);
  const padding = track.width / 2 + 16;
  const x = Math.min(...xs) - padding,
    y = Math.min(...ys) - padding;
  const width = Math.max(...xs) + padding - x,
    height = Math.max(...ys) + padding - y;
  const d =
    track.points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") +
    " Z";
  const [a, b] = track.points,
    length = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = ((-(b.y - a.y) / length) * track.width) / 2,
    ny = (((b.x - a.x) / length) * track.width) / 2;
  return `<svg viewBox="${x} ${y} ${width} ${height}" aria-hidden="true" focusable="false"><g fill="none" stroke-linejoin="round" stroke-linecap="round"><path d="${d}" stroke="#74808b" stroke-width="${track.width + 3}"/><path d="${d}" stroke="#a6a3a0" stroke-width="${track.width}"/><path d="${d}" stroke="#f9f1e2" stroke-width="3" stroke-dasharray="16 22"/><path d="M${a.x - nx},${a.y - ny} L${a.x + nx},${a.y + ny}" stroke="#c84e28" stroke-width="12"/></g></svg>`;
}
