const STALE_WRITE_INTENT_MS = 15 * 60 * 1_000;
const ABANDONED_PROVISIONING_JOB_MS = 24 * 60 * 60 * 1_000;
const CLEANUP_BATCH_SIZE = 20;

export async function createStorageWriteIntent(
  db: D1Database,
  operationId: string,
  keys: string[],
  now: number,
): Promise<void> {
  await db.batch(keys.map((key) => db.prepare(
    `INSERT INTO storage_write_intents (id, operation_id, object_key, created_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), operationId, key, now)));
}

export function queueStorageCleanupStatement(
  db: D1Database,
  objectKey: string,
  reason: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO storage_cleanup_outbox
     (object_key, reason, attempts, available_at, created_at, completed_at, last_error)
     VALUES (?, ?, 0, ?, ?, NULL, NULL)
     ON CONFLICT(object_key) DO UPDATE SET
       reason = excluded.reason,
       available_at = MIN(storage_cleanup_outbox.available_at, excluded.available_at),
       completed_at = NULL,
       last_error = NULL`,
  ).bind(objectKey, reason, now, now);
}

export async function abandonStorageWriteIntent(
  db: D1Database,
  operationId: string,
  keys: string[],
  reason: string,
  now: number,
): Promise<void> {
  await db.batch([
    ...keys.map((key) => queueStorageCleanupStatement(db, key, reason, now)),
    db.prepare("DELETE FROM storage_write_intents WHERE operation_id = ?").bind(operationId),
  ]);
}

export async function reconcileStorageLifecycle(
  db: D1Database,
  bucket: R2Bucket | undefined,
  now = Date.now(),
): Promise<void> {
  if (!bucket) return;
  const abandonedAssets = await db.prepare(
    `SELECT a.r2_key, j.id AS job_id, j.status
     FROM scenario_provisioning_assets a
     JOIN scenario_provisioning_jobs j ON j.id = a.job_id
     WHERE a.committed_at IS NULL
       AND (j.status = 'failed' OR j.updated_at <= ?)
     ORDER BY j.updated_at, a.created_at LIMIT ?`,
  ).bind(now - ABANDONED_PROVISIONING_JOB_MS, CLEANUP_BATCH_SIZE).all<{
    r2_key: string;
    job_id: string;
    status: string;
  }>();
  if (abandonedAssets.results.length) {
    const staleJobIds = [...new Set(
      abandonedAssets.results
        .filter((asset) => asset.status !== "failed")
        .map((asset) => asset.job_id),
    )];
    await db.batch([
      ...staleJobIds.map((jobId) => db.prepare(
        `UPDATE scenario_provisioning_jobs
         SET status = 'failed', summary = 'Provisioning job expired before completion.',
             error_code = 'job_abandoned', updated_at = ?
         WHERE id = ? AND status NOT IN ('ready', 'failed')`,
      ).bind(now, jobId)),
      ...abandonedAssets.results.map((asset) =>
        queueStorageCleanupStatement(db, asset.r2_key, "provisioning-job-abandoned", now)
      ),
    ]);
  }
  const stale = await db.prepare(
    `SELECT operation_id, object_key FROM storage_write_intents
     WHERE created_at <= ? ORDER BY created_at LIMIT ?`,
  ).bind(now - STALE_WRITE_INTENT_MS, CLEANUP_BATCH_SIZE).all<{
    operation_id: string;
    object_key: string;
  }>();
  if (stale.results.length) {
    await db.batch(stale.results.flatMap((intent) => [
      queueStorageCleanupStatement(db, intent.object_key, "abandoned-write-intent", now),
      db.prepare(
        "DELETE FROM storage_write_intents WHERE operation_id = ? AND object_key = ?",
      ).bind(intent.operation_id, intent.object_key),
    ]));
  }

  const rows = await db.prepare(
    `SELECT object_key, attempts FROM storage_cleanup_outbox
     WHERE completed_at IS NULL AND available_at <= ?
     ORDER BY available_at, created_at LIMIT ?`,
  ).bind(now, CLEANUP_BATCH_SIZE).all<{ object_key: string; attempts: number }>();
  for (const row of rows.results) {
    const references = await storageReferenceCount(db, row.object_key);
    if (references > 0) {
      await db.prepare(
        `UPDATE storage_cleanup_outbox SET completed_at = ?, last_error = 'object-is-referenced'
         WHERE object_key = ? AND completed_at IS NULL`,
      ).bind(now, row.object_key).run();
      continue;
    }
    const activeIntent = await db.prepare(
      "SELECT 1 AS found FROM storage_write_intents WHERE object_key = ? LIMIT 1",
    ).bind(row.object_key).first();
    if (activeIntent) {
      await db.prepare(
        `UPDATE storage_cleanup_outbox SET available_at = ?, last_error = 'write-intent-active'
         WHERE object_key = ? AND completed_at IS NULL`,
      ).bind(now + STALE_WRITE_INTENT_MS, row.object_key).run();
      continue;
    }
    try {
      await bucket.delete(row.object_key);
      await db.prepare(
        `UPDATE storage_cleanup_outbox SET completed_at = ?, attempts = attempts + 1,
         last_error = NULL WHERE object_key = ? AND completed_at IS NULL`,
      ).bind(now, row.object_key).run();
    } catch (error) {
      const attempts = row.attempts + 1;
      const retryAt = now + Math.min(60 * 60 * 1_000, 1_000 * 2 ** Math.min(attempts, 10));
      await db.prepare(
        `UPDATE storage_cleanup_outbox SET attempts = ?, available_at = ?, last_error = ?
         WHERE object_key = ? AND completed_at IS NULL`,
      ).bind(attempts, retryAt, cleanError(error), row.object_key).run();
    }
  }
}

async function storageReferenceCount(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM handouts
        WHERE deleted_at IS NULL AND (display_key = ? OR thumbnail_key = ?)) +
       (SELECT COUNT(*) FROM scenario_provisioning_assets a
        JOIN scenario_provisioning_jobs j ON j.id = a.job_id
        WHERE a.r2_key = ? AND (
          (a.committed_at IS NOT NULL AND a.kind NOT IN ('handout-display', 'handout-thumbnail'))
          OR (a.committed_at IS NULL AND j.status != 'failed')
        ))
       AS value`,
  ).bind(key, key, key).first<{ value: number }>();
  return Number(row?.value) || 0;
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").slice(0, 240);
}
