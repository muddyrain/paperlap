import { test } from "node:test";
import assert from "node:assert/strict";
import { storageFixture, measure } from "./fixtures/storage-performance.ts";
import { SaveSession, STORAGE_KEY, OLD_KEYS } from "../src/game/storage-v3.ts";
import { renameTrack, setBest, type SaveResult } from "../src/game/save-v3.ts";
const value = (r: SaveResult) => {
  if (!r.ok) throw Error(r.error);
  return r.save;
};
test("20×900 V3 cold load stays strict; metadata/best hot writes avoid full geometry", (t) => {
  const old = JSON.stringify(storageFixture(900)),
    items = new Map([[OLD_KEYS.v2, old]]);
  const store = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      items.set(k, v);
    },
  };
  const lease = () => ({ owned: true, release() {} }),
    session = new SaveSession(store, lease());
  let save = session.open().save;
  assert.ok(session.writable);
  const raw = items.get(STORAGE_KEY)!;
  const cold = measure(() => {
    const m = new Map([
      [STORAGE_KEY, raw],
      [OLD_KEYS.v2, old],
    ]);
    const s = new SaveSession(
      {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => {
          m.set(k, v);
        },
      },
      lease(),
    );
    assert.ok(s.open().persisted);
  }, 3);
  let step = 0;
  const rename = measure(() => {
    save = value(renameTrack(save, save.activeTrackUid, `性能 ${++step}`));
    assert.ok(session.write(save).ok);
  }, 3);
  const best = measure(() => {
    save = value(setBest(save, save.activeTrackUid, 20 - ++step * 0.001));
    assert.ok(session.write(save).ok);
  }, 3);
  const mute = measure(() => {
    save = { ...save, muted: !save.muted };
    assert.ok(session.write(save).ok);
  }, 3);
  const report = {
    tracks: 20,
    points: 900,
    oldCharacters: old.length,
    v3Characters: raw.length,
    cold,
    rename,
    best,
    mute,
  };
  t.diagnostic(JSON.stringify(report));
  for (const hot of [rename, best, mute])
    assert.ok(hot.medianMs < cold.medianMs * 0.5, JSON.stringify(report));
  assert.equal(items.get(OLD_KEYS.v2), old);
});
