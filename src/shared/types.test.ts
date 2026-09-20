import { describe, expect, test } from "bun:test";
import {
  isMubiUrl,
  isPlaybackTime,
  normalizeServerUrl,
  parseServerMessage,
} from "./types";

describe("normalizeServerUrl", () => {
  test("accepts wss and normalizes trailing slash, query and fragment", () => {
    const r = normalizeServerUrl("  wss://example.com/base/?x=1#f  ");
    expect(r).toEqual({ ok: true, url: "wss://example.com/base" });
  });

  test("rejects plaintext ws to a remote host", () => {
    const r = normalizeServerUrl("ws://example.com");
    expect(r.ok).toBe(false);
  });

  test("allows plaintext ws only for loopback", () => {
    expect(normalizeServerUrl("ws://localhost:47642").ok).toBe(true);
    expect(normalizeServerUrl("ws://127.0.0.1:47642").ok).toBe(true);
    expect(normalizeServerUrl("ws://[::1]:47642").ok).toBe(true);
  });

  test("rejects non-websocket schemes", () => {
    for (const bad of [
      "https://example.com",
      "http://example.com",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      expect(normalizeServerUrl(bad).ok).toBe(false);
    }
  });

  test("rejects embedded credentials", () => {
    expect(normalizeServerUrl("wss://user:pass@example.com").ok).toBe(false);
  });
});

describe("isMubiUrl", () => {
  test("accepts exactly the host the content script runs on", () => {
    expect(isMubiUrl("https://mubi.com/en/films/1")).toBe(true);
    expect(isMubiUrl("https://mubi.com/")).toBe(true);
  });

  test("rejects lookalikes that a substring check would accept", () => {
    for (const bad of [
      "https://mubi.com.evil.net/",
      "https://notmubi.com/",
      "https://evil.net/?q=mubi.com",
      "http://mubi.com/",
      "https://www.mubi.com/",
      undefined,
    ]) {
      expect(isMubiUrl(bad)).toBe(false);
    }
  });
});

describe("isPlaybackTime", () => {
  test("rejects values that would break the player or other clients", () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, 1e18, "5", null, {}]) {
      expect(isPlaybackTime(bad)).toBe(false);
    }
    expect(isPlaybackTime(0)).toBe(true);
    expect(isPlaybackTime(120.5)).toBe(true);
  });
});

describe("parseServerMessage", () => {
  test("accepts well-formed messages", () => {
    expect(parseServerMessage({ type: "RoomCreated", room_id: "abc123" }))
      .toEqual({ type: "RoomCreated", room_id: "abc123" });
    expect(parseServerMessage({ type: "Sync", time: 12.5, paused: false }))
      .toEqual({ type: "Sync", time: 12.5, paused: false });
    expect(
      parseServerMessage({
        type: "RoomJoined",
        room_id: "abc",
        is_host: true,
        your_name: "Happy Panda",
        participants: [{ name: "Clever Fox", is_host: false }],
      }),
    ).toBeTruthy();
  });

  test("rejects a hostile server's malformed or out-of-range fields", () => {
    const hostile = [
      null,
      "string",
      { type: "Nope" },
      { type: "RoomCreated" },
      { type: "RoomCreated", room_id: "" },
      { type: "RoomCreated", room_id: "x".repeat(500) },
      { type: "RoomCreated", room_id: 123 },
      { type: "Sync", time: NaN, paused: false },
      { type: "Sync", time: null, paused: false },
      { type: "Sync", time: 1e30, paused: false },
      { type: "Sync", time: 5, paused: "yes" },
      { type: "RoomJoined", room_id: "a", is_host: "yes", your_name: "n", participants: [] },
      { type: "RoomJoined", room_id: "a", is_host: true, your_name: "n", participants: "nope" },
      { type: "RoomJoined", room_id: "a", is_host: true, your_name: "n", participants: [{ name: 1 }] },
      { type: "UserJoined", user: { name: "x" } },
      { type: "UserLeft", user_name: 42 },
      { type: "Error", message: "" },
    ];
    for (const msg of hostile) {
      expect(parseServerMessage(msg)).toBeNull();
    }
  });

  test("does not let prototype pollution through", () => {
    const evil = JSON.parse('{"type":"Sync","time":5,"paused":false,"__proto__":{"polluted":true}}');
    const parsed = parseServerMessage(evil);
    expect(parsed).toEqual({ type: "Sync", time: 5, paused: false });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
