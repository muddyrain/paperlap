import { test } from "node:test";
import assert from "node:assert/strict";
import { freshSave, activeTrack } from "../src/game/save-v3.ts";
import { fingerprint } from "../src/game/geometry.ts";
import { LocalGeometryProof, localSource } from "../src/game/local-source.ts";
import {
  LocalEditModel,
  prepareLocalDrag,
  deformLocal,
} from "../src/game/local-edit.ts";
import {
  LocalDraftStorage,
  LOCAL_DRAFT_KEY,
} from "../src/game/local-draft-storage.ts";
import { SaveSession, STORAGE_KEY } from "../src/game/storage-v3.ts";
import { Trackbook } from "../src/game/trackbook.ts";

test("exact local proofs are source-bound, privately copied, bounded; fingerprint is no evidence", () => {
  const e = activeTrack(freshSave()),
    base = e.track.points,
    source = localSource(e);
  const proof = new LocalGeometryProof(source, base);
  assert.equal(proof.check(base), null);
  const copy = structuredClone(base);
  assert.equal(proof.check(copy), null);
  assert.throws(
    () =>
      new LocalEditModel(base, {
        proof,
        source: { ...source, uid: "another" },
      }),
    /来源不匹配/,
  );
  assert.equal(proof.stats.strict, 1);
  assert.equal(proof.stats.reused, 1);
  copy[10].x += 0.001;
  assert.equal(fingerprint(copy, e.track.width), e.track.id);
  assert.equal(proof.check(copy), null);
  assert.equal(proof.stats.strict, 2);
  copy[0].x += 1;
  assert.ok(proof.check(copy));
  assert.equal(proof.stats.snapshots, 2);
  assert.equal(proof.matches({ ...source, uid: "another" }, base), false);
  assert.equal(
    proof.matches({ ...source, geometryIdentity: "g-" + "a".repeat(32) }, base),
    false,
  );
  assert.equal(
    proof.matches(
      { ...source, geometryDigest: "sha256-v1-" + "0".repeat(64) },
      base,
    ),
    false,
  );
  assert.equal(
    proof.matches({ ...source, algorithmVersion: 2 } as never, base),
    false,
  );
  assert.equal(proof.matches(source, copy), false);
  source.uid = "mutated";
  assert.equal(proof.matches(source, base), false);
  for (let i = 0; i < 40; i++) {
    const p = structuredClone(base);
    p[10].x += i * 0.0001;
    assert.equal(proof.check(p), null);
  }
  assert.equal(proof.stats.snapshots, 32);
  const n = proof.stats.strict;
  assert.equal(proof.check(base, true), null);
  assert.equal(proof.stats.strict, n + 1);
});

test("release proof is reused for draft backup but every disk recovery is strict", () => {
  const items = new Map<string, string>();
  const store = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      items.set(k, v);
    },
    removeItem: (k: string) => {
      items.delete(k);
    },
  };
  const session = new SaveSession(store, { owned: true, release() {} }),
    save = session.open().save;
  const e = activeTrack(save),
    source = localSource(e),
    proof = new LocalGeometryProof(source, e.track.points);
  const model = new LocalEditModel(e.track.points, { source, proof });
  const i = e.track.points.reduce(
      (a, p, i) => (p.x < e.track.points[a].x ? i : a),
      0,
    ),
    selection = prepareLocalDrag(e.track.points, e.track.points[i]);
  assert.ok(selection.ok);
  if (!selection.ok) throw Error();
  assert.equal(
    model.preview(deformLocal(selection.drag, { x: -4, y: 0 })),
    null,
  );
  assert.ok(model.adopt());
  const backup = new LocalDraftStorage(store, () => session.check().ok, proof);
  assert.ok(backup.open(source, e.track.points).ok);
  const strict = proof.stats.strict;
  assert.ok(backup.write(model.checkpoint).ok);
  assert.equal(proof.stats.strict, strict);
  const recovery = new LocalDraftStorage(
    store,
    () => session.check().ok,
    proof,
  );
  assert.ok(recovery.open(source, e.track.points).ok);
  assert.equal(proof.stats.strict, strict + 2);
  const doc = JSON.parse(items.get(LOCAL_DRAFT_KEY)!);
  doc.entries[0].checkpoint.current[0].x += 1;
  const corrupt = JSON.stringify(doc);
  items.set(LOCAL_DRAFT_KEY, corrupt);
  assert.equal(
    new LocalDraftStorage(store, () => true, proof).open(source, e.track.points)
      .ok,
    false,
  );
  assert.equal(items.get(LOCAL_DRAFT_KEY), corrupt);
  items.set(STORAGE_KEY, items.get(STORAGE_KEY)! + " ");
  assert.equal(backup.write(model.checkpoint).ok, false);
});

test("formal transaction reuses only a matching proof and still validates V3 identity/write/readback", () => {
  const items = new Map<string, string>();
  const store = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      items.set(k, v);
    },
  };
  const session = new SaveSession(store, { owned: true, release() {} }),
    save = session.open().save;
  let applied = 0;
  const book = new Trackbook(save, {
    uid: () => "unused",
    check: () => session.check(),
    write: (s) => session.write(s as never),
    stop() {},
    prepare: () => () => {
      applied++;
    },
    recover() {
      throw Error("unexpected");
    },
  });
  assert.ok(book.beginLocal().ok);
  const e = activeTrack(save),
    source = localSource(e),
    proof = new LocalGeometryProof(source, e.track.points),
    model = new LocalEditModel(e.track.points, { source, proof });
  const changed = structuredClone(e.track.points);
  changed[10].x += 0.001;
  assert.equal(model.preview(changed), null);
  assert.ok(model.adopt());
  const bad = structuredClone(model.current);
  bad[0].x += 1;
  assert.equal(book.commitLocal(source, bad, proof).ok, false);
  assert.equal(applied, 0);
  const strict = proof.stats.strict;
  assert.ok(book.commitLocal(source, model.current, proof).ok);
  assert.equal(proof.stats.strict, strict);
  assert.equal(applied, 1);
  const durable = JSON.parse(items.get(STORAGE_KEY)!);
  assert.equal(durable.tracks[0].track.id, e.track.id);
  assert.notEqual(durable.tracks[0].geometryIdentity, e.geometryIdentity);
  assert.notEqual(durable.tracks[0].geometryDigest, e.geometryDigest);
  assert.deepEqual(durable.tracks[0].track.points, changed);
});
