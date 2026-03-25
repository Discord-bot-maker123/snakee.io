import * as PIXI from "pixi.js";
import { BlurFilter, Text, TextStyle } from "pixi.js";
import { SNAKE_BODY_RADIUS, SNAKE_HEAD_RADIUS } from "snakee-shared/constants";
import type { SnakeState } from "snakee-shared/types";

type SnakeDisplay = {
  container: PIXI.Container;
  body: PIXI.Graphics;
  glow: PIXI.Graphics;
  head: PIXI.Graphics;
  nameText: Text;
};

type SnakeTheme = {
  primary: number;
  secondary: number;
  highlight: number;
};

/* changed by gemini */
const SNAKE_THEMES: SnakeTheme[] = [
  { primary: 0x00f2ff, secondary: 0x0066ff, highlight: 0xffffff }, // Neon Cyan/Blue
  { primary: 0xbc13fe, secondary: 0x7a04eb, highlight: 0xffffff }, // Neon Purple
  { primary: 0x00ff9f, secondary: 0x00b36b, highlight: 0xffffff }, // Neon Mint
  { primary: 0xff0055, secondary: 0xaa0033, highlight: 0xffffff }  // Neon Pink
];

export class SnakeRenderer {
  private readonly layer: PIXI.Container;

  private readonly displays: Map<string, SnakeDisplay>;

  private readonly blurFilter: BlurFilter;

  private readonly nameStyle: TextStyle;

  public constructor(layer: PIXI.Container) {
    this.layer = layer;
    this.displays = new Map<string, SnakeDisplay>();
    this.blurFilter = new BlurFilter({ strength: 2.5, quality: 2 });
    this.nameStyle = new TextStyle({
      fontFamily: "'Courier New', monospace",
      fontSize: 11,
      fill: 0xe8f4ff,
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
    const glow = new PIXI.Graphics();
    glow.filters = [this.blurFilter];
    const head = new PIXI.Graphics();
    const nameText = new Text({ text: "", style: this.nameStyle });
    nameText.anchor.set(0.5, 1);

    container.addChild(body);
    container.addChild(glow);
    container.addChild(head);
    container.addChild(nameText);
    this.layer.addChild(container);

    const created: SnakeDisplay = { container, body, glow, head, nameText };
    this.displays.set(id, created);
    return created;
  }

  private drawSnake(display: SnakeDisplay, snake: SnakeState): void {
    /* changed by gemini */
    display.body.clear();
    display.head.clear();
    display.glow.clear(); // Glow removed as requested

    const head = snake.segments[0];
    const theme = SNAKE_THEMES[this.themeIndexFromId(snake.id)];
    
    const scoreFactor = Math.min(2.5, 1 + Math.sqrt(snake.score || 0) * 0.04);
    const bodyRadius = SNAKE_BODY_RADIUS * 1.5 * scoreFactor;
    const headRadius = bodyRadius; // Head is same size as body in the new screenshot

    // 1. Draw Body Segments with 3D Spherical Look
    for (let i = snake.segments.length - 1; i >= 1; i -= 1) {
      const segment = snake.segments[i];
      
      // Theme-based coloring (alternating for rainbow/pattern feel)
      const color = (Math.floor(i / 1.5) % 2 === 0) ? theme.primary : theme.secondary;
      
      // Base Circle
      display.body.beginFill(color, 1);
      display.body.drawCircle(segment.x, segment.y, bodyRadius);
      display.body.endFill();

      // Subtle Bottom-Right Shadow
      display.body.beginFill(0x000000, 0.15);
      display.body.drawCircle(segment.x + bodyRadius * 0.15, segment.y + bodyRadius * 0.15, bodyRadius * 0.85);
      display.body.endFill();

      // Subtle Top-Left Highlight
      display.body.beginFill(0xffffff, 0.15);
      display.body.drawCircle(segment.x - bodyRadius * 0.2, segment.y - bodyRadius * 0.2, bodyRadius * 0.5);
      display.body.endFill();
    }

    // 2. Draw Head
    display.head.beginFill(theme.primary, 1);
    display.head.drawCircle(head.x, head.y, headRadius);
    display.head.endFill();
    
    // 3D effect on head
    display.head.beginFill(0xffffff, 0.15);
    display.head.drawCircle(head.x - headRadius * 0.2, head.y - headRadius * 0.2, headRadius * 0.5);
    display.head.endFill();

    // 3. Dynamic Eyes (tracking direction)
    const neck = snake.segments[1] ?? { x: head.x - 1, y: head.y };
    const angle = Math.atan2(head.y - neck.y, head.x - neck.x);
    
    const eyeSize = headRadius * 0.42;
    const pupilSize = eyeSize * 0.55;
    const eyeOffset = headRadius * 0.5;

    // Left Eye
    const lx = head.x + Math.cos(angle - 0.6) * eyeOffset;
    const ly = head.y + Math.sin(angle - 0.6) * eyeOffset;
    display.head.beginFill(0xffffff, 1);
    display.head.drawCircle(lx, ly, eyeSize);
    display.head.endFill();
    
    // Pupil looks in direction of travel
    display.head.beginFill(0x000000, 1);
    display.head.drawCircle(lx + Math.cos(angle) * (eyeSize * 0.35), ly + Math.sin(angle) * (eyeSize * 0.35), pupilSize);
    display.head.endFill();

    // Right Eye
    const rx = head.x + Math.cos(angle + 0.6) * eyeOffset;
    const ry = head.y + Math.sin(angle + 0.6) * eyeOffset;
    display.head.beginFill(0xffffff, 1);
    display.head.drawCircle(rx, ry, eyeSize);
    display.head.endFill();
    
    display.head.beginFill(0x000000, 1);
    display.head.drawCircle(rx + Math.cos(angle) * (eyeSize * 0.35), ry + Math.sin(angle) * (eyeSize * 0.35), pupilSize);
    display.head.endFill();

    display.nameText.text = snake.name;
    display.nameText.style.fill = 0xffffff;
    display.nameText.style.fontSize = 11 * scoreFactor;
    display.nameText.position.set(head.x, head.y - headRadius - 12);
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
