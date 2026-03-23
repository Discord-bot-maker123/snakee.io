export class StartMenu {
  private static readonly LAST_GAME_KEY = "snakee.lastGame";

  private static readonly BEST_GAME_KEY = "snakee.bestGame";

  private readonly root: HTMLDivElement;

  private readonly nicknameInput: HTMLInputElement;

  private readonly playButton: HTMLButtonElement;

  private readonly leftStats: HTMLDivElement;

  private readonly rightStats: HTMLDivElement;

  public constructor(parent: HTMLElement, onPlay: (nickname: string) => void) {
    this.root = document.createElement("div");
    this.root.className = "menu-overlay";

    const rays = document.createElement("div");
    rays.className = "menu-rays";
    this.root.appendChild(rays);

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "menu-settings";
    settings.textContent = "Settings";
    this.root.appendChild(settings);

    this.leftStats = document.createElement("div");
    this.leftStats.className = "menu-stats menu-stats-left";

    this.rightStats = document.createElement("div");
    this.rightStats.className = "menu-stats menu-stats-right";

    const center = document.createElement("div");
    center.className = "menu-center";

    const logo = document.createElement("div");
    logo.className = "menu-logo";
    /* changed by gemini */
    logo.innerHTML = "<span class=\"menu-logo-text\"><span class=\"logo-slither\">slither</span><span class=\"logo-dot-io\">.io</span></span>";

    const subtitle = document.createElement("div");
    subtitle.className = "menu-subtitle";
    /* changed by gemini */
    subtitle.textContent = "Don't run into other players!";

    this.nicknameInput = document.createElement("input");
    this.nicknameInput.className = "menu-nickname";
    this.nicknameInput.placeholder = "Nickname";
    this.nicknameInput.maxLength = 18;
    this.nicknameInput.value = localStorage.getItem("snakee.nickname") ?? "";

    this.playButton = document.createElement("button");
    this.playButton.type = "button";
    this.playButton.className = "menu-play";
    /* changed by gemini */
    this.playButton.textContent = "Play";

    this.playButton.addEventListener("click", () => {
      localStorage.setItem("snakee.nickname", this.getNickname());
      onPlay(this.getNickname());
      this.hide();
    });

    this.nicknameInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        localStorage.setItem("snakee.nickname", this.getNickname());
        onPlay(this.getNickname());
        this.hide();
      }
    });

    center.appendChild(logo);
    /* changed by gemini */
    center.appendChild(subtitle);
    center.appendChild(this.nicknameInput);
    center.appendChild(this.playButton);

    this.root.appendChild(this.leftStats);
    this.root.appendChild(center);
    this.root.appendChild(this.rightStats);

    parent.appendChild(this.root);
    this.renderStats();
  }

  public hide(): void {
    this.root.classList.add("menu-hidden");
  }

  public recordGame(finalLength: number, finalScore: number): void {
    const lastGame = { length: finalLength, score: finalScore };
    localStorage.setItem(StartMenu.LAST_GAME_KEY, JSON.stringify(lastGame));

    const bestGame = this.readStats(StartMenu.BEST_GAME_KEY);
    if (!bestGame || finalScore > bestGame.score) {
      localStorage.setItem(StartMenu.BEST_GAME_KEY, JSON.stringify(lastGame));
    }

    this.renderStats();
  }

  private getNickname(): string {
    const cleaned = this.nicknameInput.value.trim();
    return cleaned.length > 0 ? cleaned : "Player";
  }

  private renderStats(): void {
    const lastGame = this.readStats(StartMenu.LAST_GAME_KEY);
    const bestGame = this.readStats(StartMenu.BEST_GAME_KEY);

    this.leftStats.innerHTML = [
      "<h4>Last game</h4>",
      `<p>Length ${lastGame?.length ?? 0}</p>`,
      `<p>Score ${lastGame?.score ?? 0}</p>`
    ].join("");

    this.rightStats.innerHTML = [
      "<h4>Your best ever</h4>",
      `<p>Length ${bestGame?.length ?? 0}</p>`,
      `<p>Score ${bestGame?.score ?? 0}</p>`
    ].join("");
  }

  private readStats(key: string): { length: number; score: number } | null {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { length?: number; score?: number };
      const length = Number(parsed.length);
      const score = Number(parsed.score);
      if (!Number.isFinite(length) || !Number.isFinite(score)) {
        return null;
      }
      return { length: Math.max(0, Math.floor(length)), score: Math.max(0, Math.floor(score)) };
    } catch {
      return null;
    }
  }
}
