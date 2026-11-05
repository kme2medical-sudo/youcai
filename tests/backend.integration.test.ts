import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
const state = vi.hoisted(() => ({ connection: null as any, savepoint: 0, locks: [] as string[] }));
// Test-only module substitution. Production has no database injection/bypass. Every route transaction
// gets a real TiDB savepoint inside one root transaction; the root is always rolled back.
vi.mock("../server/crm/db", async () => {
  const actual = await vi.importActual<typeof import("../server/crm/db")>("../server/crm/db");
  return { ...actual, getPool: () => state.connection || actual.getPool(),
    rows: async (db:any, sql:string, values:any[] = []) => { if (sql.includes("FOR UPDATE")) state.locks.push(sql); return actual.rows(db, sql, values); },
    transaction: async (work: (db: PoolConnection) => Promise<unknown>) => {
      if (!state.connection) return actual.transaction(work);
      const name = `test_route_${++state.savepoint}`;
      await state.connection.query(`SAVEPOINT ${name}`);
      try { const result = await work(state.connection); await state.connection.query(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await state.connection.query(`ROLLBACK TO SAVEPOINT ${name}`); await state.connection.query(`RELEASE SAVEPOINT ${name}`); throw error; }
    },
  };
});
import { crmRouter } from "../server/crm/api";
import { rows, run } from "../server/crm/db";
import { setTestMailTransport, type TransactionalMail } from "../server/crm/mail";
import { hash, opaque, csrfFor, getUser, effectiveAdminCount, BOOTSTRAP_EMAILS } from "../server/crm/security";
import { issueOwnerAdminInvitations, type OwnerAdminInvitation } from "../server/crm/admin-enrollment";
import { PERMISSION_CODES } from "../shared/crm";
import { seed } from "../scripts/seed";
const enabled = !!process.env.DATABASE_URL;
const password = "Secure Youcai Test Password 2026";
const mail: TransactionalMail[] = [];
let server: Server, origin: string, actualDb: typeof import("../server/crm/db"), connection: PoolConnection;
interface Client { userId: string; cookie: string; csrf: string; }
let admin: Client, secondAdmin: Client, pending: Client, sales: Client, pricing: Client, employee: Client, technician: Client, unverified: Client;
let customerId = "", primaryId = "";
const uniqueEmail = (label: string) => `${label}-${randomUUID()}@example.invalid`;
async function request(path: string, method = "GET", body?: unknown, client?: Client, extra: Record<string,string> = {}) {
  const headers: Record<string,string> = { ...extra };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (client) { headers.Cookie = client.cookie; if (method !== "GET") headers["X-CSRF-Token"] = client.csrf; }
  const response = await fetch(`${origin}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, cookie: response.headers.get("set-cookie"), headers: response.headers };
}
function mailedToken(email: string): string { const latest = [...mail].reverse().find(item => item.to === email); if (!latest) throw new Error("Test mail was not delivered"); const link = latest.text.match(/https:\/\/[^\s]+/)?.[0]; if (!link) throw new Error("Test mail did not contain a private link"); return new URL(link).searchParams.get("token")!; }
async function signup(email: string, requestedRole: string, verify = true): Promise<Client> {
  const response = await request("/auth/register", "POST", { fullName:"Rollback Test Account", email, password, requestedRole }); expect(response.status).toBe(200); expect(response.data).toEqual({ message: expect.any(String) });
  const created = (await rows(connection, "SELECT id, status, email_verified_at FROM crm_users WHERE email_normalized = ?", [email]))[0];
  expect(created.status).toBe("UNVERIFIED"); expect(created.email_verified_at).toBeNull(); expect((await rows(connection, "SELECT role_code FROM crm_user_roles WHERE user_id = ?", [created.id])).length).toBe(0);
  if (verify) { const token = mailedToken(email); expect(JSON.stringify(response.data)).not.toContain(token); const stored = (await rows(connection, "SELECT token_hash FROM crm_auth_tokens WHERE user_id = ?", [created.id]))[0]; expect(stored.token_hash).toBe(hash(token)); expect((await request("/auth/verify", "POST", { token, password })).status).toBe(200); }
  const login = await request("/auth/login", "POST", { email, password }); expect(login.status).toBe(200);
  return { userId: login.data.user.id, cookie: login.cookie!.split(";")[0], csrf: login.data.csrfToken };
}
async function approve(client: Client, roles: string[]) { expect((await request(`/users/${client.userId}`, "PUT", { status:"ACTIVE", roles }, admin)).status).toBe(200); }
(enabled ? describe : describe.skip)("backend managed TiDB rollback integration", () => {
  beforeAll(async () => {
    actualDb = await vi.importActual<typeof import("../server/crm/db")>("../server/crm/db");
    connection = await actualDb.getPool().getConnection(); await connection.beginTransaction(); state.connection = connection;
    setTestMailTransport(async message => { mail.push(message); });
    const app = express(); app.use("/api", crmRouter); server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
    // Only exact verified allowlisted identities may become test admins, and all are rolled back.
    const conflict = await rows(connection, "SELECT id FROM crm_users WHERE email_normalized IN ('alberto@youcaimedical.com', 'eniodeleon87@gmail.com', 'eadlr1@gmail.com', 'kme2medical@gmail.com', 'wangxukai@youcaimedical.com')"); if (conflict.length) throw new Error("Allowlisted identities already exist. Refusing to change real identities; run integration against an isolated copy.");
    admin = await signup("alberto@youcaimedical.com", "employee"); secondAdmin = await signup("eniodeleon87@gmail.com", "technician");
    pending = await signup(uniqueEmail("pending"), "admin");
    sales = await signup(uniqueEmail("sales"), "sales"); await approve(sales, ["sales"]);
    pricing = await signup(uniqueEmail("pricing"), "pricing"); await approve(pricing, ["pricing"]);
    employee = await signup(uniqueEmail("employee"), "employee"); await approve(employee, ["employee"]);
    technician = await signup(uniqueEmail("technician"), "technician"); await approve(technician, ["technician"]);
    unverified = await signup(uniqueEmail("unverified"), "admin", false);
  }, 120000);
  beforeEach(async () => { await run(connection, "DELETE FROM crm_auth_rate_limits"); state.locks.length = 0; });
  afterAll(async () => {
    setTestMailTransport(undefined); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (connection) { await connection.rollback(); state.connection = null; connection.release(); }
    if (actualDb) await actualDb.closePool();
  }, 30000);
  it("verified exact allowlist becomes admin; ordinary verification stays pending with no roles", async () => {
    for (const fixture of [admin, secondAdmin]) { const a = await getUser(connection, fixture.userId); expect(a?.status).toBe("ACTIVE"); expect(a?.emailVerified).toBe(true); expect(a?.roles).toEqual(["admin"]); expect(a?.permissions).toHaveLength(13); expect(a?.permissions).toEqual([...PERMISSION_CODES].sort()); }
    const p = await getUser(connection, pending.userId);
    expect(p?.status).toBe("PENDING_APPROVAL"); expect(p?.roles).toEqual([]); expect(p?.permissions).toEqual([]); expect(p?.requestedRole).toBe("admin");
  });
  it("Wang's exact mailbox bootstraps once after owner verification, never restoring revoked admin rights or granting domain/alias matches", async () => {
    const email = "wangxukai@youcaimedical.com", registrationPassword = "Wang Personally Chosen Registration Password 2026", ownerPassword = "Wang Personally Chosen Verification Password 2026", resetPassword = "Wang Personally Chosen Recovery Password 2026";
    const nearMatches = [`ordinary-${randomUUID()}@youcaimedical.com`, `wangxukai+${randomUUID()}@youcaimedical.com`], mailCount = mail.length;
    await connection.query("SAVEPOINT test_wang_bootstrap");
    try {
      const registration = await request("/auth/register", "POST", { fullName: "Rollback Wang Mailbox Owner", email, password: registrationPassword, requestedRole: "employee" });
      expect(registration.status).toBe(200); expect(registration.data).toEqual({ message: expect.any(String) });
      const created = (await rows(connection, "SELECT id, status, email_verified_at, bootstrap_completed FROM crm_users WHERE email_normalized = ?", [email]))[0];
      expect(created.status).toBe("UNVERIFIED"); expect(created.email_verified_at).toBeNull(); expect(Number(created.bootstrap_completed)).toBe(0);
      expect(await getUser(connection, created.id)).toMatchObject({ email, status: "UNVERIFIED", emailVerified: false, requestedRole: "employee", roles: [], permissions: [] });
      const roleCount = async () => Number((await rows(connection, "SELECT COUNT(*) AS total FROM crm_user_roles WHERE user_id = ?", [created.id]))[0].total);
      const bootstrapCount = async () => Number((await rows(connection, "SELECT COUNT(*) AS total FROM crm_audit_logs WHERE entity_id = ? AND action = 'auth.verified_admin_bootstrap'", [created.id]))[0].total);
      expect(await roleCount()).toBe(0); expect(await bootstrapCount()).toBe(0);
      const initialLogin = await request("/auth/login", "POST", { email, password: registrationPassword }); expect(initialLogin.status).toBe(200);
      expect(initialLogin.data.user).toMatchObject({ id: created.id, status: "UNVERIFIED", emailVerified: false, roles: [], permissions: [] });
      const earlierSession: Client = { userId: created.id, cookie: initialLogin.cookie!.split(";")[0], csrf: initialLogin.data.csrfToken };
      expect((await request("/auth/me", "GET", undefined, earlierSession)).data.user).toMatchObject({ status: "UNVERIFIED", roles: [], permissions: [] });
      for (const path of ["/customers", "/users", "/company"]) expect((await request(path, "GET", undefined, earlierSession)).status).toBe(403);
      const token = mailedToken(email); expect(JSON.stringify(registration.data)).not.toContain(token);
      // The mailbox owner personally supplies the durable password to the mailed form; no admin approval is involved.
      const verified = await request("/auth/verify", "POST", { token, password: ownerPassword }); expect(verified.status).toBe(200); expect(verified.cookie).toBeNull();
      const ownerUser = await getUser(connection, created.id);
      expect(ownerUser).toMatchObject({ email, status: "ACTIVE", emailVerified: true, requestedRole: "employee", roles: ["admin"] });
      expect(ownerUser?.permissions).toHaveLength(13); expect(ownerUser?.permissions).toEqual([...PERMISSION_CODES].sort());
      expect(await roleCount()).toBe(1); expect(await bootstrapCount()).toBe(1);
      expect(await rows(connection, "SELECT action FROM crm_audit_logs WHERE entity_id = ? AND action IN ('user.approval_changed', 'user.roles_status_changed')", [created.id])).toEqual([]);
      const marker = (await rows(connection, "SELECT email_verified_at, bootstrap_completed FROM crm_users WHERE id = ?", [created.id]))[0];
      expect(marker.email_verified_at).not.toBeNull(); expect(Number(marker.bootstrap_completed)).toBe(1);
      expect(Number((await rows(connection, "SELECT COUNT(*) AS total FROM crm_auth_sessions WHERE user_id = ?", [created.id]))[0].total)).toBe(0);
      expect((await request("/auth/me", "GET", undefined, earlierSession)).data.user).toBeNull();
      for (const path of ["/customers", "/users", "/company"]) expect((await request(path, "GET", undefined, earlierSession)).status).toBe(401);
      for (const oldPassword of [registrationPassword, password]) expect((await request("/auth/login", "POST", { email, password: oldPassword })).status).toBe(401);
      const ownerLogin = await request("/auth/login", "POST", { email, password: ownerPassword }); expect(ownerLogin.status).toBe(200);
      expect(ownerLogin.data.user).toMatchObject({ id: created.id, status: "ACTIVE", emailVerified: true, roles: ["admin"] }); expect(ownerLogin.data.user.permissions).toEqual([...PERMISSION_CODES].sort());
      const owner: Client = { userId: created.id, cookie: ownerLogin.cookie!.split(";")[0], csrf: ownerLogin.data.csrfToken };
      for (const path of ["/customers", "/users", "/company"]) expect((await request(path, "GET", undefined, owner)).status).toBe(200);
      const credential = (await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [created.id]))[0].password_hash;
      const replay = await request("/auth/verify", "POST", { token, password: resetPassword }); expect(replay.status).toBe(400); expect(replay.data).toEqual({ message: "This link is invalid or expired" });
      expect(await getUser(connection, created.id)).toEqual(ownerUser);
      expect((await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [created.id]))[0].password_hash).toBe(credential);
      const verifiedMailCount = mail.length;
      expect((await request("/auth/resend", "POST", { email })).status).toBe(200); expect(mail).toHaveLength(verifiedMailCount);
      expect(await roleCount()).toBe(1); expect(await bootstrapCount()).toBe(1);
      // Once another administrator revokes access, account-recovery routes must not bootstrap it again.
      expect((await request(`/users/${created.id}`, "PUT", { status: "SUSPENDED", roles: [] }, admin)).status).toBe(200);
      const assertRevoked = async () => {
        expect(await getUser(connection, created.id)).toMatchObject({ email, status: "SUSPENDED", emailVerified: true, roles: [], permissions: [] });
        expect(await roleCount()).toBe(0); expect(await bootstrapCount()).toBe(1);
        expect((await rows(connection, "SELECT email_verified_at, bootstrap_completed FROM crm_users WHERE id = ?", [created.id]))[0]).toEqual(marker);
      };
      await assertRevoked();
      for (const path of ["/customers", "/users", "/company"]) expect((await request(path, "GET", undefined, owner)).status).toBe(403);
      expect((await request("/auth/verify", "POST", { token, password: resetPassword })).status).toBe(400); await assertRevoked();
      expect((await request("/auth/register", "POST", { fullName: "Rollback Wang Re-registration", email, password: resetPassword, requestedRole: "admin" })).status).toBe(200);
      expect((await request("/auth/resend", "POST", { email })).status).toBe(200); expect(mail).toHaveLength(verifiedMailCount); await assertRevoked();
      expect(await rows(connection, "SELECT token_hash FROM crm_auth_tokens WHERE user_id = ? AND purpose = 'VERIFY'", [created.id])).toEqual([]);
      expect((await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [created.id]))[0].password_hash).toBe(credential);
      expect((await request("/auth/forgot", "POST", { email })).status).toBe(200); await assertRevoked();
      const resetToken = mailedToken(email);
      expect((await request("/auth/reset", "POST", { token: resetToken, password: resetPassword })).status).toBe(200); await assertRevoked();
      expect((await request("/auth/me", "GET", undefined, owner)).data.user).toBeNull();
      const recoveredLogin = await request("/auth/login", "POST", { email, password: resetPassword }); expect(recoveredLogin.status).toBe(200);
      expect(recoveredLogin.data.user).toMatchObject({ id: created.id, status: "SUSPENDED", roles: [], permissions: [] });
      for (const nearMatch of nearMatches) {
        const account = await signup(nearMatch, "employee");
        expect(await getUser(connection, account.userId)).toMatchObject({ email: nearMatch, status: "PENDING_APPROVAL", emailVerified: true, requestedRole: "employee", roles: [], permissions: [] });
        expect(Number((await rows(connection, "SELECT bootstrap_completed FROM crm_users WHERE id = ?", [account.userId]))[0].bootstrap_completed)).toBe(0);
        expect(await rows(connection, "SELECT role_code FROM crm_user_roles WHERE user_id = ?", [account.userId])).toEqual([]);
        expect(await rows(connection, "SELECT action FROM crm_audit_logs WHERE entity_id = ? AND action = 'auth.verified_admin_bootstrap'", [account.userId])).toEqual([]);
        for (const path of ["/customers", "/users", "/company"]) expect((await request(path, "GET", undefined, account)).status).toBe(403);
      }
      await assertRevoked();
    } finally {
      await connection.query("ROLLBACK TO SAVEPOINT test_wang_bootstrap"); await connection.query("RELEASE SAVEPOINT test_wang_bootstrap"); mail.splice(mailCount);
      expect(await rows(connection, "SELECT id FROM crm_users WHERE email_normalized IN (?, ?, ?)", [email, ...nearMatches])).toEqual([]);
    }
  }, 60000);
  it("mailed owner verification defeats allowlisted account preregistration and revokes every attacker session", async () => {
    await connection.query("SAVEPOINT test_prehijack");
    try {
      const email = "kme2medical@gmail.com", duplicatePassword = "Owner Duplicate Signup Password 2026", ownerPassword = "Owner Mailed Form Password 2026";
      const attacker = await signup(email, "admin", false);
      const secondLogin = await request("/auth/login", "POST", { email, password }); expect(secondLogin.status).toBe(200);
      const secondSession = { userId: attacker.userId, cookie: secondLogin.cookie!.split(";")[0], csrf: secondLogin.data.csrfToken };
      expect((await request("/customers", "GET", undefined, attacker)).status).toBe(403);
      const oldCredential = (await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [attacker.userId]))[0].password_hash;
      const token = mailedToken(email), mailCount = mail.length;
      const duplicate = await request("/auth/register", "POST", { fullName: "Actual Mailbox Owner", email, password: duplicatePassword, requestedRole: "employee" });
      expect(duplicate.status).toBe(200); expect(duplicate.data).toEqual({ message: "If your request is eligible, an email will be sent with next steps." }); expect(mail).toHaveLength(mailCount);
      expect((await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [attacker.userId]))[0].password_hash).toBe(oldCredential);
      expect((await getUser(connection, attacker.userId))?.emailVerified).toBe(false);
      expect(Number((await rows(connection, "SELECT COUNT(*) AS total FROM crm_auth_sessions WHERE user_id = ?", [attacker.userId]))[0].total)).toBe(2);
      state.locks.length = 0;
      const verified = await request("/auth/verify", "POST", { token, password: ownerPassword }); expect(verified.status).toBe(200); expect(verified.cookie).toBeNull();
      const authLocks = state.locks.filter(sql => /crm_auth_credentials|crm_security_guard|crm_users|crm_auth_tokens/.test(sql));
      expect(authLocks).toHaveLength(4); expect(authLocks[0]).toContain("crm_auth_credentials"); expect(authLocks[1]).toContain("crm_security_guard"); expect(authLocks[2]).toContain("crm_users"); expect(authLocks[3]).toContain("crm_auth_tokens");
      expect(Number((await rows(connection, "SELECT COUNT(*) AS total FROM crm_auth_sessions WHERE user_id = ?", [attacker.userId]))[0].total)).toBe(0);
      for (const session of [attacker, secondSession]) { expect((await request("/auth/me", "GET", undefined, session)).data.user).toBeNull(); expect((await request("/users", "GET", undefined, session)).status).toBe(401); }
      const owner = await getUser(connection, attacker.userId); expect(owner).toMatchObject({ email, emailVerified: true, status: "ACTIVE", roles: ["admin"] }); expect(owner?.permissions).toEqual([...PERMISSION_CODES].sort());
      const marker = (await rows(connection, "SELECT email_verified_at, bootstrap_completed FROM crm_users WHERE id = ?", [attacker.userId]))[0]; expect(marker.email_verified_at).not.toBeNull(); expect(Number(marker.bootstrap_completed)).toBe(1);
      const newCredential = (await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [attacker.userId]))[0].password_hash; expect(newCredential).not.toBe(oldCredential); expect(newCredential).toMatch(/^scrypt\$32768\$8\$1\$/); expect(newCredential).not.toContain(ownerPassword);
      expect((await request("/auth/verify", "POST", { token, password: duplicatePassword })).status).toBe(400);
      expect((await rows(connection, "SELECT email_verified_at, bootstrap_completed FROM crm_users WHERE id = ?", [attacker.userId]))[0]).toEqual(marker);
      expect((await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [attacker.userId]))[0].password_hash).toBe(newCredential);
      expect((await rows(connection, "SELECT token_hash FROM crm_auth_tokens WHERE user_id = ? AND purpose = 'VERIFY'", [attacker.userId]))).toEqual([]);
      for (const oldPassword of [password, duplicatePassword]) expect((await request("/auth/login", "POST", { email, password: oldPassword })).status).toBe(401);
      const ownerLogin = await request("/auth/login", "POST", { email, password: ownerPassword }); expect(ownerLogin.status).toBe(200); expect(ownerLogin.data.user).toMatchObject({ id: attacker.userId, email, emailVerified: true, status: "ACTIVE", roles: ["admin"] });
      const logs = await rows(connection, "SELECT action, metadata FROM crm_audit_logs WHERE entity_id = ?", [attacker.userId]); const serialized = JSON.stringify(logs); for (const secret of [token, password, duplicatePassword, ownerPassword, oldCredential, newCredential]) expect(serialized).not.toContain(secret);
      expect(logs.filter(log => log.action === "auth.verified_admin_bootstrap")).toHaveLength(1);
    } finally { await connection.query("ROLLBACK TO SAVEPOINT test_prehijack"); await connection.query("RELEASE SAVEPOINT test_prehijack"); }
  }, 60000);
  it("verification rejects missing/invalid passwords, expired/wrong-purpose tokens and ineligible or already-verified users without changing ownership", async () => {
    await connection.query("SAVEPOINT test_verify_guards");
    try {
      const email = "eadlr1@gmail.com", account = await signup(email, "admin", false), token = mailedToken(email), ownerPassword = "Fresh Owner Verification Password 2026";
      const credential = (await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [account.userId]))[0].password_hash;
      const unchanged = async (status: string) => {
        expect((await getUser(connection, account.userId))).toMatchObject({ status, emailVerified: false, roles: [] });
        expect((await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [account.userId]))[0].password_hash).toBe(credential);
        expect((await request("/auth/me", "GET", undefined, account)).data.user?.id).toBe(account.userId);
      };
      const generic = { message: "This link is invalid or expired" };
      for (const body of [{ token }, { token, password: "x".repeat(11) }, { token, password: "x".repeat(129) }, { token, password: ownerPassword, roles: ["admin"] }, { token: opaque(), password: ownerPassword }]) {
        const response = await request("/auth/verify", "POST", body); expect(response.status).toBe(400); expect(response.data).toEqual(generic); await unchanged("UNVERIFIED");
      }
      await run(connection, "UPDATE crm_auth_tokens SET expires_at = ? WHERE token_hash = ?", [new Date(Date.now() - 1000), hash(token)]);
      const expired = await request("/auth/verify", "POST", { token, password: ownerPassword }); expect(expired.status).toBe(400); expect(expired.data).toEqual(generic); await unchanged("UNVERIFIED");
      await run(connection, "UPDATE crm_auth_tokens SET expires_at = ?, purpose = 'RESET' WHERE token_hash = ?", [new Date(Date.now() + 3600000), hash(token)]);
      expect((await request("/auth/verify", "POST", { token, password: ownerPassword })).status).toBe(400); await unchanged("UNVERIFIED");
      await run(connection, "UPDATE crm_auth_tokens SET purpose = 'VERIFY' WHERE token_hash = ?", [hash(token)]);
      for (const status of ["ACTIVE", "REJECTED", "SUSPENDED"]) {
        await run(connection, "UPDATE crm_users SET status = ? WHERE id = ?", [status, account.userId]);
        const response = await request("/auth/verify", "POST", { token, password: ownerPassword }); expect(response.status).toBe(400); expect(response.data).toEqual(generic); await unchanged(status);
      }
      await run(connection, "UPDATE crm_users SET status = 'PENDING_APPROVAL' WHERE id = ?", [account.userId]);
      expect((await request("/auth/verify", "POST", { token, password: ownerPassword })).status).toBe(200);
      expect((await getUser(connection, account.userId))).toMatchObject({ email, emailVerified: true, status: "ACTIVE", roles: ["admin"], permissions: [...PERMISSION_CODES].sort() }); expect((await request("/auth/me", "GET", undefined, account)).data.user).toBeNull();
      // Simulate a stale token from a racing resend/import. It must not replace a verified credential or re-elevate a suspended identity.
      const stale = opaque(); await run(connection, "INSERT INTO crm_auth_tokens (token_hash,user_id,purpose,expires_at) VALUES (?,?,'VERIFY',?)", [hash(stale), account.userId, new Date(Date.now() + 3600000)]);
      const verifiedCredential = (await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [account.userId]))[0].password_hash;
      const marker = (await rows(connection, "SELECT email_verified_at, bootstrap_completed FROM crm_users WHERE id = ?", [account.userId]))[0];
      expect((await request("/auth/verify", "POST", { token: stale, password })).status).toBe(400);
      await run(connection, "DELETE FROM crm_auth_rate_limits");
      await run(connection, "UPDATE crm_users SET status = 'SUSPENDED' WHERE id = ?", [account.userId]); await run(connection, "DELETE FROM crm_user_roles WHERE user_id = ?", [account.userId]);
      expect((await request("/auth/verify", "POST", { token: stale, password })).status).toBe(400); expect((await getUser(connection, account.userId))).toMatchObject({ status: "SUSPENDED", emailVerified: true, roles: [] });
      expect((await rows(connection, "SELECT email_verified_at, bootstrap_completed FROM crm_users WHERE id = ?", [account.userId]))[0]).toEqual(marker);
      expect((await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [account.userId]))[0].password_hash).toBe(verifiedCredential);
    } finally { await connection.query("ROLLBACK TO SAVEPOINT test_verify_guards"); await connection.query("RELEASE SAVEPOINT test_verify_guards"); }
  }, 60000);
  it("pending, unverified and unauthenticated users get no direct business API data", async () => {
    for (const path of ["/customers", "/company", "/dashboard", "/reference", "/users", "/roles", "/audit"]) { expect((await request(path, "GET", undefined, pending)).status).toBe(403); expect((await request(path, "GET", undefined, unverified)).status).toBe(403); expect((await request(path)).status).toBe(401); }
    expect((await request(`/users/${unverified.userId}`, "PUT", {status:"ACTIVE", roles:["admin"]}, admin)).status).toBe(409); expect((await getUser(connection, unverified.userId))?.emailVerified).toBe(false);
  });
  it("sessions are opaque hashed eight-hour cookies with CSRF and no cached role claims", async () => {
    const me = await request("/auth/me", "GET", undefined, admin); expect(me.data.csrfToken).toBe(admin.csrf);
    const secret = admin.cookie.split("=")[1]; const stored = (await rows(connection, "SELECT *, TIMESTAMPDIFF(SECOND, created_at, expires_at) AS duration FROM crm_auth_sessions WHERE token_hash = ?", [hash(secret)]))[0]; expect(stored.token_hash).not.toBe(secret); expect(stored.csrf_hash).toBe(hash(admin.csrf)); expect(Number(stored.duration)).toBeGreaterThanOrEqual(28790); expect(Number(stored.duration)).toBeLessThanOrEqual(28810);
    const email = (await getUser(connection, admin.userId))!.email; const login = await request("/auth/login", "POST", { email, password }); expect(login.cookie).toContain("HttpOnly"); expect(login.cookie).toContain("Secure"); expect(login.cookie).toContain("SameSite=None"); expect(login.cookie).not.toContain("roles");
    const badCsrf = await request("/company", "PUT", {timezone:"UTC",defaultCurrency:"USD"}, {...admin,csrf:"wrong"}); expect(badCsrf.status).toBe(403);
    const hostile = await request("/auth/login", "POST", {email,password}, undefined, {Origin:"https://evil.example"}); expect(hostile.status).toBe(403);
  });
  it("approval assigns multiple roles and current role edits revoke permissions immediately", async () => {
    expect((await request(`/users/${pending.userId}`, "PUT", { status:"ACTIVE", roles:["sales","pricing"] }, admin)).status).toBe(200); const me = (await request("/auth/me", "GET", undefined, pending)).data.user; expect(me.roles).toEqual(["pricing","sales"]); expect(me.permissions).toEqual(["contacts.manage","customers.create","customers.read","customers.update"]);
    expect((await request(`/users/${pending.userId}`, "PUT", {status:"SUSPENDED",roles:["sales","pricing"]}, admin)).status).toBe(200); expect((await request("/customers", "GET", undefined, pending)).status).toBe(403); expect((await request("/auth/me", "GET", undefined, pending)).data.user.permissions).toEqual([]);
    expect((await request(`/users/${pending.userId}`, "PUT", {status:"ACTIVE",roles:["employee"]}, admin)).status).toBe(200); expect((await request("/customers", "GET", undefined, pending)).status).toBe(403);
  });
  it("role-specific direct restrictions match Sales, Pricing, Employee and Technician", async () => {
    for (const client of [employee, technician]) { expect((await request("/dashboard", "GET", undefined, client)).status).toBe(200); expect((await request("/dashboard", "GET", undefined, client)).data.customersTotal).toBe(0); expect((await request("/customers", "GET", undefined, client)).status).toBe(403); expect((await request("/roles", "GET", undefined, client)).status).toBe(403); expect((await request("/company", "GET", undefined, client)).status).toBe(403); }
    expect((await request("/customers", "GET", undefined, pricing)).status).toBe(200); expect((await request("/customers", "POST", {displayName:"Denied",customerType:"Other",countryCode:"US"}, pricing)).status).toBe(403); expect((await request("/roles", "GET", undefined, sales)).status).toBe(403);
  });
  it("creates legal/customer dimensions, warns duplicates without uniqueness, persists filter/search/pagination", async () => {
    const input = { displayName:"Rollback Medical Clinic", legalName:"Rollback Clinic LLC", customerType:"Hospital/Clinic", legalEntityType:"LLC/Limited Liability Company", countryCode:"TR", email:"rollback-clinic@example.invalid", phone:"+90 123", website:"https://example.invalid", taxId:"ROLLBACK-TAX", addressLine1:"Line 1", addressLine2:"Line 2", city:"Ankara", state:"Ankara", postalCode:"12345", notes:"Rollback-only private note" };
    const created = await request("/customers", "POST", input, sales); expect(created.status).toBe(201); customerId = created.data.customer.id; expect(created.data.customer.customerType).toBe("Hospital/Clinic"); expect(created.data.customer.legalEntityType).toBe("LLC/Limited Liability Company"); expect(created.data.customer.regionCode).toBe("MENA"); expect(created.data.customer.notes).toBe(input.notes);
    const duplicate = await request("/customers", "POST", input, sales); expect(duplicate.status).toBe(201); expect(duplicate.data.warnings[0]).toContain(customerId); expect(duplicate.data.customer.id).not.toBe(customerId);
    const list = await request("/customers?q=Medical&type=Hospital%2FClinic&country=TR&region=MENA&status=ACTIVE&page=1", "GET", undefined, sales); expect(list.status).toBe(200); expect(list.data.total).toBe(2); expect(list.data.pageSize).toBe(25); expect(list.data.items.every((v:any) => v.countryCode === "TR")).toBe(true);
    expect((await request("/customers?q=%27%20OR%201%3D1&page=1", "GET", undefined, sales)).data.total).toBe(0); expect((await request("/customers?page=-1", "GET", undefined, sales)).status).toBe(422);
    const updated = await request(`/customers/${customerId}`, "PUT", {...input, city:"Istanbul"}, sales); expect(updated.status).toBe(200); expect((await request(`/customers/${customerId}`, "GET", undefined, sales)).data.customer.city).toBe("Istanbul");
  });
  it("serializes contacts on parent lock and guarantees zero or one primary with scoped IDs", async () => {
    const first = await request(`/customers/${customerId}/contacts`, "POST", {salutation:"Dr.",fullName:"Rollback First",alias:"First",jobTitle:"Director",phone:"123",email:"first@example.invalid",isPrimary:true}, sales); expect(first.status).toBe(201); primaryId = first.data.contact.id;
    const second = await request(`/customers/${customerId}/contacts`, "POST", {salutation:"Lic.",fullName:"Rollback Second",isPrimary:true}, sales); expect(second.status).toBe(201);
    const detail = await request(`/customers/${customerId}`, "GET", undefined, sales); expect(detail.data.contacts).toHaveLength(2); expect(detail.data.contacts.filter((v:any) => v.isPrimary)).toHaveLength(1); expect(detail.data.contacts.find((v:any) => v.id === primaryId).isPrimary).toBe(false);
    expect(state.locks.some(sql => sql.includes("crm_customers WHERE id = ? FOR UPDATE"))).toBe(true);
    const changed = await request(`/customers/${customerId}/contacts/${primaryId}`, "PUT", {fullName:"Changed Primary",isPrimary:true}, sales); expect(changed.status).toBe(200); expect((await rows(connection, "SELECT COUNT(*) AS count FROM crm_customer_contacts WHERE customer_id = ? AND is_primary = TRUE", [customerId]))[0].count).toBe(1);
    expect((await request(`/customers/${randomUUID()}/contacts/${primaryId}`, "DELETE", undefined, sales)).status).toBe(404);
    expect((await request(`/customers/${customerId}/contacts/${primaryId}`, "DELETE", undefined, sales)).status).toBe(204); expect((await rows(connection, "SELECT COUNT(*) AS count FROM crm_customer_contacts WHERE customer_id = ? AND is_primary = TRUE", [customerId]))[0].count).toBe(0);
    expect((await request(`/customers/${customerId}/contacts`, "POST", {fullName:"Denied"}, pricing)).status).toBe(403);
  });
  it("allows archive/restore only with archive permission and preserves customers", async () => {
    expect((await request(`/customers/${customerId}/archive`, "POST", {archived:true}, sales)).status).toBe(403); expect((await request(`/customers/${customerId}/archive`, "POST", {archived:true}, admin)).status).toBe(200);
    expect((await request(`/customers/${customerId}`, "GET", undefined, sales)).data.customer.status).toBe("ARCHIVED"); expect((await request(`/customers/${customerId}/contacts`, "POST", {fullName:"Blocked"}, sales)).status).toBe(409);
    expect((await request("/customers?status=ARCHIVED", "GET", undefined, sales)).data.total).toBe(1); expect((await request(`/customers/${customerId}/archive`, "POST", {archived:false}, admin)).status).toBe(200);
  });
  it("company is blank/default until authorized edit; validates ISO country and timezone", async () => {
    const before = await request("/company", "GET", undefined, admin); expect(before.status).toBe(200); expect(before.data.legalName).toBeNull(); expect(before.data.timezone).toBe("UTC");
    const input = {tradingName:"Rollback Test Company", legalName:"Rollback Legal Entity",logoUrl:"https://example.invalid/logo.png",website:"https://example.invalid",email:"company@example.invalid",phone:"123",countryCode:"EG",addressLine1:"Street",city:"Cairo",state:"Cairo",postalCode:"123",timezone:"Africa/Cairo",defaultCurrency:"EGP",description:"Rollback only"};
    const updated = await request("/company", "PUT", input, admin); expect(updated.status).toBe(200); expect(updated.data.tradingName).toBe(input.tradingName); expect(updated.data.updatedBy).toBe(admin.userId); expect((await request("/company", "GET", undefined, admin)).data.countryCode).toBe("EG"); expect((await request("/company", "PUT", {...input,countryCode:"ZZ"}, admin)).status).toBe(422); expect((await request("/company", "PUT", input, sales)).status).toBe(403);
  });
  it("ISO dataset includes all countries, seven regions, TR/EG MENA; mappings are editable and dynamic", async () => {
    const reference = await request("/reference", "GET", undefined, employee); expect(reference.status).toBe(200); expect(reference.data.countries).toHaveLength(249); expect(reference.data.regions).toHaveLength(7); for (const code of ["TR","EG"]) expect(reference.data.countries.find((v:any) => v.code === code).regionCode).toBe("MENA");
    expect((await request("/reference/countries/TR", "PUT", {regionCode:"EU"}, sales)).status).toBe(403); expect((await request("/reference/countries/TR", "PUT", {regionCode:"EU"}, admin)).status).toBe(200); expect((await request(`/customers/${customerId}`, "GET", undefined, sales)).data.customer.regionCode).toBe("EU");
    expect((await request("/customers?region=EU", "GET", undefined, sales)).data.total).toBe(2); expect((await request("/reference/countries/TR", "PUT", {regionCode:"MENA"}, admin)).status).toBe(200);
  });
  it("audits administrator mutations without secrets; protects self/top-level core/last effective admin", async () => {
    expect((await request(`/users/${admin.userId}`, "PUT", {status:"SUSPENDED",roles:[]}, admin)).status).toBe(409); expect((await request("/roles/admin", "PUT", {permissions:[]}, admin)).status).toBe(409); expect((await request("/roles/ceo", "PUT", {permissions:["customers.read"]}, admin)).status).toBe(409);
    expect((await request(`/users/${secondAdmin.userId}`, "PUT", {status:"SUSPENDED",roles:["admin"]}, admin)).status).toBe(200); expect(await effectiveAdminCount(connection)).toBe(1);
    // Simulate an imported malformed top-level assignment with no effective permissions, proving
    // last-admin checks count effective rights rather than just the strings admin/ceo.
    const actor = opaque(), token = opaque(); const actorId = randomUUID();
    await run(connection, "INSERT INTO crm_users (id,full_name,email_normalized,status,email_verified_at) VALUES (?,?,?,'ACTIVE',UTC_TIMESTAMP(3))", [actorId,"Rollback Malformed Admin",uniqueEmail("malformed")]);
    await run(connection, "INSERT INTO crm_user_roles (user_id,role_code) VALUES (?,'ceo')", [actorId]);
    await run(connection, "DELETE FROM crm_role_permissions WHERE role_code = 'ceo' AND permission_code = 'customers.archive'");
    await run(connection, "INSERT INTO crm_auth_sessions (token_hash,user_id,csrf_hash,expires_at) VALUES (?,?,?,?)", [hash(token),actorId,hash(csrfFor(token)),new Date(Date.now()+3600000)]);
    const malformed = {userId:actorId,cookie:`youcai_session=${token}`,csrf:csrfFor(token)};
    expect((await request(`/users/${admin.userId}`, "PUT", {status:"SUSPENDED",roles:[]}, malformed)).status).toBe(409); expect((await getUser(connection,admin.userId))?.status).toBe("ACTIVE");
    await run(connection,"INSERT INTO crm_role_permissions (role_code,permission_code) VALUES ('ceo','customers.archive')");
    const logs = await request("/audit?page=1", "GET", undefined, admin); expect(logs.status).toBe(200); expect(logs.data.pagination.pageSize).toBe(25); expect(logs.data.items.some((v:any)=>v.action === "user.roles_status_changed" || v.action === "user.approval_changed")).toBe(true); const serialized = JSON.stringify(logs.data); expect(serialized).not.toContain(password); expect(serialized).not.toContain(token); expect(serialized).not.toContain("password_hash"); expect(state.locks.some(sql => sql.includes("crm_security_guard"))).toBe(true);
    void actor;
  });
  it("role permission edits take effect in existing sessions; seeds preserve edits and company/mapping data", async () => {
    expect((await request("/roles/employee", "PUT", {permissions:["customers.read"]}, admin)).status).toBe(200); expect((await request("/customers", "GET", undefined, employee)).status).toBe(200); expect((await request("/company", "GET", undefined, employee)).status).toBe(403);
    await request("/reference/countries/EG", "PUT", {regionCode:"OTHER"}, admin); const companyBefore = (await request("/company", "GET", undefined, admin)).data; const usersBefore = Number((await rows(connection,"SELECT COUNT(*) AS total FROM crm_users"))[0].total);
    await seed(); await seed();
    expect((await getUser(connection, employee.userId))?.permissions).toEqual(["customers.read"]); expect((await rows(connection,"SELECT region_code FROM crm_country_regions WHERE country_code='EG'"))[0].region_code).toBe("OTHER"); expect((await request("/company", "GET", undefined, admin)).data).toEqual(companyBefore); expect(Number((await rows(connection,"SELECT COUNT(*) AS total FROM crm_users"))[0].total)).toBe(usersBefore);
    await request("/roles/employee", "PUT", {permissions:[]}, admin); expect((await request("/customers", "GET", undefined, employee)).status).toBe(403);
  }, 60000);
  it("verification is single-use and reset is mailed-only, single-use and revokes all sessions", async () => {
    const account = (await getUser(connection, pricing.userId))!; const verifyToken = mailedToken(account.email); expect((await request("/auth/verify", "POST", {token:verifyToken,password})).status).toBe(400);
    const forgot = await request("/auth/forgot", "POST", {email:account.email}); const missing = await request("/auth/forgot", "POST", {email:uniqueEmail("absent")}); expect(forgot.data).toEqual(missing.data); const resetToken = mailedToken(account.email); expect(JSON.stringify(forgot.data)).not.toContain(resetToken);
    const newPassword = "New Secure Rollback Password 2026"; expect((await request("/auth/reset", "POST", {token:resetToken,password:newPassword})).status).toBe(200); expect((await request("/auth/me", "GET", undefined, pricing)).data.user).toBeNull(); expect((await request("/auth/reset", "POST", {token:resetToken,password:newPassword})).status).toBe(400);
    expect((await request("/auth/login", "POST", {email:account.email,password})).status).toBe(401); expect((await request("/auth/login", "POST", {email:account.email,password:newPassword})).status).toBe(200);
  });
  it("expired session/token is unusable and auth attempts are persistently limited", async () => {
    const token = opaque(); await run(connection,"INSERT INTO crm_auth_sessions (token_hash,user_id,csrf_hash,expires_at) VALUES (?,?,?,?)",[hash(token),admin.userId,hash(csrfFor(token)),new Date(Date.now()-1000)]); expect((await request("/auth/me","GET",undefined,{userId:admin.userId,cookie:`youcai_session=${token}`,csrf:csrfFor(token)})).data.user).toBeNull();
    const email = uniqueEmail("login-limit"); let response:any; for(let attempt=0;attempt<9;attempt++) response=await request("/auth/login","POST",{email,password:"wrong"}); expect(response.status).toBe(429); expect(Number((await rows(connection,"SELECT MAX(attempts) AS attempts FROM crm_auth_rate_limits"))[0].attempts)).toBeGreaterThanOrEqual(9);
    expect((await request("/auth/verify","POST",{token:opaque(),password})).status).toBe(400);
  }, 30000);
  it("no product entities/endpoints; logout is CSRF protected and removes the session", async () => {
    for (const path of ["/products", "/products/download"]) expect((await request(path,"GET",undefined,admin)).status).toBe(404);
    const tables = await rows(connection,"SHOW TABLES"); expect(tables.some(row => String(Object.values(row)[0]).toLowerCase().includes("product"))).toBe(false);
    expect((await request("/auth/logout","POST",undefined,{...technician,csrf:"bad"})).status).toBe(403); const logout=await request("/auth/logout","POST",undefined,technician); expect(logout.status).toBe(200); expect(logout.cookie).toContain("Expires=Thu, 01 Jan 1970"); expect((await request("/auth/me","GET",undefined,technician)).data.user).toBeNull();
  });
});

// Runs only after the preceding describe has rolled back and closed its pool. These suites must
// not be concurrent: route savepoints and the global security guard share one test connection.
(enabled ? describe : describe.skip)("owner-provisioned local administrators rollback integration", () => {
  let invitations: OwnerAdminInvitation[] = [], owners: Client[] = [];
  let baseline: number[] = [], effectiveBaseline = 0;
  const tracked = ["crm_users", "crm_owner_admin_access", "crm_auth_credentials", "crm_auth_tokens", "crm_auth_sessions", "crm_user_roles", "crm_audit_logs", "crm_auth_rate_limits"];
  const chosenPassword = (index: number) => `Personally chosen owner ${index} password 2026`;
  const counts = async (db: PoolConnection) => Promise.all(tracked.map(async table => Number((await rows(db, `SELECT COUNT(*) AS total FROM ${table}`))[0].total)));
  const complete = (invitation: OwnerAdminInvitation, index: number, token = invitation.token) => request("/auth/admin-setup", "POST", { token, fullName: `Rollback Owner Administrator ${index}`, password: chosenPassword(index) });
  const generic = { message: "This link is invalid or expired" };
  beforeAll(async () => {
    actualDb = await vi.importActual<typeof import("../server/crm/db")>("../server/crm/db");
    connection = await actualDb.getPool().getConnection();
    // Guard BEFORE any fixtures or mutations; never test against provisioned real identities.
    const conflict = await rows(connection, `SELECT id FROM crm_users WHERE email_normalized IN (${Array(BOOTSTRAP_EMAILS.size).fill("?").join(",")})`, [...BOOTSTRAP_EMAILS]);
    if (conflict.length) { connection.release(); throw new Error("Allowlisted identities already exist. Refusing to change real identities; run integration against an isolated copy."); }
    baseline = await counts(connection);
    effectiveBaseline = await effectiveAdminCount(connection);
    await connection.beginTransaction(); state.connection = connection; state.savepoint = 0; state.locks.length = 0;
    setTestMailTransport(undefined);
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("EMAIL_FROM", ""); vi.stubEnv("APP_PUBLIC_URL", "");
    const app = express(); app.use("/api", crmRouter); server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${(server.address() as any).port}`;
  }, 120000);
  beforeEach(async () => { await run(connection, "DELETE FROM crm_auth_rate_limits"); state.locks.length = 0; });
  afterAll(async () => {
    setTestMailTransport(undefined); vi.unstubAllEnvs(); vi.restoreAllMocks();
    if (state.connection === connection) {
      if (server) await new Promise<void>(resolve => server.close(() => resolve()));
      try { await connection.rollback(); state.connection = null; expect(await counts(connection)).toEqual(baseline); }
      finally { state.connection = null; connection.release(); }
    }
    if (actualDb) await actualDb.closePool();
  }, 60000);
  it("refuses public preregistration and credential-bearing identities without owner-pending authorization, atomically", async () => {
    for (const withCredential of [false, true]) {
      await connection.query("SAVEPOINT owner_identity_conflict");
      try {
        const userId = randomUUID(), email = [...BOOTSTRAP_EMAILS][2];
        await run(connection, "INSERT INTO crm_users (id,full_name,email_normalized,status) VALUES (?,?,?,'UNVERIFIED')", [userId, "Rollback Public Identity", email]);
        if (withCredential) await run(connection, "INSERT INTO crm_auth_credentials (user_id,password_hash) VALUES (?,?)", [userId, "not-a-default-credential"]);
        await expect(issueOwnerAdminInvitations()).rejects.toMatchObject({ status: 409 });
        expect(await rows(connection, "SELECT user_id FROM crm_owner_admin_access")).toHaveLength(baseline[1]);
        expect(await rows(connection, "SELECT token_hash FROM crm_auth_tokens WHERE purpose = 'ADMIN_SETUP'")).toEqual([]);
        expect((await rows(connection, "SELECT id,full_name FROM crm_users WHERE email_normalized = ?", [email]))[0]).toEqual({ id: userId, full_name: "Rollback Public Identity" });
        expect(await rows(connection, "SELECT role_code FROM crm_user_roles WHERE user_id = ?", [userId])).toEqual([]);
      } finally { await connection.query("ROLLBACK TO SAVEPOINT owner_identity_conflict"); await connection.query("RELEASE SAVEPOINT owner_identity_conflict"); }
    }
  }, 60000);
  it("issues exactly five private pending capabilities with no mail, credential, session or role and metadata-only config", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    try {
      expect((await request("/auth/config")).data).toEqual({ emailReady: false, adminSetupAvailable: true });
      expect((await request("/auth/register", "POST", { fullName: "Disabled Signup", email: uniqueEmail("disabled"), password, requestedRole: "admin" })).status).toBe(503);
      invitations = await issueOwnerAdminInvitations();
      expect(invitations).toHaveLength(5); expect(invitations.map(item => item.email).sort()).toEqual([...BOOTSTRAP_EMAILS].sort());
      expect(new Set(invitations.map(item => item.userId)).size).toBe(5); expect(new Set(invitations.map(item => item.token)).size).toBe(5);
      for (const invitation of invitations) {
        expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(new Date(invitation.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600000);
        expect(await getUser(connection, invitation.userId)).toMatchObject({ fullName: "Administrator", email: invitation.email, status: "UNVERIFIED", emailVerified: false, accessAuthorized: false, accessMethod: null, roles: [], permissions: [] });
        expect(await rows(connection, "SELECT user_id FROM crm_auth_credentials WHERE user_id = ?", [invitation.userId])).toEqual([]);
        const token = (await rows(connection, "SELECT token_hash,purpose,TIMESTAMPDIFF(SECOND,created_at,expires_at) AS seconds FROM crm_auth_tokens WHERE user_id = ?", [invitation.userId]))[0];
        expect(token.token_hash === hash(invitation.token)).toBe(true); expect(token.purpose).toBe("ADMIN_SETUP"); expect(Number(token.seconds)).toBeGreaterThanOrEqual(86390); expect(Number(token.seconds)).toBeLessThanOrEqual(86410);
        const check = await request("/auth/admin-setup/check", "POST", { token: invitation.token }); expect(check.status).toBe(200); expect(check.data).toEqual({ email: invitation.email });
        expect((await request("/auth/login", "POST", { email: invitation.email, password: chosenPassword(0) })).status).toBe(401);
        const audit = (await rows(connection, "SELECT actor_id,action,metadata FROM crm_audit_logs WHERE entity_id = ?", [invitation.userId]))[0];
        expect(audit.actor_id).toBeNull(); expect(audit.action).toBe("owner.admin_setup_issued"); expect(JSON.stringify(audit).includes(invitation.token)).toBe(false);
      }
      for (const path of ["/customers", "/users", "/company"]) expect((await request(path)).status).toBe(401);
      expect((await request("/auth/admin-setup/issue", "POST", {})).status).toBe(404);
      const logged = JSON.stringify(logs.map(log => log.mock.calls));
      for (const invitation of invitations) expect(logged.includes(invitation.token)).toBe(false);
    } finally { logs.forEach(log => log.mockRestore()); }
  }, 120000);
  it("rolls back pending token rotation and issuance audits when the private handoff fails", async () => {
    const snapshot = async () => hash(JSON.stringify({
      counts: await counts(connection),
      owners: await Promise.all(invitations.map(async invitation => ({
        user: (await rows(connection, "SELECT * FROM crm_users WHERE id = ?", [invitation.userId]))[0],
        proof: (await rows(connection, "SELECT * FROM crm_owner_admin_access WHERE user_id = ?", [invitation.userId]))[0],
        tokens: await rows(connection, "SELECT * FROM crm_auth_tokens WHERE user_id = ? ORDER BY token_hash", [invitation.userId]),
        audits: (await rows(connection, "SELECT * FROM crm_audit_logs WHERE entity_id = ?", [invitation.userId])).map(row => JSON.stringify(row)).sort(),
      }))),
    }));
    const before = await snapshot();
    const onPrepared = vi.fn(async () => { throw new Error("Simulated private handoff write failure"); });
    await expect(issueOwnerAdminInvitations(onPrepared)).rejects.toThrow("Simulated private handoff write failure");
    expect(onPrepared.mock.calls.length).toBe(1);
    expect(await snapshot()).toBe(before);
    for (const invitation of invitations) {
      const check = await request("/auth/admin-setup/check", "POST", { token: invitation.token });
      expect(check.status).toBe(200); expect(check.data).toEqual({ email: invitation.email });
    }
  }, 60000);
  it("explicit rerun rotates only pending capabilities, preserves UUIDs and invalidates prior tokens", async () => {
    const previous = invitations; invitations = await issueOwnerAdminInvitations();
    expect(invitations.map(item => item.userId)).toEqual(previous.map(item => item.userId));
    for (let i = 0; i < invitations.length; i++) {
      expect(invitations[i].token === previous[i].token).toBe(false);
      expect((await request("/auth/admin-setup/check", "POST", { token: previous[i].token })).status).toBe(400);
      expect((await request("/auth/admin-setup/check", "POST", { token: invitations[i].token })).status).toBe(200);
    }
  }, 60000);
  it("rejects malformed, outsider, short-password, expired and wrong-purpose capabilities with generic errors", async () => {
    const invitation = invitations[0];
    for (const body of [{ token: "bad" }, { token: opaque() }, { token: invitation.token, email: invitation.email }]) {
      const response = await request("/auth/admin-setup/check", "POST", body); expect(response.status).toBe(400); expect(response.data).toEqual(generic);
    }
    for (const body of [
      { token: invitation.token }, { token: invitation.token, fullName: "Name", password: "x".repeat(11) },
      { token: invitation.token, fullName: "Name", password: "x".repeat(129) },
      { token: invitation.token, fullName: "x", password }, { token: invitation.token, fullName: "x".repeat(161), password },
      { token: invitation.token, fullName: "Name", password, roles: ["admin"] },
      { token: opaque(), fullName: "Name", password },
    ]) { const response = await request("/auth/admin-setup", "POST", body); expect(response.status).toBe(400); expect(response.data).toEqual(generic); }
    await connection.query("SAVEPOINT owner_capability_guards");
    try {
      await run(connection, "UPDATE crm_auth_tokens SET expires_at = ? WHERE token_hash = ?", [new Date(Date.now() - 1000), hash(invitation.token)]);
      for (const path of ["/auth/admin-setup/check", "/auth/admin-setup"]) {
        const response = await request(path, "POST", path.endsWith("check") ? { token: invitation.token } : { token: invitation.token, fullName: "Name", password }); expect(response.status).toBe(400); expect(response.data).toEqual(generic);
      }
      await run(connection, "UPDATE crm_auth_tokens SET expires_at = ?, purpose = 'RESET' WHERE token_hash = ?", [new Date(Date.now() + 3600000), hash(invitation.token)]);
      expect((await request("/auth/admin-setup/check", "POST", { token: invitation.token })).status).toBe(400);
      expect((await complete(invitation, 0)).status).toBe(400);
      await run(connection, "DELETE FROM crm_auth_rate_limits");
      await run(connection, "UPDATE crm_auth_tokens SET purpose = 'ADMIN_SETUP' WHERE token_hash = ?", [hash(invitation.token)]);
      await run(connection, "UPDATE crm_users SET email_normalized = ? WHERE id = ?", [uniqueEmail("outsider"), invitation.userId]);
      expect((await request("/auth/admin-setup/check", "POST", { token: invitation.token })).status).toBe(400); expect((await complete(invitation, 0)).status).toBe(400);
    } finally { await connection.query("ROLLBACK TO SAVEPOINT owner_capability_guards"); await connection.query("RELEASE SAVEPOINT owner_capability_guards"); }
    expect(await rows(connection, "SELECT user_id FROM crm_auth_credentials WHERE user_id = ?", [invitation.userId])).toEqual([]);
    expect(await getUser(connection, invitation.userId)).toMatchObject({ status: "UNVERIFIED", emailVerified: false, accessAuthorized: false, roles: [] });
  }, 120000);
  it("requires pending owner authorization and pristine identity despite a genuine setup token", async () => {
    const invitation = invitations[0];
    for (const mutation of [
      "DELETE FROM crm_owner_admin_access WHERE user_id = ?",
      "UPDATE crm_owner_admin_access SET completed_at = UTC_TIMESTAMP(3) WHERE user_id = ?",
      "UPDATE crm_users SET status = 'SUSPENDED' WHERE id = ?",
      "UPDATE crm_users SET status = 'REJECTED' WHERE id = ?",
      "UPDATE crm_users SET status = 'PENDING_APPROVAL' WHERE id = ?",
      "UPDATE crm_users SET bootstrap_completed = TRUE WHERE id = ?",
      "UPDATE crm_users SET email_verified_at = UTC_TIMESTAMP(3) WHERE id = ?",
      "INSERT INTO crm_auth_credentials (user_id,password_hash) VALUES (?,'not-a-default-credential')",
      "INSERT INTO crm_user_roles (user_id,role_code) VALUES (?,'employee')",
    ]) {
      await connection.query("SAVEPOINT owner_identity_guard");
      try {
        await run(connection, mutation, [invitation.userId]);
        const check = await request("/auth/admin-setup/check", "POST", { token: invitation.token }); expect(check.status).toBe(400); expect(check.data).toEqual(generic);
        const result = await complete(invitation, 0); expect(result.status).toBe(400); expect(result.data).toEqual(generic);
      } finally { await connection.query("ROLLBACK TO SAVEPOINT owner_identity_guard"); await connection.query("RELEASE SAVEPOINT owner_identity_guard"); }
    }
  }, 120000);
  it("completes all five with individual salted passwords, truthful owner access and no automatic session", async () => {
    const credentials: string[] = [], secrets: string[] = [];
    for (let index = 0; index < invitations.length; index++) {
      const invitation = invitations[index], staleSession = opaque(), staleVerify = opaque();
      // Completion cleans up any imported/stale sessions and all token purposes.
      await run(connection, "INSERT INTO crm_auth_sessions (token_hash,user_id,csrf_hash,expires_at) VALUES (?,?,?,?)", [hash(staleSession), invitation.userId, hash(csrfFor(staleSession)), new Date(Date.now() + 3600000)]);
      await run(connection, "INSERT INTO crm_auth_tokens (token_hash,user_id,purpose,expires_at) VALUES (?,?,'VERIFY',?)", [hash(staleVerify), invitation.userId, new Date(Date.now() + 3600000)]);
      state.locks.length = 0;
      const result = await complete(invitation, index); expect(result.status).toBe(200); expect(result.cookie).toBeNull();
      const locks = state.locks.filter(sql => /crm_security_guard|crm_users|crm_auth_tokens/.test(sql));
      expect(locks).toHaveLength(3); expect(locks[0]).toContain("crm_security_guard"); expect(locks[1]).toContain("crm_users"); expect(locks[2]).toContain("crm_auth_tokens");
      expect(await getUser(connection, invitation.userId)).toMatchObject({ fullName: `Rollback Owner Administrator ${index}`, email: invitation.email, status: "ACTIVE", emailVerified: false, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED", roles: ["admin"], permissions: [...PERMISSION_CODES].sort() });
      const marker = (await rows(connection, "SELECT u.email_verified_at,u.bootstrap_completed,u.updated_by,oa.authorized_at,oa.completed_at FROM crm_users u JOIN crm_owner_admin_access oa ON oa.user_id = u.id WHERE u.id = ?", [invitation.userId]))[0];
      expect(marker.email_verified_at).toBeNull(); expect(Number(marker.bootstrap_completed)).toBe(1); expect(marker.updated_by).toBe(invitation.userId); expect(marker.authorized_at).not.toBeNull(); expect(marker.completed_at).not.toBeNull();
      expect(await rows(connection, "SELECT token_hash FROM crm_auth_tokens WHERE user_id = ?", [invitation.userId])).toEqual([]);
      expect(await rows(connection, "SELECT token_hash FROM crm_auth_sessions WHERE user_id = ?", [invitation.userId])).toEqual([]);
      const credential = (await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [invitation.userId]))[0].password_hash;
      expect(credential).toMatch(/^scrypt\$32768\$8\$1\$/); expect(credential.includes(chosenPassword(index))).toBe(false); credentials.push(credential);
      expect((await request("/auth/login", "POST", { email: invitation.email, password })).status).toBe(401);
      const login = await request("/auth/login", "POST", { email: invitation.email, password: chosenPassword(index) }); expect(login.status).toBe(200);
      expect(login.data.user).toMatchObject({ emailVerified: false, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED", roles: ["admin"], permissions: [...PERMISSION_CODES].sort() });
      const owner = { userId: invitation.userId, cookie: login.cookie!.split(";")[0], csrf: login.data.csrfToken }; owners.push(owner);
      for (const path of ["/customers", "/users", "/company", "/roles", "/audit"]) expect((await request(path, "GET", undefined, owner)).status).toBe(200);
      const listed = (await request("/users", "GET", undefined, owner)).data.items.find((user: any) => user.id === owner.userId); expect(listed).toMatchObject({ emailVerified: false, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED", permissions: [...PERMISSION_CODES].sort() });
      expect((await request("/auth/admin-setup/check", "POST", { token: invitation.token })).status).toBe(400);
      expect((await complete(invitation, index + 10)).status).toBe(400);
      expect((await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [invitation.userId]))[0].password_hash === credential).toBe(true);
      expect(await rows(connection, "SELECT role_code FROM crm_user_roles WHERE user_id = ?", [invitation.userId])).toEqual([{ role_code: "admin" }]);
      expect(await rows(connection, "SELECT action FROM crm_audit_logs WHERE entity_id = ? AND action = 'owner.admin_setup_completed'", [invitation.userId])).toHaveLength(1);
      secrets.push(invitation.token, staleSession, staleVerify, chosenPassword(index), credential);
    }
    expect(new Set(credentials).size).toBe(5); expect(new Set(credentials.map(encoded => encoded.split("$")[4])).size).toBe(5);
    expect(await effectiveAdminCount(connection)).toBe(effectiveBaseline + 5);
    const serialized = JSON.stringify(await rows(connection, "SELECT action,metadata FROM crm_audit_logs")); for (const secret of secrets) expect(serialized.includes(secret)).toBe(false);
    const before = await counts(connection); expect(await issueOwnerAdminInvitations()).toEqual([]); expect(await counts(connection)).toEqual(before);
  }, 180000);
  it("ordinary unverified/pending identities and public signup do not receive owner access or automatic roles", async () => {
    const localMail: TransactionalMail[] = []; setTestMailTransport(async message => { localMail.push(message); });
    await connection.query("SAVEPOINT owner_public_signup");
    try {
      for (const [index, verify] of [false, true].entries()) {
        const email = uniqueEmail(verify ? "owner-suite-pending" : "owner-suite-unverified");
        expect((await request("/auth/register", "POST", { fullName: "Ordinary Public Signup", email, password, requestedRole: "admin" })).status).toBe(200);
        const userId = (await rows(connection, "SELECT id FROM crm_users WHERE email_normalized = ?", [email]))[0].id;
        if (verify) {
          const link = localMail[index].text.match(/https:\/\/[^\s]+/)![0], token = new URL(link).searchParams.get("token")!;
          expect((await request("/auth/verify", "POST", { token, password })).status).toBe(200);
        }
        expect(await getUser(connection, userId)).toMatchObject({ status: verify ? "PENDING_APPROVAL" : "UNVERIFIED", emailVerified: verify, accessAuthorized: verify, accessMethod: verify ? "EMAIL_VERIFIED" : null, roles: [], permissions: [] });
        expect(await rows(connection, "SELECT user_id FROM crm_owner_admin_access WHERE user_id = ?", [userId])).toEqual([]);
        const login = await request("/auth/login", "POST", { email, password }); expect(login.status).toBe(200);
        const client = { userId, cookie: login.cookie!.split(";")[0], csrf: login.data.csrfToken };
        for (const path of ["/customers", "/users", "/company"]) expect((await request(path, "GET", undefined, client)).status).toBe(403);
        if (!verify) expect((await request(`/users/${userId}`, "PUT", { status: "ACTIVE", roles: ["admin"] }, owners[0])).status).toBe(409);
      }
      const invitation = invitations[0], before = await getUser(connection, invitation.userId);
      expect((await request("/auth/register", "POST", { fullName: "Public Impersonator", email: invitation.email, password, requestedRole: "admin" })).status).toBe(200);
      expect(await getUser(connection, invitation.userId)).toEqual(before);
    } finally { setTestMailTransport(undefined); await connection.query("ROLLBACK TO SAVEPOINT owner_public_signup"); await connection.query("RELEASE SAVEPOINT owner_public_signup"); }
  }, 120000);
  it("demotion and suspension remain effective in existing sessions; replay and owner reruns cannot restore admin", async () => {
    await connection.query("SAVEPOINT owner_revocation");
    try {
      expect((await request(`/users/${owners[1].userId}`, "PUT", { status: "ACTIVE", roles: ["sales"] }, owners[0])).status).toBe(200);
      expect((await request(`/users/${owners[2].userId}`, "PUT", { status: "SUSPENDED", roles: ["admin"] }, owners[0])).status).toBe(200);
      expect((await request("/users", "GET", undefined, owners[1])).status).toBe(403); expect((await request("/customers", "GET", undefined, owners[2])).status).toBe(403);
      const snapshots = await Promise.all(invitations.map(async item => ({ user: await getUser(connection, item.userId), credential: (await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [item.userId]))[0].password_hash, proof: (await rows(connection, "SELECT * FROM crm_owner_admin_access WHERE user_id = ?", [item.userId]))[0] })));
      const before = await counts(connection); expect(await issueOwnerAdminInvitations()).toEqual([]); expect(await counts(connection)).toEqual(before);
      for (const index of [1, 2]) {
        expect((await complete(invitations[index], index + 10)).status).toBe(400);
        expect(await getUser(connection, invitations[index].userId)).toEqual(snapshots[index].user);
        expect((await rows(connection, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ?", [invitations[index].userId]))[0].password_hash === snapshots[index].credential).toBe(true);
        expect((await rows(connection, "SELECT * FROM crm_owner_admin_access WHERE user_id = ?", [invitations[index].userId]))[0]).toEqual(snapshots[index].proof);
        expect(await rows(connection, "SELECT action FROM crm_audit_logs WHERE entity_id = ? AND action = 'owner.admin_setup_completed'", [invitations[index].userId])).toHaveLength(1);
      }
      expect(await effectiveAdminCount(connection)).toBe(effectiveBaseline + 3);
      // Genuine replay and a stale imported ADMIN_SETUP token both fail after durable completion.
      const stale = opaque(); await run(connection, "INSERT INTO crm_auth_tokens (token_hash,user_id,purpose,expires_at) VALUES (?,?,'ADMIN_SETUP',?)", [hash(stale), invitations[1].userId, new Date(Date.now() + 3600000)]);
      expect((await complete(invitations[1], 1, stale)).status).toBe(400);
      expect((await request("/auth/admin-setup/check", "POST", { token: stale })).status).toBe(400);
    } finally { await connection.query("ROLLBACK TO SAVEPOINT owner_revocation"); await connection.query("RELEASE SAVEPOINT owner_revocation"); }
  }, 120000);
  it("protects the last effective owner admin, self changes and core permissions with rollback", async () => {
    await connection.query("SAVEPOINT owner_last_admin");
    try {
      for (const owner of owners.slice(1)) expect((await request(`/users/${owner.userId}`, "PUT", { status: "SUSPENDED", roles: [] }, owners[0])).status).toBe(200);
      // Existing unrelated admins, if any, are not fixtures and are never mutated; test last-admin
      // only when the guarded database has no effective nonfixture administrator.
      if (effectiveBaseline === 0) {
        expect(await effectiveAdminCount(connection)).toBe(1);
        const actorId = randomUUID(), session = opaque();
        await run(connection, "INSERT INTO crm_users (id,full_name,email_normalized,status,email_verified_at) VALUES (?,?,?,'ACTIVE',UTC_TIMESTAMP(3))", [actorId, "Rollback Incomplete CEO", uniqueEmail("owner-last-actor")]);
        await run(connection, "INSERT INTO crm_user_roles (user_id,role_code) VALUES (?,'ceo')", [actorId]);
        await run(connection, "DELETE FROM crm_role_permissions WHERE role_code = 'ceo' AND permission_code = 'customers.archive'");
        await run(connection, "INSERT INTO crm_auth_sessions (token_hash,user_id,csrf_hash,expires_at) VALUES (?,?,?,?)", [hash(session), actorId, hash(csrfFor(session)), new Date(Date.now() + 3600000)]);
        const malformed = { userId: actorId, cookie: `youcai_session=${session}`, csrf: csrfFor(session) };
        expect((await request(`/users/${owners[0].userId}`, "PUT", { status: "SUSPENDED", roles: [] }, malformed)).status).toBe(409);
        expect(await getUser(connection, owners[0].userId)).toMatchObject({ status: "ACTIVE", emailVerified: false, accessAuthorized: true, roles: ["admin"] });
        expect(await effectiveAdminCount(connection)).toBe(1);
      }
      expect((await request(`/users/${owners[0].userId}`, "PUT", { status: "SUSPENDED", roles: [] }, owners[0])).status).toBe(409);
      expect((await request("/roles/admin", "PUT", { permissions: [] }, owners[0])).status).toBe(409);
    } finally { await connection.query("ROLLBACK TO SAVEPOINT owner_last_admin"); await connection.query("RELEASE SAVEPOINT owner_last_admin"); }
  }, 120000);
  it("rate limits both capability check and completion without leaking a token or user identity", async () => {
    for (const path of ["/auth/admin-setup/check", "/auth/admin-setup"]) {
      let response: Awaited<ReturnType<typeof request>> | undefined;
      for (let attempt = 0; attempt < 13; attempt++) response = await request(path, "POST", { token: opaque() });
      expect(response?.status).toBe(429); expect(response?.data).toEqual({ message: "Too many attempts. Please try again later" });
    }
  }, 60000);
});
