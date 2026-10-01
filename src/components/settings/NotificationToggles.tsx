// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

import { useCallback, useSyncExternalStore } from "react";
import Switch from "./Switch";

export interface NotifItem {
  key: string;
  label: string;
  sub?: string;
}

interface NotificationTogglesProps {
  storageKey: string;
  items: NotifItem[];
}

const NOTIF_EVENT = "airhalte:notif-changed";

// Per-(storageKey) snapshot cache so useSyncExternalStore.getSnapshot returns
// a stable reference until something actually changes.
const snapshotCache = new Map<
  string,
  { signature: string; value: Record<string, boolean> }
>();

function readAll(storageKey: string, items: NotifItem[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  if (typeof window === "undefined") {
    for (const it of items) next[it.key] = true;
    return next;
  }
  for (const it of items) {
    const raw = window.localStorage.getItem(`${storageKey}:${it.key}`);
    next[it.key] = raw === null ? true : raw === "1";
  }
  return next;
}

function getSnapshot(
  storageKey: string,
  items: NotifItem[]
): Record<string, boolean> {
  const fresh = readAll(storageKey, items);
  // Signature lets us return the same object across calls when nothing changed.
  const signature = items.map((it) => `${it.key}=${fresh[it.key] ? 1 : 0}`).join("|");
  const cached = snapshotCache.get(storageKey);
  if (cached && cached.signature === signature) return cached.value;
  snapshotCache.set(storageKey, { signature, value: fresh });
  return fresh;
}

/**
 * Generic notification preference list. Each item is a labeled toggle that
 * persists to localStorage under `${storageKey}:${item.key}`. Defaults to ON
 * when no value is stored yet. Reads via useSyncExternalStore so values are
 * correct on first render and stay reactive across tabs / components.
 */
export default function NotificationToggles({
  storageKey,
  items,
}: NotificationTogglesProps) {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener(NOTIF_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(NOTIF_EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  }, []);

  const state = useSyncExternalStore<Record<string, boolean>>(
    subscribe,
    () => getSnapshot(storageKey, items),
    () => {
      const init: Record<string, boolean> = {};
      for (const it of items) init[it.key] = true;
      return init;
    }
  );

  const setOne = (k: string, v: boolean) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${storageKey}:${k}`, v ? "1" : "0");
    snapshotCache.delete(storageKey);
    window.dispatchEvent(new CustomEvent(NOTIF_EVENT));
  };

  return (
    <div>
      {items.map((it) => (
        <div key={it.key} className="set-toggle-row">
          <div className="set-toggle-text">
            <div className="set-toggle-label">{it.label}</div>
            {it.sub && <div className="set-toggle-sub">{it.sub}</div>}
          </div>
          <Switch
            checked={state[it.key] ?? true}
            onChange={(v) => setOne(it.key, v)}
            label={it.label}
          />
        </div>
      ))}
    </div>
  );
}
