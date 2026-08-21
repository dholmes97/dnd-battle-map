export type RateLimitPolicy = { limit: number; windowMs: number };

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function consumeRateLimit(
  db: D1Database,
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): Promise<RateLimitResult> {
  const windowEndsAt = now + policy.windowMs;
  const row = await db.prepare(
    `INSERT INTO request_rate_limits (key, request_count, window_ends_at, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       request_count = CASE
         WHEN request_rate_limits.window_ends_at <= ? THEN 1
         ELSE request_rate_limits.request_count + 1
       END,
       window_ends_at = CASE
         WHEN request_rate_limits.window_ends_at <= ? THEN excluded.window_ends_at
         ELSE request_rate_limits.window_ends_at
       END,
       updated_at = excluded.updated_at
     WHERE request_rate_limits.window_ends_at <= ?
        OR request_rate_limits.request_count < ?
     RETURNING request_count, window_ends_at`,
  ).bind(key, windowEndsAt, now, now, now, now, policy.limit).first<{
    request_count: number;
    window_ends_at: number;
  }>();
  if (row) {
    if (key.startsWith("global:") && row.request_count === 1) {
      await db.prepare(
        "DELETE FROM request_rate_limits WHERE key <> ? AND window_ends_at <= ?",
      ).bind(key, now).run();
      await db.prepare(
        "DELETE FROM operation_leases WHERE expires_at <= ?",
      ).bind(now).run();
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const existing = await db.prepare(
    "SELECT window_ends_at FROM request_rate_limits WHERE key = ?",
  ).bind(key).first<{ window_ends_at: number }>();
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(((existing?.window_ends_at ?? windowEndsAt) - now) / 1_000)),
  };
}

export async function acquireOperationLease(
  db: D1Database,
  key: string,
  leaseMs: number,
  now = Date.now(),
): Promise<string | null> {
  const token = crypto.randomUUID();
  const row = await db.prepare(
    `INSERT INTO operation_leases (key, lease_token, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       lease_token = excluded.lease_token,
       expires_at = excluded.expires_at
     WHERE operation_leases.expires_at <= ?
     RETURNING lease_token`,
  ).bind(key, token, now + leaseMs, now).first<{ lease_token: string }>();
  return row?.lease_token === token ? token : null;
}

export async function releaseOperationLease(
  db: D1Database,
  key: string,
  token: string,
): Promise<void> {
  await db.prepare(
    "DELETE FROM operation_leases WHERE key = ? AND lease_token = ?",
  ).bind(key, token).run();
}
