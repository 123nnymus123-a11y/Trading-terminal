import type { ReplayStatus } from "./events.js";

export type StreamSource = "demo" | "replay";
export type StreamStatus = {
  source: StreamSource;
  replay?: ReplayStatus | null;
};

/**
 * IPC channel names.
 * We expose both a preferred set + a compatibility alias list,
 * because your preload may already be using older names.
 */
export const IPC = {
  EVENTS: "tc:events",
  SET_SOURCE: "tc:setSource",
  GET_STATUS: "tc:getStatus",
  REPLAY_PLAY: "tc:replay:play",
  REPLAY_PAUSE: "tc:replay:pause",
  REPLAY_SET_SPEED: "tc:replay:setSpeed",
  REPLAY_SCRUB_TO: "tc:replay:scrubTo",
} as const;

export const LEGACY_IPC_ALIASES = {
  EVENTS: ["tc:events", "cockpit:events", "streaming:events"],
  SET_SOURCE: ["tc:setSource", "cockpit:setSource", "streaming:setSource"],
  GET_STATUS: ["tc:getStatus", "cockpit:getStatus", "streaming:getStatus"],
  REPLAY_PLAY: [
    "tc:replay:play",
    "cockpit:replay:play",
    "streaming:replay:play",
  ],
  REPLAY_PAUSE: [
    "tc:replay:pause",
    "cockpit:replay:pause",
    "streaming:replay:pause",
  ],
  REPLAY_SET_SPEED: [
    "tc:replay:setSpeed",
    "cockpit:replay:setSpeed",
    "streaming:replay:setSpeed",
  ],
  REPLAY_SCRUB_TO: [
    "tc:replay:scrubTo",
    "cockpit:replay:scrubTo",
    "streaming:replay:scrubTo",
  ],
} as const;
