export type Vec2 = {
  x: number;
  y: number;
};

export type SnakeSegment = Vec2;

export type SnakeState = {
  id: string;
  name: string;
  color: number;
  score: number;
  alive: boolean;
  segments: SnakeSegment[];
};

export type OrbState = {
  id: string;
  x: number;
  y: number;
  color: number;
  size: number;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  score: number;
  color: number;
};

export type WelcomeMsg = {
  type: "welcome";
  protocolVersion: number;
  playerId: string;
  worldRadius: number;
  serverTime: number;
  snakes: SnakeState[];
  orbs: OrbState[];
};

export type TickMsg = {
  type: "tick";
  serverTime: number;
  tick: number;
  snakes: SnakeState[];
  orbs: OrbState[];
  removedSnakeIds: string[];
  removedOrbIds: string[];
  leaderboard: LeaderboardEntry[];
};

export type DeathMsg = {
  type: "death";
  victimId: string;
  killerId: string | null;
  killerName: string | null;
  finalScore: number;
  finalLength: number;
};

export type InputMsg = {
  type: "input";
  angle: number;
  boosting: boolean;
  seq: number;
  timestamp: number;
};

export type JoinMsg = {
  type: "join";
  name: string;
};

export type ServerMsg = WelcomeMsg | TickMsg | DeathMsg;
export type ClientMsg = InputMsg | JoinMsg;
