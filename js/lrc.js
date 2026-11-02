// Lyrics timing: LRC parsing / formatting, and the karaoke "wipe" progress within a line.

const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parse pasted lyrics. Lines with [mm:ss.xx] tags get times; plain lines get t = null.
 *  Returns {lines:[{text, t}], timed:boolean}. Metadata tags ([ti:], [ar:], [offset:]) are honoured / dropped. */
export function parseLyrics(raw) {
  let offset = 0;
  const timed = [], plain = [];
  for (const rawLine of (raw || "").replace(/\r/g, "").split("\n")) {
    const meta = rawLine.match(/^\s*\[(ti|ar|al|by|offset|length|re|ve):([^\]]*)\]\s*$/i);
    if (meta) {
      if (meta[1].toLowerCase() === "offset") offset = (parseInt(meta[2], 10) || 0) / 1000;
      continue;
    }
    const times = [];
    let m;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(rawLine))) {
      const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
      times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
    }
    const text = rawLine.replace(TAG, "").trim();
    if (times.length) times.forEach(t => timed.push({ text, t }));
    else if (text) plain.push({ text, t: null });
  }
  if (timed.length) {
    // LRC offset: positive = lyrics appear earlier
    const lines = timed.map(l => ({ text: l.text, t: Math.max(0, +(l.t - offset).toFixed(2)) }))
      .sort((a, b) => a.t - b.t).filter(l => l.text);
    return { lines, timed: true };
  }
  return { lines: plain, timed: false };
}

export function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return "--:--";
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export const toLrc = lines => lines.map(l => `${l.t != null ? `[${fmtTime(l.t)}]` : ""}${l.text}`).join("\n");

/** Index of the line being sung at time `t` (-1 before the first line). */
export function currentIndex(lines, t) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t != null && lines[i].t <= t) idx = i; else if (lines[i].t != null && lines[i].t > t) break;
  }
  return idx;
}

/** How far (0..1) the wipe has gone through line i at time t. A line "lasts" until the next line
 *  starts, but never longer than ~0.45 s per character (so long instrumental gaps don't slow the wipe). */
export function lineProgress(lines, i, t, duration = null) {
  if (i < 0 || lines[i]?.t == null) return 0;
  const start = lines[i].t;
  const next = lines.slice(i + 1).find(l => l.t != null)?.t ?? (duration || start + 6);
  const chars = [...(lines[i].text || "")].filter(c => c.trim()).length || 1;
  const len = Math.max(0.6, Math.min(next - start, chars * 0.45 + 0.8));
  return Math.max(0, Math.min(1, (t - start) / len));
}
