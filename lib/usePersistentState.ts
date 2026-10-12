"use client";

import { useCallback, useSyncExternalStore } from "react";

// Tiny localStorage-backed state, shared by every component using the same key
// (so e.g. the guess-pool setting is the same on every page).

const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, unknown>();

function read<T>(key: string, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T;
  let value = fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    // Storage unavailable or corrupt: fall back to the default.
  }
  memory.set(key, value);
  return value;
}

function write<T>(key: string, value: T) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota / privacy-mode errors; the in-memory value still works.
  }
  listeners.get(key)?.forEach((l) => l());
}

export function usePersistentState<T>(key: string, fallback: T): [T, (value: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(listener);
      return () => listeners.get(key)!.delete(listener);
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = read(key, fallback);
      write(key, typeof next === "function" ? (next as (p: T) => T)(prev) : next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}
