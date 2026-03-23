import {
  getMe,
  getSession,
  isSupabaseConfigured,
  onAuthStateChanged,
  signInWithGoogle,
  signInWithPassword,
  signOut,
  updateMeDisplayName,
  type MeResponse
} from "../auth/supabase";

export type StartSessionConfig = {
  nickname: string;
  accessToken: string | null;
  isAuthenticated: boolean;
};

export class StartMenu {
  private static readonly LAST_GAME_KEY = "snakee.lastGame";
  private static readonly BEST_GAME_KEY = "snakee.bestGame";

  private readonly root: HTMLDivElement;
  private readonly onPlay: (config: StartSessionConfig) => void;

  private readonly leftStats: HTMLDivElement;
  private readonly rightStats: HTMLDivElement;
  private readonly authStatus: HTMLDivElement;

  private readonly landingPage: HTMLDivElement;
  private readonly loginPage: HTMLDivElement;
  private readonly playPage: HTMLDivElement;

  private readonly openLoginPageButton: HTMLButtonElement;
  private readonly guestButton: HTMLButtonElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly signOutButton: HTMLButtonElement;

  private readonly loginEmailInput: HTMLInputElement;
  private readonly loginPasswordInput: HTMLInputElement;
  private readonly loginRememberCheckbox: HTMLInputElement;
  private readonly loginButton: HTMLButtonElement;
  private readonly googleButton: HTMLButtonElement;
  private readonly loginBackButton: HTMLButtonElement;

  private readonly nicknameInput: HTMLInputElement;
  private readonly playButton: HTMLButtonElement;

  private authAccessToken: string | null;
  private authenticated: boolean;
  private me: MeResponse | null;
  private launching: boolean;
  private useGuestMode: boolean;
  private authUnsubscribe: (() => void) | null;

  public constructor(parent: HTMLElement, onPlay: (config: StartSessionConfig) => void) {
    this.onPlay = onPlay;
    this.authAccessToken = null;
    this.authenticated = false;
    this.me = null;
    this.launching = false;
    this.useGuestMode = false;
    this.authUnsubscribe = null;

    this.root = document.createElement("div");
    this.root.className = "menu-overlay";

    const rays = document.createElement("div");
    rays.className = "menu-rays";
    this.root.appendChild(rays);

    this.leftStats = document.createElement("div");
    this.leftStats.className = "menu-stats menu-stats-left";

    this.rightStats = document.createElement("div");
    this.rightStats.className = "menu-stats menu-stats-right";

    const center = document.createElement("div");
    center.className = "menu-center";

    const logo = document.createElement("div");
    logo.className = "menu-logo";
    logo.innerHTML = "<span class=\"menu-logo-text\"><span class=\"logo-slither\">slither</span><span class=\"logo-dot-io\">.io</span></span>";

    const subtitle = document.createElement("div");
    subtitle.className = "menu-subtitle";
    subtitle.textContent = "Don't run into other players!";

    this.authStatus = document.createElement("div");
    this.authStatus.className = "menu-auth-status";
    this.authStatus.textContent = "Choose how you want to play.";

    // Landing page
    this.landingPage = document.createElement("div");
    this.landingPage.className = "menu-auth-choice";

    this.openLoginPageButton = document.createElement("button");
    this.openLoginPageButton.type = "button";
    this.openLoginPageButton.className = "menu-auth";
    this.openLoginPageButton.textContent = "Sign in / Sign up";

    this.guestButton = document.createElement("button");
    this.guestButton.type = "button";
    this.guestButton.className = "menu-auth menu-auth-guest";
    this.guestButton.textContent = "Use Guest Mode";

    this.continueButton = document.createElement("button");
    this.continueButton.type = "button";
    this.continueButton.className = "menu-auth hidden";
    this.continueButton.textContent = "Play";

    this.signOutButton = document.createElement("button");
    this.signOutButton.type = "button";
    this.signOutButton.className = "menu-auth menu-auth-back hidden";
    this.signOutButton.textContent = "Sign out";

    this.landingPage.appendChild(this.openLoginPageButton);
    this.landingPage.appendChild(this.guestButton);
    this.landingPage.appendChild(this.continueButton);
    this.landingPage.appendChild(this.signOutButton);

    // Login page (separate, hidden initially)
    this.loginPage = document.createElement("div");
    this.loginPage.className = "menu-login-page hidden";

    const loginCard = document.createElement("div");
    loginCard.className = "menu-login-card menu-page-fade";

    const loginTitle = document.createElement("h3");
    loginTitle.className = "menu-login-title";
    loginTitle.textContent = "Welcome Back";

    const loginDesc = document.createElement("p");
    loginDesc.className = "menu-login-desc";
    loginDesc.textContent = "Sign in to snakee.io";

    this.loginEmailInput = document.createElement("input");
    this.loginEmailInput.className = "menu-auth-email-input";
    this.loginEmailInput.type = "email";
    this.loginEmailInput.placeholder = "Email";
    this.loginEmailInput.autocomplete = "email";

    this.loginPasswordInput = document.createElement("input");
    this.loginPasswordInput.className = "menu-auth-email-input";
    this.loginPasswordInput.type = "password";
    this.loginPasswordInput.placeholder = "Password";
    this.loginPasswordInput.autocomplete = "current-password";

    const rememberRow = document.createElement("label");
    rememberRow.className = "menu-remember-row";
    this.loginRememberCheckbox = document.createElement("input");
    this.loginRememberCheckbox.type = "checkbox";
    this.loginRememberCheckbox.checked = localStorage.getItem("snakee.rememberMe") === "true";
    const rememberText = document.createElement("span");
    rememberText.textContent = "Remember me";
    rememberRow.appendChild(this.loginRememberCheckbox);
    rememberRow.appendChild(rememberText);

    this.loginButton = document.createElement("button");
    this.loginButton.type = "button";
    this.loginButton.className = "menu-auth";
    this.loginButton.textContent = "Sign In";

    this.googleButton = document.createElement("button");
    this.googleButton.type = "button";
    this.googleButton.className = "menu-auth menu-auth-google";
    this.googleButton.innerHTML = [
      "<span class=\"menu-google-logo\" aria-hidden=\"true\">",
      "<svg viewBox=\"0 0 18 18\" width=\"18\" height=\"18\">",
      "<path fill=\"#EA4335\" d=\"M9 3.5c1.2 0 2.2.4 3 1.2l2.2-2.2C12.8 1.2 11 0.5 9 0.5 5.7 0.5 2.9 2.4 1.5 5.2l2.6 2C4.8 5 6.7 3.5 9 3.5z\"/>",
      "<path fill=\"#34A853\" d=\"M9 17.5c2.4 0 4.4-.8 5.9-2.2l-2.7-2.1c-.8.6-1.8 1-3.2 1-2.2 0-4.2-1.5-4.9-3.7l-2.7 2.1C2.8 15.4 5.6 17.5 9 17.5z\"/>",
      "<path fill=\"#4A90E2\" d=\"M17.3 9.2c0-.6-.1-1.1-.2-1.6H9v3.1h4.6c-.2 1-.8 1.9-1.7 2.5l2.7 2.1c1.6-1.5 2.7-3.8 2.7-6.1z\"/>",
      "<path fill=\"#FBBC05\" d=\"M4.1 10.5c-.2-.5-.3-1-.3-1.5s.1-1.1.3-1.5L1.5 5.2C.9 6.4.5 7.6.5 9s.4 2.6 1 3.8l2.6-2.3z\"/>",
      "</svg>",
      "</span>",
      "<span>Sign in with Google</span>"
    ].join("");

    this.loginBackButton = document.createElement("button");
    this.loginBackButton.type = "button";
    this.loginBackButton.className = "menu-auth menu-auth-back";
    this.loginBackButton.textContent = "Back";

    loginCard.appendChild(loginTitle);
    loginCard.appendChild(loginDesc);
    loginCard.appendChild(this.loginEmailInput);
    loginCard.appendChild(this.loginPasswordInput);
    loginCard.appendChild(rememberRow);
    loginCard.appendChild(this.loginButton);
    loginCard.appendChild(this.googleButton);
    loginCard.appendChild(this.loginBackButton);
    this.loginPage.appendChild(loginCard);

    // Play page
    this.playPage = document.createElement("div");
    this.playPage.className = "menu-game-controls hidden";

    this.nicknameInput = document.createElement("input");
    this.nicknameInput.className = "menu-nickname";
    this.nicknameInput.placeholder = "Nickname";
    this.nicknameInput.maxLength = 18;
    this.nicknameInput.value = localStorage.getItem("snakee.nickname") ?? "";

    this.playButton = document.createElement("button");
    this.playButton.type = "button";
    this.playButton.className = "menu-play";
    this.playButton.textContent = "Play";

    this.playPage.appendChild(this.nicknameInput);
    this.playPage.appendChild(this.playButton);

    this.openLoginPageButton.addEventListener("click", () => this.showLoginPage());
    this.loginBackButton.addEventListener("click", () => this.showLandingPage());
    this.guestButton.addEventListener("click", () => {
      this.useGuestMode = true;
      this.enterPlayStep();
    });
    this.continueButton.addEventListener("click", () => {
      this.useGuestMode = false;
      this.enterPlayStep();
    });
    this.signOutButton.addEventListener("click", () => void this.handleSignOut());
    this.loginButton.addEventListener("click", () => void this.handlePasswordLogin());
    this.googleButton.addEventListener("click", () => void this.handleGoogleLogin());
    this.playButton.addEventListener("click", () => void this.launchMatch());

    this.loginPasswordInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        void this.handlePasswordLogin();
      }
    });

    this.nicknameInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        void this.launchMatch();
      }
    });

    center.appendChild(logo);
    center.appendChild(subtitle);
    center.appendChild(this.landingPage);
    center.appendChild(this.loginPage);
    center.appendChild(this.playPage);
    center.appendChild(this.authStatus);

    this.root.appendChild(this.leftStats);
    this.root.appendChild(center);
    this.root.appendChild(this.rightStats);

    parent.appendChild(this.root);
    this.renderStats();
    this.renderAuthState();
    void this.initializeAuthState();

    this.authUnsubscribe = onAuthStateChanged((session) => {
      void this.handleAuthStateSession(session?.access_token ?? null);
    });
  }

  public hide(): void {
    this.root.classList.add("menu-hidden");
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
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

  private showLandingPage(): void {
    this.landingPage.classList.remove("hidden");
    this.loginPage.classList.add("hidden");
    this.playPage.classList.add("hidden");
  }

  private showLoginPage(): void {
    this.landingPage.classList.add("hidden");
    this.loginPage.classList.remove("hidden");
    this.playPage.classList.add("hidden");
  }

  private async initializeAuthState(): Promise<void> {
    if (!isSupabaseConfigured()) {
      this.renderAuthState();
      return;
    }

    try {
      const session = await getSession();
      await this.handleAuthStateSession(session?.access_token ?? null);
    } catch {
      this.authAccessToken = null;
      this.authenticated = false;
      this.me = null;
      this.renderStats();
      this.renderAuthState();
    }
  }

  private async handleAuthStateSession(accessToken: string | null): Promise<void> {
    if (!accessToken) {
      this.authAccessToken = null;
      this.authenticated = false;
      this.me = null;
      this.renderStats();
      this.renderAuthState();
      return;
    }

    try {
      this.authAccessToken = accessToken;
      this.authenticated = true;
      const me = await getMe();
      this.me = me;
      this.nicknameInput.value = me.profile.displayName;
      this.renderStats();
      this.renderAuthState();
    } catch {
      this.authAccessToken = accessToken;
      this.authenticated = true;
      this.me = null;
      this.renderStats();
      this.renderAuthState();
    }
  }

  private async handlePasswordLogin(): Promise<void> {
    if (!isSupabaseConfigured()) {
      this.authStatus.textContent = "Auth is not configured. Use guest mode.";
      return;
    }

    const email = this.loginEmailInput.value.trim();
    const password = this.loginPasswordInput.value;
    if (email.length === 0 || !email.includes("@")) {
      this.authStatus.textContent = "Enter a valid email.";
      return;
    }
    if (password.length === 0) {
      this.authStatus.textContent = "Enter your password.";
      return;
    }

    try {
      this.loginButton.textContent = "Signing In...";
      this.loginButton.disabled = true;
      await signInWithPassword(email, password);
      localStorage.setItem("snakee.rememberMe", this.loginRememberCheckbox.checked ? "true" : "false");
      this.authStatus.textContent = "Signed in.";
      this.useGuestMode = false;
      this.enterPlayStep();
    } catch {
      this.authStatus.textContent = "snakee.io login failed. Check credentials or use Google.";
    } finally {
      this.loginButton.textContent = "Sign In";
      this.loginButton.disabled = false;
    }
  }

  private async handleGoogleLogin(): Promise<void> {
    if (!isSupabaseConfigured()) {
      this.authStatus.textContent = "Auth is not configured. Use guest mode.";
      return;
    }

    try {
      this.googleButton.textContent = "Redirecting...";
      await signInWithGoogle();
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("provider is not enabled")) {
        this.authStatus.textContent = "snakee.io login unavailable: enable Google provider in Supabase Auth.";
      } else {
        this.authStatus.textContent = "snakee.io login failed. Check Google + Supabase auth settings.";
      }
      this.googleButton.textContent = "Sign in with Google";
    }
  }

  private async handleSignOut(): Promise<void> {
    try {
      await signOut();
    } catch {
      // Keep local reset path.
    }

    this.authAccessToken = null;
    this.authenticated = false;
    this.me = null;
    this.useGuestMode = false;
    this.showLandingPage();
    this.renderStats();
    this.renderAuthState();
  }

  private enterPlayStep(): void {
    this.landingPage.classList.add("hidden");
    this.loginPage.classList.add("hidden");
    this.playPage.classList.remove("hidden");
    this.renderAuthState();
    this.renderStats();
  }

  private async launchMatch(): Promise<void> {
    if (this.launching) {
      return;
    }

    this.launching = true;
    const nickname = this.getNickname();
    localStorage.setItem("snakee.nickname", nickname);

    const canUseAuth = !this.useGuestMode && this.authenticated && this.authAccessToken;
    if (canUseAuth) {
      try {
        const updated = await updateMeDisplayName(nickname);
        this.me = updated;
        this.nicknameInput.value = updated.profile.displayName;
      } catch {
        // Profile sync failure should not block entering match.
      }
    }

    this.onPlay({
      nickname: this.getNickname(),
      accessToken: canUseAuth ? this.authAccessToken : null,
      isAuthenticated: Boolean(canUseAuth)
    });
    this.hide();
    this.launching = false;
  }

  private renderAuthState(): void {
    if (!isSupabaseConfigured()) {
      this.loginButton.disabled = true;
      this.googleButton.disabled = true;
      this.authStatus.textContent = "Guest mode (auth not configured).";
      return;
    }

    this.loginButton.disabled = false;
    this.googleButton.disabled = false;
    this.openLoginPageButton.classList.toggle("hidden", this.authenticated);
    this.guestButton.classList.toggle("hidden", this.authenticated);
    this.continueButton.classList.toggle("hidden", !this.authenticated);
    this.signOutButton.classList.toggle("hidden", !this.authenticated);
    this.authStatus.textContent = this.authenticated ? "Signed in. Ready to play." : "Sign in / sign up, or continue as guest.";
  }

  private getNickname(): string {
    const cleaned = this.nicknameInput.value.trim();
    return cleaned.length > 0 ? cleaned : "Player";
  }

  private renderStats(): void {
    if (this.authenticated && this.me && !this.useGuestMode) {
      this.leftStats.innerHTML = [
        "<h4>Cloud stats</h4>",
        `<p>Games ${this.me.stats.gamesPlayed}</p>`,
        `<p>Total score ${this.me.stats.totalScore}</p>`
      ].join("");

      this.rightStats.innerHTML = [
        "<h4>Best ever</h4>",
        `<p>Length ${this.me.stats.bestLength}</p>`,
        `<p>Score ${this.me.stats.bestScore}</p>`
      ].join("");
      return;
    }

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
