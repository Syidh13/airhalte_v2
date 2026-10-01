// Web Speech API wrapper — Transjakarta announcer simulation.
// Template script (DO NOT EDIT):
//   "Pemberhentian berikutnya. {HalteName}, {BrandName}. Mohon bersiap untuk turun."

export type VoiceGender = "female" | "male";

const STATE = {
  voices: [] as SpeechSynthesisVoice[],
  loaded: false,
  preferredGender: "female" as VoiceGender,
  rate: 0.92,
  pitch: 1.0,
  currentlyPlaying: null as HTMLElement | null,
};

function loadVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const all = window.speechSynthesis.getVoices();
  if (all && all.length) {
    STATE.voices = all;
    STATE.loaded = true;
  }
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

const FEMALE_HINTS =
  /female|wanita|perempuan|samantha|siri|karen|tessa|moira|veena|fiona|gadis|zira|hazel/i;
const MALE_HINTS =
  /male|pria|laki|alex|daniel|fred|aaron|tom|rishi|david|mark|george|guy|james/i;

function byLang(prefix: string): SpeechSynthesisVoice[] {
  return STATE.voices.filter(
    (v) => v.lang && v.lang.toLowerCase().startsWith(prefix)
  );
}

function findGendered(
  pool: SpeechSynthesisVoice[],
  gender: VoiceGender
): SpeechSynthesisVoice | null {
  const wantHints = gender === "male" ? MALE_HINTS : FEMALE_HINTS;
  const avoidHints = gender === "male" ? FEMALE_HINTS : MALE_HINTS;
  const m = pool.find((v) => wantHints.test(v.name) && !avoidHints.test(v.name));
  return m ?? null;
}

function pickVoice(gender: VoiceGender): SpeechSynthesisVoice | null {
  if (!STATE.voices.length) return null;

  const idVoices = byLang("id");
  const msVoices = byLang("ms");
  const enVoices = byLang("en");

  if (gender === "female") {
    // Per spec: prefer female-hinted id voice, else the default id voice
    // (which on most platforms ships as a female speaker), then fall back
    // through ms/en female-hinted voices.
    return (
      findGendered(idVoices, "female") ??
      idVoices[0] ??
      findGendered(msVoices, "female") ??
      msVoices[0] ??
      findGendered(enVoices, "female") ??
      enVoices[0] ??
      STATE.voices[0] ??
      null
    );
  }

  // male: keep the Indonesian accent at all costs — prefer a real male id voice,
  // else reuse the default id voice (pitch differentiation in speakAnnouncement
  // makes it sound male-ish while preserving id-ID pronunciation). Only fall
  // through to ms/en when no Indonesian voice exists on this platform.
  return (
    findGendered(idVoices, "male") ??
    idVoices[0] ??
    findGendered(msVoices, "male") ??
    msVoices[0] ??
    findGendered(enVoices, "male") ??
    enVoices[0] ??
    STATE.voices[0] ??
    null
  );
}

export interface SpeakOptions {
  halteName: string;
  brandName?: string;
  btnEl?: HTMLElement | null;
  onUnsupported?: () => void;
}

export function speakAnnouncement({
  halteName,
  brandName,
  btnEl,
  onUnsupported,
}: SpeakOptions) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onUnsupported?.();
    return;
  }

  window.speechSynthesis.cancel();
  if (STATE.currentlyPlaying) {
    STATE.currentlyPlaying.classList.remove("playing");
  }

  const cleanBrand = (brandName || "").trim();
  const brandPart = cleanBrand ? `, ${cleanBrand}` : "";
  const script = `Pemberhentian berikutnya. ${halteName}${brandPart}. Mohon bersiap untuk turun.`;

  const utter = new SpeechSynthesisUtterance(script);
  const voice = pickVoice(STATE.preferredGender);
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  } else {
    utter.lang = "id-ID";
  }
  utter.rate = STATE.rate;
  // Pitch differentiation: lower for male, slightly higher for female. Acts as
  // a safety net when the platform lacks a true male/female voice variant.
  const isMaleVoice = voice ? MALE_HINTS.test(voice.name) && !FEMALE_HINTS.test(voice.name) : false;
  if (STATE.preferredGender === "male") {
    // Sweet spot for the female id-ID voice forced into a male register:
    // pitch 0.1 sounds robotic/childlike, pitch 0.6+ still sounds feminine.
    // ~0.4 with a noticeably slower, deliberate cadence reads as a mature
    // adult male announcer (think station PA voice).
    utter.pitch = isMaleVoice ? 0.85 : 0.4;
    if (!isMaleVoice) utter.rate = 0.78;
  } else {
    utter.pitch = 1.1;
  }
  utter.volume = 1.0;

  if (btnEl) {
    btnEl.classList.add("playing");
    STATE.currentlyPlaying = btnEl;
  }

  utter.onend = () => {
    if (btnEl) btnEl.classList.remove("playing");
    STATE.currentlyPlaying = null;
  };
  utter.onerror = () => {
    if (btnEl) btnEl.classList.remove("playing");
    STATE.currentlyPlaying = null;
  };

  setTimeout(() => window.speechSynthesis.speak(utter), 50);
}

export function setVoiceGender(gender: VoiceGender) {
  STATE.preferredGender = gender;
}

export function getVoiceGender(): VoiceGender {
  return STATE.preferredGender;
}

export function isVoiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
