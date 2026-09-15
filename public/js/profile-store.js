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

/** Throws with a plain-English message on anything that is not a profile. */
export function importProfileJSON(text, source = 'import') {
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
