// Background worker: builds the kuromoji tokenizer (dictionary download + decompression is heavy)
// off the main thread, then tokenizes lyric lines on request.
/* global kuromoji */
importScripts("https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js");

const ready = new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/" })
    .build((err, t) => (err ? reject(err) : resolve(t)));
});

const FIELDS = ["surface_form", "pos", "pos_detail_1", "basic_form", "reading"];

self.onmessage = async e => {
  const { id, texts } = e.data;
  try {
    const t = await ready;
    const out = (texts || []).map(text => t.tokenize(text).map(tok => Object.fromEntries(FIELDS.map(f => [f, tok[f]]))));
    self.postMessage({ id, tokens: out });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
