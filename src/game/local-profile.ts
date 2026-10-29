// Opt-in, bounded, read-only phase measurements. Normal play keeps no samples.
const enabled =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("profile");
interface Sample {
  phase: string;
  start: number;
  ms: number;
}
const samples: Sample[] = [];
export function profile<T>(phase: string, run: () => T): T {
  if (!enabled) return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    samples.push({ phase, start, ms: performance.now() - start });
    if (samples.length > 2000) samples.shift();
  }
}
export const localProfile = () => samples.map((s) => ({ ...s }));
