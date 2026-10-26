export function formatTime(seconds: number): string {
  const hundredths = Math.max(0, Math.floor(seconds * 100 + 1e-7));
  return `${String(Math.floor(hundredths / 6000)).padStart(2, "0")}:${String(Math.floor(hundredths / 100) % 60).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`;
}
