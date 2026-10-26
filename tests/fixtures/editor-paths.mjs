export function densify(points, spacing = 5) {
  const output = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing),
    );
    for (let j = 1; j <= steps; j++)
      output.push({
        x: a.x + ((b.x - a.x) * j) / steps,
        y: a.y + ((b.y - a.y) * j) / steps,
      });
  }
  return output;
}

// Traced approximately from the reported screenshot: a large loop with a short
// gap and a change in direction just before rejoining its starting point.
export const screenshotLoop = densify(
  [
    [469, 345],
    [470, 333],
    [479, 312],
    [495, 293],
    [512, 277],
    [536, 262],
    [564, 250],
    [606, 241],
    [651, 236],
    [701, 237],
    [750, 239],
    [804, 248],
    [855, 261],
    [904, 280],
    [950, 304],
    [993, 332],
    [1028, 365],
    [1055, 398],
    [1071, 425],
    [1078, 444],
    [1079, 470],
    [1071, 496],
    [1055, 519],
    [1032, 542],
    [1007, 563],
    [978, 581],
    [945, 598],
    [909, 612],
    [871, 623],
    [830, 632],
    [786, 636],
    [748, 634],
    [708, 627],
    [674, 614],
    [648, 597],
    [625, 576],
    [606, 551],
    [588, 526],
    [568, 503],
    [548, 479],
    [528, 457],
    [502, 407],
    [478, 382],
  ].map(([x, y]) => ({ x, y })),
);

export function wobblyLoop(phase = 0) {
  return Array.from({ length: 241 }, (_, i) => {
    const a = phase + (i / 240) * Math.PI * 2,
      wobble = 6 * Math.sin(a * 31);
    return {
      x: 720 + (430 + wobble) * Math.cos(a),
      y: 440 + (205 + wobble) * Math.sin(a),
    };
  });
}
