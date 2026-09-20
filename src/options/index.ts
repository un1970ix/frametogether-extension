import browser from "webextension-polyfill";
import { normalizeServerUrl } from "../shared/types";

const DEFAULT_SERVER = "wss://frametogether.19702038.xyz";
const STATUS_MS = 4_000;

class OptionsUI {
  private serverInput = document.getElementById("serverUrl") as HTMLInputElement;
  private saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
  private defaultBtn = document.getElementById("defaultBtn") as HTMLButtonElement;
  private status = document.getElementById("status")!;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.init();
  }

  private async init() {
    const settings = await browser.storage.sync.get(["serverUrl"]);
    if (typeof settings.serverUrl === "string") {
      this.serverInput.value = settings.serverUrl;
    }

    this.saveBtn.addEventListener("click", () => this.save());
    this.defaultBtn.addEventListener("click", () => {
      this.serverInput.value = DEFAULT_SERVER;
      this.save();
    });
    this.serverInput.addEventListener("input", () => this.clearStatus());
  }

  private save() {
    const parsed = normalizeServerUrl(this.serverInput.value);
    if (!parsed.ok) {
      this.showStatus(parsed.error, "error");
      return;
    }

    try {
      this.serverInput.value = parsed.url;
      const port = browser.runtime.connect({ name: "options" });
      port.postMessage({ type: "SET_SERVER", url: parsed.url });
      port.disconnect();
      this.showStatus("Settings saved!", "success");
    } catch {
      this.showStatus("Failed to save settings.", "error");
    }
  }

  private showStatus(message: string, type: "success" | "error") {
    this.status.textContent = message;
    this.status.className = `${type} visible`;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.clearStatus(), STATUS_MS);
  }

  private clearStatus() {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = null;
    this.status.textContent = "";
    this.status.className = "";
  }
}

new OptionsUI();
