import type { PersistedAppState } from './types';

const STORAGE_KEY = 'vidya.goal-companion.state';

export function loadAppState(): PersistedAppState {
  if (typeof window === 'undefined') {
    return { blueprint: null, lastPreparedSessionId: null };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { blueprint: null, lastPreparedSessionId: null };
    }

    const parsed = JSON.parse(raw) as PersistedAppState;
    return {
      blueprint: parsed.blueprint ?? null,
      lastPreparedSessionId: parsed.lastPreparedSessionId ?? null,
    };
  } catch {
    return { blueprint: null, lastPreparedSessionId: null };
  }
}

export function saveAppState(state: PersistedAppState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
