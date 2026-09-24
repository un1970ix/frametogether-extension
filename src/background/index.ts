import browser from "webextension-polyfill";
import {
  isMubiUrl,
  isPlaybackTime,
  isVideoState,
  MAX_ROOM_ID_LENGTH,
  normalizeServerUrl,
  parseServerMessage,
  type MessageType,
  type ServerMessage,
  type SyncConfig,
  type VideoState,
} from "../shared/types";
import { isTrustedPort } from "./ports";

const SESSION_KEY = "frametogether-extension:session";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_MS = 15_000;

const storageArea = () => browser.storage.session ?? browser.storage.local;

interface SessionState {
  roomId?: string;
  isHost?: boolean;
  userName?: string;
  tabId?: number;
}

type RoomRequest = { type: "Create" } | { type: "Join"; room_id: string };

const answers = (
  request: RoomRequest | null,
  joined: { room_id: string; is_host: boolean },
) =>
  request?.type === "Create"
    ? joined.is_host
    : request?.room_id === joined.room_id;

class SyncManager {
  private ws: WebSocket | null = null;
  private config: SyncConfig | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private activeTabId: number | null = null;
  private pending: RoomRequest | null = null;
  private joined = false;
  private lastError: string | null = null;
  private lastSync: VideoState | null = null;
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.restore().catch(() => undefined);

    browser.runtime.onMessage.addListener(
      (message: unknown, sender: browser.Runtime.MessageSender) => {
        const msg = message as {
          type?: unknown;
          state?: unknown;
          fresh?: unknown;
        } | null;
        if (msg?.type === "TEST") return Promise.resolve({ status: "ok" });
        if (msg?.type === "VIDEO_STATE") {
          const fresh = msg.fresh === true;
          void this.ready.then(() =>
            this.receiveVideoState(msg.state, fresh, sender),
          );
        }
        return Promise.resolve();
      },
    );

    browser.runtime.onConnect.addListener((port) => {
      if (!isTrustedPort(port, browser.runtime.id, browser.runtime.getURL(""))) {
        port.disconnect();
        return;
      }
      port.onMessage.addListener(
        (msg) => void this.ready.then(() => this.handleCommand(msg, port)),
      );
    });
  }

  private async restore() {
    const saved = await browser.storage.sync.get(["serverUrl"]);
    if (typeof saved.serverUrl !== "string") return;
    const parsed = normalizeServerUrl(saved.serverUrl);
    if (!parsed.ok) return;
    this.config = { serverUrl: parsed.url };

    const session = await this.loadSession();
    if (!session?.roomId) return;
    const { tabId, ...room } = session;
    this.config = { ...this.config, ...room };
    this.activeTabId = typeof tabId === "number" ? tabId : null;
    this.connect();
  }

  private async receiveVideoState(
    state: unknown,
    fresh: boolean,
    sender: browser.Runtime.MessageSender,
  ) {
    const tab = sender.tab;
    if (tab?.id === undefined || !isMubiUrl(tab.url)) return;
    if (!isVideoState(state)) return;

    if (tab.id !== this.activeTabId) {
      const current = this.activeTabId;
      if (await this.readTab()) return;
      if (this.activeTabId !== current) return;
      this.activeTabId = tab.id;
      await this.saveSession();
    }
    if (!this.joined) return;
    if (this.config?.isHost) {
      this.send({ type: "State", time: state.time, paused: state.paused });
    } else if (fresh && this.lastSync) {
      await this.applyToTab(this.lastSync.time, this.lastSync.paused);
    }
  }

  private async loadSession(): Promise<SessionState | null> {
    try {
      const stored = await storageArea().get([SESSION_KEY]);
      const raw = stored[SESSION_KEY];
      return typeof raw === "object" && raw !== null
        ? (raw as SessionState)
        : null;
    } catch {
      return null;
    }
  }

  private async saveSession() {
    try {
      const area = storageArea();
      if (!this.config?.roomId) {
        await area.remove([SESSION_KEY]);
        return;
      }
      await area.set({
        [SESSION_KEY]: {
          roomId: this.config.roomId,
          isHost: this.config.isHost,
          userName: this.config.userName,
          tabId: this.activeTabId ?? undefined,
        } satisfies SessionState,
      });
    } catch {
      return;
    }
  }

  private async handleCommand(raw: unknown, port: browser.Runtime.Port) {
    if (typeof raw !== "object" || raw === null) return;
    const msg = raw as {
      type?: unknown;
      roomId?: unknown;
      url?: unknown;
      tabId?: unknown;
    };

    switch (msg.type) {
      case "CREATE_ROOM":
        this.request({ type: "Create" }, msg.tabId);
        break;
      case "JOIN_ROOM": {
        const roomId = typeof msg.roomId === "string" ? msg.roomId.trim() : "";
        if (roomId && roomId.length <= MAX_ROOM_ID_LENGTH) {
          this.request({ type: "Join", room_id: roomId }, msg.tabId);
        }
        break;
      }
      case "LEAVE_ROOM":
        await this.leaveRoom();
        break;
      case "GET_STATUS":
        port.postMessage({
          type: "STATUS",
          connected: this.joined,
          config: this.config,
          error: this.lastError,
        });
        break;
      case "SET_SERVER":
        if (typeof msg.url === "string") await this.setServer(msg.url);
        break;
    }
  }

  private async setServer(url: string) {
    const parsed = normalizeServerUrl(url);
    if (!parsed.ok) {
      this.broadcastError(parsed.error);
      return;
    }
    await this.leaveRoom();
    this.config = { serverUrl: parsed.url };
    await browser.storage.sync.set({ serverUrl: parsed.url });
    this.broadcastStatus();
  }

  private request(request: RoomRequest, tabId: unknown) {
    if (!this.config) return;
    if (typeof tabId === "number") this.activeTabId = tabId;
    this.lastError = null;
    this.pending = request;
    if (!this.send(request)) this.connect();
  }

  private isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(payload: Record<string, unknown>) {
    if (!this.isOpen()) return false;
    this.ws!.send(JSON.stringify(payload));
    return true;
  }

  private connect() {
    if (!this.config?.serverUrl) return;
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(`${this.config.serverUrl}/sync`);
    } catch {
      this.dropped();
      return;
    }
    this.ws = socket;
    this.startTicker();

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      if (!this.pending && this.config?.roomId) {
        this.pending = { type: "Join", room_id: this.config.roomId };
      }
      if (this.pending) this.send(this.pending);
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket || typeof event.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const msg = parseServerMessage(raw);
      if (msg) void this.handleServerMessage(msg);
    };

    socket.onclose = () => {
      if (this.ws === socket) this.dropped();
    };
  }

  private dropped() {
    this.ws = null;
    this.joined = false;
    this.broadcastStatus();
    if (this.config?.roomId) {
      this.scheduleReconnect();
      return;
    }
    this.stopTicker();
    if (this.pending) {
      this.pending = null;
      this.broadcastError("Could not connect to the server.");
    }
  }

  private disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.stopTicker();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private async leaveRoom() {
    this.send({ type: "Leave" });
    this.disconnect();
    this.pending = null;
    this.joined = false;
    this.lastSync = null;

    if (this.config) this.config = { serverUrl: this.config.serverUrl };
    await this.saveSession();
    this.broadcastStatus();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.config?.roomId) return;
    if (this.reconnectAttempts >= RECONNECT_ATTEMPTS) {
      void this.leaveRoom().then(() =>
        this.broadcastError("Lost connection to the server."),
      );
      return;
    }
    const backoff = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        this.connect();
      },
      backoff / 2 + Math.random() * (backoff / 2),
    );
  }

  private async handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "RoomJoined":
        if (!this.config) break;
        if (answers(this.pending, msg)) this.pending = null;
        this.joined = true;
        this.lastSync = null;
        this.config = {
          ...this.config,
          roomId: msg.room_id,
          isHost: msg.is_host,
          userName: msg.your_name,
        };
        await this.saveSession();
        this.broadcastStatus();
        if (msg.is_host) await this.reportState();
        break;

      case "HostChanged":
        if (this.config?.userName === msg.user_name) {
          this.config = { ...this.config, isHost: true };
          await this.saveSession();
          this.broadcastStatus();
          await this.reportState();
        }
        break;

      case "Sync":
        this.lastSync = { time: msg.time, paused: msg.paused };
        if (!this.config?.isHost) await this.applyToTab(msg.time, msg.paused);
        break;

      case "Error":
        if (this.pending) await this.leaveRoom();
        this.broadcastError(msg.message);
        break;

      case "UserJoined":
      case "UserLeft":
        this.broadcastStatus();
        break;
    }
  }

  private async readTab(): Promise<VideoState | null> {
    if (this.activeTabId === null) return null;
    try {
      const state: unknown = await browser.tabs.sendMessage(this.activeTabId, {
        type: "GET_STATE",
      } satisfies MessageType);
      return isVideoState(state) ? state : null;
    } catch {
      return null;
    }
  }

  private async reportState() {
    const state = await this.readTab();
    if (state) this.send({ type: "State", time: state.time, paused: state.paused });
  }

  private async applyToTab(time: number, paused: boolean) {
    if (this.activeTabId === null || !isPlaybackTime(time)) return;
    try {
      await browser.tabs.sendMessage(this.activeTabId, {
        type: "APPLY_STATE",
        state: { time, paused },
      } satisfies MessageType);
    } catch {
      this.activeTabId = null;
    }
  }

  private broadcastStatus() {
    this.lastError = null;
    this.post({
      type: "CONNECTION_STATUS",
      connected: this.joined,
      config: this.config ?? undefined,
    });
  }

  private broadcastError(message: string) {
    this.lastError = message;
    this.post({ type: "ERROR", message });
  }

  private post(message: MessageType) {
    browser.runtime.sendMessage(message).catch(() => {});
  }

  private startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      this.send({ type: "Heartbeat" });
      browser.runtime.getPlatformInfo().catch(() => {});
    }, HEARTBEAT_MS);
  }

  private stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }
}

new SyncManager();
