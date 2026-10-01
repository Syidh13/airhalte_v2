"use client";

import { useCallback, useSyncExternalStore } from "react";

import { isLoggedIn as authIsLoggedIn } from "./auth";

const FAVORITES_KEY = "airhalte:favorites";
const FAVORITES_EVENT = "airhalte:favorites-changed";
const EMPTY: string[] = [];

export function isLoggedIn(): boolean {
  return authIsLoggedIn();
}

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(FAVORITES_KEY);
  } catch {
    return null;
  }
}

function parseFavorites(raw: string | null): string[] {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function readFavorites(): string[] {
  return parseFavorites(readRaw());
}

function writeFavorites(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    /* storage penuh / diblokir */
  }
  window.dispatchEvent(new CustomEvent(FAVORITES_EVENT));
}

// Snapshot untuk useSyncExternalStore harus stabil: array yang sama selama
// isi localStorage tidak berubah.
let snapshotRaw: string | null = null;
let snapshotIds: string[] = EMPTY;

function getSnapshot(): string[] {
  const raw = readRaw();
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshotIds = parseFavorites(raw);
  }
  return snapshotIds;
}

function subscribe(cb: () => void) {
  window.addEventListener(FAVORITES_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(FAVORITES_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useFavorites() {
  // Server & render pertama: daftar kosong (sama seperti sebelumnya), lalu
  // isi localStorage setelah hydrate.
  const ids = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const has = useCallback((id: string | number) => ids.includes(String(id)), [ids]);

  const toggle = useCallback((id: string | number) => {
    const sid = String(id);
    const current = readFavorites();
    const next = current.includes(sid)
      ? current.filter((x) => x !== sid)
      : [...current, sid];
    writeFavorites(next);
    return next.includes(sid);
  }, []);

  const remove = useCallback((id: string | number) => {
    const sid = String(id);
    writeFavorites(readFavorites().filter((x) => x !== sid));
  }, []);

  return { ids, has, toggle, remove };
}
