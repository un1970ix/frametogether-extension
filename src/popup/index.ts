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

    status.className = "status";
    status.textContent = "";
    content.textContent = "";

    if (!this.config.serverUrl) {
      const errorSpan = document.createElement("span");
      errorSpan.className = "error";
      errorSpan.textContent = "⚠️ No server configured.";
      status.appendChild(errorSpan);

      const p = document.createElement("p");
      p.textContent = "Please configure a server in the ";

      const optionsLink = document.createElement("a");
      optionsLink.href = "#";
      optionsLink.textContent = "options";
      optionsLink.addEventListener("click", (e) => {
        e.preventDefault();
        browser.runtime.openOptionsPage();
      });

      p.appendChild(optionsLink);
      p.appendChild(document.createTextNode("."));
      content.appendChild(p);
      return;
    }

    if (this.connected && this.config.roomId) {
      const connectedSpan = document.createElement("span");
      connectedSpan.className = "connected";
      connectedSpan.textContent = "🟢 Connected.";
      status.appendChild(connectedSpan);

      const infoDiv = document.createElement("div");
      infoDiv.className = "info";

      const roomP = document.createElement("p");
      const roomStrong = document.createElement("strong");
      roomStrong.textContent = "Room:";
      const roomCode = document.createElement("code");
      roomCode.textContent = this.config.roomId || "";
      roomP.appendChild(roomStrong);
      roomP.appendChild(document.createTextNode(" "));
      roomP.appendChild(roomCode);
      infoDiv.appendChild(roomP);

      const userP = document.createElement("p");
      const userStrong = document.createElement("strong");
      userStrong.textContent = "You are:";
      userP.appendChild(userStrong);
      userP.appendChild(
        document.createTextNode(" " + (this.config.userName || "Unknown")),
      );
      infoDiv.appendChild(userP);

      const roleP = document.createElement("p");
      const roleStrong = document.createElement("strong");
      roleStrong.textContent = "Role:";
      roleP.appendChild(roleStrong);
      roleP.appendChild(
        document.createTextNode(" " + (this.config.isHost ? "Host" : "Viewer")),
      );
      infoDiv.appendChild(roleP);

      content.appendChild(infoDiv);

      const leaveBtn = document.createElement("button");
      leaveBtn.id = "leaveBtn";
      leaveBtn.className = "btn btn-danger";
      leaveBtn.textContent = "Leave Room";
      leaveBtn.addEventListener("click", () => {
        this.port.postMessage({ type: "LEAVE_ROOM" });
      });
      content.appendChild(leaveBtn);

      const copyBtn = document.createElement("button");
      copyBtn.id = "copyBtn";
      copyBtn.className = "btn btn-secondary";
      copyBtn.textContent = "Copy Room ID";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(this.config.roomId);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy Room ID";
        }, 1500);
      });
      content.appendChild(copyBtn);
    } else {
      const disconnectedSpan = document.createElement("span");
      disconnectedSpan.className = "disconnected";
      disconnectedSpan.textContent = "⚪ Not connected.";
      status.appendChild(disconnectedSpan);

      const createBtn = document.createElement("button");
      createBtn.id = "createBtn";
      createBtn.className = "btn btn-primary";
      createBtn.textContent = "Create Room";
      createBtn.addEventListener("click", () => {
        this.port.postMessage({ type: "CREATE_ROOM" });
      });
      content.appendChild(createBtn);

      const divider = document.createElement("div");
      divider.className = "divider";
      divider.textContent = "or";
      content.appendChild(divider);

      const roomInput = document.createElement("input");
      roomInput.type = "text";
      roomInput.id = "roomInput";
      roomInput.placeholder = "Enter room ID.";
      roomInput.maxLength = 6;
      content.appendChild(roomInput);

      const joinBtn = document.createElement("button");
      joinBtn.id = "joinBtn";
      joinBtn.className = "btn btn-secondary";
      joinBtn.textContent = "Join Room";
      joinBtn.addEventListener("click", () => {
        const roomId = roomInput.value.trim();
        if (roomId) {
          this.port.postMessage({ type: "JOIN_ROOM", roomId });
        }
      });
      content.appendChild(joinBtn);
    }
  }

  private showNotOnMubi() {
    const status = document.getElementById("status")!;
    const content = document.getElementById("content")!;

    status.className = "status";
    status.textContent = "";
    content.textContent = "";

    const errorSpan = document.createElement("span");
    errorSpan.className = "error";
    errorSpan.textContent = "📺 Not on MUBI.";
    status.appendChild(errorSpan);

    const p = document.createElement("p");
    p.textContent = "Please navigate to ";

    const link = document.createElement("a");
    link.href = "https://mubi.com";
    link.target = "_blank";
    link.textContent = "mubi.com";

    p.appendChild(link);
    p.appendChild(document.createTextNode(" to use FrameTogether."));
    content.appendChild(p);
  }
}

new PopupUI();
