import * as PIXI from "pixi.js";
import { Text, TextStyle } from "pixi.js";
import { SNAKE_BODY_RADIUS } from "snakee-shared/constants";
import type { SnakeState } from "snakee-shared/types";

type SnakeDisplay = {
  container: PIXI.Container;
  body: PIXI.Graphics;
  head: PIXI.Graphics;
  nameText: Text;
};

type SnakeTheme = {
  primary: number;
  secondary: number;
};

// 12 themes matching snake.io's colour variety — natural and neon tones
const SNAKE_THEMES: SnakeTheme[] = [
  { primary: 0x4fc3f7, secondary: 0x0277bd },  // sky blue
  { primary: 0x81c784, secondary: 0x2e7d32 },  // forest green
  { primary: 0xff7043, secondary: 0xbf360c },  // orange-red
  { primary: 0xce93d8, secondary: 0x6a1b9a },  // purple
  { primary: 0xf48fb1, secondary: 0xad1457 },  // pink
  { primary: 0xffca28, secondary: 0xe65100 },  // amber
  { primary: 0x4db6ac, secondary: 0x00695c },  // teal
  { primary: 0xef5350, secondary: 0xb71c1c },  // red
  { primary: 0xd4e157, secondary: 0x558b2f },  // lime
  { primary: 0xc8a97e, secondary: 0x6d4c2b },  // natural tan (snake.io earthy feel)
  { primary: 0x80deea, secondary: 0x00838f },  // cyan
  { primary: 0x90a4ae, secondary: 0x37474f },  // slate
];

export class SnakeRenderer {
  private readonly layer: PIXI.Container;

  private readonly displays: Map<string, SnakeDisplay>;

  private readonly nameStyle: TextStyle;

  public constructor(layer: PIXI.Container) {
    this.layer = layer;
    this.displays = new Map<string, SnakeDisplay>();
    this.nameStyle = new TextStyle({
      fontFamily: "'Arial Rounded MT Bold', 'Arial', sans-serif",
      fontSize: 13,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
      align: "center"
    });
  }

  public render(snakes: SnakeState[]): void {
    const seen = new Set<string>();

    for (const snake of snakes) {
      if (!snake.alive || snake.segments.length === 0) {
        continue;
      }
      seen.add(snake.id);
      const display = this.ensureDisplay(snake.id);
      this.drawSnake(display, snake);
    }

    for (const [id, display] of this.displays.entries()) {
      if (!seen.has(id)) {
        this.layer.removeChild(display.container);
        display.container.destroy({ children: true });
        this.displays.delete(id);
      }
    }
  }

  private ensureDisplay(id: string): SnakeDisplay {
    const existing = this.displays.get(id);
    if (existing) {
      return existing;
    }

    const container = new PIXI.Container();
    const body = new PIXI.Graphics();
    const head = new PIXI.Graphics();
    const nameText = new Text({ text: "", style: this.nameStyle });
    nameText.anchor.set(0.5, 1);

    container.addChild(body);
    container.addChild(head);
    container.addChild(nameText);
    this.layer.addChild(container);

    const created: SnakeDisplay = { container, body, head, nameText };
    this.displays.set(id, created);
    return created;
  }

  private drawSnake(display: SnakeDisplay, snake: SnakeState): void {
    display.body.clear();
    display.head.clear();

    const head = snake.segments[0];
    const theme = SNAKE_THEMES[this.themeIndexFromId(snake.id)];

    const scoreFactor = Math.min(2.5, 1 + Math.sqrt(snake.score || 0) * 0.04);
    const bodyRadius = SNAKE_BODY_RADIUS * 1.5 * scoreFactor;
    const headRadius = bodyRadius * 1.05;

    // Body segments — drawn back-to-front so head overlaps
    for (let i = snake.segments.length - 1; i >= 1; i -= 1) {
      const segment = snake.segments[i];

      // 3-segment colour banding: stripes are wide and clear like snake.io
      const color = (Math.floor(i / 3) % 2 === 0) ? theme.primary : theme.secondary;

      // --- Base sphere fill ---
      display.body.beginFill(color, 1);
      display.body.drawCircle(segment.x, segment.y, bodyRadius);
      display.body.endFill();

      // --- 3D specular highlight: bright spot upper-left, makes segments look like shiny balls ---
      display.body.beginFill(0xffffff, 0.24);
      display.body.drawCircle(
        segment.x - bodyRadius * 0.28,
        segment.y - bodyRadius * 0.28,
        bodyRadius * 0.40
      );
      display.body.endFill();

      // --- Boost inner white glow ---
      if (snake.boosting) {
        display.body.beginFill(0xffffff, 0.28);
        display.body.drawCircle(segment.x, segment.y, bodyRadius * 0.48);
        display.body.endFill();
      }
    }

    // --- Head ---
    display.head.beginFill(theme.primary, 1);
    display.head.drawCircle(head.x, head.y, headRadius);
    display.head.endFill();

    // Head specular highlight
    display.head.beginFill(0xffffff, 0.26);
    display.head.drawCircle(
      head.x - headRadius * 0.28,
      head.y - headRadius * 0.28,
      headRadius * 0.40
    );
    display.head.endFill();

    // --- Eyes: track direction of travel ---
    const neck = snake.segments[1] ?? { x: head.x - 1, y: head.y };
    const angle = Math.atan2(head.y - neck.y, head.x - neck.x);

    const eyeSize  = headRadius * 0.40;
    const pupilSize = eyeSize * 0.52;
    const eyeOffset = headRadius * 0.48;

    // Left eye
    const lx = head.x + Math.cos(angle - 0.62) * eyeOffset;
    const ly = head.y + Math.sin(angle - 0.62) * eyeOffset;
    display.head.beginFill(0xffffff, 1);
    display.head.drawCircle(lx, ly, eyeSize);
    display.head.endFill();
    display.head.beginFill(0x111111, 1);
    display.head.drawCircle(
      lx + Math.cos(angle) * (eyeSize * 0.35),
      ly + Math.sin(angle) * (eyeSize * 0.35),
      pupilSize
    );
    display.head.endFill();
    // Eye shine
    display.head.beginFill(0xffffff, 0.7);
    display.head.drawCircle(
      lx + Math.cos(angle) * (eyeSize * 0.35) - eyeSize * 0.18,
      ly + Math.sin(angle) * (eyeSize * 0.35) - eyeSize * 0.18,
      pupilSize * 0.38
    );
    display.head.endFill();

    // Right eye
    const rx = head.x + Math.cos(angle + 0.62) * eyeOffset;
    const ry = head.y + Math.sin(angle + 0.62) * eyeOffset;
    display.head.beginFill(0xffffff, 1);
    display.head.drawCircle(rx, ry, eyeSize);
    display.head.endFill();
    display.head.beginFill(0x111111, 1);
    display.head.drawCircle(
      rx + Math.cos(angle) * (eyeSize * 0.35),
      ry + Math.sin(angle) * (eyeSize * 0.35),
      pupilSize
    );
    display.head.endFill();
    // Eye shine
    display.head.beginFill(0xffffff, 0.7);
    display.head.drawCircle(
      rx + Math.cos(angle) * (eyeSize * 0.35) - eyeSize * 0.18,
      ry + Math.sin(angle) * (eyeSize * 0.35) - eyeSize * 0.18,
      pupilSize * 0.38
    );
    display.head.endFill();

    // --- Name label ---
    display.nameText.text = snake.name;
    display.nameText.style.fontSize = 13 * scoreFactor;
    display.nameText.position.set(head.x, head.y - headRadius - 10);
  }

  private stableHash(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  private themeIndexFromId(id: string): number {
    return this.stableHash(id) % SNAKE_THEMES.length;
  }

}
