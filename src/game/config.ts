export const WORLD = { width: 1440, height: 860 };
export const RULES_VERSION = 2;
export const ROAD = {
  width: 108,
  tolerance: 3,
  spacing: 8,
  minLength: 850,
  closeDistance: 75,
  maxRaw: 1600,
  maxPoints: 900,
  smoothingDistance: 27,
  margin: 64,
  minY: 184,
  maxY: 700,
};
export const DRIVE = {
  step: 1 / 120,
  maxFrame: 0.1,
  acceleration: 125,
  brake: 255,
  maxSpeed: 260,
  drag: 0.32,
  offroadDrag: 3.4,
  offroadSpeed: 75,
  steering: 2.15,
  highSpeedSteering: 3.1,
  steeringSpeed: 100,
  steeringResponse: 22,
  steeringReturn: 36,
  lateralGrip: 9.5,
  wheelbase: 41,
};
export const COLORS = {
  paper: "#f2e7d1",
  grid: "#c5ccd0",
  ink: "#374553",
  accent: "#d65932",
  road: "#a6a3a0",
  pencil: "#74808b",
  pale: "#f9f1e2",
};
