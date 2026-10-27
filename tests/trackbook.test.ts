import { test } from "node:test";
import assert from "node:assert/strict";
import { Trackbook } from "../src/game/trackbook.ts";
import { activeTrack, freshSave, recordKey } from "../src/game/save.ts";
import { defaultTrack, fromDrawing } from "../src/game/geometry.ts";
import { wobblyLoop } from "./fixtures/editor-paths.mjs";
import { STORAGE_KEY, writeSave } from "../src/game/storage.ts";

function setup() {
  const initial = freshSave();
  initial.records[recordKey(activeTrack(initial))] = 24;
  let raw = JSON.stringify(initial);
  let blocked = false;
  let shown = initial.activeTrackUid;
  const book = new Trackbook(initial, {
    uid: () => "entry-b",
    write: (save) =>
      writeSave(
        {
          getItem: () => raw,
          setItem: (key, value) => {
            assert.equal(key, STORAGE_KEY);
            if (blocked) throw new DOMException("full", "QuotaExceededError");
            raw = value;
          },
        },
        save,
      ),
    stop: () => {},
    prepare: (entry) => () => {
      assert.equal(
        JSON.parse(raw).activeTrackUid,
        entry.uid,
        "persist before applying the scene",
      );
      shown = entry.uid;
    },
    recover: () => {},
  });
  return {
    book,
    initial,
    stored: () => JSON.parse(raw),
    shown: () => shown,
    block: (value: boolean) => {
      blocked = value;
    },
  };
}

test("create commits a new UID only after persistence; cancel never changes the book", () => {
  const app = setup(),
    { book, initial } = app;
  assert.equal(book.beginEdit("create").ok, true);
  book.cancelEdit();
  assert.deepEqual(app.stored(), initial);
  assert.deepEqual(book.save, initial);
  book.beginEdit("create");
  assert.equal(book.acceptDrawing(activeTrack(initial).track).ok, true);
  assert.equal(book.save.tracks.length, 2);
  assert.equal(book.save.activeTrackUid, "entry-b");
  assert.deepEqual(book.save.tracks[0], initial.tracks[0]);
  assert.equal(book.save.records[recordKey(activeTrack(book.save))], undefined);
  assert.equal(app.shown(), "entry-b");
  assert.deepEqual(app.stored(), book.save);
});

test("failed creation retains the draft and old active state for retry", () => {
  const app = setup(),
    { book, initial } = app;
  book.beginEdit("create");
  app.block(true);
  assert.deepEqual(book.acceptDrawing(activeTrack(initial).track), {
    ok: false,
    error: "quota",
  });
  assert.equal(book.intent, "create");
  assert.equal(app.shown(), initial.activeTrackUid);
  assert.deepEqual(book.save, initial);
  assert.deepEqual(app.stored(), initial);
  app.block(false);
  assert.equal(book.acceptDrawing(activeTrack(initial).track).ok, true);
  assert.equal(book.save.tracks.length, 2);
});

test("selection persists before applying; reselecting the active entry is a stable no-op", () => {
  const app = setup(),
    { book, initial } = app;
  book.beginEdit("create");
  book.acceptDrawing(activeTrack(initial).track);
  app.block(true);
  assert.deepEqual(book.select("entry-b"), {
    ok: true,
    persisted: true,
    changed: false,
  });
  assert.deepEqual(book.select(initial.activeTrackUid), {
    ok: false,
    error: "quota",
  });
  assert.equal(book.save.activeTrackUid, "entry-b");
  assert.equal(app.shown(), "entry-b");
  assert.equal(app.stored().activeTrackUid, "entry-b");
  app.block(false);
  assert.equal(book.select(initial.activeTrackUid).ok, true);
  assert.equal(app.shown(), initial.activeTrackUid);
  assert.equal(book.save.records[recordKey(activeTrack(book.save))], 24);
});

test("replace keeps UID, name and history, including unsaved playable editing", () => {
  const app = setup(),
    { book, initial } = app;
  const drawn = fromDrawing(wobblyLoop());
  assert.ok(drawn.ok);
  book.beginEdit("replace");
  app.block(true);
  assert.deepEqual(book.acceptDrawing(drawn.track), {
    ok: true,
    changed: true,
    persisted: false,
    error: "quota",
  });
  assert.equal(book.intent, null);
  assert.equal(book.save.tracks.length, 1);
  assert.equal(book.save.activeTrackUid, initial.activeTrackUid);
  assert.equal(
    activeTrack(book.save).track.name,
    activeTrack(initial).track.name,
  );
  assert.notEqual(
    activeTrack(book.save).track.id,
    activeTrack(initial).track.id,
  );
  assert.deepEqual(book.save.records, initial.records);
  assert.equal(book.save.records[recordKey(activeTrack(book.save))], undefined);
  assert.deepEqual(app.stored(), initial);
});

test("rename and confirmed deletion preserve other records and archive; failures are atomic", () => {
  const app = setup(),
    { book, initial } = app;
  book.save.legacyRecords["track-deadbeef:rules-1"] = 30;
  book.beginEdit("create");
  book.acceptDrawing(defaultTrack());
  const before = structuredClone(book.save);
  for (const name of ["", " ", "x".repeat(41)])
    assert.deepEqual(book.rename("entry-b", name), {
      ok: false,
      error: "invalid-name",
    });
  app.block(true);
  assert.equal(book.rename("entry-b", "B").ok, false);
  assert.equal(book.remove(initial.activeTrackUid, true).ok, false);
  assert.deepEqual(book.save, before);
  assert.deepEqual(app.stored(), before);
  app.block(false);
  assert.equal(book.rename("entry-b", "B").ok, true);
  assert.equal(app.stored().tracks[1].track.name, "B");
  assert.deepEqual(book.save.records, before.records);
  const cancelled = book.remove(initial.activeTrackUid, false);
  assert.ok(cancelled.ok);
  assert.equal(cancelled.changed, false);
  assert.equal(book.save.tracks.length, 2);
  assert.equal(book.remove(initial.activeTrackUid, true).ok, true);
  assert.equal(book.save.activeTrackUid, "entry-b");
  assert.equal(app.shown(), "entry-b");
  assert.deepEqual(book.save.records, {});
  assert.deepEqual(book.save.legacyRecords, { "track-deadbeef:rules-1": 30 });
  assert.deepEqual(book.remove("entry-b", true), {
    ok: false,
    error: "last-track",
  });
});

test("preparation errors preserve the old save; post-write rendering errors require reload", () => {
  for (const when of ["prepare", "apply"]) {
    const initial = freshSave();
    let stored = initial,
      recovered = false;
    const book = new Trackbook(initial, {
      uid: () => "entry-b",
      write: (save) => {
        stored = save;
        return { ok: true };
      },
      stop: () => {},
      prepare: () => {
        if (when === "prepare") throw Error("canvas unavailable");
        return () => {
          throw Error("texture unavailable");
        };
      },
      recover: () => {
        recovered = true;
      },
    });
    book.beginEdit("create");
    const result = book.acceptDrawing(defaultTrack());
    assert.deepEqual(result, {
      ok: false,
      error: when === "prepare" ? "render" : "reload-required",
    });
    assert.equal(recovered, when === "apply");
    assert.deepEqual(book.save, stored);
    assert.equal(stored.tracks.length, when === "prepare" ? 1 : 2);
    if (when === "apply") {
      assert.equal(book.select(initial.activeTrackUid).ok, false);
      assert.equal(book.rename("entry-b", "B").ok, false);
    }
  }
});

test("metadata and no-ops never stop or rebuild the current scene; active deletion does", () => {
  const initial = freshSave();
  let stopped = 0,
    applied = 0,
    writes = 0;
  const book = new Trackbook(initial, {
    uid: () => "entry-b",
    write: () => {
      writes++;
      return { ok: true };
    },
    stop: () => {
      stopped++;
    },
    prepare: () => () => {
      applied++;
    },
    recover: () => {},
  });
  book.beginEdit("create");
  assert.equal(book.select(initial.activeTrackUid).ok, false);
  book.acceptDrawing(defaultTrack());
  assert.deepEqual([stopped, applied, writes], [1, 1, 1]);
  book.select("entry-b");
  book.rename("entry-b", activeTrack(initial).track.name); // duplicate names allowed
  book.remove(initial.activeTrackUid, false);
  assert.deepEqual([stopped, applied, writes], [1, 1, 2]);
  book.remove("entry-b", true);
  assert.equal(book.save.activeTrackUid, initial.activeTrackUid);
  assert.deepEqual([stopped, applied, writes], [2, 2, 3]);
});

test("20-entry limit rejects creation without starting a draft or writing", () => {
  const save = freshSave();
  save.tracks = Array.from({ length: 20 }, (_, i) => ({
    uid: i ? `entry-${i}` : save.activeTrackUid,
    track: defaultTrack(),
  }));
  const book = new Trackbook(save, {
    uid: () => "unused",
    write: () => {
      assert.fail("no write");
    },
    stop: () => {
      assert.fail("no stop");
    },
    prepare: () => {
      assert.fail("no render");
    },
    recover: () => {},
  });
  assert.deepEqual(book.beginEdit("create"), {
    ok: false,
    error: "track-limit",
  });
  assert.equal(book.intent, null);
});

test("failed unsaved replacement rendering reloads the durable old track", () => {
  const initial = freshSave();
  let recovered = false;
  const book = new Trackbook(initial, {
    uid: () => "unused",
    write: () => ({ ok: false, error: "quota" }),
    stop: () => {},
    prepare: () => () => {
      throw Error("render failed");
    },
    recover: () => {
      recovered = true;
    },
  });
  book.beginEdit("replace");
  assert.deepEqual(book.acceptDrawing(defaultTrack()), {
    ok: false,
    error: "reload-required",
  });
  assert.equal(recovered, true);
  assert.deepEqual(book.save, initial);
});
