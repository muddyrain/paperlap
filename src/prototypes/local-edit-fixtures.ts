import { defaultTrack, fingerprint, type Track } from "../game/geometry";
import { ROAD } from "../game/config";
export function ellipseTrack(
  count = 450,
  rx = 480,
  ry = 215,
  name = "宽环线",
): Track {
  const points = Array.from({ length: count }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI * 2) / count;
    return { x: 720 + rx * Math.cos(a), y: 440 + ry * Math.sin(a) };
  });
  return {
    schemaVersion: 1,
    name,
    points,
    width: ROAD.width,
    id: fingerprint(points, ROAD.width),
  };
}
export const localFixtures = () => [
  ellipseTrack(),
  { ...defaultTrack(), name: "连续 S 弯" },
  ellipseTrack(450, 340, 210, "较紧弯"),
  ellipseTrack(450, 570, 240, "靠边弯"),
];
