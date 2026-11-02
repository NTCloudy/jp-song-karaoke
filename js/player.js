// Playback clock: a YouTube video (IFrame API) or, without a video, a silent timer so lyrics can still run.

let ytReady = null;

function loadYouTube() {
  if (!ytReady) {
    ytReady = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve();
      window.onYouTubeIframeAPIReady = () => resolve();
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => { ytReady = null; reject(new Error("無法載入 YouTube（請確認網路）")); };
      document.head.appendChild(s);
    });
  }
  return ytReady;
}

/** "https://youtu.be/ID", "watch?v=ID", "shorts/ID", or a bare 11-char ID -> ID */
export function youtubeId(input) {
  const s = (input || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : "";
}

class SilentClock {
  constructor(duration) { this.duration = duration; this.base = 0; this.started = null; this.rate = 1; this.onstate = () => {}; }
  async init() { return this; }
  get playing() { return this.started != null; }
  time() { return this.started == null ? this.base : this.base + (performance.now() - this.started) / 1000 * this.rate; }
  play() { if (this.started == null) { this.started = performance.now(); this.onstate(true); } }
  pause() { if (this.started != null) { this.base = this.time(); this.started = null; this.onstate(false); } }
  seek(t) { const p = this.playing; this.base = Math.max(0, t); if (p) this.started = performance.now(); }
  setRate(r) { this.base = this.time(); if (this.started != null) this.started = performance.now(); this.rate = r; }
  getDuration() { return this.duration; }
  destroy() { this.pause(); }
}

class YouTubeClock {
  constructor(el, id) { this.el = el; this.id = id; this.player = null; this.onstate = () => {}; this.rate = 1; }
  async init() {
    await loadYouTube();
    await new Promise((resolve, reject) => {
      this.player = new window.YT.Player(this.el, {
        videoId: this.id,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 },
        events: {
          onReady: () => resolve(),
          onError: e => reject(new Error(`YouTube 影片無法播放（錯誤 ${e.data}，可能不允許嵌入）`)),
          onStateChange: e => this.onstate(e.data === window.YT.PlayerState.PLAYING),
        },
      });
    });
    return this;
  }
  get playing() { return this.player?.getPlayerState?.() === window.YT.PlayerState.PLAYING; }
  time() { return this.player?.getCurrentTime?.() || 0; }
  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  seek(t) { this.player?.seekTo(Math.max(0, t), true); }
  setRate(r) { this.rate = r; this.player?.setPlaybackRate(r); }
  getDuration() { return this.player?.getDuration?.() || 0; }
  destroy() { try { this.player?.destroy(); } catch { /* already gone */ } }
}

export async function createClock(song, videoEl) {
  if (song.youtubeId) return new YouTubeClock(videoEl, song.youtubeId).init();
  const last = song.lines.filter(l => l.t != null).at(-1)?.t || 0;
  return new SilentClock(song.duration || last + 8).init();
}
