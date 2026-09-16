import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_SCHEMA_VERSION,
  applySnapshot,
  captureSnapshot,
  pickSyncDirection,
  snapshotsEqual
} from '../cloud-sync-core.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const decks = [{ id: 'verbs-1' }, { id: 'chunks-1' }];

test('captures deck progress, sessions, favorites, and SRS data', () => {
  const storage = new MemoryStorage({
    'gfc:settings': JSON.stringify({ front: 'en' }),
    'gfc:favorites': JSON.stringify({ 'verbs-1:0': { deckId: 'verbs-1', cardIndex: 0 } }),
    'gfc:srs:v1': JSON.stringify({ 'verbs-1:0': { stage: 2 } }),
    'gfc:progress:verbs-1': JSON.stringify({ known: [0], again: [] }),
    'gfc:session:verbs-1': JSON.stringify({ version: 4, idx: 1 })
  });

  const snapshot = captureSnapshot(storage, decks, 1234);
  assert.equal(snapshot.schemaVersion, CLOUD_SCHEMA_VERSION);
  assert.equal(snapshot.updatedAtMs, 1234);
  assert.deepEqual(snapshot.progress['verbs-1'], { known: [0], again: [] });
  assert.deepEqual(snapshot.sessions['verbs-1'], { version: 4, idx: 1 });
  assert.equal(snapshot.srs['verbs-1:0'].stage, 2);
});

test('applies a cloud snapshot as the authoritative set of deck data', () => {
  const storage = new MemoryStorage({
    'gfc:progress:verbs-1': JSON.stringify({ known: [9], again: [] }),
    'gfc:session:verbs-1': JSON.stringify({ version: 4, idx: 9 })
  });
  const remote = {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    updatedAtMs: 2000,
    settings: { front: 'de' },
    favorites: {},
    srs: {},
    progress: { 'chunks-1': { known: [1], again: [] } },
    sessions: {}
  };

  assert.equal(applySnapshot(storage, remote), true);
  assert.equal(storage.getItem('gfc:progress:verbs-1'), null);
  assert.deepEqual(JSON.parse(storage.getItem('gfc:progress:chunks-1')), { known: [1], again: [] });
  assert.equal(JSON.parse(storage.getItem('gfc:cloud-meta:v1')).lastChangedAtMs, 2000);
});

test('chooses the newest complete snapshot and avoids redundant syncs', () => {
  const base = {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    updatedAtMs: 100,
    settings: {}, favorites: {}, srs: {}, progress: {}, sessions: {}
  };
  const changedLocal = {
    ...base,
    updatedAtMs: 200,
    settings: { front: 'en' }
  };
  assert.equal(pickSyncDirection(changedLocal, base), 'upload');
  assert.equal(pickSyncDirection(base, { ...base, updatedAtMs: 200 }), 'none');
  assert.equal(pickSyncDirection({ ...base, updatedAtMs: 300 }, base), 'none');
  assert.equal(pickSyncDirection(base, null), 'upload');
  assert.equal(snapshotsEqual(base, { ...base, updatedAtMs: 999 }), true);
});
