import { createHash, randomUUID } from "node:crypto";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import mysql, { type Connection, type RowDataPacket } from "mysql2";

/**
 * Manual logical export only. Never imports application migrations/seeds and
 * never issues INSERT/UPDATE/DELETE/DDL or creates an application identity.
 * See docs/operations.md before running against any managed/customer database.
 */
const BUSINESS_TABLES = [
  "crm_users",
  "crm_owner_admin_access",
  "crm_business_regions",
  "crm_countries",
  "crm_country_regions",
  "crm_roles",
  "crm_permissions",
  "crm_role_permissions",
  "crm_user_roles",
  "crm_role_requests",
  "crm_company",
  "crm_customers",
  "crm_customer_contacts",
  "crm_audit_logs",
  "crm_security_guard",
  "crm_schema_migrations",
] as const;
const AUTH_TABLES = [
  "crm_auth_credentials",
  "crm_auth_sessions",
  "crm_auth_tokens",
  "crm_auth_rate_limits",
] as const;
// Unused starter `users` is deliberately NOT included, even with --include-auth.
// Unknown tables are skipped, not guessed safe. Review these lists after migrations.
const KNOWN_TABLES = new Set<string>([...BUSINESS_TABLES, ...AUTH_TABLES]);
const SENSITIVE_TABLES = new Set<string>(AUTH_TABLES);
const HELP = `Youcai read-only logical JSON export

Usage:
  pnpm exec tsx scripts/backup.ts --directory /absolute/private/directory
  pnpm exec tsx scripts/backup.ts --directory /absolute/private/directory \\
    --include-auth --acknowledge-sensitive-export

Requires DATABASE_URL in the server environment or private .env.
The existing destination directory must be owned by the current user, have no
permissions for group/others, and be outside every Git repository.
No credentials, SQL error details or row data are printed. Output is cleartext
JSON with mode 0600: encrypt externally, restrict access, and never commit it.
Default preserves CRM identity metadata but excludes password hashes, sessions,
single-use tokens and authentication rate limits. Identity metadata is still PII.
--include-auth requires explicit acknowledgment; all live sessions and single-use
tokens must still be invalidated during a reviewed, isolated restore.
No restore, seed or migration is performed. Unknown tables are never exported.
`;

interface Options {
  directory: string;
  includeAuth: boolean;
}
interface Column extends RowDataPacket {
  name: string;
  type: string;
  nullable: string;
  defaultValue: unknown;
  extra: string;
  ordinal: number;
}
interface TableSchema {
  name: string;
  createTableSql: string;
  schemaSha256: string;
  columns: Column[];
}
class SafeFailure extends Error {}

function optionsFrom(args: string[]): Options | null {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return null;
  let directory: string | undefined;
  let includeAuth = false;
  let acknowledgment = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      arg === "--directory" &&
      !directory &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    ) {
      directory = args[++i];
    } else if (arg === "--include-auth" && !includeAuth) {
      includeAuth = true;
    } else if (arg === "--acknowledge-sensitive-export" && !acknowledgment) {
      acknowledgment = true;
    } else {
      throw new SafeFailure(
        "Invalid arguments. Run with --help; never pass credentials as command arguments."
      );
    }
  }
  if (!directory || !path.isAbsolute(directory))
    throw new SafeFailure("An absolute --directory is required.");
  if (includeAuth !== acknowledgment)
    throw new SafeFailure(
      "Use --include-auth and --acknowledge-sensitive-export together only after authorizing a sensitive export."
    );
  return { directory, includeAuth };
}

async function privateDirectory(requested: string): Promise<string> {
  const directory = await realpath(requested);
  const stat = await lstat(directory);
  if (!stat.isDirectory())
    throw new SafeFailure(
      "The export destination must be an existing directory."
    );
  if ((stat.mode & 0o077) !== 0)
    throw new SafeFailure(
      "The destination must not grant group/other access; use a private directory with mode 0700."
    );
  if (process.getuid && stat.uid !== process.getuid())
    throw new SafeFailure(
      "The destination must be owned by the current operating-system user."
    );
  const project = await realpath(
    fileURLToPath(new URL("../", import.meta.url))
  );
  if (directory === project || directory.startsWith(project + path.sep))
    throw new SafeFailure(
      "Exports must be stored outside the application source directory."
    );
  for (let ancestor = directory; ; ancestor = path.dirname(ancestor)) {
    try {
      await lstat(path.join(ancestor, ".git"));
      throw new SafeFailure(
        "The destination is inside a Git repository; select a private directory elsewhere."
      );
    } catch (error) {
      if (error instanceof SafeFailure) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (path.dirname(ancestor) === ancestor) break;
  }
  return directory;
}

function connectionFromEnvironment(): Connection {
  const raw = process.env.DATABASE_URL;
  if (!raw)
    throw new SafeFailure(
      "DATABASE_URL is missing; configure it privately on the server."
    );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFailure("DATABASE_URL is not a valid database URL.");
  }
  if (
    !["mysql:", "mysql2:"].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  ) {
    throw new SafeFailure(
      "DATABASE_URL must identify a MySQL-compatible server and database."
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  return mysql.createConnection({
    host,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: local ? undefined : { rejectUnauthorized: true, verifyIdentity: true },
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    jsonStrings: true,
    multipleStatements: false,
    connectTimeout: 15_000,
  });
}

function quoteIdentifier(name: string): string {
  if (!KNOWN_TABLES.has(name))
    throw new SafeFailure(
      "Refusing to export a table outside the reviewed allowlist."
    );
  return "`" + name.replace(/`/g, "``") + "`";
}

async function tableSchema(
  connection: Connection,
  name: string
): Promise<TableSchema> {
  const db = connection.promise();
  const [ddlRows] = await db.query<RowDataPacket[]>(
    `SHOW CREATE TABLE ${quoteIdentifier(name)}`
  );
  const createTableSql = ddlRows[0]?.["Create Table"];
  if (typeof createTableSql !== "string")
    throw new SafeFailure(
      "Unable to inspect a table definition; export stopped."
    );
  const [columns] = await db.execute<Column[]>(
    "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, ORDINAL_POSITION AS ordinal FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [name]
  );
  return {
    name,
    createTableSql,
    schemaSha256: createHash("sha256").update(createTableSql).digest("hex"),
    columns,
  };
}

async function writeAll(file: FileHandle, text: string): Promise<void> {
  const buffer = Buffer.from(text, "utf8");
  for (let offset = 0; offset < buffer.length; ) {
    const { bytesWritten } = await file.write(
      buffer,
      offset,
      buffer.length - offset,
      null
    );
    if (!bytesWritten)
      throw new SafeFailure(
        "The output filesystem did not accept data; export stopped."
      );
    offset += bytesWritten;
  }
}

function serializeRow(row: Record<string, unknown>): string {
  // mysql2 returns dates/JSON/large numerics as strings for lossless portability.
  // Binary data is tagged, not silently coerced to a UTF-8 string.
  const portable = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      Buffer.isBuffer(value)
        ? { $binary: "base64", data: value.toString("base64") }
        : value,
    ])
  );
  return JSON.stringify(portable);
}

async function exportDatabase(options: Options): Promise<void> {
  process.umask(0o077);
  config({ quiet: true });
  let stage = "validating the private destination";
  let connection: Connection | undefined;
  let file: FileHandle | undefined;
  let outputPath: string | undefined;
  let outputCreated = false;
  let complete = false;
  let inTransaction = false;
  const startedAt = new Date().toISOString();
  try {
    const directory = await privateDirectory(options.directory);
    stage = "connecting securely to the database";
    connection = connectionFromEnvironment();
    const db = connection.promise();
    stage = "starting the required read-only consistent snapshot";
    await db.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    inTransaction = true;
    const [versionRows] = await db.query<RowDataPacket[]>(
      "SELECT VERSION() AS version"
    );
    const serverVersion = String(versionRows[0].version);
    stage = "inspecting the actual schema";
    const [discovered] = await db.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    const actual = discovered.map(row => String(row.name));
    const selected = actual.filter(
      name =>
        KNOWN_TABLES.has(name) &&
        (options.includeAuth || !SENSITIVE_TABLES.has(name))
    );
    const required = options.includeAuth
      ? [...BUSINESS_TABLES, ...AUTH_TABLES]
      : [...BUSINESS_TABLES];
    if (required.some(name => !selected.includes(name))) {
      throw new SafeFailure(
        "The complete reviewed CRM schema is not visible; no backup was created. Review migrations, read permissions and the export allowlist."
      );
    }
    const excludedAuthenticationTables = actual.filter(
      name => SENSITIVE_TABLES.has(name) && !options.includeAuth
    );
    const ignoredTables = actual.filter(name => !KNOWN_TABLES.has(name));
    const schemas: TableSchema[] = [];
    for (const name of selected) {
      const schema = await tableSchema(connection, name);
      if (
        !options.includeAuth &&
        schema.columns.some(column =>
          /password|secret|token|csrf/i.test(column.name)
        )
      ) {
        throw new SafeFailure(
          "A reviewed business table now has a potentially sensitive auth column; default export stopped pending schema/security review."
        );
      }
      schemas.push(schema);
    }
    stage = "creating the private output file";
    // Random filename + exclusive creation prevents overwriting any previous backup.
    outputPath = path.join(
      directory,
      `youcai-${startedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`
    );
    file = await open(outputPath, "wx", 0o600);
    outputCreated = true;
    await file.chmod(0o600);
    await writeAll(
      file,
      '{"format":"youcai-logical-export","formatVersion":1,"tables":['
    );
    const tableCounts: Record<string, number> = {};
    const tableRowSha256: Record<string, string> = {};
    let totalRows = 0;
    for (let index = 0; index < schemas.length; index++) {
      const schema = schemas[index];
      stage = "streaming the snapshot to private storage";
      if (index > 0) await writeAll(file, ",");
      const metadata = JSON.stringify(schema);
      await writeAll(file, metadata.slice(0, -1) + ',"rows":[');
      const stream = connection
        .query(`SELECT * FROM ${quoteIdentifier(schema.name)}`)
        .stream({ highWaterMark: 32 });
      let count = 0;
      const hash = createHash("sha256");
      try {
        for await (const row of stream) {
          const serialized = serializeRow(row as Record<string, unknown>);
          if (count > 0) await writeAll(file, ",");
          await writeAll(file, serialized);
          hash.update(serialized + "\n");
          count++;
        }
      } finally {
        if (!stream.destroyed) stream.destroy();
      }
      await writeAll(file, `],"rowCount":${count}}`);
      tableCounts[schema.name] = count;
      tableRowSha256[schema.name] = hash.digest("hex");
      totalRows += count;
      // Counts only; never print customer/user/authentication row values.
      console.log(`Exported reviewed table ${schema.name}: ${count} rows.`);
    }
    stage = "checking for concurrent schema changes";
    for (const schema of schemas) {
      const after = await tableSchema(connection, schema.name);
      if (after.schemaSha256 !== schema.schemaSha256)
        throw new SafeFailure(
          "Schema changed during export; output discarded. Pause migrations and retry after review."
        );
    }
    const [afterTables] = await db.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    if (
      JSON.stringify(afterTables.map(row => String(row.name))) !==
      JSON.stringify(actual)
    ) {
      throw new SafeFailure(
        "The table set changed during export; output discarded. Pause migrations and retry after review."
      );
    }
    const manifest = {
      startedAt,
      completedAt: new Date().toISOString(),
      databaseServerVersion: serverVersion,
      isolation: "REPEATABLE READ",
      transaction: "WITH CONSISTENT SNAPSHOT, READ ONLY",
      authenticationIncluded: options.includeAuth,
      encrypted: false,
      excludedAuthenticationTables,
      ignoredTables,
      tableCounts,
      totalRows,
      tableRowSha256,
      warnings: [
        "Logical export of reviewed tables only; not a full server/provider backup or point-in-time recovery mechanism.",
        "Contains confidential business/personal data. Encrypt externally and never commit or expose publicly.",
        ...(options.includeAuth
          ? [
              "Contains password hashes and sensitive authentication state. Invalidate all sessions and one-use tokens before any restored app becomes accessible.",
            ]
          : [
              "CRM identity metadata/role relationships are included, but password hashes and authentication state are excluded. Restored business records retain actor references; users cannot sign in until an approved credential-recovery process is completed. Do not assume the current password-reset endpoint creates missing credential rows.",
            ]),
        ...(ignoredTables.length
          ? [
              "Unreviewed/legacy tables were skipped; inspect ignoredTables before accepting coverage.",
            ]
          : []),
      ],
    };
    await writeAll(file, '],"manifest":' + JSON.stringify(manifest) + "}\n");
    stage = "completing the read-only transaction and flushing the file";
    await db.commit();
    inTransaction = false;
    await file.sync();
    await file.close();
    file = undefined;
    complete = true;
    console.log(`Completed private JSON export: ${outputPath}`);
    console.log(
      `Manifest: ${selected.length} reviewed tables, ${totalRows} rows; authentication ${options.includeAuth ? "INCLUDED — encrypt externally" : "excluded"}.`
    );
    if (ignoredTables.length)
      console.log(
        `Coverage warning: ${ignoredTables.length} unreviewed/legacy tables were skipped; see the private manifest.`
      );
    console.log(
      "No database data was changed. Encrypt this private file before transfer or long-term retention."
    );
  } catch (error) {
    // Driver errors can contain credentials, SQL or row values. Never print them.
    const message =
      error instanceof SafeFailure
        ? error.message
        : `Export failed while ${stage}. Details suppressed to protect secrets; inspect server/provider access privately.`;
    throw new SafeFailure(message);
  } finally {
    if (file) await file.close().catch(() => undefined);
    if (connection && inTransaction)
      await connection
        .promise()
        .rollback()
        .catch(() => undefined);
    if (connection) connection.destroy();
    if (!complete && outputCreated && outputPath)
      await unlink(outputPath).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  try {
    const options = optionsFrom(process.argv.slice(2));
    if (!options) {
      console.log(HELP);
      return;
    }
    await exportDatabase(options);
  } catch (error) {
    console.error(
      error instanceof SafeFailure
        ? error.message
        : "Export failed; private details were suppressed."
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
