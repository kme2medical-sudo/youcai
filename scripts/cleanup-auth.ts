import "dotenv/config";
import { fileURLToPath } from "node:url";
import { getPool, run, closePool } from "../server/crm/db";
export async function cleanupAuth() {
  const db = getPool();
  const sessions = await run(db, "DELETE FROM crm_auth_sessions WHERE expires_at <= UTC_TIMESTAMP(3)");
  const tokens = await run(db, "DELETE FROM crm_auth_tokens WHERE expires_at <= UTC_TIMESTAMP(3)");
  const buckets = await run(db, "DELETE FROM crm_auth_rate_limits WHERE window_start < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)");
  console.log(`Expired auth cleanup: ${sessions.affectedRows} sessions, ${tokens.affectedRows} tokens, ${buckets.affectedRows} stale limit buckets. No identities or business records changed.`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) cleanupAuth().catch(() => { console.error("Auth cleanup failed; check private database configuration."); process.exitCode = 1; }).finally(closePool);
