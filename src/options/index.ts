import browser from "webextension-polyfill";

class OptionsUI {
  private serverInput: HTMLInputElement;
  private saveBtn: HTMLButtonElement;
  private defaultBtn: HTMLButtonElement;
  private status: HTMLElement;

  constructor() {
    this.serverInput = document.getElementById("serverUrl") as HTMLInputElement;
    this.saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
    this.defaultBtn = document.getElementById(
      "defaultBtn",
    ) as HTMLButtonElement;
    this.status = document.getElementById("status")!;

    this.init();
  }

  private async init() {
    const settings = await browser.storage.sync.get(["serverUrl"]);
    if (settings.serverUrl && typeof settings.serverUrl === "string") {
      this.serverInput.value = settings.serverUrl;
    }

    this.saveBtn.addEventListener("click", () => this.save());
    this.defaultBtn.addEventListener("click", () => this.useDefault());
    this.serverInput.addEventListener("input", () => this.clearStatus());
  }

  private async save() {
    const url = this.serverInput.value.trim();

    if (!url) {
      this.showStatus("Please enter a server URL.", "error");
      return;
    }

    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      this.showStatus("URL must start with ws:// or wss:// prefix.", "error");
      return;
    }

    try {
      await browser.storage.sync.set({ serverUrl: url });

      const port = browser.runtime.connect({ name: "options" });
      port.postMessage({ type: "SET_SERVER", url });

      this.showStatus("Settings saved!", "success");
    } catch (error) {
      this.showStatus("Failed to save settings.", "error");
    }
  }

  private async useDefault() {
    const defaultUrl = "wss://frametogether.19702038.xyz";
    this.serverInput.value = defaultUrl;
    await this.save();
  }

  private showStatus(message: string, type: "success" | "error") {
    this.status.textContent = message;
    this.status.className = `${type} visible`;

    setTimeout(() => this.clearStatus(), 3000);
  }

  private clearStatus() {
    this.status.textContent = "";
    this.status.className = "";
  }
}

new OptionsUI();
