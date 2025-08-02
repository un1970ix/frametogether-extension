import browser from "webextension-polyfill";
import type { MessageType, SyncConfig, VideoState } from "../shared/types";

class SyncManager {
  private ws: WebSocket | null = null;
  private config: SyncConfig | null = null;
  private reconnectTimer: number | null = null;
  private activeTabId: number | null = null;
  private heartbeatTimer: number | null = null;
  private lastVideoState: VideoState | null = null;

  constructor() {
    this.init();
  }

  private async init() {
    const saved = await browser.storage.sync.get(["serverUrl"]);
    if (saved.serverUrl && typeof saved.serverUrl === "string") {
      this.config = { serverUrl: saved.serverUrl };
    }

    browser.runtime.onMessage.addListener(
      (message: unknown, sender: browser.Runtime.MessageSender) => {
        const msg = message as any;

        if (msg.type === "TEST") {
          return Promise.resolve({ status: "ok" });
        }

        if (msg.type === "VIDEO_STATE" && sender.tab?.id) {
          this.activeTabId = sender.tab.id;
          this.handleVideoState(msg.state);
        }
        return Promise.resolve();
      },
    );

    browser.runtime.onConnect.addListener((port) => {
      port.onMessage.addListener((msg) => {
        this.handleCommand(msg, port);
      });
    });
  }

  private handleCommand(msg: any, port: browser.Runtime.Port) {
    switch (msg.type) {
      case "CREATE_ROOM":
        this.createRoom();
        break;
      case "JOIN_ROOM":
        this.joinRoom(msg.roomId);
        break;
      case "LEAVE_ROOM":
        this.disconnect();
        break;
      case "GET_STATUS":
        port.postMessage({
          type: "STATUS",
          connected: this.ws?.readyState === WebSocket.OPEN,
          config: this.config,
        });
        break;
      case "SET_SERVER":
        this.setServer(msg.url);
        break;
    }
  }

  private async setServer(url: string) {
    this.config = { serverUrl: url };
    await browser.storage.sync.set({ serverUrl: url });
    this.disconnect();
  }

  private connect() {
    if (!this.config?.serverUrl) return;

    try {
      let wsUrl = this.config.serverUrl;
      if (!wsUrl.endsWith("/")) {
        wsUrl += "/";
      }
      wsUrl += "sync";

      console.log("FrameTogether: Connecting to", wsUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("FrameTogether: Connected to server");
        this.broadcastStatus();
        this.startHeartbeat();

        if (this.config?.roomId) {
          setTimeout(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(
                JSON.stringify({ type: "Join", room_id: this.config!.roomId }),
              );
            }
          }, 100);
        }
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log("FrameTogether: Received message", msg);
        this.handleServerMessage(msg);
      };

      this.ws.onclose = () => {
        console.log("FrameTogether: Disconnected");
        this.stopHeartbeat();
        this.broadcastStatus();
        if (this.config?.roomId) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error("FrameTogether: WebSocket error", error);
      };
    } catch (error) {
      console.error("FrameTogether: Failed to connect", error);
    }
  }

  private disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.config) {
      this.config = {
        serverUrl: this.config.serverUrl,
        roomId: undefined,
        isHost: undefined,
        userName: undefined,
      };
    }
    this.broadcastStatus();
  }

  private scheduleReconnect() {
    if (this.config?.roomId && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 3000) as any;
    }
  }

  private createRoom() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "Create" }));
    } else {
      this.connect();
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "Create" }));
        }
      }, 500);
    }
  }

  private joinRoom(roomId: string) {
    if (this.config) {
      this.config = { ...this.config, roomId };
    } else {
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "Join", room_id: roomId }));
    } else {
      this.connect();
    }
  }

  private handleVideoState(state: VideoState) {
    this.lastVideoState = state;

    if (this.ws?.readyState === WebSocket.OPEN && this.config?.isHost) {
      this.ws.send(
        JSON.stringify({
          type: "State",
          time: state.time,
          paused: state.paused,
        }),
      );
    }
  }

  private handleServerMessage(msg: any) {
    switch (msg.type) {
      case "RoomCreated":
        if (this.config) {
          this.config = { ...this.config, roomId: msg.room_id };
          if (this.ws?.readyState === WebSocket.OPEN) {
            setTimeout(() => {
              this.ws!.send(
                JSON.stringify({ type: "Join", room_id: msg.room_id }),
              );
            }, 100);
          }
        }
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
        this.broadcastStatus();
        break;

      case "Sync":
        if (!this.config?.isHost && this.activeTabId) {
          browser.tabs.sendMessage(this.activeTabId, {
            type: "APPLY_STATE",
            state: { time: msg.time, paused: msg.paused },
          } as MessageType);
        }
        break;

      case "Error":
        console.error("FrameTogether: Server error", msg.message);
        this.broadcastStatus();
        break;
    }
  }

  private broadcastStatus() {
    browser.runtime
      .sendMessage({
        type: "CONNECTION_STATUS",
        connected: this.ws?.readyState === WebSocket.OPEN,
        config: this.config,
      } as MessageType)
      .catch(() => {});
  }

  private startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "Heartbeat" }));
      }
    }, 15000) as any;
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

new SyncManager();
