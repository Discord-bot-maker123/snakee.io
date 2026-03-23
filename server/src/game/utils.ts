export type DeathEvent = {
  victimId: string;
  killerId: string | null;
  killerName: string | null;
  finalScore: number;
  finalLength: number;
};

export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = angle % twoPi;
  if (wrapped > Math.PI) {
    wrapped -= twoPi;
  }
  if (wrapped < -Math.PI) {
    wrapped += twoPi;
  }
  return wrapped;
}

export function randomColor(): number {
  const palette = [0x29f1ff, 0x4ef37e, 0xff8b2d, 0xff5f86, 0xf9f871, 0x9a95ff];
  return palette[Math.floor(Math.random() * palette.length)];
}
