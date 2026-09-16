import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  CLOUD_META_KEY,
  STORAGE_PREFIX,
  applySnapshot,
  captureSnapshot,
  pickSyncDirection
} from './cloud-sync-core.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDa0QJmnt7uiKDNhcD1oRm6xaq718MDSD8',
  authDomain: 'german-words-list-app.firebaseapp.com',
  projectId: 'german-words-list-app',
  storageBucket: 'german-words-list-app.firebasestorage.app',
  messagingSenderId: '997179116756',
  appId: '1:997179116756:web:31dddba4688485f9a23f41',
  measurementId: 'G-PW8LJZWW5T'
};

const APP_ID = 'german-80-20-app';
const SAVE_DELAY_MS = 700;

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

const statusEl = document.getElementById('cloudStatus');
const loginButton = document.getElementById('cloudLogin');
const logoutButton = document.getElementById('cloudLogout');
const decks = window.GFC_DECKS || [];
const progressRef = uid => doc(db, `artifacts/${APP_ID}/users/${uid}/progress/main`);

let saveTimer = null;
let suppressLocalTracking = false;
let syncInFlight = Promise.resolve();
let authRevision = 0;

function setStatus(message, state = 'local') {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(CLOUD_META_KEY)) || {};
  } catch {
    return {};
  }
}

function writeMeta(patch) {
  const next = { ...readMeta(), ...patch };
  originalSetItem.call(localStorage, CLOUD_META_KEY, JSON.stringify(next));
  return next;
}

const originalSetItem = Storage.prototype.setItem;
const originalRemoveItem = Storage.prototype.removeItem;

function markLocalChange() {
  if (suppressLocalTracking) return;
  writeMeta({ lastChangedAtMs: Date.now() });
  scheduleCloudSave();
}

Storage.prototype.setItem = function(key, value) {
  const previousValue = this === localStorage ? this.getItem(key) : null;
  originalSetItem.call(this, key, value);
  if (
    this === localStorage &&
    key.startsWith(STORAGE_PREFIX) &&
    key !== CLOUD_META_KEY &&
    previousValue !== String(value)
  ) {
    markLocalChange();
  }
};

Storage.prototype.removeItem = function(key) {
  const hadValue = this === localStorage && this.getItem(key) !== null;
  originalRemoveItem.call(this, key);
  if (
    this === localStorage &&
    key.startsWith(STORAGE_PREFIX) &&
    key !== CLOUD_META_KEY &&
    hadValue
  ) {
    markLocalChange();
  }
};

function localSnapshot() {
  return captureSnapshot(localStorage, decks, readMeta().lastChangedAtMs || 0);
}

async function uploadProgress(user) {
  if (!user || auth.currentUser?.uid !== user.uid) return;
  const updatedAtMs = Math.max(Date.now(), readMeta().lastChangedAtMs || 0);
  writeMeta({ lastChangedAtMs: updatedAtMs });
  const snapshot = captureSnapshot(localStorage, decks, updatedAtMs);

  setStatus('Syncing progress…', 'syncing');
  await setDoc(progressRef(user.uid), {
    appId: APP_ID,
    schemaVersion: snapshot.schemaVersion,
    snapshot,
    lastUpdated: serverTimestamp()
  }, { mergeFields: ['appId', 'schemaVersion', 'snapshot', 'lastUpdated'] });

  if (auth.currentUser?.uid !== user.uid) return;
  writeMeta({ lastSyncedAtMs: Date.now() });
  setStatus(`Synced as ${user.displayName || user.email || 'learner'}`, 'synced');
}

function scheduleCloudSave() {
  window.clearTimeout(saveTimer);
  if (!auth.currentUser) {
    setStatus('Saved locally · sign in to sync', 'local');
    return;
  }

  const user = auth.currentUser;
  saveTimer = window.setTimeout(() => {
    syncInFlight = syncInFlight
      .then(() => uploadProgress(user))
      .catch(error => {
        console.warn('Cloud progress save failed:', error);
        if (auth.currentUser?.uid === user.uid) {
          setStatus('Cloud sync unavailable · saved locally', 'error');
        }
      });
  }, SAVE_DELAY_MS);
}

async function reconcileProgress(user) {
  setStatus('Checking cloud progress…', 'syncing');
  const remoteDoc = await getDoc(progressRef(user.uid));
  if (auth.currentUser?.uid !== user.uid) return;

  const remoteSnapshot = remoteDoc.exists() ? remoteDoc.data().snapshot : null;
  const direction = pickSyncDirection(localSnapshot(), remoteSnapshot);

  if (direction === 'upload') {
    await uploadProgress(user);
    return;
  }

  if (direction === 'download') {
    suppressLocalTracking = true;
    let applied = false;
    try {
      applied = applySnapshot(localStorage, remoteSnapshot);
      if (applied) window.refreshGermanCardsFromStorage?.();
    } finally {
      suppressLocalTracking = false;
    }

    if (applied) {
      setStatus(`Synced as ${user.displayName || user.email || 'learner'}`, 'synced');
      return;
    }
    await uploadProgress(user);
    return;
  }

  writeMeta({ lastSyncedAtMs: Date.now() });
  setStatus(`Synced as ${user.displayName || user.email || 'learner'}`, 'synced');
}

loginButton.addEventListener('click', async () => {
  loginButton.disabled = true;
  setStatus('Opening Google sign-in…', 'syncing');
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.warn('Sign-in failed:', error);
    setStatus(error.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled · saved locally' : 'Sign-in failed · saved locally', 'error');
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await signOut(auth);
  } finally {
    logoutButton.disabled = false;
  }
});

setStatus('Checking sign-in…', 'syncing');

onAuthStateChanged(auth, user => {
  const revision = ++authRevision;
  window.clearTimeout(saveTimer);
  saveTimer = null;
  loginButton.hidden = !!user;
  logoutButton.hidden = !user;

  if (!user) {
    setStatus('Saved locally · sign in to sync', 'local');
    return;
  }

  syncInFlight = syncInFlight
    .then(() => {
      if (revision !== authRevision || auth.currentUser?.uid !== user.uid) return;
      return reconcileProgress(user);
    })
    .catch(error => {
      console.warn('Cloud progress load failed:', error);
      if (revision === authRevision && auth.currentUser?.uid === user.uid) {
        setStatus('Cloud sync unavailable · saved locally', 'error');
      }
    });
});
