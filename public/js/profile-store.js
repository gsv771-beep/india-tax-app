/**
 * The one place the shared profile is read from and written to in the browser.
 *
 * Everything stays in localStorage under PROFILE_KEY; nothing here talks to the network.
 * Tools call getProfile() to pre-fill and updateProfile() to write back; they listen for
 * `profilechange` on window and ignore events they raised themselves (detail.source).
 */
import { PROFILE_KEY, emptyProfile, migrateProfile, parseProfileJSON, SCHEMA_VERSION } from '../engine/profile.js';

// Storage and window are absent when the engine tests import a UI module under Node; behave as an in-memory store then.
const storage = typeof localStorage !== 'undefined' ? localStorage : null;
let profile = load();

function load() {
  try {
    const raw = JSON.parse(storage?.getItem(PROFILE_KEY) || 'null');
    return raw ? migrateProfile(raw) : emptyProfile();
  } catch { return emptyProfile(); }
}

function persist() {
  try { storage?.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* private mode or full: the session still works */ }
}

function emit(source) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profilechange', { detail: { source, profile } }));
}

/** A deep copy: callers may mutate what they get without touching the store. */
export function getProfile() {
  return structuredClone(profile);
}

/**
 * updateProfile(fn, source): fn receives a copy and returns the new profile (or mutates and returns nothing).
 * updateProfile(obj, source): obj replaces the profile.
 */
export function updateProfile(change, source = 'unknown') {
  let next;
  if (typeof change === 'function') { const draft = getProfile(); next = change(draft) || draft; } else next = change;
  next = migrateProfile(next);
  if (JSON.stringify(next) === JSON.stringify(profile)) return profile;
  profile = next;
  persist();
  emit(source);
  return profile;
}

export function resetProfile(source = 'panel') {
  return updateProfile(emptyProfile(), source);
}

/** Every TaxCompass key, not just the profile: calculators, budget, tax form, person, session. */
export function wipeEverything() {
  try { for (const k of Object.keys(storage || {})) if (k.startsWith('taxcompass.')) storage.removeItem(k); } catch {}
  profile = emptyProfile();
  emit('wipe');
}

export function exportProfileJSON() {
  return JSON.stringify({ ...profile, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), app: 'TaxCompass India' }, null, 2);
}

/**
 * Everything the site remembers in this browser: the profile plus every calculator's own inputs
 * (a scenario in the home-buying tool, SIP lump sums, the budget). Restoring it resumes exactly
 * where you left off; the profile-only export is the portable, human-readable one.
 */
export function exportSnapshotJSON() {
  const keys = {};
  try { for (const k of Object.keys(storage || {})) if (k.startsWith('taxcompass.') && !/session|person|ui\.v1|calc-blank/.test(k)) keys[k] = storage.getItem(k); } catch {}
  return JSON.stringify({ app: 'TaxCompass India', kind: 'snapshot', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), keys }, null, 2);
}

/**
 * Throws with a plain-English message on anything that is not a profile or a snapshot.
 * A snapshot restores every key and returns { snapshot: true }; the caller should reload.
 */
export function importProfileJSON(text, source = 'import') {
  let raw = null;
  try { raw = JSON.parse(text); } catch { /* parseProfileJSON gives the message */ }
  if (raw && raw.kind === 'snapshot' && raw.keys && typeof raw.keys === 'object') {
    if (Number(raw.schemaVersion) > SCHEMA_VERSION) throw new Error(`This snapshot was saved by a newer version of TaxCompass (schema ${raw.schemaVersion}).`);
    const profileText = raw.keys[PROFILE_KEY];
    const p = profileText ? parseProfileJSON(profileText) : emptyProfile();
    try { for (const k of Object.keys(storage || {})) if (k.startsWith('taxcompass.')) storage.removeItem(k); } catch {}
    try { for (const [k, v] of Object.entries(raw.keys)) if (k.startsWith('taxcompass.') && typeof v === 'string') storage?.setItem(k, v); } catch {}
    profile = p; persist(); emit(source);
    return { snapshot: true, profile: p };
  }
  const p = parseProfileJSON(text);
  return updateProfile(p, source);
}

/** Subscribe to changes not raised by `ignoreSource`. Returns an unsubscribe function. */
export function onProfileChange(fn, ignoreSource = null) {
  const handler = (e) => { if (ignoreSource && e.detail.source === ignoreSource) return; fn(getProfile(), e.detail.source); };
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('profilechange', handler);
  return () => window.removeEventListener('profilechange', handler);
}
