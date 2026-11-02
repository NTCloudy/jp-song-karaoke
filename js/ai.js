// AI study notes for a song (Gemini API, called directly from the browser with your own key).
// One request per song: natural Traditional-Chinese translation, grammar notes and word meanings per line.

const MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"];
const URL = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          i: { type: "INTEGER" },
          zh: { type: "STRING" },
          notes: { type: "STRING" },
          words: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { w: { type: "STRING" }, base: { type: "STRING" }, r: { type: "STRING" }, m: { type: "STRING" } },
              required: ["w", "base", "r", "m"],
            },
          },
        },
        required: ["i", "zh", "notes", "words"],
      },
    },
  },
  required: ["lines"],
};

export async function analyzeSong(key, title, lines) {
  if (!key) throw new Error("請先到「設定」貼上 Gemini API 金鑰");
  const numbered = lines.map((l, i) => `${i}. ${l.text}`).join("\n");
  const prompt = `你是日文老師。以下是使用者正在學唱的日文歌「${title}」的歌詞（每行有編號）。
請逐行輸出（i 為行號，所有行都要有）：
- zh：自然、口語的繁體中文翻譯（台灣用語）
- notes：這行值得學的文法或用法，1～2 點、簡短（繁體中文）；沒有特別的就空字串
- words：這行的實詞（名詞、動詞、形容詞、副詞等，助詞不用）：w=歌詞中的寫法、base=辭書形、r=辭書形的平假名讀音、m=在這句裡的中文意思（簡短）

歌詞：
${numbered}`;
  let last = null;
  for (const model of MODELS) {
    try {
      const r = await fetch(URL(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, responseMimeType: "application/json", responseSchema: SCHEMA },
        }),
      });
      if (r.status === 400 || r.status === 403) {
        const t = await r.text();
        if (/API key|PERMISSION|API_KEY/i.test(t)) throw new Error("Gemini 金鑰無效，請到「設定」重新貼上");
        last = new Error(`${model}: ${r.status}`);
        continue;
      }
      if (!r.ok) { last = new Error(`${model}: HTTP ${r.status}`); continue; }
      const data = await r.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      const parsed = JSON.parse(text);
      const out = lines.map(() => ({ zh: "", notes: "", words: [] }));
      for (const l of parsed.lines || []) if (l.i >= 0 && l.i < out.length) out[l.i] = { zh: l.zh, notes: l.notes, words: l.words || [] };
      return { lines: out, model, at: new Date().toISOString() };
    } catch (e) {
      if (/金鑰無效/.test(e.message)) throw e;
      last = e;
    }
  }
  throw new Error(`AI 解析失敗：${last?.message || "未知錯誤"}`);
}

/** Meaning of a word in a given line from the AI notes (matches surface or dictionary form). */
export function meaningFor(analysis, lineIdx, word) {
  const words = analysis?.lines?.[lineIdx]?.words || [];
  const hit = words.find(x => x.w === word.surface || x.base === word.base || x.w.includes(word.surface) || word.surface.includes(x.w));
  return hit || null;
}
