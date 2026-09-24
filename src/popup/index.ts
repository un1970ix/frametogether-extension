import browser from "webextension-polyfill";
import {
  isMubiUrl,
  MAX_ROOM_ID_LENGTH,
  type MessageType,
  type SyncConfig,
} from "../shared/types";
import { button, el, field } from "./dom";

const COPY_RESET_MS = 1_500;

class PopupUI {
  private port = browser.runtime.connect({ name: "popup" });
  private status = document.getElementById("status")!;
  private content = document.getElementById("content")!;
  private connected = false;
  private config: SyncConfig | null = null;
  private error: string | null = null;
  private tabId: number | undefined;

  constructor() {
    this.init();
  }

  private init() {
    this.port.onMessage.addListener((message: unknown) => {
      const msg = message as {
        type?: unknown;
        connected?: unknown;
        config?: unknown;
        error?: unknown;
      } | null;
      if (msg?.type !== "STATUS") return;
      this.connected = msg.connected === true;
      this.config = (msg.config as SyncConfig) ?? null;
      this.error = typeof msg.error === "string" ? msg.error : null;
      void this.render();
    });

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as MessageType | null;
      if (msg?.type === "CONNECTION_STATUS") {
        this.connected = msg.connected;
        this.config = msg.config ?? null;
        this.error = null;
        void this.render();
      } else if (msg?.type === "ERROR") {
        this.error = msg.message;
        void this.render();
      }
      return Promise.resolve();
    });

    this.port.postMessage({ type: "GET_STATUS" });
  }

  private reset() {
    this.status.className = "status";
    this.status.replaceChildren();
    this.content.replaceChildren();
  }

  private note(className: string, textContent: string) {
    this.status.append(el("span", { className, textContent }));
  }

  private command(type: string) {
    return () => this.port.postMessage({ type, tabId: this.tabId });
  }

  private async render() {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!isMubiUrl(tab?.url)) return this.renderNotOnMubi();
    this.tabId = tab?.id;

    this.reset();
    if (this.error) this.note("error", `⚠️ ${this.error}`);
    if (!this.config?.serverUrl) return this.renderNoServer();

    if (!this.config.roomId) return this.renderDisconnected();
    return this.connected
      ? this.renderConnected(this.config)
      : this.renderReconnecting();
  }

  private renderNoServer() {
    this.note("error", "⚠️ No server configured.");

    const link = el("a", { href: "#", textContent: "options" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      void browser.runtime.openOptionsPage();
    });
    this.content.append(
      el("p", {}, "Please configure a server in the ", link, "."),
    );
  }

  private renderConnected(config: SyncConfig) {
    this.note("connected", "🟢 Connected.");

    this.content.append(
      el(
        "div",
        { className: "info" },
        field("Room:", el("code", { textContent: config.roomId ?? "" })),
        field("You are:", config.userName ?? "Unknown"),
        field("Role:", config.isHost ? "Host" : "Viewer"),
      ),
    );

    const copyBtn = button("copyBtn", "secondary", "Copy Room ID", async () => {
      try {
        await navigator.clipboard.writeText(config.roomId ?? "");
        copyBtn.textContent = "Copied!";
      } catch {
        copyBtn.textContent = "Copy failed.";
      }
      setTimeout(() => {
        copyBtn.textContent = "Copy Room ID";
      }, COPY_RESET_MS);
    });

    this.content.append(
      button("leaveBtn", "danger", "Leave Room", this.command("LEAVE_ROOM")),
      copyBtn,
    );
  }

  private renderReconnecting() {
    this.note("disconnected", "🟡 Reconnecting.");
    this.content.append(
      button("leaveBtn", "danger", "Leave Room", this.command("LEAVE_ROOM")),
    );
  }

  private renderDisconnected() {
    this.note("disconnected", "⚪ Not connected.");

    const roomInput = el("input", {
      type: "text",
      id: "roomInput",
      placeholder: "Enter room ID.",
      maxLength: MAX_ROOM_ID_LENGTH,
    });
    const join = () => {
      const roomId = roomInput.value.trim();
      if (roomId) {
        this.port.postMessage({ type: "JOIN_ROOM", roomId, tabId: this.tabId });
      }
    };
    roomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") join();
    });

    this.content.append(
      button("createBtn", "primary", "Create Room", this.command("CREATE_ROOM")),
      el("div", { className: "divider", textContent: "or" }),
      roomInput,
      button("joinBtn", "secondary", "Join Room", join),
    );
  }

  private renderNotOnMubi() {
    this.reset();
    this.note("error", "📺 Not on MUBI.");
    this.content.append(
      el(
        "p",
        {},
        "Please navigate to ",
        el("a", {
          href: "https://mubi.com",
          target: "_blank",
          rel: "noopener noreferrer",
          textContent: "mubi.com",
        }),
        " to use FrameTogether.",
      ),
    );
  }
}

new PopupUI();
