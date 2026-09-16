export const STORAGE_PREFIX = 'gfc:';
export const CLOUD_META_KEY = `${STORAGE_PREFIX}cloud-meta:v1`;
export const CLOUD_SCHEMA_VERSION = 1;

const jsonClone = value => JSON.parse(JSON.stringify(value));

function readJSON(storage, key, fallback) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function hasLearningData(snapshot) {
  if (!snapshot) return false;
  return Object.keys(snapshot.favorites || {}).length > 0 ||
    Object.keys(snapshot.srs || {}).length > 0 ||
    Object.values(snapshot.progress || {}).some(progress =>
      (progress?.known?.length || 0) > 0 || (progress?.again?.length || 0) > 0
    );
}

export function captureSnapshot(storage, decks, updatedAtMs = 0) {
  const progress = {};
  const sessions = {};

  for (const deck of decks || []) {
    const deckProgress = readJSON(storage, `${STORAGE_PREFIX}progress:${deck.id}`, null);
    const deckSession = readJSON(storage, `${STORAGE_PREFIX}session:${deck.id}`, null);
    if (deckProgress) progress[deck.id] = deckProgress;
    if (deckSession) sessions[deck.id] = deckSession;
  }

  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    updatedAtMs: Number(updatedAtMs) || 0,
    settings: safeObject(readJSON(storage, `${STORAGE_PREFIX}settings`, {})),
    favorites: safeObject(readJSON(storage, `${STORAGE_PREFIX}favorites`, {})),
    srs: safeObject(readJSON(storage, `${STORAGE_PREFIX}srs:v1`, {})),
    progress,
    sessions
  };
}

export function snapshotsEqual(left, right) {
  if (!left || !right) return false;
  const comparable = value => ({
    schemaVersion: value.schemaVersion,
    settings: value.settings || {},
    favorites: value.favorites || {},
    srs: value.srs || {},
    progress: value.progress || {},
    sessions: value.sessions || {}
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function applySnapshot(storage, snapshot) {
  if (!snapshot || snapshot.schemaVersion !== CLOUD_SCHEMA_VERSION) return false;

  const write = (key, value) => storage.setItem(key, JSON.stringify(jsonClone(value)));
  const staleDeckKeys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(`${STORAGE_PREFIX}progress:`) || key?.startsWith(`${STORAGE_PREFIX}session:`)) {
      staleDeckKeys.push(key);
    }
  }
  staleDeckKeys.forEach(key => storage.removeItem(key));

  write(`${STORAGE_PREFIX}settings`, safeObject(snapshot.settings));
  write(`${STORAGE_PREFIX}favorites`, safeObject(snapshot.favorites));
  write(`${STORAGE_PREFIX}srs:v1`, safeObject(snapshot.srs));

  for (const [deckId, progress] of Object.entries(safeObject(snapshot.progress))) {
    write(`${STORAGE_PREFIX}progress:${deckId}`, progress);
  }
  for (const [deckId, session] of Object.entries(safeObject(snapshot.sessions))) {
    write(`${STORAGE_PREFIX}session:${deckId}`, session);
  }

  write(CLOUD_META_KEY, {
    lastChangedAtMs: Number(snapshot.updatedAtMs) || 0,
    lastSyncedAtMs: Date.now()
  });
  return true;
}

export function pickSyncDirection(localSnapshot, remoteSnapshot) {
  if (!remoteSnapshot) return 'upload';
  if (snapshotsEqual(localSnapshot, remoteSnapshot)) return 'none';
  if (!hasLearningData(localSnapshot) && hasLearningData(remoteSnapshot)) return 'download';
  if ((localSnapshot?.updatedAtMs || 0) > (remoteSnapshot.updatedAtMs || 0)) return 'upload';
  return 'download';
}
