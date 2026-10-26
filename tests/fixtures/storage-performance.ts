import { fingerprint } from "../../src/game/geometry.ts";
import type { Save, SaveResult } from "../../src/game/save.ts";

export function storageFixture(points = 350, count = 20): Save {
  const tracks = Array.from({ length: count }, (_, index) => {
    const path = Array.from({ length: points }, (_, i) => {
      const angle = (i / points) * Math.PI * 2;
      return {
        x: 720 + (480 - index) * Math.cos(angle),
        y: 430 + (215 - index / 3) * Math.sin(angle),
      };
    });
    return {
      uid: `entry-perf-${index}`,
      track: {
        schemaVersion: 1 as const,
        id: fingerprint(path, 108),
        width: 108,
        name: `性能赛道 ${index + 1}`,
        points: path,
      },
    };
  });
  return {
    schemaVersion: 2,
    rulesVersion: 2,
    activeTrackUid: tracks[0].uid,
    tracks,
    records: {},
    legacyRecords: {},
    muted: true,
  };
}

export function saved(result: SaveResult): Save {
  if (!result.ok) throw Error(result.error);
  return result.save;
}

export function measure(action: () => unknown, samples = 5) {
  action(); // Warm-up is excluded from reported measurements.
  const milliseconds = Array.from({ length: samples }, () => {
    const start = performance.now();
    action();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return {
    medianMs: milliseconds[Math.floor(milliseconds.length / 2)],
    p95Ms: milliseconds[Math.ceil(milliseconds.length * 0.95) - 1],
    milliseconds,
  };
}

export function benchmarkStorage(
  model: typeof import("../../src/game/save.ts"),
  persistence: typeof import("../../src/game/storage.ts"),
  pointCount: number,
  samples = 5,
  backingStorage?: Pick<Storage, "getItem" | "setItem">,
) {
  let save = saved(model.validateSave(storageFixture(pointCount)));
  const raw = JSON.stringify(save);
  const items = new Map([[persistence.STORAGE_KEY, raw]]);
  const storage = backingStorage ?? {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
  storage.setItem(persistence.STORAGE_KEY, raw);
  save = persistence.loadSave(storage).save;
  let iteration = 0;
  const best = () => {
    save = saved(
      model.setBest(save, save.activeTrackUid, 20 - ++iteration * 0.0001),
    );
  };
  const write = () => {
    const result = persistence.writeSave(storage, save);
    if (!result.ok) throw Error(result.error);
  };
  const operations = {
    setBest: () => best(),
    renameTrack: () => {
      save = saved(
        model.renameTrack(save, save.activeTrackUid, `命名 ${++iteration}`),
      );
    },
    selectTrack: () => {
      save = saved(model.selectTrack(save, save.tracks[++iteration % 20].uid));
    },
    writeSave: () => write(),
    bestAndWrite: () => {
      best();
      write();
    },
    mutedAndWrite: () => {
      save.muted = !save.muted;
      write();
    },
    parseUntrusted: () => {
      if (!model.parseSave(raw)) throw Error("Fixture rejected");
    },
  };
  return {
    tracks: 20,
    pointsPerTrack: pointCount,
    operations: Object.fromEntries(
      Object.entries(operations).map(([name, run]) => [
        name,
        measure(run, samples),
      ]),
    ),
  };
}
