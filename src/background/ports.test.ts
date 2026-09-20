import { describe, expect, test } from "bun:test";
import { isTrustedPort } from "./ports";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const page = (name: string) => ({ name, sender: { id: ID } });

describe("isTrustedPort", () => {
  test("accepts the extension's own popup and options pages", () => {
    expect(isTrustedPort(page("popup"), ID)).toBe(true);
    expect(isTrustedPort(page("options"), ID)).toBe(true);
  });

  test("rejects a content script, which carries a tab", () => {
    expect(
      isTrustedPort({ name: "popup", sender: { id: ID, tab: { id: 7 } } }, ID),
    ).toBe(false);
  });

  test("rejects another extension", () => {
    expect(isTrustedPort({ name: "popup", sender: { id: "other" } }, ID)).toBe(
      false,
    );
  });

  test("rejects a port with no sender", () => {
    expect(isTrustedPort({ name: "popup" }, ID)).toBe(false);
    expect(isTrustedPort({ name: "popup", sender: {} }, ID)).toBe(false);
  });

  test("rejects an unknown channel name", () => {
    expect(isTrustedPort(page("content"), ID)).toBe(false);
    expect(isTrustedPort(page(""), ID)).toBe(false);
    expect(isTrustedPort(page("frametogether-extension"), ID)).toBe(false);
  });
});
