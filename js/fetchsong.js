// One-step import: YouTube link -> video title/channel (noembed) -> best matching timed lyrics (LRCLIB).
// Lyrics are fetched at runtime from LRCLIB's public API into this browser only; nothing is bundled with the app.

const NOEMBED = id => `https://noembed.com/embed?url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`;
const LRCLIB = "https://lrclib.net/api/search";

export async function videoInfo(id) {
  const r = await fetch(NOEMBED(id));
  if (!r.ok) throw new Error("讀不到這支影片的資訊");
  const d = await r.json();
  if (d.error) throw new Error("找不到這支影片（可能是私人影片或網址錯誤）");
  return { title: d.title || "", channel: d.author_name || "" };
}

// ---------------------------------------------------------------- guessing artist / track from a video title
const NOISE = [
  /official\s*(music\s*)?(video|audio|mv|lyric video|visualizer)/gi, /\b(music video|lyric video|lyrics?|mv|pv|full ver\.?|full version|4k|hd|hq|remaster(ed)?)\b/gi,
  /(公式|オフィシャル)?\s*(ミュージックビデオ|MV|PV|リリックビデオ|歌詞付き?|フル)/g, /(中字|中文字幕|中日字幕|歌詞|動態歌詞|完整版)/g,
];
const BRACKETS = /[【\[（(［〔＜<][^】\]）)］〕＞>]*[】\]）)］〕＞>]/g;

export function clean(s) {
  let t = s || "";
  NOISE.forEach(re => { t = t.replace(re, " "); });
  return t.replace(/[|｜\/]+$/, "").replace(/\s{2,}/g, " ").trim().replace(/^[-–—:：\s]+|[-–—:：\s]+$/g, "");
}

export function cleanChannel(c) {
  // only standalone words: "Official髭男dism" keeps its name, "Sora Band Official" loses the suffix
  return (c || "").replace(/\s*-\s*Topic$/i, "").replace(/(^|\s)(official|channel|youtube|music)(?=\s|$)/gi, " ")
    .replace(/(オフィシャル|公式)(チャンネル|YouTube)?/g, "").replace(/VEVO$/i, "").replace(/\s{2,}/g, " ").trim();
}

/** Candidate {track, artist} pairs, most likely first. */
export function guess(title, channel) {
  const out = [];
  const add = (track, artist) => {
    track = clean(track); artist = cleanChannel(clean(artist || ""));
    if (track && !out.some(x => x.track === track && x.artist === artist)) out.push({ track, artist });
  };
  const ch = cleanChannel(channel);
  const quoted = (title || "").match(/[「『"“]([^」』"”]+)[」』"”]/);
  if (quoted) {
    const before = title.slice(0, quoted.index).replace(BRACKETS, " ");
    add(quoted[1], before.trim() || ch);
    add(quoted[1], ch);
  }
  const noBr = (title || "").replace(BRACKETS, " ");
  const dash = noBr.split(/\s+[-–—|｜／/]\s+|\s*[-–—]\s+/);
  if (dash.length >= 2) {
    add(dash.slice(1).join(" "), dash[0]);      // "Artist - Track"
    add(dash[0], dash.slice(1).join(" "));      // "Track - Artist"
  }
  add(noBr, ch);
  add(noBr, "");
  return out;
}

// ---------------------------------------------------------------- scoring LRCLIB results
const norm = s => (s || "").toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");

function overlap(a, b) {               // share of `a`'s characters (bigrams) found in `b`
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (b.includes(a) || a.includes(b)) return 1;
  const grams = s => new Set([...s].map((c, i) => s.slice(i, i + 2)).filter(g => g.length === 2));
  const A = grams(a), B = grams(b);
  if (!A.size) return 0;
  let n = 0;
  A.forEach(g => { if (B.has(g)) n++; });
  return n / A.size;
}

const VARIANT = /(inst(rumental)?|off\s*vocal|karaoke|english\s*ver|tv\s*size|remix|acoustic|live|cover)/i;

export function score(item, g, videoTitle, duration = 0) {
  let s = 0;
  s += 3 * overlap(item.trackName, g.track);
  s += g.artist ? 1.5 * overlap(item.artistName, g.artist) : 0;
  s += 1 * overlap(item.trackName + " " + item.artistName, videoTitle);
  if (item.syncedLyrics) s += 2;
  if (item.instrumental || !(item.syncedLyrics || item.plainLyrics)) s -= 10;
  const v = (item.trackName || "").match(VARIANT);
  if (v && !new RegExp(v[1], "i").test(videoTitle)) s -= 2.5;   // "(inst)" etc. only if the video is that version
  if (duration && item.duration) s -= Math.min(2, Math.abs(item.duration - duration) / 15);
  return s;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(params) {
  let status = 0;
  for (let attempt = 0; attempt < 3; attempt++) {   // LRCLIB sometimes answers 429/503 when busy
    try {
      const r = await fetch(`${LRCLIB}?${new URLSearchParams(params)}`);
      if (r.ok) return r.json();
      status = r.status;
      if (![429, 500, 502, 503, 504].includes(r.status)) break;
    } catch { status = -1; }
    await sleep(800 * (attempt + 1));
  }
  throw new Error(status === -1 ? "連不上歌詞資料庫（請確認網路）" : `歌詞資料庫暫時忙碌（${status}），請稍後再試`);
}

/** Best lyrics for a video: {best, candidates, guessed}. `best` is null if nothing usable was found. */
export async function findLyrics(videoTitle, channel, duration = 0) {
  const guesses = guess(videoTitle, channel);
  const seen = new Map();
  let lastError = null, ok = 0;
  for (const g of guesses.slice(0, 4)) {
    const queries = [g.artist ? { track_name: g.track, artist_name: g.artist } : null, { q: `${g.track} ${g.artist}`.trim() }].filter(Boolean);
    for (const q of queries) {
      let list = [];
      try { list = await search(q); ok++; } catch (e) { lastError = e; continue; }
      for (const it of list) {
        const sc = Math.max(...guesses.slice(0, 4).map(gg => score(it, gg, videoTitle, duration)));
        if (!seen.has(it.id) || seen.get(it.id).score < sc) seen.set(it.id, { ...it, score: sc });
      }
      const top = [...seen.values()].sort((a, b) => b.score - a.score)[0];
      if (top && top.syncedLyrics && top.score >= 5.5) return pack(seen, guesses);   // confident: stop early
    }
  }
  if (!ok && lastError) throw lastError;
  return pack(seen, guesses);
}

function pack(seen, guesses) {
  const candidates = [...seen.values()].filter(x => x.syncedLyrics || x.plainLyrics).sort((a, b) => b.score - a.score).slice(0, 8);
  const best = candidates[0] && candidates[0].score >= 2.5 ? candidates[0] : null;
  return { best, candidates, guessed: guesses[0] || null };
}

/** Free-text search for the "not this song?" picker. */
export async function searchFree(q) {
  const list = await search({ q });
  return list.filter(x => x.syncedLyrics || x.plainLyrics).slice(0, 10);
}
