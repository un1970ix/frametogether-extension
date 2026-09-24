import { describe, expect, test } from "bun:test";
import { isTrustedPort } from "./ports";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${ID}/`;
const page = (name: string, tab?: unknown) => ({
  name,
  sender: { id: ID, url: `${ORIGIN}html/${name}.html`, tab },
});

describe("isTrustedPort", () => {
  test("accepts the extension's own popup and options pages", () => {
    expect(isTrustedPort(page("popup"), ID, ORIGIN)).toBe(true);
    expect(isTrustedPort(page("options"), ID, ORIGIN)).toBe(true);
  });

  test("accepts the options page when it is opened in a tab", () => {
    expect(isTrustedPort(page("options", { id: 3 }), ID, ORIGIN)).toBe(true);
  });

  test("rejects a content script, which runs on a web page", () => {
    const port = {
      name: "popup",
      sender: { id: ID, url: "https://mubi.com/films", tab: { id: 7 } },
    };
    expect(isTrustedPort(port, ID, ORIGIN)).toBe(false);
  });

  test("rejects another extension", () => {
    const port = {
      name: "popup",
      sender: { id: "other", url: "chrome-extension://other/html/popup.html" },
    };
    expect(isTrustedPort(port, ID, ORIGIN)).toBe(false);
  });

  test("rejects a lookalike extension origin", () => {
    const port = {
      name: "popup",
      sender: { id: ID, url: `chrome-extension://${ID}x/html/popup.html` },
    };
    expect(isTrustedPort(port, ID, ORIGIN)).toBe(false);
  });

  test("rejects a port with no sender or no sender URL", () => {
    expect(isTrustedPort({ name: "popup" }, ID, ORIGIN)).toBe(false);
    expect(isTrustedPort({ name: "popup", sender: {} }, ID, ORIGIN)).toBe(false);
    expect(isTrustedPort({ name: "popup", sender: { id: ID } }, ID, ORIGIN)).toBe(
      false,
    );
  });

  test("rejects an unknown channel name", () => {
    expect(isTrustedPort(page("content"), ID, ORIGIN)).toBe(false);
    expect(isTrustedPort(page(""), ID, ORIGIN)).toBe(false);
    expect(isTrustedPort(page("frametogether-extension"), ID, ORIGIN)).toBe(
      false,
    );
  });
});
