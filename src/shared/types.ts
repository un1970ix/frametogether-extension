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

export type MessageType =
  | { type: "VIDEO_STATE"; state: VideoState }
  | { type: "APPLY_STATE"; state: VideoState }
  | { type: "CONNECTION_STATUS"; connected: boolean; config?: SyncConfig }
  | { type: "ERROR"; message: string };
