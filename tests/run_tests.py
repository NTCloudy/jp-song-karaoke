"""Browser tests (headless Chromium via Playwright): pure logic in js/*.js plus an end-to-end run of the app.

python3 tests/run_tests.py            # needs: pip install playwright && python -m playwright install chromium
Serves the repo on http://127.0.0.1:8765 (start it first: python3 -m http.server 8765).
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765/"
OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

UNIT = r"""
async () => {
  const J = await import('/js/japanese.js');
  const L = await import('/js/lrc.js');
  const S = await import('/js/srs.js');
  const P = await import('/js/player.js');
  const fails = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

  // romaji
  eq('basic', J.kanaToRomaji('ありがとう'), 'arigatou');
  eq('sokuon', J.kanaToRomaji('きって'), 'kitte');
  eq('sokuon ch', J.kanaToRomaji('まっちゃ'), 'matcha');
  eq('youon', J.kanaToRomaji('きょう'), 'kyou');
  eq('katakana long', J.kanaToRomaji('コーヒー'), 'koohii');
  eq('n apostrophe', J.kanaToRomaji('きんようび'), "kin'youbi");
  eq('n plain', J.kanaToRomaji('さんぽ'), 'sanpo');
  eq('fa', J.kanaToRomaji('ファン'), 'fan');
  // furigana placement
  eq('okurigana', J.rubySegments('食べる', 'タベル'), [{text:'食',rt:'た'},{text:'べる',rt:null}]);
  eq('mixed', J.rubySegments('取り扱い', 'トリアツカイ'), [{text:'取',rt:'と'},{text:'り',rt:null},{text:'扱',rt:'あつか'},{text:'い',rt:null}]);
  eq('kana only', J.rubySegments('ひかり', 'ヒカリ'), [{text:'ひかり',rt:null}]);
  eq('jukujikun', J.rubySegments('今日', 'キョウ'), [{text:'今日',rt:'きょう'}]);
  // LRC
  const p = L.parseLyrics('[ti:x]\n[offset:500]\n[00:01.50]一\n[00:03.00][00:10.00]二\n');
  eq('lrc timed', p.timed, true);
  eq('lrc lines', p.lines.map(l => [l.text, l.t]), [['一', 1], ['二', 2.5], ['二', 9.5]]);
  eq('plain', L.parseLyrics('あ\n\nい').lines.map(l => l.t), [null, null]);
  eq('idx', L.currentIndex([{t:1},{t:3},{t:5}], 3.2), 1);
  eq('idx before', L.currentIndex([{t:1}], 0.5), -1);
  const prog = L.lineProgress([{t:0,text:'あいう'},{t:100,text:'x'}], 0, 1.0);
  if (!(prog > 0.3 && prog < 0.6)) fails.push('wipe should not stretch over a long gap: ' + prog);
  // SRS
  const c1 = S.review({}, 2, 0); eq('srs first', c1.interval, 1);
  const c2 = S.review(c1, 2, 0); eq('srs second', c2.interval, 4);
  const c0 = S.review(c2, 0, 0); eq('srs lapse', [c0.reps, c0.lapses, c0.due], [0, 1, 600000]);
  // youtube ids
  eq('yt short', P.youtubeId('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
  eq('yt watch', P.youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), 'dQw4w9WgXcQ');
  eq('yt bad', P.youtubeId('hello'), '');
  // tokenizer end-to-end (downloads the dictionary)
  const tk = await J.getTokenizer();
  const words = J.analyzeLine(tk, '朝の光が窓をたたく');
  eq('romaji line', J.romajiLine(words), 'asa no hikari ga mado o tataku');
  eq('furigana', words.filter(w => w.segs.some(s => s.rt)).map(w => w.segs.map(s => s.rt || '').join('')), ['あさ', 'ひかり', 'まど']);
  const w2 = J.analyzeLine(tk, '君は空を見る');
  eq('particle wa', J.romajiLine(w2), 'kimi wa sora o miru');
  eq('te-form joined', J.romajiLine(J.analyzeLine(tk, '眠い目をこすって空を見る')), 'nemui me o kosutte sora o miru');
  eq('te-form 2', J.romajiLine(J.analyzeLine(tk, '君の町まで飛んでいく')), 'kimi no machi made tonde iku');
  eq('past/neg', J.romajiLine(J.analyzeLine(tk, '忘れないでね')), 'wasurenaide ne');
  return fails;
}
"""


def main() -> int:
    failures = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                  user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
                                             "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", locale="zh-TW")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE)
        page.wait_for_selector(".song")
        failures += page.evaluate(UNIT)

        # library -> demo song in the KTV screen
        page.screenshot(path=str(OUT / "1-library.png"))
        page.click(".song a.grow")
        page.wait_for_selector(".ln.now", timeout=30000)
        page.click("#play")
        page.wait_for_timeout(7600)          # ~line 2 ("眠い目をこすって空を見る") is being sung
        now = page.inner_text(".ln.now .base .jp")
        if "眠" not in now:
            failures.append(f"KTV: expected line 2 at ~7.6 s, got {now!r}")
        clip = page.eval_on_selector(".ln.now .fill", "e => e.style.clipPath")
        if not clip.startswith("inset(0px") and not clip.startswith("inset(0 "):
            failures.append(f"KTV: wipe not applied ({clip})")
        if "kosutte" not in page.inner_text(".ln.now .base .ro"):
            failures.append("KTV: romaji line missing")
        if page.locator(".ln.now ruby rt").count() < 2:
            failures.append("KTV: furigana missing")
        page.screenshot(path=str(OUT / "2-ktv.png"))
        # tap a word -> sheet, add to vocab
        page.locator(".ln.now .w.c").first.click()
        page.wait_for_selector(".sheet.show")
        page.screenshot(path=str(OUT / "3-word.png"))
        page.click("#sh-add")
        page.click("#sh-x")
        # loop current line
        page.click("#loop")
        page.wait_for_timeout(5500)
        if "眠" not in page.inner_text(".ln.now .base .jp"):
            failures.append("KTV: loop did not keep the current line")
        page.click("#loop")
        page.click("#play")

        # vocab + review
        page.goto(BASE + "#/vocab")
        page.wait_for_selector(".vocab")
        page.screenshot(path=str(OUT / "4-vocab.png"))
        page.goto(BASE + "#/review")
        page.click("#show")
        page.screenshot(path=str(OUT / "5-review.png"))
        page.click(".grades .g2")
        page.wait_for_selector(".center-box")

        # add a song with plain lyrics -> tap-to-sync
        page.goto(BASE + "#/edit/new")
        page.fill("#f-title", "テスト")
        page.fill("#f-lyrics", "一行目のテスト\n二行目のテスト")
        page.click("#f-save")
        page.wait_for_selector("#tap")
        page.click("#play")
        page.wait_for_timeout(600)
        page.click("#tap")
        page.wait_for_timeout(600)
        page.click("#tap")
        page.screenshot(path=str(OUT / "6-sync.png"))
        page.click("#save")
        page.wait_for_selector(".ln", timeout=30000)
        saved = page.evaluate("JSON.parse(localStorage.getItem('jpk.v1')).songs.find(s => s.title === 'テスト').lines.map(l => l.t)")
        if not (saved[0] is not None and saved[1] is not None and saved[1] > saved[0]):
            failures.append(f"sync: times not saved in order: {saved}")
        page.goto(BASE + "#/stats")
        page.wait_for_selector(".bars")
        page.screenshot(path=str(OUT / "7-stats.png"))
        failures += [f"page error: {e}" for e in errors]
        browser.close()
    for f in failures:
        print("FAIL", f)
    print(f"{'OK' if not failures else 'FAILED'} ({len(failures)} failures); screenshots in {OUT}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
