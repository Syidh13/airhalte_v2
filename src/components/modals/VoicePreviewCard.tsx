"use client";

import { useRef, useState } from "react";
import {
  speakAnnouncement,
  setVoiceGender,
  type VoiceGender,
} from "@/lib/voicePreview";

interface VoicePreviewCardProps {
  kicker: string;
  halteName: string;
  brandValue: string;
  channels: string[];
  emptyPlaceholder?: string;
  onUnsupported: () => void;
}

export default function VoicePreviewCard({
  kicker,
  halteName,
  brandValue,
  channels,
  emptyPlaceholder = "Nama brand Anda",
  onUnsupported,
}: VoicePreviewCardProps) {
  const [gender, setGender] = useState<VoiceGender>("female");
  const btnRef = useRef<HTMLButtonElement>(null);

  const trimmed = brandValue.trim();
  const slotEmpty = !trimmed;

  const handlePlay = () => {
    speakAnnouncement({
      halteName,
      brandName: trimmed,
      btnEl: btnRef.current,
      onUnsupported,
    });
  };

  const handleGenderClick = (g: VoiceGender) => {
    setGender(g);
    setVoiceGender(g);
  };

  return (
    <div className="voice-preview">
      <div className="voice-preview-head">
        <span className="voice-preview-kicker">🔊 {kicker}</span>
      </div>
      <div className="voice-preview-script">
        &ldquo;Pemberhentian berikutnya. {halteName},{" "}
        <span className={`brand-slot ${slotEmpty ? "empty" : ""}`}>
          {slotEmpty ? emptyPlaceholder : trimmed}
        </span>
        . Mohon bersiap untuk turun.&rdquo;
      </div>
      <div className="voice-preview-controls">
        <button
          ref={btnRef}
          className="voice-play-btn"
          onClick={handlePlay}
          type="button"
        >
          <span className="icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          Putar suara
        </button>
        <div className="voice-options">
          <button
            type="button"
            className={`voice-opt ${gender === "female" ? "active" : ""}`}
            onClick={() => handleGenderClick("female")}
          >
            Perempuan
          </button>
          <button
            type="button"
            className={`voice-opt ${gender === "male" ? "active" : ""}`}
            onClick={() => handleGenderClick("male")}
          >
            Laki-laki
          </button>
        </div>
      </div>
      {channels.length > 0 && (
        <div className="voice-channels">
          {channels.map((c) => (
            <span className="voice-channel" key={c}>
              <span className="ch-dot" />
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
