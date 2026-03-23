import { createClient, type Session } from "@supabase/supabase-js";

export type CloudProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type CloudStats = {
  gamesPlayed: number;
  totalScore: number;
  bestScore: number;
  bestLength: number;
  lastPlayedAt: string | null;
};

export type MeResponse = {
  profile: CloudProfile;
  stats: CloudStats;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const apiBaseUrlFromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;

const hasConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasConfig
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;

function apiUrl(path: string): string {
  if (apiBaseUrlFromEnv && apiBaseUrlFromEnv.length > 0) {
    const base = apiBaseUrlFromEnv.replace(/\/$/, "");
    return `${base}${path}`;
  }

  const protocol = window.location.protocol;
  const host = window.location.port === "5173" ? `${window.location.hostname}:9001` : window.location.host;
  return `${protocol}//${host}${path}`;
}

async function getAccessTokenOrThrow(): Promise<string> {
  if (!supabase) {
    throw new Error("Supabase is not configured in client env.");
  }
  const sessionResult = await supabase.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;
  if (!accessToken) {
    throw new Error("Missing access token.");
  }
  return accessToken;
}

export function isSupabaseConfigured(): boolean {
  return hasConfig;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) {
    return null;
  }
  const result = await supabase.auth.getSession();
  return result.data.session ?? null;
}

export function onAuthStateChanged(callback: (session: Session | null) => void): (() => void) | null {
  if (!supabase) {
    return null;
  }

  const {
    data: { subscription }
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => {
    subscription.unsubscribe();
  };
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const result = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });
  if (result.error) {
    throw result.error;
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const result = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (result.error) {
    throw result.error;
  }
}

export async function signOut(): Promise<void> {
  if (!supabase) {
    return;
  }

  const result = await supabase.auth.signOut();
  if (result.error) {
    throw result.error;
  }
}

export async function getMe(): Promise<MeResponse> {
  const token = await getAccessTokenOrThrow();

  const response = await fetch(apiUrl("/api/me"), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.status}`);
  }

  const raw = (await response.json()) as {
    profile: { id: string; displayName: string; avatarUrl: string | null };
    stats: {
      gamesPlayed: number;
      totalScore: number;
      bestScore: number;
      bestLength: number;
      lastPlayedAt: string | null;
    };
  };

  return raw;
}

export async function updateMeDisplayName(displayName: string): Promise<MeResponse> {
  const token = await getAccessTokenOrThrow();

  const response = await fetch(apiUrl("/api/me"), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ displayName })
  });
  if (!response.ok) {
    throw new Error(`Failed to update display name: ${response.status}`);
  }

  return (await response.json()) as MeResponse;
}

export async function getAllTimeLeaderboard(): Promise<
  Array<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    bestScore: number;
    bestLength: number;
  }>
> {
  const response = await fetch(apiUrl("/api/leaderboard/all-time"));
  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard: ${response.status}`);
  }
  const payload = (await response.json()) as {
    entries: Array<{
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      bestScore: number;
      bestLength: number;
    }>;
  };
  return payload.entries;
}
