// Local storage: songs, vocabulary, practice log and settings live only on this device (export/import for backup).

const KEY = "jpk.v1";
const DEFAULT = {
  songs: [],          // {id, title, artist, youtubeId, duration, offset, lines:[{text,t}], analysis, plays, practiceSec, created}
  vocab: [],          // {id, surface, reading, romaji, base, meaning, pos, songId, line, due, interval, ease, reps, lapses, created}
  log: {},            // {"YYYY-MM-DD": {sec, plays, reviews}}
  settings: { geminiKey: "", showRomaji: true, showFurigana: true, showZh: true, rate: 1, fontScale: 1 },
};

let db = null;

export function load() {
  if (db) return db;
  try { db = { ...structuredClone(DEFAULT), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { db = structuredClone(DEFAULT); }
  db.settings = { ...DEFAULT.settings, ...(db.settings || {}) };
  return db;
}

export function save() { localStorage.setItem(KEY, JSON.stringify(db)); }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function song(id) { return load().songs.find(s => s.id === id); }

export function upsertSong(s) {
  const d = load();
  const i = d.songs.findIndex(x => x.id === s.id);
  if (i >= 0) d.songs[i] = s; else d.songs.unshift(s);
  save();
}

export function deleteSong(id) {
  const d = load();
  d.songs = d.songs.filter(s => s.id !== id);
  save();
}

export function logPractice(sec = 0, plays = 0, reviews = 0) {
  const d = load(), k = today();
  const e = d.log[k] || (d.log[k] = { sec: 0, plays: 0, reviews: 0 });
  e.sec += sec; e.plays += plays; e.reviews += reviews;
  save();
}

/** Consecutive days (ending today or yesterday) with any practice. */
export function streak(log = load().log) {
  let n = 0;
  const d = new Date();
  if (!log[today(d)]) d.setDate(d.getDate() - 1);
  while (log[today(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function exportJson() { return JSON.stringify(load(), null, 1); }

export function importJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.songs)) throw new Error("不是這個 App 匯出的檔案");
  db = { ...structuredClone(DEFAULT), ...data, settings: { ...DEFAULT.settings, ...(data.settings || {}) } };
  save();
}
