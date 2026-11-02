# 🎤 日文歌 KTV 學習

自己用的日文歌學習網頁 App（可以加到 iPhone 主畫面當 App 用）。

👉 **https://ntcloudy.github.io/jp-song-karaoke/**

## 功能
- **KTV 模式**：歌詞跟著音樂跑，唱到的字會變色；漢字上面有**假名**，下面有**羅馬拼音**，還有中文翻譯
- 搭配 **YouTube** 影片播放；沒有影片也可以用無聲計時器跑歌詞
- **對時**：貼上一般歌詞後，播放歌曲、每句開始時按一下，就完成時間標記；也可以直接貼有時間標記的 LRC 歌詞
- 上一句／下一句、**重複這一句**、0.5～1 倍速、時間微調
- **點歌詞裡的單字**：讀音、羅馬拼音、詞性、辭書形、中文意思、🔊 朗讀，⭐ 加入單字本
- **🤖 AI 解析**（Gemini，用你自己的免費金鑰）：每句中文翻譯、文法重點、單字意思
- **單字本 + 閃卡複習**（間隔重複，忘了的 10 分鐘後再出現）
- **學習紀錄**：連續天數、每天練習分鐘、每首歌練習次數
- 離線也能開（已存的歌詞、日文字典都會快取）

## 隱私與版權
- 歌詞、單字本、紀錄**只存在你自己的瀏覽器**（localStorage），不會上傳；換裝置請用「設定 → 匯出備份」。
- 這個 repo **不包含任何歌曲的歌詞**。內建的範例歌是為這個 App 寫的原創歌詞。請只貼你自己有權使用的歌詞來練習。

## 技術
純前端（HTML/CSS/JavaScript 模組，不需要編譯），GitHub Pages 免費部署。
- 斷詞與讀音：[kuromoji.js](https://github.com/takuyaa/kuromoji.js)（瀏覽器端，字典約 12 MB，第一次載入後快取）
- 假名位置與羅馬拼音（Hepburn）：`js/japanese.js`
- 歌詞時間、KTV 變色進度：`js/lrc.js`
- YouTube IFrame API／無聲計時器：`js/player.js`
- 間隔重複：`js/srs.js`

## 測試
```bash
python3 -m http.server 8765 &
pip install playwright && python -m playwright install chromium
python3 tests/run_tests.py     # 邏輯測試 + 用 iPhone 尺寸的瀏覽器跑完整流程，截圖在 tests/out/
```
