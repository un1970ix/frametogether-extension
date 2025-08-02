import browser from "webextension-polyfill";
import type { MessageType, VideoState } from "../shared/types";

class MubiController {
  private video: HTMLVideoElement | null = null;
  private lastState: VideoState | null = null;
  private isApplyingState = false;
  private isConnected = false;

  constructor() {
    this.init();
  }

  private async init() {
    console.log("FrameTogether: Initializing content script");

    this.video = await this.waitForVideo();
    if (!this.video) return;

    console.log("FrameTogether: Video found!");

    this.video.addEventListener("play", () => this.onStateChange());
    this.video.addEventListener("pause", () => this.onStateChange());
    this.video.addEventListener("seeked", () => this.onStateChange());

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as MessageType;
      if (msg.type === "APPLY_STATE") {
        this.applyState(msg.state);
      }
      return Promise.resolve();
    });

    this.checkConnection();

    setInterval(() => this.checkState(), 1000);
  }

  private async checkConnection() {
    try {
      await browser.runtime.sendMessage({ type: "TEST" });
      this.isConnected = true;
      console.log("FrameTogether: Connected to background script");
    } catch (error) {
      console.log(
        "FrameTogether: Background script not ready yet, retrying...",
      );
      this.isConnected = false;
      setTimeout(() => this.checkConnection(), 1000);
    }
  }

  private async waitForVideo(): Promise<HTMLVideoElement | null> {
    for (let i = 0; i < 60; i++) {
      const video = document.querySelector("video");
      if (video) return video;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error("FrameTogether: No video found");
    return null;
  }

  private checkState() {
    if (!this.video || this.isApplyingState || !this.isConnected) return;

    const currentState: VideoState = {
      time: this.video.currentTime,
      paused: this.video.paused,
    };

    if (
      !this.lastState ||
      Math.abs(currentState.time - this.lastState.time) > 0.5 ||
      currentState.paused !== this.lastState.paused
    ) {
      this.lastState = currentState;
      this.sendState(currentState);
    }
  }

  private onStateChange() {
    if (!this.isApplyingState) {
      this.checkState();
    }
  }

  private async sendState(state: VideoState) {
    if (!this.isConnected) return;

    const message: MessageType = {
      type: "VIDEO_STATE",
      state,
    };

    browser.runtime.sendMessage(message).catch((error) => {
      console.error("FrameTogether: Failed to send state:", error);
    });
  }

  private applyState(state: VideoState) {
    if (!this.video) return;

    this.isApplyingState = true;

    if (Math.abs(this.video.currentTime - state.time) > 2) {
      this.video.currentTime = state.time;
    }

    if (state.paused && !this.video.paused) {
      this.video.pause();
    } else if (!state.paused && this.video.paused) {
      this.video.play().catch((e) => {
        console.error("FrameTogether: Failed to play", e);
      });
    }

    setTimeout(() => {
      this.isApplyingState = false;
    }, 500);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new MubiController());
} else {
  new MubiController();
}
