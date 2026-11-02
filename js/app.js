import * as store from "./store.js";
import { getTokenizer, analyzeLine, romajiLine } from "./japanese.js";
import { parseLyrics, fmtTime, toLrc, currentIndex, lineProgress } from "./lrc.js";
import { createClock, youtubeId } from "./player.js";
import { analyzeSong, meaningFor } from "./ai.js";
import * as srs from "./srs.js";
import { DEMO } from "./demo.js";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = () => $("#view");
let cleanup = null;   // called when leaving a screen (stops players / timers)

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove("show"), ms);
}

function speak(text) {
  if (!("speechSynthesis" in window)) return toast("這個瀏覽器不支援朗讀");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

// ------------------------------------------------------------------ router
const routes = {
  "": showLibrary, edit: showEdit, sync: showSync, play: showPlay,
  vocab: showVocab, review: showReview, stats: showStats, settings: showSettings,
};

function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const [name, arg] = location.hash.replace(/^#\/?/, "").split("/");
  $$("nav a").forEach(a => a.classList.toggle("on", a.dataset.r === (name || "")));
  document.body.dataset.screen = name || "library";
  (routes[name] || showLibrary)(arg ? decodeURIComponent(arg) : "");
  window.scrollTo(0, 0);
}
const go = h => { location.hash = h; };

// ------------------------------------------------------------------ library
function dueCount() { return store.load().vocab.filter(v => srs.isDue(v)).length; }

function showLibrary() {
  const db = store.load();
  if (!db.songs.length && !db.demoAdded) {
    store.upsertSong({ ...structuredClone(DEMO), id: store.uid(), created: Date.now(), plays: 0, practiceSec: 0 });
    db.demoAdded = true;
    store.save();
  }
  const due = dueCount();
  view().innerHTML = `
    <div class="hero">
      <div><div class="big">🔥 ${store.streak()}</div><div class="muted">連續天數</div></div>
      <div><div class="big">${db.songs.length}</div><div class="muted">首歌</div></div>
      <a href="#/review" class="${due ? "due" : ""}"><div class="big">${due}</div><div class="muted">待複習單字</div></a>
    </div>
    <div class="row between"><h2>🎤 我的歌</h2><a class="btn primary" href="#/edit/new">＋ 新增歌曲</a></div>
    ${db.songs.map(s => {
      const timed = s.lines.length && s.lines.every(l => l.t != null);
      return `<div class="card song">
        <a class="grow" href="#/play/${s.id}">
          <div class="title">${esc(s.title)}</div>
          <div class="muted">${esc(s.artist || "")}${s.artist ? "・" : ""}${s.lines.length} 句・${s.youtubeId ? "▶ YouTube" : "🔇 無影片"}
            ${timed ? "" : "・<span class='warn'>還沒對時</span>"}${s.analysis ? "・🤖 已解析" : ""}</div>
          <div class="muted small">練習 ${s.plays || 0} 次・${Math.round((s.practiceSec || 0) / 60)} 分鐘</div>
        </a>
        <div class="col">
          <a class="btn small" href="#/${timed ? "play" : "sync"}/${s.id}">${timed ? "🎤 唱" : "⏱ 對時"}</a>
          <a class="btn small ghost" href="#/edit/${s.id}">編輯</a>
        </div>
      </div>`;
    }).join("") || `<p class="muted">還沒有歌，按「新增歌曲」貼上歌詞。</p>`}
    <p class="muted small">歌詞只存在這支手機／這台電腦的瀏覽器裡。換裝置前請到「設定」匯出備份。</p>`;
}

// ------------------------------------------------------------------ add / edit
function showEdit(id) {
  const s = id && id !== "new" ? store.song(id) : null;
  view().innerHTML = `
    <h2>${s ? "✏️ 編輯歌曲" : "＋ 新增歌曲"}</h2>
    <label>歌名<input id="f-title" value="${esc(s?.title || "")}" placeholder="歌名"></label>
    <label>歌手<input id="f-artist" value="${esc(s?.artist || "")}"></label>
    <label>YouTube 網址（選填，沒有就用無聲計時）<input id="f-yt" value="${esc(s?.youtubeId ? "https://youtu.be/" + s.youtubeId : "")}" placeholder="https://youtu.be/..."></label>
    <label>歌詞（一行一句。也可以貼有時間標記的 LRC，例如 <code>[00:12.30]歌詞</code>，就不用再對時）
      <textarea id="f-lyrics" rows="14" placeholder="把日文歌詞貼在這裡">${esc(s ? toLrc(s.lines) : "")}</textarea></label>
    <div class="row">
      <button class="primary" id="f-save">儲存</button>
      ${s ? `<button class="ghost danger" id="f-del">刪除這首歌</button>` : ""}
    </div>
    <p class="muted small">小技巧：網路上搜尋「歌名 LRC」常常找得到有時間標記的歌詞，貼上後就能直接唱。</p>`;
  $("#f-save").onclick = () => {
    const title = $("#f-title").value.trim();
    const { lines, timed } = parseLyrics($("#f-lyrics").value);
    if (!title) return toast("請輸入歌名");
    if (!lines.length) return toast("請貼上歌詞");
    const yt = $("#f-yt").value.trim();
    const vid = youtubeId(yt);
    if (yt && !vid) return toast("看不懂這個 YouTube 網址");
    const changedText = !s || s.lines.map(l => l.text).join("\n") !== lines.map(l => l.text).join("\n");
    const next = {
      ...(s || { id: store.uid(), created: Date.now(), plays: 0, practiceSec: 0, offset: 0 }),
      title, artist: $("#f-artist").value.trim(), youtubeId: vid,
      lines: timed ? lines : lines.map((l, i) => ({ text: l.text, t: s && !changedText ? s.lines[i]?.t ?? null : null })),
      analysis: changedText ? null : s?.analysis || null,
    };
    store.upsertSong(next);
    const ready = next.lines.every(l => l.t != null);
    toast(ready ? "已儲存" : "已儲存，接著幫歌詞對時");
    go(ready ? `#/play/${next.id}` : `#/sync/${next.id}`);
  };
  if (s) $("#f-del").onclick = () => { if (confirm(`刪除「${s.title}」？`)) { store.deleteSong(s.id); go("#/"); } };
}

// ------------------------------------------------------------------ shared player shell
async function mountClock(s, onTick) {
  const box = $("#video");
  if (s.youtubeId) box.innerHTML = `<div id="yt"></div>`;
  else box.innerHTML = `<div class="silent">🔇 無影片模式：用計時器跑歌詞</div>`;
  const clock = await createClock(s, $("#yt"));
  let raf = 0;
  const loop = () => { onTick(clock.time()); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  return { clock, stop: () => { cancelAnimationFrame(raf); clock.destroy(); } };
}

// ------------------------------------------------------------------ tap-to-sync
async function showSync(id) {
  const s = store.song(id);
  if (!s) return go("#/");
  let target = Math.max(0, s.lines.findIndex(l => l.t == null));
  if (s.lines.every(l => l.t != null)) target = 0;
  const times = s.lines.map(l => l.t);
  view().innerHTML = `
    <div class="row between"><h2>⏱ 對時：${esc(s.title)}</h2><a class="btn ghost small" href="#/play/${s.id}">完成</a></div>
    <p class="muted small">播放歌曲，每一句<b>開始唱的瞬間</b>按下大按鈕（電腦可以按空白鍵）。按錯了按「上一句」重錄。</p>
    <div id="video" class="video"></div>
    <div class="sync-now card"><div class="muted small">下一個要標記的句子</div><div id="sync-line" class="sync-line"></div>
      <div id="sync-time" class="muted"></div></div>
    <button id="tap" class="tap">👆 這句開始了</button>
    <div class="row wrap">
      <button id="play" class="primary">▶ 播放</button>
      <button id="back5">⏪ 5 秒</button>
      <button id="undo">↩ 上一句</button>
      <button id="restart" class="ghost">從頭重來</button>
      <button id="save" class="primary">💾 儲存</button>
    </div>
    <ol id="sync-list" class="sync-list"></ol>`;
  const render = () => {
    $("#sync-line").textContent = s.lines[target]?.text || "🎉 全部標記完成，按「儲存」";
    $("#sync-list").innerHTML = s.lines.map((l, i) =>
      `<li class="${i === target ? "on" : ""}" data-i="${i}"><span class="t">${fmtTime(times[i])}</span> ${esc(l.text)}</li>`).join("");
    $("#sync-list li.on")?.scrollIntoView({ block: "nearest" });
  };
  render();
  let shell;
  try {
    shell = await mountClock(s, t => { $("#sync-time").textContent = `播放位置 ${fmtTime(t)}`; });
  } catch (e) { toast(e.message, 5000); return; }
  const { clock } = shell;
  clock.onstate = p => { $("#play").textContent = p ? "⏸ 暫停" : "▶ 播放"; };
  const mark = () => {
    if (target >= s.lines.length) return;
    times[target] = +clock.time().toFixed(2);
    target++;
    render();
  };
  $("#tap").onclick = mark;
  $("#play").onclick = () => clock.playing ? clock.pause() : clock.play();
  $("#back5").onclick = () => clock.seek(clock.time() - 5);
  $("#undo").onclick = () => {
    if (target > 0) { target--; times[target] = null; clock.seek((times[target - 1] ?? 0) - 1); render(); }
  };
  $("#restart").onclick = () => { times.fill(null); target = 0; clock.seek(0); render(); };
  $("#sync-list").onclick = e => {               // tap a line to re-record from there
    const li = e.target.closest("li");
    if (!li) return;
    target = +li.dataset.i;
    for (let i = target; i < times.length; i++) times[i] = null;
    clock.seek((times[target - 1] ?? 0) - 1);
    render();
  };
  $("#save").onclick = () => {
    s.lines = s.lines.map((l, i) => ({ ...l, t: times[i] }));
    store.upsertSong(s);
    const missing = times.filter(t => t == null).length;
    toast(missing ? `已儲存（還有 ${missing} 句沒標記）` : "已儲存，可以開始唱了！");
    if (!missing) go(`#/play/${s.id}`);
  };
  const key = e => { if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); mark(); } };
  document.addEventListener("keydown", key);
  cleanup = () => { document.removeEventListener("keydown", key); shell.stop(); };
}

// ------------------------------------------------------------------ KTV player
function rubyHtml(w, li, wi, furigana) {
  if (w.space) return " ";
  const inner = w.segs.map(sg => sg.rt && furigana ? `<ruby>${esc(sg.text)}<rt>${esc(sg.rt)}</rt></ruby>` : esc(sg.text)).join("");
  return `<span class="w${w.content ? " c" : ""}" data-li="${li}" data-wi="${wi}">${inner}</span>`;
}

async function showPlay(id) {
  const s = store.song(id);
  if (!s) return go("#/");
  if (!s.lines.some(l => l.t != null)) return go(`#/sync/${id}`);
  const st = store.load().settings;
  view().innerHTML = `
    <div class="row between ktv-head"><div><div class="title">${esc(s.title)}</div><div class="muted small">${esc(s.artist || "")}</div></div>
      <div class="row"><a class="btn ghost small" href="#/sync/${s.id}">⏱ 對時</a><button class="small" id="ai">🤖 AI 解析</button></div></div>
    <div id="video" class="video"></div>
    <div id="stage" class="stage"><div class="loading">🈁 分析歌詞中…（第一次要下載日文字典，約 10 秒）</div></div>
    <div class="controls">
      <div class="row prog"><span id="cur">00:00</span><input id="seek" type="range" min="0" max="100" step="0.1" value="0"><span id="dur">--:--</span></div>
      <div class="row center">
        <button id="prev" title="上一句">⏮</button>
        <button id="play" class="primary round">▶</button>
        <button id="next" title="下一句">⏭</button>
        <button id="loop" title="重複這一句">🔁</button>
        <select id="rate">${[0.5, 0.75, 0.9, 1].map(r => `<option value="${r}" ${r === (st.rate || 1) ? "selected" : ""}>${r}x</option>`).join("")}</select>
      </div>
      <div class="row center toggles">
        <label><input type="checkbox" id="t-furi" ${st.showFurigana ? "checked" : ""}> 假名</label>
        <label><input type="checkbox" id="t-roma" ${st.showRomaji ? "checked" : ""}> 羅馬</label>
        <label><input type="checkbox" id="t-zh" ${st.showZh ? "checked" : ""}> 中文</label>
        <span class="muted small">時間微調 <button class="tiny" id="off-minus" title="歌詞早一點">−</button>
          <span id="off">${(s.offset || 0).toFixed(1)}s</span><button class="tiny" id="off-plus" title="歌詞晚一點">＋</button></span>
      </div>
    </div>
    <div id="sheet" class="sheet"></div>`;

  // ---- lyrics analysis (furigana / romaji / words)
  let lines;
  try {
    const tk = await getTokenizer();
    lines = s.lines.map(l => { const words = analyzeLine(tk, l.text); return { ...l, words, romaji: romajiLine(words) }; });
  } catch (e) {
    $("#stage").innerHTML = `<div class="loading">❌ ${esc(e.message)}</div>`;
    return;
  }

  const stage = $("#stage");
  const opts = () => ({ furi: $("#t-furi").checked, roma: $("#t-roma").checked, zh: $("#t-zh").checked });
  const lineBlock = (i, cls) => {
    if (i < 0 || i >= lines.length) return `<div class="ln ${cls} empty"></div>`;
    const o = opts(), L = lines[i];
    const jp = L.words.map((w, wi) => rubyHtml(w, i, wi, o.furi)).join("");
    const zh = s.analysis?.lines?.[i]?.zh;
    const body = `<div class="jp">${jp}</div>${o.roma ? `<div class="ro">${esc(L.romaji)}</div>` : ""}`;
    return `<div class="ln ${cls}" data-i="${i}">
      <div class="wipe"><div class="base">${body}</div><div class="fill" aria-hidden="true">${body}</div></div>
      ${o.zh && zh && cls === "now" ? `<div class="zh">${esc(zh)}</div>` : ""}</div>`;
  };
  let shown = null;
  const renderLines = idx => {
    stage.innerHTML = lineBlock(idx - 1, "prev") + lineBlock(Math.max(idx, 0) === idx ? idx : -1, "now")
      + lineBlock(idx + 1, "next") + lineBlock(idx + 2, "next2")
      + (idx < 0 ? `<div class="countdown">${lines[0].t > 3 ? "🎵 前奏中…" : ""}</div>` : "");
    // shrink long lines so they stay on one row (the wipe needs a single line)
    $$(".ln .wipe", stage).forEach(w => {
      w.style.fontSize = "";
      const max = stage.clientWidth - 8;
      if (w.scrollWidth > max) w.style.fontSize = `${Math.max(0.55, max / w.scrollWidth)}em`;
    });
    shown = idx;
  };

  // ---- playback
  let shell;
  try { shell = await mountClock(s, tick); } catch (e) { toast(e.message, 6000); return; }
  const { clock } = shell;
  clock.setRate(+$("#rate").value);
  let loopLine = -1, startedAt = null, practiced = 0, counted = false;
  clock.onstate = p => {
    $("#play").textContent = p ? "⏸" : "▶";
    if (p) { startedAt = performance.now(); if (!counted) { counted = true; s.plays = (s.plays || 0) + 1; store.upsertSong(s); store.logPractice(0, 1); } }
    else if (startedAt) { practiced += (performance.now() - startedAt) / 1000; startedAt = null; }
  };
  const dur = () => clock.getDuration() || (lines.at(-1).t + 8);

  function tick(raw) {
    if (!lines) return;
    const t = raw + (s.offset || 0);
    const idx = currentIndex(lines, t);
    if (loopLine >= 0) {
      const end = lines[loopLine + 1]?.t ?? dur();
      if (t >= end || t < lines[loopLine].t - 1.5) clock.seek(lines[loopLine].t - (s.offset || 0) - 0.3);
    }
    if (idx !== shown) renderLines(idx);
    const fill = $(".ln.now .fill", stage);
    if (fill) fill.style.clipPath = `inset(0 ${100 - lineProgress(lines, idx, t, dur()) * 100}% 0 0)`;
    const d = dur();
    $("#cur").textContent = fmtTime(raw).slice(0, 5);
    $("#dur").textContent = fmtTime(d).slice(0, 5);
    if (!tick.dragging) $("#seek").value = d ? (raw / d) * 100 : 0;
    if (!s.youtubeId && raw >= d && clock.playing) { clock.pause(); clock.seek(0); }
  }
  renderLines(-1);

  const jump = i => { i = Math.max(0, Math.min(lines.length - 1, i)); clock.seek(lines[i].t - (s.offset || 0) - 0.2); if (!clock.playing) clock.play(); };
  $("#play").onclick = () => clock.playing ? clock.pause() : clock.play();
  $("#prev").onclick = () => jump((shown ?? 0) - 1);
  $("#next").onclick = () => jump((shown ?? -1) + 1);
  $("#loop").onclick = () => {
    loopLine = loopLine >= 0 ? -1 : Math.max(0, shown);
    $("#loop").classList.toggle("on", loopLine >= 0);
    toast(loopLine >= 0 ? `🔁 重複第 ${loopLine + 1} 句` : "取消重複");
  };
  $("#rate").onchange = e => { clock.setRate(+e.target.value); store.load().settings.rate = +e.target.value; store.save(); };
  const seek = $("#seek");
  seek.oninput = () => { tick.dragging = true; };
  seek.onchange = () => { tick.dragging = false; clock.seek(seek.value / 100 * dur()); };
  ["furi", "roma", "zh"].forEach(k => $(`#t-${k}`).onchange = e => {
    const map = { furi: "showFurigana", roma: "showRomaji", zh: "showZh" };
    store.load().settings[map[k]] = e.target.checked; store.save(); renderLines(shown);
  });
  const nudge = d => { s.offset = +((s.offset || 0) + d).toFixed(1); $("#off").textContent = `${s.offset.toFixed(1)}s`; store.upsertSong(s); };
  $("#off-minus").onclick = () => nudge(-0.2);
  $("#off-plus").onclick = () => nudge(0.2);

  // ---- AI notes
  $("#ai").onclick = async () => {
    if (s.analysis && !confirm("已經解析過了，要重新解析嗎？")) return;
    const btn = $("#ai");
    btn.disabled = true; btn.textContent = "🤖 解析中…";
    try {
      s.analysis = await analyzeSong(store.load().settings.geminiKey, s.title, s.lines);
      store.upsertSong(s);
      toast("解析完成：中文翻譯、文法、單字意思都有了");
      renderLines(shown);
    } catch (e) { toast(e.message, 5000); if (/金鑰/.test(e.message)) setTimeout(() => go("#/settings"), 1500); }
    btn.disabled = false; btn.textContent = "🤖 AI 解析";
  };

  // ---- tap a word / a line
  stage.onclick = e => {
    const w = e.target.closest(".w");
    const ln = e.target.closest(".ln");
    if (w) return openWord(+w.dataset.li, +w.dataset.wi);
    if (ln && ln.dataset.i != null && !ln.classList.contains("now")) jump(+ln.dataset.i);
  };
  function openWord(li, wi) {
    const word = lines[li].words[wi];
    const ai = meaningFor(s.analysis, li, word);
    const notes = s.analysis?.lines?.[li]?.notes;
    const inVocab = store.load().vocab.some(v => v.base === word.base && v.surface === word.surface);
    const sheet = $("#sheet");
    sheet.innerHTML = `<div class="sheet-card">
      <div class="row between"><div class="word">${esc(word.surface)}</div><button class="ghost" id="sh-x">✕</button></div>
      <div class="muted">${esc(word.reading || "")}・${esc(word.romaji || "")}・${esc(word.pos)}${word.base !== word.surface ? `・辭書形 ${esc(word.base)}` : ""}</div>
      <div class="meaning">${ai ? esc(ai.m) : s.analysis ? "（AI 沒有解釋這個詞）" : "按上方「🤖 AI 解析」就會有中文意思"}</div>
      <div class="line-ctx">${esc(lines[li].text)}${s.analysis?.lines?.[li]?.zh ? `<div class="muted">${esc(s.analysis.lines[li].zh)}</div>` : ""}</div>
      ${notes ? `<div class="notes">📘 ${esc(notes)}</div>` : ""}
      <div class="row">
        <button id="sh-say">🔊 唸單字</button><button id="sh-line">🔊 唸整句</button>
        <button class="primary" id="sh-add" ${inVocab ? "disabled" : ""}>${inVocab ? "✓ 已在單字本" : "⭐ 加入單字本"}</button>
      </div></div>`;
    sheet.classList.add("show");
    $("#sh-x").onclick = () => sheet.classList.remove("show");
    $("#sh-say").onclick = () => speak(word.base || word.surface);
    $("#sh-line").onclick = () => speak(lines[li].text);
    $("#sh-add").onclick = () => {
      const db = store.load();
      db.vocab.unshift({
        id: store.uid(), surface: word.surface, base: ai?.base || word.base, reading: ai?.r || word.reading,
        romaji: word.romaji, meaning: ai?.m || "", pos: word.pos, songId: s.id, song: s.title, line: lines[li].text,
        due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0, created: Date.now(),
      });
      store.save();
      $("#sh-add").textContent = "✓ 已加入"; $("#sh-add").disabled = true;
      toast(ai ? "已加入單字本" : "已加入單字本（可以到單字本補上中文意思）");
    };
  }

  const key = e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); $("#play").click(); }
    if (e.code === "ArrowLeft") $("#prev").click();
    if (e.code === "ArrowRight") $("#next").click();
    if (e.key === "r") $("#loop").click();
  };
  document.addEventListener("keydown", key);
  cleanup = () => {
    document.removeEventListener("keydown", key);
    if (startedAt) practiced += (performance.now() - startedAt) / 1000;
    if (practiced > 3) { s.practiceSec = (s.practiceSec || 0) + Math.round(practiced); store.upsertSong(s); store.logPractice(Math.round(practiced)); }
    shell.stop();
  };
}

// ------------------------------------------------------------------ vocabulary
function showVocab() {
  const db = store.load();
  const due = dueCount();
  view().innerHTML = `
    <div class="row between"><h2>⭐ 單字本（${db.vocab.length}）</h2>
      <a class="btn primary ${due ? "" : "disabled"}" href="#/review">開始複習（${due}）</a></div>
    <input id="q" placeholder="搜尋單字、讀音或意思">
    <div id="vl"></div>`;
  const render = () => {
    const q = $("#q").value.trim();
    const list = db.vocab.filter(v => !q || [v.surface, v.base, v.reading, v.meaning, v.romaji].some(x => (x || "").includes(q)));
    $("#vl").innerHTML = list.map(v => `<div class="card vocab" data-id="${v.id}">
      <div class="grow"><div><b class="vw">${esc(v.base || v.surface)}</b> <span class="muted">${esc(v.reading || "")}</span>
        ${srs.isDue(v) ? `<span class="tag">待複習</span>` : `<span class="muted small">下次 ${new Date(v.due).toLocaleDateString()}</span>`}</div>
        <input class="vm" value="${esc(v.meaning || "")}" placeholder="（點這裡填中文意思）">
        <div class="muted small">🎵 ${esc(v.song || "")}：${esc(v.line || "")}</div></div>
      <div class="col"><button class="small" data-act="say">🔊</button><button class="small ghost danger" data-act="del">刪除</button></div>
    </div>`).join("") || `<p class="muted">在唱歌畫面點一下歌詞裡的單字，就能加入單字本。</p>`;
  };
  render();
  $("#q").oninput = render;
  $("#vl").onclick = e => {
    const card = e.target.closest(".vocab"); if (!card) return;
    const v = db.vocab.find(x => x.id === card.dataset.id);
    if (e.target.dataset.act === "say") speak(v.base || v.surface);
    if (e.target.dataset.act === "del" && confirm(`刪除「${v.base || v.surface}」？`)) { db.vocab = db.vocab.filter(x => x !== v); store.save(); render(); }
  };
  $("#vl").onchange = e => {
    if (!e.target.classList.contains("vm")) return;
    const v = db.vocab.find(x => x.id === e.target.closest(".vocab").dataset.id);
    v.meaning = e.target.value.trim(); store.save(); toast("已儲存");
  };
}

function showReview() {
  const db = store.load();
  const queue = db.vocab.filter(v => srs.isDue(v)).sort((a, b) => (a.due || 0) - (b.due || 0));
  let done = 0;
  const next = () => {
    const v = queue.shift();
    if (!v) {
      view().innerHTML = `<div class="center-box"><div class="big">🎉</div><h2>今天的單字複習完了</h2>
        <p class="muted">這次複習了 ${done} 個。</p><a class="btn primary" href="#/">回到我的歌</a></div>`;
      return;
    }
    view().innerHTML = `
      <div class="muted small">剩下 ${queue.length + 1} 個</div>
      <div class="flash card" id="card">
        <div class="fw">${esc(v.base || v.surface)}</div>
        <div class="back hidden">
          <div class="muted">${esc(v.reading || "")}・${esc(v.romaji || "")}</div>
          <div class="meaning">${esc(v.meaning || "（沒有填意思）")}</div>
          <div class="muted small">🎵 ${esc(v.line || "")}</div>
        </div>
      </div>
      <button class="primary wide" id="show">看答案</button>
      <div class="grades hidden" id="grades">
        ${["忘了", "困難", "記得", "簡單"].map((g, i) => `<button data-g="${i}" class="g${i}">${g}<div class="small">${srs.nextLabel(v, i)}</div></button>`).join("")}
      </div>`;
    speak(v.base || v.surface);
    $("#show").onclick = () => { $(".back").classList.remove("hidden"); $("#grades").classList.remove("hidden"); $("#show").classList.add("hidden"); };
    $("#grades").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      const g = +b.dataset.g;
      Object.assign(v, srs.review(v, g));
      if (g === 0) queue.push(v);
      done++;
      store.save();
      store.logPractice(0, 0, 1);
      next();
    };
  };
  if (!queue.length) {
    view().innerHTML = `<div class="center-box"><div class="big">☕</div><h2>目前沒有要複習的單字</h2>
      <p class="muted">唱歌時點單字加入單字本，之後就會安排複習。</p><a class="btn" href="#/vocab">看單字本</a></div>`;
    return;
  }
  next();
}

// ------------------------------------------------------------------ stats
function showStats() {
  const db = store.load();
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(store.today(d)); }
  const max = Math.max(60, ...days.map(k => db.log[k]?.sec || 0));
  const totalMin = Math.round(Object.values(db.log).reduce((a, e) => a + (e.sec || 0), 0) / 60);
  const learned = db.vocab.filter(v => (v.interval || 0) >= 21).length;
  view().innerHTML = `
    <h2>📊 學習紀錄</h2>
    <div class="hero">
      <div><div class="big">🔥 ${store.streak()}</div><div class="muted">連續天數</div></div>
      <div><div class="big">${totalMin}</div><div class="muted">總練習分鐘</div></div>
      <div><div class="big">${db.vocab.length}</div><div class="muted">單字（熟記 ${learned}）</div></div>
    </div>
    <div class="card"><div class="muted small">最近 14 天練習分鐘</div>
      <div class="bars">${days.map(k => { const sec = db.log[k]?.sec || 0; return `<div class="bar" title="${k}：${Math.round(sec / 60)} 分">
        <div style="height:${Math.round(sec / max * 100)}%"></div><span>${+k.slice(8)}</span></div>`; }).join("")}</div></div>
    <div class="card"><div class="muted small">每首歌</div>
      ${db.songs.map(s => `<div class="row between"><span>${esc(s.title)}</span><span class="muted">${s.plays || 0} 次・${Math.round((s.practiceSec || 0) / 60)} 分</span></div>`).join("") || "<p class='muted'>還沒有歌</p>"}
    </div>`;
}

// ------------------------------------------------------------------ settings
function showSettings() {
  const st = store.load().settings;
  view().innerHTML = `
    <h2>⚙️ 設定</h2>
    <div class="card">
      <b>🤖 Gemini API 金鑰</b>（中文翻譯、文法、單字意思用；免費）
      <input id="key" type="password" value="${esc(st.geminiKey)}" placeholder="AIza...">
      <div class="muted small">到 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 按「Create API key」取得。
        金鑰只存在這個瀏覽器，只會用來呼叫 Google 的 Gemini。</div>
      <button class="primary" id="key-save">儲存金鑰</button>
    </div>
    <div class="card">
      <b>💾 備份</b>
      <div class="muted small">歌詞、單字本和紀錄都只存在這個瀏覽器。換手機或清除瀏覽器資料前，先匯出備份。</div>
      <div class="row"><button id="exp">匯出備份檔</button><label class="btn">匯入備份檔<input type="file" id="imp" accept=".json" hidden></label></div>
    </div>
    <div class="card">
      <b>📱 加到 iPhone 主畫面</b>
      <div class="muted small">用 Safari 開啟這個網頁 → 按下方「分享」按鈕 → 「加入主畫面」。之後就像 App 一樣全螢幕開啟，沒有網路也能看已存的歌詞（YouTube 和 AI 解析需要網路）。</div>
    </div>`;
  $("#key-save").onclick = () => { st.geminiKey = $("#key").value.trim(); store.save(); toast("已儲存"); };
  $("#exp").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([store.exportJson()], { type: "application/json" }));
    a.download = `日文歌學習備份-${store.today()}.json`;
    a.click();
  };
  $("#imp").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm("匯入會取代目前這個瀏覽器裡的所有資料，確定嗎？")) return;
    try { store.importJson(await f.text()); toast("匯入完成"); go("#/"); } catch (err) { toast(`匯入失敗：${err.message}`); }
  };
}

// ------------------------------------------------------------------ boot
window.addEventListener("hashchange", route);
route();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
getTokenizer().catch(() => {});   // warm up the dictionary in the background
