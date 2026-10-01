"use client";

import { useSyncExternalStore } from "react";

// ============================================================================
// THEME — light / dark toggle persisted in localStorage.
// The `dark` class on <html> is the single source of truth for CSS rules
// (see `html.dark { ... }` block in globals.css). An inline script in the
// root layout applies the class before hydration to avoid a white flash.
// ============================================================================

export type Theme = "light" | "dark";

const STORAGE_KEY = "airhalte_theme";
const THEME_EVENT = "airhalte:theme-changed";

export function getTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    return (window.localStorage.getItem(STORAGE_KEY) as Theme) || "light";
  } catch {
    return "light";
  }
}

/**
 * Persist the theme choice, sync the `dark` class on <html>, and broadcast
 * a custom event so subscribers (charts, map style, etc.) can re-render.
 */
export function setTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage quota / private mode — still update the DOM so it works for
    // the current tab.
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.dispatchEvent(new CustomEvent(THEME_EVENT));
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/**
 * React hook backed by useSyncExternalStore — returns the live theme and
 * re-renders subscribers on any change (this tab via custom event, other
 * tabs via the native `storage` event). Server snapshot is always "light"
 * to match the unhydrated DOM (which lacks the `dark` class until the
 * inline script in <head> runs).
 */
export function useTheme(): Theme {
  return useSyncExternalStore<Theme>(
    (cb) => {
      window.addEventListener(THEME_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(THEME_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    getTheme,
    () => "light"
  );
}
