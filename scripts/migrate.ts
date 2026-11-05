import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getPool, rows, run, closePool } from "../server/crm/db";
export async function migrate() {
  const db = getPool();
  const version = (await rows(db, "SELECT VERSION() AS version"))[0].version;
  console.log(`Database compatibility: ${version}; portable InnoDB tables and application transactions`);
  await run(db, "CREATE TABLE IF NOT EXISTS crm_schema_migrations (name VARCHAR(160) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB");
  const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
  for (const name of (await readdir(directory)).filter(v => /^\d+.*\.sql$/.test(v)).sort()) {
    const text = await readFile(`${directory}/${name}`, "utf8");
    const checksum = createHash("sha256").update(text).digest("hex");
    const existing = (await rows(db, "SELECT checksum FROM crm_schema_migrations WHERE name = ?", [name]))[0];
    if (existing) { if (existing.checksum !== checksum) throw new Error(`Applied migration ${name} was changed; add a new migration instead`); console.log(`Already applied: ${name}`); continue; }
    // DDL auto-commits; every statement is rerunnable after partial failure. No multi-statement SQL enabled.
    for (const statement of text.split(";").map(v => v.trim()).filter(Boolean)) await run(db, statement);
    await run(db, "INSERT INTO crm_schema_migrations (name, checksum) VALUES (?, ?)", [name, checksum]);
    console.log(`Applied: ${name}`);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) migrate().catch(() => { console.error("Migration failed. Check database configuration and migration compatibility."); process.exitCode = 1; }).finally(closePool);
