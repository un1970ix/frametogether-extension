import browser from "webextension-polyfill";
import { isPlaybackTime, isVideoState, type MessageType, type VideoState } from "../shared/types";

const POLL_MS = 1_000;
const SEEK_THRESHOLD_SECONDS = 2;
const REPORT_THRESHOLD_SECONDS = 0.5;
const APPLY_QUIET_MS = 500;
const PLAYER_EVENTS = ["play", "pause", "seeked"] as const;

class MubiController {
  private video: HTMLVideoElement | null = null;
  private lastState: VideoState | null = null;
  private applying = false;
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  private readonly onPlayerEvent = () => {
    if (!this.applying) this.checkState();
  };

  constructor() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as MessageType | null;
      if (msg?.type === "GET_STATE") return Promise.resolve(this.readState());
      if (msg?.type === "APPLY_STATE" && isVideoState(msg.state)) {
        this.applyState(msg.state);
      }
      return Promise.resolve();
    });

    void this.checkConnection();
    setInterval(() => this.poll(), POLL_MS);
  }

  private poll() {
    const video = document.querySelector("video");
    if (video !== this.video) this.attach(video);
    this.checkState();
  }

  private attach(video: HTMLVideoElement | null) {
    for (const event of PLAYER_EVENTS) {
      this.video?.removeEventListener(event, this.onPlayerEvent);
      video?.addEventListener(event, this.onPlayerEvent);
    }
    this.video = video;
    this.lastState = null;
  }

  private async checkConnection() {
    try {
      await browser.runtime.sendMessage({ type: "TEST" });
      this.connected = true;
    } catch {
      this.connected = false;
      setTimeout(() => void this.checkConnection(), POLL_MS);
    }
  }

  private readState(): VideoState | null {
    if (!this.video || !isPlaybackTime(this.video.currentTime)) return null;
    return { time: this.video.currentTime, paused: this.video.paused };
  }

  private checkState() {
    if (this.applying || !this.connected) return;

    const state = this.readState();
    if (!state) return;

    const last = this.lastState;
    const drifted =
      !last ||
      Math.abs(state.time - last.time) > REPORT_THRESHOLD_SECONDS ||
      state.paused !== last.paused;

    if (drifted) {
      this.lastState = state;
      void this.sendState(state, !last);
    }
  }

  private async sendState(state: VideoState, fresh: boolean) {
    try {
      await browser.runtime.sendMessage({
        type: "VIDEO_STATE",
        state,
        fresh,
      } satisfies MessageType);
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

new MubiController();
