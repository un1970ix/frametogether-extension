export interface VideoState {
  time: number;
  paused: boolean;
}

export interface SyncConfig {
  serverUrl: string;
  roomId?: string;
  isHost?: boolean;
  userName?: string;
}

export interface Participant {
  name: string;
  is_host: boolean;
}

export type MessageType =
  | { type: "TEST" }
  | { type: "VIDEO_STATE"; state: VideoState; fresh?: boolean }
  | { type: "APPLY_STATE"; state: VideoState }
  | { type: "GET_STATE" }
  | { type: "CONNECTION_STATUS"; connected: boolean; config?: SyncConfig }
  | { type: "ERROR"; message: string };

export type ServerMessage =
  | { type: "RoomCreated"; room_id: string }
  | {
      type: "RoomJoined";
      room_id: string;
      is_host: boolean;
      your_name: string;
      participants: Participant[];
    }
  | { type: "Sync"; time: number; paused: boolean }
  | { type: "UserJoined"; user: Participant }
  | { type: "UserLeft"; user_name: string }
  | { type: "HostChanged"; user_name: string }
  | { type: "Error"; message: string };

export const MAX_ROOM_ID_LENGTH = 64;
export const MAX_NAME_LENGTH = 64;
export const MAX_PARTICIPANTS = 256;
export const MAX_PLAYBACK_SECONDS = 86_400;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

export const isPlaybackTime = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= MAX_PLAYBACK_SECONDS;

export const isVideoState = (v: unknown): v is VideoState =>
  isRecord(v) && isPlaybackTime(v.time) && typeof v.paused === "boolean";

function parseParticipant(v: unknown): Participant | null {
  if (!isRecord(v) || !isText(v.name, MAX_NAME_LENGTH)) return null;
  if (typeof v.is_host !== "boolean") return null;
  return { name: v.name, is_host: v.is_host };
}

function parseParticipants(v: unknown): Participant[] | null {
  if (!Array.isArray(v) || v.length > MAX_PARTICIPANTS) return null;
  const out: Participant[] = [];
  for (const entry of v) {
    const p = parseParticipant(entry);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  const { type } = raw;

  switch (type) {
    case "RoomCreated":
      return isText(raw.room_id, MAX_ROOM_ID_LENGTH)
        ? { type, room_id: raw.room_id }
        : null;

    case "RoomJoined": {
      const participants = parseParticipants(raw.participants);
      if (!participants) return null;
      if (!isText(raw.room_id, MAX_ROOM_ID_LENGTH)) return null;
      if (!isText(raw.your_name, MAX_NAME_LENGTH)) return null;
      if (typeof raw.is_host !== "boolean") return null;
      return {
        type,
        room_id: raw.room_id,
        is_host: raw.is_host,
        your_name: raw.your_name,
        participants,
      };
    }

    case "Sync":
      return isPlaybackTime(raw.time) && typeof raw.paused === "boolean"
        ? { type, time: raw.time, paused: raw.paused }
        : null;

    case "UserJoined": {
      const user = parseParticipant(raw.user);
      return user ? { type, user } : null;
    }

    case "UserLeft":
    case "HostChanged":
      return isText(raw.user_name, MAX_NAME_LENGTH)
        ? { type, user_name: raw.user_name }
        : null;

    case "Error":
      return isText(raw.message, 512) ? { type, message: raw.message } : null;

    default:
      return null;
  }
}

export type UrlResult = { ok: true; url: string } | { ok: false; error: string };

export function normalizeServerUrl(input: string): UrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Please enter a server URL." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return { ok: false, error: "URL must start with ws:// or wss:// prefix." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URL must not contain credentials." };
  }
  if (parsed.protocol === "ws:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    return {
      ok: false,
      error: "Use wss://. Plain ws:// is only allowed for localhost.",
    };
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.protocol}//${parsed.host}${path}` };
}

export function isMubiUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname === "mubi.com";
  } catch {
    return false;
  }
}
