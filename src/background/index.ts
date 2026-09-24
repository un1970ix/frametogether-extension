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
} from "../shared/types";
import { isTrustedPort } from "./ports";

const SESSION_KEY = "frametogether-extension:session";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const HEARTBEAT_MS = 15_000;

const storageArea = () => browser.storage.session ?? browser.storage.local;

interface SessionState {
  roomId?: string;
  isHost?: boolean;
  userName?: string;
}

class SyncManager {
  private ws: WebSocket | null = null;
  private config: SyncConfig | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private activeTabId: number | null = null;
  private deliberateClose = false;
  private pendingCreate = false;

  constructor() {
    void this.init();
  }

  private async init() {
    const saved = await browser.storage.sync.get(["serverUrl"]);
    if (typeof saved.serverUrl === "string") {
      const parsed = normalizeServerUrl(saved.serverUrl);
      if (parsed.ok) this.config = { serverUrl: parsed.url };
    }

    const session = await this.loadSession();
    if (this.config && session?.roomId) {
      this.config = { ...this.config, ...session };
    }

    browser.runtime.onMessage.addListener(
      (message: unknown, sender: browser.Runtime.MessageSender) => {
        const msg = message as { type?: unknown; state?: unknown } | null;
        if (msg?.type === "TEST") return Promise.resolve({ status: "ok" });
        if (msg?.type === "VIDEO_STATE") this.receiveVideoState(msg.state, sender);
        return Promise.resolve();
      },
    );

    browser.runtime.onConnect.addListener((port) => {
      if (!isTrustedPort(port, browser.runtime.id, browser.runtime.getURL(""))) {
        port.disconnect();
        return;
      }
      port.onMessage.addListener((msg) => void this.handleCommand(msg, port));
    });

    if (this.config?.roomId) this.connect();
  }

  private receiveVideoState(
    state: unknown,
    sender: browser.Runtime.MessageSender,
  ) {
    if (sender.tab?.id === undefined || !isMubiUrl(sender.tab.url)) return;
    if (!isVideoState(state)) return;

    this.activeTabId = sender.tab.id;
    if (this.config?.isHost) {
      this.send({ type: "State", time: state.time, paused: state.paused });
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
        } satisfies SessionState,
      });
    } catch {
      return;
    }
  }

  private async handleCommand(raw: unknown, port: browser.Runtime.Port) {
    if (typeof raw !== "object" || raw === null) return;
    const msg = raw as { type?: unknown; roomId?: unknown; url?: unknown };

    switch (msg.type) {
      case "CREATE_ROOM":
        this.createRoom();
        break;
      case "JOIN_ROOM":
        if (typeof msg.roomId === "string") this.joinRoom(msg.roomId);
        break;
      case "LEAVE_ROOM":
        await this.leaveRoom();
        break;
      case "GET_STATUS":
        port.postMessage({
          type: "STATUS",
          connected: this.isOpen(),
          config: this.config,
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

    this.deliberateClose = false;

    let socket: WebSocket;
    try {
      socket = new WebSocket(`${this.config.serverUrl}/sync`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      if (this.pendingCreate) {
        this.pendingCreate = false;
        this.send({ type: "Create" });
      } else if (this.config?.roomId) {
        this.send({ type: "Join", room_id: this.config.roomId });
      }
      this.broadcastStatus();
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
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
      this.stopHeartbeat();
      if (this.ws === socket) this.ws = null;
      this.broadcastStatus();
      if (!this.deliberateClose && this.config?.roomId) this.scheduleReconnect();
    };
  }

  private async leaveRoom() {
    this.deliberateClose = true;
    this.pendingCreate = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;

    this.send({ type: "Leave" });
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;

    if (this.config) this.config = { serverUrl: this.config.serverUrl };
    await this.saveSession();
    this.broadcastStatus();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.config?.roomId) return;
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

  private createRoom() {
    this.deliberateClose = false;
    if (!this.send({ type: "Create" })) {
      this.pendingCreate = true;
      this.connect();
    }
  }

  private joinRoom(roomId: string) {
    if (!this.config) return;
    const trimmed = roomId.trim();
    if (!trimmed || trimmed.length > MAX_ROOM_ID_LENGTH) return;

    this.config = { ...this.config, roomId: trimmed };
    this.deliberateClose = false;
    if (!this.send({ type: "Join", room_id: trimmed })) this.connect();
  }

  private async handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "RoomCreated":
        if (this.config) this.config = { ...this.config, roomId: msg.room_id };
        break;

      case "RoomJoined":
        if (this.config) {
          this.config = {
            ...this.config,
            roomId: msg.room_id,
            isHost: msg.is_host,
            userName: msg.your_name,
          };
        }
        await this.saveSession();
        this.broadcastStatus();
        break;

      case "HostChanged":
        if (this.config?.userName === msg.user_name) {
          this.config = { ...this.config, isHost: true };
          await this.saveSession();
          this.broadcastStatus();
        }
        break;

      case "Sync":
        if (!this.config?.isHost) await this.applyToTab(msg.time, msg.paused);
        break;

      case "Error":
        this.broadcastError(msg.message);
        break;

      case "UserJoined":
      case "UserLeft":
        this.broadcastStatus();
        break;
    }
  }

  private async applyToTab(time: number, paused: boolean) {
    if (this.activeTabId === null || !isPlaybackTime(time)) return;
    try {
      await browser.tabs.sendMessage(this.activeTabId, {
        type: "APPLY_STATE",
        state: { time, paused },
      } as MessageType);
    } catch {
      this.activeTabId = null;
    }
  }

  private broadcastStatus() {
    this.post({
      type: "CONNECTION_STATUS",
      connected: this.isOpen(),
      config: this.config ?? undefined,
    });
  }

  private broadcastError(message: string) {
    this.post({ type: "ERROR", message });
  }

  private post(message: MessageType) {
    browser.runtime.sendMessage(message).catch(() => {});
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.send({ type: "Heartbeat" })) this.stopHeartbeat();
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

new SyncManager();
