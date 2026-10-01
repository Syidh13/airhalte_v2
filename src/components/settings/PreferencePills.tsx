"use client";

import { useState } from "react";
import { emitInfoToast } from "@/components/FavoriteToaster";
import { setTheme, useTheme, type Theme } from "@/lib/theme";

/**
 * Two preference rows: language + theme. Used by both /settings (portal) and
 * dashboard SettingsPage. Language toggle is still a "coming soon" stub;
 * theme toggle is wired live via @/lib/theme (persists to localStorage and
 * syncs the `dark` class on <html>).
 */
export default function PreferencePills() {
  const [lang] = useState<"id" | "en">("id");
  // Tema dibaca lewat useTheme() (useSyncExternalStore): server snapshot
  // "light" supaya cocok dengan SSR, lalu nilai localStorage setelah hydrate.
  // setTheme() menyiarkan event, jadi komponen ini ikut ter-render ulang.
  const currentTheme = useTheme();

  const handleTheme = (t: Theme) => {
    setTheme(t); // updates localStorage + html.dark class + broadcasts event
  };

  return (
    <>
      <div className="set-pref-row">
        <div className="set-pref-text">
          <div className="set-pref-label">Bahasa / Language</div>
          <div className="set-pref-sub">
            Bahasa antarmuka untuk seluruh aplikasi.
          </div>
        </div>
        <div className="set-pill-group" role="radiogroup" aria-label="Bahasa">
          <button
            type="button"
            role="radio"
            aria-checked={lang === "id"}
            className={`set-pill${lang === "id" ? " active" : ""}`}
          >
            🇮🇩 Indonesia
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={false}
            aria-disabled="true"
            className="set-pill disabled"
            onClick={() => emitInfoToast("Bahasa Inggris segera hadir")}
          >
            🇬🇧 English
            <span className="set-pill-soon">Segera hadir</span>
          </button>
        </div>
      </div>

      <div className="set-pref-row">
        <div className="set-pref-text">
          <div className="set-pref-label">Tampilan / Theme</div>
          <div className="set-pref-sub">
            Mode tampilan terang atau gelap.
          </div>
        </div>
        <div className="set-pill-group" role="radiogroup" aria-label="Tampilan">
          <button
            type="button"
            role="radio"
            aria-checked={currentTheme === "light"}
            className={`set-pill${currentTheme === "light" ? " active" : ""}`}
            onClick={() => handleTheme("light")}
          >
            ☀️ Terang
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={currentTheme === "dark"}
            className={`set-pill${currentTheme === "dark" ? " active" : ""}`}
            onClick={() => handleTheme("dark")}
          >
            🌙 Gelap
          </button>
        </div>
      </div>
    </>
  );
}
