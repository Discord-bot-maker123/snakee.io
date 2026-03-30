export const ARENA_RADIUS = 3600;
export const SERVER_TICK_RATE = 20;
export const CLIENT_RENDER_FPS = 60;
export const INPUT_SEND_RATE = 30;

export const MAX_ORBS = 2200;
export const ORB_MIN_SIZE = 4;
export const ORB_PULSE_SPEED = 1.8;

// Orb tiers: [size, value, spawnWeight]
// common: small, worth 1 segment | uncommon: medium, worth 3 | rare: large, worth 7
export const ORB_TIERS: ReadonlyArray<{ size: number; value: number; weight: number }> = [
  { size: 4,  value: 1, weight: 65 },
  { size: 10, value: 3, weight: 25 },
  { size: 18, value: 7, weight: 10 },
];

export const SNAKE_START_LENGTH = 3;
export const SEGMENT_SPACING = 12;
export const SNAKE_BASE_SPEED = 220;
export const SNAKE_TURN_SPEED = 4.5;
export const SNAKE_HEAD_RADIUS = 14;
export const SNAKE_BODY_RADIUS = 10;

export const BOOST_MULTIPLIER = 1.6;
export const BOOST_ENERGY_MAX = 100;
export const BOOST_ENERGY_DRAIN_PER_SEC = 34;
export const BOOST_ENERGY_REGEN_PER_SEC = 26;
export const BOOST_ORB_DROP_INTERVAL_SEC = 1;
export const BOOST_START_MIN_SEGMENTS = 6;
export const BOT_BOOST_START_MIN_SEGMENTS = 3;
export const BOOST_HARD_MIN_SEGMENTS = 3;

export const CAMERA_LERP = 0.1;
export const CAMERA_ZOOM_MIN = 0.6;
export const CAMERA_ZOOM_MAX = 1.1;

export const NETWORK_PROTOCOL_VERSION = 1;
export const GRID_SIZE = 120;
export const BACKGROUND_COLOR = 0x05070a;
export const GRID_COLOR = 0x111826;
export const ARENA_BORDER_COLOR = 0x3cf2ff;
