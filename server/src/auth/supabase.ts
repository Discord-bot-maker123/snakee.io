import { createClient, type User } from "@supabase/supabase-js";

type ProfileRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type PlayerStatsRow = {
  user_id: string;
  games_played: number;
  total_score: number;
  best_score: number;
  best_length: number;
  last_played_at: string | null;
};

export type AuthIdentity = {
  userId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type ProfileWithStats = {
  profile: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
  stats: {
    gamesPlayed: number;
    totalScore: number;
    bestScore: number;
    bestLength: number;
    lastPlayedAt: string | null;
  };
};

export type LeaderboardRow = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bestScore: number;
  bestLength: number;
};

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const adminClient =
  supabaseUrl.length > 0 && supabaseServiceRoleKey.length > 0
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

function sanitizeDisplayName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 18);
  return cleaned.length > 0 ? cleaned : "Player";
}

function deriveDisplayName(user: User): string {
  const metadata = user.user_metadata ?? {};
  const fromMeta =
    metadata.full_name ??
    metadata.name ??
    metadata.preferred_username ??
    metadata.user_name ??
    null;
  if (typeof fromMeta === "string" && fromMeta.trim().length > 0) {
    return sanitizeDisplayName(fromMeta);
  }

  if (typeof user.email === "string" && user.email.includes("@")) {
    const localPart = user.email.split("@")[0];
    if (localPart.length > 0) {
      return sanitizeDisplayName(localPart);
    }
  }

  return "Player";
}

function mapProfileWithStats(profile: ProfileRow, stats: PlayerStatsRow): ProfileWithStats {
  return {
    profile: {
      id: profile.id,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url
    },
    stats: {
      gamesPlayed: stats.games_played,
      totalScore: stats.total_score,
      bestScore: stats.best_score,
      bestLength: stats.best_length,
      lastPlayedAt: stats.last_played_at
    }
  };
}

export function isSupabaseConfigured(): boolean {
  return adminClient !== null;
}

export async function verifyAccessToken(accessToken: string): Promise<AuthIdentity | null> {
  if (!adminClient || accessToken.length === 0) {
    return null;
  }

  const { data, error } = await adminClient.auth.getUser(accessToken);
  if (error || !data.user) {
    return null;
  }

  const identity: AuthIdentity = {
    userId: data.user.id,
    email: data.user.email ?? null,
    displayName: deriveDisplayName(data.user),
    avatarUrl: typeof data.user.user_metadata?.avatar_url === "string" ? data.user.user_metadata.avatar_url : null
  };

  return identity;
}

export async function ensureProfile(identity: AuthIdentity): Promise<void> {
  if (!adminClient) {
    return;
  }

  const profileUpsert = await adminClient.from("profiles").upsert(
    {
      id: identity.userId,
      display_name: identity.displayName,
      avatar_url: identity.avatarUrl
    },
    {
      onConflict: "id"
    }
  );

  if (profileUpsert.error) {
    throw profileUpsert.error;
  }

  const statsUpsert = await adminClient.from("player_stats").upsert(
    {
      user_id: identity.userId,
      games_played: 0,
      total_score: 0,
      best_score: 0,
      best_length: 0,
      last_played_at: null
    },
    {
      onConflict: "user_id"
    }
  );

  if (statsUpsert.error) {
    throw statsUpsert.error;
  }
}

export async function getProfileWithStats(userId: string): Promise<ProfileWithStats | null> {
  if (!adminClient) {
    return null;
  }

  const profileResult = await adminClient
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  if (profileResult.error || !profileResult.data) {
    return null;
  }

  const statsResult = await adminClient
    .from("player_stats")
    .select("user_id, games_played, total_score, best_score, best_length, last_played_at")
    .eq("user_id", userId)
    .maybeSingle<PlayerStatsRow>();
  if (statsResult.error || !statsResult.data) {
    return null;
  }

  return mapProfileWithStats(profileResult.data, statsResult.data);
}

export async function updateDisplayName(userId: string, displayName: string): Promise<ProfileWithStats | null> {
  if (!adminClient) {
    return null;
  }

  const sanitized = sanitizeDisplayName(displayName);
  const updateResult = await adminClient
    .from("profiles")
    .update({
      display_name: sanitized
    })
    .eq("id", userId);
  if (updateResult.error) {
    return null;
  }

  return getProfileWithStats(userId);
}

export async function recordDeathForUser(userId: string, finalScore: number, finalLength: number): Promise<void> {
  if (!adminClient) {
    return;
  }

  const existingResult = await adminClient
    .from("player_stats")
    .select("user_id, games_played, total_score, best_score, best_length, last_played_at")
    .eq("user_id", userId)
    .maybeSingle<PlayerStatsRow>();

  const existing = existingResult.data ?? {
    user_id: userId,
    games_played: 0,
    total_score: 0,
    best_score: 0,
    best_length: 0,
    last_played_at: null
  };

  const gamesPlayed = existing.games_played + 1;
  const totalScore = existing.total_score + Math.max(0, Math.floor(finalScore));
  const bestScore = Math.max(existing.best_score, Math.max(0, Math.floor(finalScore)));
  const bestLength = Math.max(existing.best_length, Math.max(0, Math.floor(finalLength)));

  const upsert = await adminClient.from("player_stats").upsert(
    {
      user_id: userId,
      games_played: gamesPlayed,
      total_score: totalScore,
      best_score: bestScore,
      best_length: bestLength,
      last_played_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  if (upsert.error) {
    throw upsert.error;
  }
}

export async function getAllTimeLeaderboard(limit: number = 20): Promise<LeaderboardRow[]> {
  if (!adminClient) {
    return [];
  }

  const statsResult = await adminClient
    .from("player_stats")
    .select("user_id, best_score, best_length")
    .order("best_score", { ascending: false })
    .order("best_length", { ascending: false })
    .limit(limit);
  if (statsResult.error || !statsResult.data) {
    return [];
  }

  const userIds = statsResult.data.map((row: { user_id: string }) => row.user_id);
  if (userIds.length === 0) {
    return [];
  }

  const profilesResult = await adminClient
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);
  if (profilesResult.error || !profilesResult.data) {
    return [];
  }

  const profileById = new Map<string, ProfileRow>();
  for (const profile of profilesResult.data as ProfileRow[]) {
    profileById.set(profile.id, profile);
  }

  const leaderboard: LeaderboardRow[] = [];
  for (const row of statsResult.data as Array<{ user_id: string; best_score: number; best_length: number }>) {
    const profile = profileById.get(row.user_id);
    if (!profile) {
      continue;
    }
    leaderboard.push({
      userId: row.user_id,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      bestScore: row.best_score,
      bestLength: row.best_length
    });
  }

  return leaderboard;
}
