import browser from "webextension-polyfill";
import type { MessageType } from "../shared/types";

class PopupUI {
  private port: browser.Runtime.Port;
  private connected = false;
  private config: any = {};

  constructor() {
    this.port = browser.runtime.connect({ name: "popup" });
    this.init();
  }

  private async init() {
    this.port.postMessage({ type: "GET_STATUS" });

    this.port.onMessage.addListener((message: unknown) => {
      const msg = message as any;
      if (msg.type === "STATUS") {
        this.connected = msg.connected;
        this.config = msg.config || {};
        this.render();
      }
    });

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as MessageType;
      if (msg.type === "CONNECTION_STATUS") {
        this.connected = msg.connected;
        this.config = msg.config || {};
        this.render();
      }
      return Promise.resolve();
    });

    this.render();
  }

  private async render() {
    const status = document.getElementById("status")!;
    const content = document.getElementById("content")!;

    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url?.includes("mubi.com")) {
      this.showNotOnMubi();
      return;
    }

    if (!this.config.serverUrl) {
      status.className = "status";
      status.innerHTML = '<span class="error">⚠️ No server configured.</span>';
      content.innerHTML = `
        <p>Please configure a server in the <a href="#" id="optionsLink">options</a>.</p>
      `;
      document.getElementById("optionsLink")?.addEventListener("click", () => {
        browser.runtime.openOptionsPage();
      });
      return;
    }

    if (this.connected && this.config.roomId) {
      status.className = "status";
      status.innerHTML = '<span class="connected">🟢 Connected.</span>';
      content.innerHTML = `
        <div class="info">
          <p><strong>Room:</strong> <code>${this.config.roomId}</code></p>
          <p><strong>You are:</strong> ${this.config.userName || "Unknown"}</p>
          <p><strong>Role:</strong> ${this.config.isHost ? "Host" : "Viewer"}</p>
        </div>
        <button id="leaveBtn" class="btn btn-danger">Leave Room</button>
        <button id="copyBtn" class="btn btn-secondary">Copy Room ID</button>
      `;

      document.getElementById("leaveBtn")?.addEventListener("click", () => {
        this.port.postMessage({ type: "LEAVE_ROOM" });
      });

      document
        .getElementById("copyBtn")
        ?.addEventListener("click", async () => {
          await navigator.clipboard.writeText(this.config.roomId);
          const btn = document.getElementById("copyBtn") as HTMLButtonElement;
          btn.textContent = "Copied!";
          setTimeout(() => {
            btn.textContent = "Copy Room ID";
          }, 1500);
        });
    } else {
      status.className = "status";
      status.innerHTML = '<span class="disconnected">⚪ Not connected.</span>';
      content.innerHTML = `
        <button id="createBtn" class="btn btn-primary">Create Room</button>
        <div class="divider">or</div>
        <input type="text" id="roomInput" placeholder="Enter room ID." maxlength="6">
        <button id="joinBtn" class="btn btn-secondary">Join Room</button>
      `;

      document.getElementById("createBtn")?.addEventListener("click", () => {
        this.port.postMessage({ type: "CREATE_ROOM" });
      });

      document.getElementById("joinBtn")?.addEventListener("click", () => {
        const input = document.getElementById("roomInput") as HTMLInputElement;
        const roomId = input.value.trim();
        if (roomId) {
          this.port.postMessage({ type: "JOIN_ROOM", roomId });
        }
      });
    }
  }

  private showNotOnMubi() {
    const status = document.getElementById("status")!;
    const content = document.getElementById("content")!;

    status.className = "status";
    status.innerHTML = '<span class="error">📺 Not on MUBI.</span>';
    content.innerHTML =
      '<p>Please navigate to <a href="https://mubi.com" target="_blank">mubi.com</a> to use FrameTogether.</p>';
  }
}

new PopupUI();
