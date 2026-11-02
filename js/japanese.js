// Japanese text processing: tokenizing (kuromoji), furigana placement and Hepburn romaji.
// Everything runs in the browser; the ~12 MB dictionary is fetched once and cached by the service worker.

const KUROMOJI_JS = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js";
const DICT_PATH = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";

let tokenizerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.kuromoji) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("無法載入日文分析程式（請確認網路）"));
    document.head.appendChild(s);
  });
}

export function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = loadScript(KUROMOJI_JS).then(() => new Promise((resolve, reject) => {
      window.kuromoji.builder({ dicPath: DICT_PATH }).build((err, t) => err ? reject(err) : resolve(t));
    }));
    tokenizerPromise.catch(() => { tokenizerPromise = null; });
  }
  return tokenizerPromise;
}

// ---------------------------------------------------------------- kana helpers
export const kataToHira = s => (s || "").replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hasKanji = s => /[\u3400-\u9fff\uf900-\ufaff々〆ヶ]/.test(s);
const isKana = c => /[\u3041-\u309f\u30a0-\u30ff]/.test(c);

/** Split a word into ruby segments: [{text, rt}] where rt is only set over kanji runs.
 *  食べる/たべる -> [{食,た},{べる}] ; 取り扱い/とりあつかい -> [{取,と},{り},{扱,あつか},{い}] */
export function rubySegments(surface, reading) {
  const r = kataToHira(reading || "");
  if (!hasKanji(surface) || !r || r === "*") return [{ text: surface, rt: null }];
  // runs of kanji vs kana
  const runs = [];
  for (const ch of surface) {
    const k = isKana(ch) ? "kana" : "kanji";
    if (runs.length && runs[runs.length - 1].k === k) runs[runs.length - 1].t += ch;
    else runs.push({ k, t: ch });
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = "^" + runs.map(x => x.k === "kanji" ? "(.+?)" : `(${esc(kataToHira(x.t))})`).join("") + "$";
  const m = r.match(new RegExp(pattern));
  if (!m) return [{ text: surface, rt: r }];
  return runs.map((x, i) => ({ text: x.t, rt: x.k === "kanji" ? m[i + 1] : null }));
}

// ---------------------------------------------------------------- romaji (Hepburn)
const BASE = {
  あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so", た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo", や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
};
const DIGRAPH = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho", しぇ: "she",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho", ちぇ: "che", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo", じぇ: "je", ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo", ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
  うぃ: "wi", うぇ: "we", うぉ: "wo", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo", つぁ: "tsa",
};

export function kanaToRomaji(kana) {
  const s = kataToHira(kana);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i], pair = s.slice(i, i + 2);
    if (c === "っ") {                        // sokuon: double the next consonant
      const next = DIGRAPH[s.slice(i + 1, i + 3)] || BASE[s[i + 1]] || "";
      out += next.startsWith("ch") ? "t" : (next[0] && !"aiueon".includes(next[0]) ? next[0] : "");
      continue;
    }
    if (c === "ー") { const v = out.match(/[aiueo](?!.*[aiueo])/); out += v ? v[0] : ""; continue; }
    if (DIGRAPH[pair]) { out += DIGRAPH[pair]; i++; continue; }
    if (c === "ん") { out += /[aiueoy]/.test(BASE[s[i + 1]]?.[0] || "") ? "n'" : "n"; continue; }
    out += BASE[c] ?? c;
  }
  return out;
}

// ---------------------------------------------------------------- tokens -> words
const POS_ZH = { 名詞: "名詞", 動詞: "動詞", 形容詞: "形容詞", 副詞: "副詞", 助詞: "助詞", 助動詞: "助動詞",
  連体詞: "連體詞", 接続詞: "連接詞", 感動詞: "感嘆詞", 接頭詞: "接頭詞", 記号: "符號", フィラー: "語氣詞" };
const PARTICLE_ROMAJI = { は: "wa", へ: "e", を: "o" };

/** One display word per token: {surface, reading(hira), romaji, pos, base, segs, content} */
export function analyzeLine(tokenizer, text) {
  const words = [];
  for (const t of tokenizer.tokenize(text)) {
    const surface = t.surface_form;
    if (!surface.trim()) { words.push({ surface, space: true }); continue; }
    const reading = t.reading && t.reading !== "*" ? kataToHira(t.reading) : (isKana(surface[0]) ? kataToHira(surface) : "");
    const pos = t.pos;
    let romaji = reading ? kanaToRomaji(reading) : surface;
    if (pos === "助詞" && PARTICLE_ROMAJI[surface]) romaji = PARTICLE_ROMAJI[surface];
    words.push({
      surface, reading, romaji, pos: POS_ZH[pos] || pos, posDetail: t.pos_detail_1,
      base: t.basic_form && t.basic_form !== "*" ? t.basic_form : surface,
      segs: rubySegments(surface, reading),
      content: ["名詞", "動詞", "形容詞", "副詞", "形容動詞", "連体詞", "感動詞"].includes(pos) && pos !== "記号",
      // conjugation endings / auxiliaries belong to the previous word in romaji (こすっ+て -> kosutte)
      attach: pos === "助動詞" || (pos === "助詞" && t.pos_detail_1 === "接続助詞")
        || (pos === "動詞" && t.pos_detail_1 === "接尾") || (pos === "名詞" && t.pos_detail_1 === "接尾"),
    });
  }
  // attach auxiliaries / conjugation endings to the preceding word for natural romaji spacing
  return words;
}

/** Romaji line with word spacing; particles and auxiliaries are kept as separate words like most lyric sites. */
export function romajiLine(words) {
  const groups = [];
  for (const w of words) {
    if (w.space || w.pos === "符號") continue;
    const prev = groups[groups.length - 1];
    if (w.attach && prev && prev.reading) { prev.reading += w.reading; prev.parts.push(w); }
    else groups.push({ reading: w.reading, parts: [w] });
  }
  return groups.map(g => g.parts.length === 1 || !g.reading ? g.parts.map(p => p.romaji).join("") : kanaToRomaji(g.reading))
    .join(" ").replace(/\s+([,.!?、。！？])/g, "$1").trim();
}
