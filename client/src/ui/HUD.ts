import type { LeaderboardEntry, SnakeState } from "snakee-shared/types";

export class HUD {
  private readonly leaderboardRoot: HTMLDivElement;

  private readonly scoreRoot: HTMLDivElement;

  public constructor(parent: HTMLElement) {
    const hudRoot = document.createElement("div");
    hudRoot.className = "hud-root";

    this.leaderboardRoot = document.createElement("div");
    this.leaderboardRoot.className = "hud-panel hud-leaderboard";

    this.scoreRoot = document.createElement("div");
    this.scoreRoot.className = "hud-panel hud-score";

    hudRoot.appendChild(this.leaderboardRoot);
    hudRoot.appendChild(this.scoreRoot);
    parent.appendChild(hudRoot);
  }

  public updateLeaderboard(entries: LeaderboardEntry[]): void {
    const title = `<div class=\"hud-title\">LEADERBOARD</div>`;
    const rows = entries
      .slice(0, 10)
      .map((entry: LeaderboardEntry, index: number) => {
        const rowClass = index === 0 ? "hud-row hud-row-top" : "hud-row";
        return `<div class=\"${rowClass}\"><span>${index + 1}. ${entry.name}</span><span>${entry.score}</span></div>`;
      })
      .join("");

    this.leaderboardRoot.innerHTML = `${title}${rows}`;
  }

  public updateScore(player: SnakeState | undefined): void {
    if (!player) {
      this.scoreRoot.innerHTML = `<div class=\"hud-title\">SCORE</div><div class=\"hud-value\">0</div>`;
      return;
    }

    this.scoreRoot.innerHTML = [
      `<div class=\"hud-title\">${player.name}</div>`,
      `<div class=\"hud-value\">Score: ${player.score}</div>`,
      `<div class=\"hud-value\">Length: ${player.segments.length}</div>`
    ].join("");
  }
}
