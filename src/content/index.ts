import browser from "webextension-polyfill";
import { isPlaybackTime, isVideoState, type MessageType, type VideoState } from "../shared/types";

const POLL_MS = 1_000;
const SEEK_THRESHOLD_SECONDS = 2;
const REPORT_THRESHOLD_SECONDS = 0.5;
const APPLY_QUIET_MS = 500;
const VIDEO_WAIT_ATTEMPTS = 60;
const VIDEO_WAIT_MS = 500;
const PLAYER_EVENTS = ["play", "pause", "seeked"] as const;

class MubiController {
  private video: HTMLVideoElement | null = null;
  private lastState: VideoState | null = null;
  private applying = false;
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private disposed = false;

  private readonly onPlayerEvent = () => {
    if (!this.applying) this.checkState();
  };

  constructor() {
    void this.init();
  }

  private async init() {
    this.video = await this.waitForVideo();
    if (!this.video || this.disposed) return;

    for (const event of PLAYER_EVENTS) {
      this.video.addEventListener(event, this.onPlayerEvent);
    }

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as MessageType | null;
      if (msg?.type === "APPLY_STATE" && isVideoState(msg.state)) {
        this.applyState(msg.state);
      }
      return Promise.resolve();
    });

    void this.checkConnection();
    this.pollTimer = setInterval(() => this.checkState(), POLL_MS);
    window.addEventListener("pagehide", () => this.dispose(), { once: true });
  }

  private dispose() {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.pollTimer = null;
    this.applyTimer = null;
    for (const event of PLAYER_EVENTS) {
      this.video?.removeEventListener(event, this.onPlayerEvent);
    }
  }

  private async checkConnection() {
    if (this.disposed) return;
    try {
      await browser.runtime.sendMessage({ type: "TEST" });
      this.connected = true;
    } catch {
      this.connected = false;
      setTimeout(() => void this.checkConnection(), POLL_MS);
    }
  }

  private async waitForVideo(): Promise<HTMLVideoElement | null> {
    for (let i = 0; i < VIDEO_WAIT_ATTEMPTS && !this.disposed; i++) {
      const video = document.querySelector("video");
      if (video) return video;
      await new Promise((r) => setTimeout(r, VIDEO_WAIT_MS));
    }
    return null;
  }

  private checkState() {
    if (!this.video || this.applying || !this.connected) return;

    const time = this.video.currentTime;
    if (!isPlaybackTime(time)) return;

    const state: VideoState = { time, paused: this.video.paused };
    const drifted =
      !this.lastState ||
      Math.abs(state.time - this.lastState.time) > REPORT_THRESHOLD_SECONDS ||
      state.paused !== this.lastState.paused;

    if (drifted) {
      this.lastState = state;
      void this.sendState(state);
    }
  }

  private async sendState(state: VideoState) {
    if (!this.connected) return;
    try {
      await browser.runtime.sendMessage({
        type: "VIDEO_STATE",
        state,
      } as MessageType);
    } catch {
      this.connected = false;
      void this.checkConnection();
    }
  }

  private applyState(state: VideoState) {
    if (!this.video) return;

    this.applying = true;
    if (this.applyTimer) clearTimeout(this.applyTimer);

    if (Math.abs(this.video.currentTime - state.time) > SEEK_THRESHOLD_SECONDS) {
      this.video.currentTime = state.time;
    }
    if (state.paused && !this.video.paused) {
      this.video.pause();
    } else if (!state.paused && this.video.paused) {
      void this.video.play().catch(() => {});
    }

    this.applyTimer = setTimeout(() => {
      this.applying = false;
      this.applyTimer = null;
    }, APPLY_QUIET_MS);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new MubiController(), {
    once: true,
  });
} else {
  new MubiController();
}
