import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { User, PermissionCode } from "../../shared/crm";
import { PERMISSION_CODES } from "../../shared/crm";
import { type Db, getPool, rows, run, transaction, iso } from "./db";
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export const opaque = (): string => randomBytes(32).toString("base64url");
export const csrfFor = (session: string): string => createHmac("sha256", session).update("youcai-csrf-v1").digest("base64url");
export function safeEqual(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, result) => err ? reject(err) : resolve(result)));
export async function hashPassword(password: string): Promise<string> { const salt = randomBytes(16).toString("hex"); const key = await derive(password, salt); return `scrypt$32768$8$1$${salt}$${key.toString("hex")}`; }
export async function checkPassword(password: string, encoded: string): Promise<boolean> { const parts = encoded.split("$"); if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$32768$8$1" || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false; return safeEqual((await derive(password, parts[4])).toString("hex"), parts[5]); }
export const BOOTSTRAP_EMAILS = new Set(["alberto@youcaimedical.com", "eniodeleon87@gmail.com", "eadlr1@gmail.com", "kme2medical@gmail.com"]);
export const shouldBootstrap = (email: string, emailVerified: boolean, alreadyCompleted = false): boolean => emailVerified && !alreadyCompleted && BOOTSTRAP_EMAILS.has(email.trim().toLowerCase());
export const isTopLevel = (user: User): boolean => user.roles.includes("admin") || user.roles.includes("ceo");
export function requireActive(user: User | null): asserts user is User { if (!user) throw new HttpError(401, "Sign in is required"); if (user.status !== "ACTIVE" || !user.emailVerified) throw new HttpError(403, "Your account is not active"); }
export function requirePermission(user: User | null, permission?: string, topLevel = false): asserts user is User { requireActive(user); if ((permission && !user.permissions.includes(permission)) || (topLevel && !isTopLevel(user))) throw new HttpError(403, "You do not have permission for this action"); }
export function validateRoleChange(actorId: string, targetId: string, verified: boolean, status: string, roles: string[], activeAdminsAfter: number): void {
  if (actorId === targetId) throw new HttpError(409, "You cannot change your own roles or status");
  if (status === "ACTIVE" && !verified) throw new HttpError(409, "Email verification is required before approval");
  if (status === "ACTIVE" && !roles.length) throw new HttpError(422, "An active user requires at least one role");
  if (activeAdminsAfter < 1) throw new HttpError(409, "At least one effective active administrator must remain");
}
export function protectRole(code: string, permissions: string[]): void { if (["admin", "ceo"].includes(code) && PERMISSION_CODES.some(p => !permissions.includes(p))) throw new HttpError(409, "Core Admin and CEO permissions cannot be removed"); }
export async function getUser(db: Db, id: string): Promise<User | null> {
  const row = (await rows(db, "SELECT u.*, rr.role_code AS requested_role FROM crm_users u LEFT JOIN crm_role_requests rr ON rr.user_id = u.id WHERE u.id = ?", [id]))[0];
  if (!row) return null;
  const roleRows = await rows(db, "SELECT r.code FROM crm_user_roles ur JOIN crm_roles r ON r.code = ur.role_code AND r.active = TRUE WHERE ur.user_id = ? ORDER BY r.code", [id]);
  const permissionRows = await rows(db, "SELECT DISTINCT p.code FROM crm_user_roles ur JOIN crm_roles r ON r.code = ur.role_code AND r.active = TRUE JOIN crm_role_permissions rp ON rp.role_code = r.code JOIN crm_permissions p ON p.code = rp.permission_code AND p.active = TRUE WHERE ur.user_id = ? ORDER BY p.code", [id]);
  const active = row.status === "ACTIVE" && !!row.email_verified_at;
  return { id: row.id, fullName: row.full_name, email: row.email_normalized, status: row.status, emailVerified: !!row.email_verified_at, roles: roleRows.map(v => v.code), permissions: active ? permissionRows.map(v => v.code) : [], requestedRole: row.requested_role ?? null, createdAt: iso(row.created_at) };
}
export interface AuthContext { user: User; sessionHash: string; csrfToken: string; csrfHash: string; }
export function sessionCookie(req: Request): string | null { const cookies = req.headers.cookie?.split(";") ?? []; for (const part of cookies) { const [key, ...values] = part.trim().split("="); if (key === "youcai_session") { const value = values.join("="); return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null; } } return null; }
export async function resolveSession(req: Request, db: Db = getPool()): Promise<AuthContext | null> {
  const token = sessionCookie(req); if (!token) return null;
  const row = (await rows(db, "SELECT user_id, csrf_hash FROM crm_auth_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)", [hash(token)]))[0];
  if (!row) return null;
  const user = await getUser(db, row.user_id); if (!user) return null;
  return { user, sessionHash: hash(token), csrfToken: csrfFor(token), csrfHash: row.csrf_hash };
}
export async function audit(db: Db, actorId: string | null, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}): Promise<void> { await run(db, "INSERT INTO crm_audit_logs (id, actor_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), actorId, action, entityType, entityId, JSON.stringify(metadata)]); }
export async function lockSecurity(db: Db): Promise<void> { await rows(db, "SELECT id FROM crm_security_guard WHERE id = 1 FOR UPDATE"); }
export async function effectiveAdminCount(db: Db): Promise<number> { const candidates = await rows(db, "SELECT DISTINCT u.id FROM crm_users u JOIN crm_user_roles ur ON ur.user_id = u.id JOIN crm_roles r ON r.code = ur.role_code AND r.active = TRUE WHERE u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL AND r.code IN ('admin', 'ceo')"); let count = 0; for (const candidate of candidates) { const user = await getUser(db, candidate.id); if (user && PERMISSION_CODES.every(p => user.permissions.includes(p))) count++; } return count; }
export async function limitAuth(req: Request, operation: string, email?: string): Promise<void> {
  // Hash addresses and IPs; trust proxy configuration belongs to the deployment, never parse client XFF here.
  const buckets = [{ key: `${operation}:ip:${req.ip || req.socket.remoteAddress || "unknown"}`, max: operation === "login" ? 30 : 12 }];
  if (email) buckets.push({ key: `${operation}:email:${email}`, max: 8 });
  let blocked = false;
  await transaction(async db => {
    for (const bucket of buckets) {
      const key = hash(bucket.key);
      await run(db, "INSERT INTO crm_auth_rate_limits (bucket_hash, attempts, window_start) VALUES (?, 0, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE bucket_hash = bucket_hash", [key]);
      const row = (await rows(db, "SELECT attempts, TIMESTAMPDIFF(SECOND, window_start, UTC_TIMESTAMP(3)) AS age FROM crm_auth_rate_limits WHERE bucket_hash = ? FOR UPDATE", [key]))[0];
      const attempts = Number(row.age) >= 900 ? 1 : Number(row.attempts) + 1;
      if (Number(row.age) >= 900) await run(db, "UPDATE crm_auth_rate_limits SET attempts = 1, window_start = UTC_TIMESTAMP(3) WHERE bucket_hash = ?", [key]);
      else await run(db, "UPDATE crm_auth_rate_limits SET attempts = LEAST(attempts + 1, 100000) WHERE bucket_hash = ?", [key]);
      if (attempts > bucket.max) blocked = true;
    }
  });
  if (blocked) throw new HttpError(429, "Too many attempts. Please try again later");
}
export function checkOrigin(req: Request): void {
  const raw = req.get("origin") || req.get("referer");
  // Non-browser callers omit Origin, but browsers cannot bypass JSON + origin checks via HTML forms.
  if (!raw) return;
  let incoming: URL; try { incoming = new URL(raw); } catch { throw new HttpError(403, "Untrusted request origin"); }
  const allowed = new Set<string>();
  if (process.env.APP_PUBLIC_URL) { try { allowed.add(new URL(process.env.APP_PUBLIC_URL).origin); } catch { /* fail closed */ } }
  // Preview and same-origin production: HTTPS only, compare public Host, not internal req.protocol.
  const host = req.get("host");
  if (host && incoming.protocol === "https:" && incoming.host === host) return;
  if (allowed.has(incoming.origin)) return;
  throw new HttpError(403, "Untrusted request origin");
}
export const permission = (code?: PermissionCode, topLevel = false) => async (req: Request, res: Response, next: NextFunction) => { try { const auth = await resolveSession(req); requirePermission(auth?.user ?? null, code, topLevel); res.locals.auth = auth; if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) { const value = req.get("x-csrf-token"); if (!value || !auth || !safeEqual(hash(value), auth.csrfHash)) throw new HttpError(403, "CSRF token is missing or invalid"); } next(); } catch (error) { next(error); } };
