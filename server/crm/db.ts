import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
export type Db = Pool | PoolConnection;
let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("Database is not configured");
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    pool = mysql.createPool({ host: url.hostname, port: Number(url.port) || 3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), ssl: local ? undefined : { rejectUnauthorized: true, verifyIdentity: true }, connectionLimit: 8, charset: "utf8mb4", timezone: "Z", dateStrings: true, multipleStatements: false });
  }
  return pool;
}
export async function rows<T = Record<string, any>>(db: Db, sql: string, values: any[] = []): Promise<T[]> { const [result] = await db.execute<RowDataPacket[]>(sql, values); return result as T[]; }
export async function run(db: Db, sql: string, values: any[] = []): Promise<ResultSetHeader> { const [result] = await db.execute<ResultSetHeader>(sql, values); return result; }
export async function transaction<T>(work: (db: PoolConnection) => Promise<T>): Promise<T> { const db = await getPool().getConnection(); try { await db.beginTransaction(); const result = await work(db); await db.commit(); return result; } catch (error) { await db.rollback(); throw error; } finally { db.release(); } }
export async function closePool(): Promise<void> { if (pool) { const old = pool; pool = undefined; await old.end(); } }
export const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value).replace(" ", "T").replace(/(?:\.\d+)?$/, "Z");
