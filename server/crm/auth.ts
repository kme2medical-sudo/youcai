import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { registerSchema, emailSchema, passwordSchema } from "../../shared/crm";
import { getPool, rows, run, transaction } from "./db";
import { BOOTSTRAP_EMAILS, HttpError, hash, opaque, csrfFor, hashPassword, checkPassword, shouldBootstrap, getUser, resolveSession, sessionCookie, safeEqual, limitAuth, audit, lockSecurity } from "./security";
import { emailReady, sendAccountMail } from "./mail";
import { checkOwnerAdminInvitation, completeOwnerAdminSetup } from "./admin-enrollment";
export const authRouter = Router();
const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };
const message = "If your request is eligible, an email will be sent with next steps.";
const setup = () => { if (!emailReady()) throw new HttpError(503, "Email setup is required. Registration and password recovery are unavailable until delivery is configured."); };
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const cookieOptions = { httpOnly: true, secure: true, sameSite: "none" as const, path: "/", maxAge: 8 * 60 * 60 * 1000 };
let dummyPassword: Promise<string> | undefined;
async function issueMail(id: string, email: string, purpose: "VERIFY" | "RESET") {
  const token = opaque();
  await transaction(async db => {
    await rows(db, "SELECT id FROM crm_users WHERE id = ? FOR UPDATE", [id]);
    await run(db, "DELETE FROM crm_auth_tokens WHERE user_id = ? AND purpose = ?", [id, purpose]);
    await run(db, "INSERT INTO crm_auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", [hash(token), id, purpose, new Date(Date.now() + (purpose === "VERIFY" ? 86400000 : 1800000))]);
  });
  try { await sendAccountMail(email, purpose, token); } catch { await run(getPool(), "DELETE FROM crm_auth_tokens WHERE token_hash = ?", [hash(token)]); /* Public response stays generic; caller can retry. Never log email URLs or provider content. */ }
}
authRouter.get("/config", (_req, res) => res.json({ emailReady: emailReady(), adminSetupAvailable: true }));
authRouter.post("/admin-setup/check", asyncRoute(async (req, res) => {
  await limitAuth(req, "admin-setup-check");
  const input = z.object({ token: tokenSchema }).strict().safeParse(req.body);
  if (!input.success) throw new HttpError(400, "This link is invalid or expired");
  return res.json(await checkOwnerAdminInvitation(input.data.token));
}));
authRouter.post("/admin-setup", asyncRoute(async (req, res) => {
  await limitAuth(req, "admin-setup");
  const input = z.object({ token: tokenSchema, fullName: z.string().trim().min(2).max(160), password: passwordSchema }).strict().safeParse(req.body);
  if (!input.success) throw new HttpError(400, "This link is invalid or expired");
  await completeOwnerAdminSetup(input.data);
  return res.json({ message: "Administrator setup completed. Sign in with your chosen password." });
}));
authRouter.get("/me", asyncRoute(async (req, res) => { const auth = await resolveSession(req); return res.json(auth ? { user: auth.user, csrfToken: auth.csrfToken } : { user: null }); }));
authRouter.post("/register", asyncRoute(async (req, res) => {
  setup(); const input = registerSchema.parse(req.body); await limitAuth(req, "register", input.email);
  const passwordHash = await hashPassword(input.password);
  const result = await transaction(async db => {
    const existing = await rows(db, "SELECT id FROM crm_users WHERE email_normalized = ?", [input.email]); if (existing.length) return null;
    const role = await rows(db, "SELECT code FROM crm_roles WHERE code = ? AND active = TRUE", [input.requestedRole]); if (!role.length) throw new HttpError(422, "Requested role is unavailable");
    const id = randomUUID();
    try { await run(db, "INSERT INTO crm_users (id, full_name, email_normalized, status) VALUES (?, ?, ?, 'UNVERIFIED')", [id, input.fullName, input.email]); } catch (error: any) { if (error.code === "ER_DUP_ENTRY") return null; throw error; }
    await run(db, "INSERT INTO crm_auth_credentials (user_id, password_hash) VALUES (?, ?)", [id, passwordHash]);
    await run(db, "INSERT INTO crm_role_requests (user_id, role_code) VALUES (?, ?)", [id, input.requestedRole]);
    await audit(db, id, "auth.registered", "user", id, { requestedRole: input.requestedRole });
    return id;
  });
  if (result) await issueMail(result, input.email, "VERIFY");
  return res.status(200).json({ message });
}));
authRouter.post("/login", asyncRoute(async (req, res) => {
  // Generic validation and credential errors do not reveal account existence.
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict().safeParse(req.body);
  if (!parsed.success) { await limitAuth(req, "login"); throw new HttpError(401, "Invalid email or password"); }
  const input = parsed.data; await limitAuth(req, "login", input.email);
  const record = (await rows(getPool(), "SELECT u.id, c.password_hash FROM crm_users u JOIN crm_auth_credentials c ON c.user_id = u.id WHERE u.email_normalized = ?", [input.email]))[0];
  dummyPassword ??= hashPassword(opaque());
  const valid = await checkPassword(input.password, record?.password_hash || await dummyPassword);
  if (!record || !valid) throw new HttpError(401, "Invalid email or password");
  const token = opaque(), csrfToken = csrfFor(token);
  const user = await transaction(async db => {
    // Recheck credentials under a lock so a concurrent password reset cannot issue a stale session.
    const current = (await rows(db, "SELECT password_hash FROM crm_auth_credentials WHERE user_id = ? FOR UPDATE", [record.id]))[0];
    if (!current || current.password_hash !== record.password_hash) throw new HttpError(401, "Invalid email or password");
    const old = sessionCookie(req); if (old) await run(db, "DELETE FROM crm_auth_sessions WHERE token_hash = ?", [hash(old)]);
    await run(db, "INSERT INTO crm_auth_sessions (token_hash, user_id, csrf_hash, expires_at) VALUES (?, ?, ?, ?)", [hash(token), record.id, hash(csrfToken), new Date(Date.now() + 8 * 3600000)]);
    await audit(db, record.id, "auth.signed_in", "user", record.id);
    return getUser(db, record.id);
  });
  res.cookie("youcai_session", token, cookieOptions);
  return res.json({ user, csrfToken });
}));
authRouter.post("/logout", asyncRoute(async (req, res) => {
  const auth = await resolveSession(req);
  if (auth) { const value = req.get("x-csrf-token"); if (!value || !safeEqual(hash(value), auth.csrfHash)) throw new HttpError(403, "CSRF token is missing or invalid"); await run(getPool(), "DELETE FROM crm_auth_sessions WHERE token_hash = ?", [auth.sessionHash]); }
  res.clearCookie("youcai_session", { httpOnly: true, secure: true, sameSite: "none", path: "/" });
  return res.json({ message: "Signed out" });
}));
authRouter.post("/verify", asyncRoute(async (req, res) => {
  await limitAuth(req, "verify"); const input = z.object({ token: tokenSchema, password: passwordSchema }).strict().safeParse(req.body); if (!input.success) throw new HttpError(400, "This link is invalid or expired");
  const encoded = await hashPassword(input.data.password), tokenHash = hash(input.data.token);
  await transaction(async db => {
    // Credential FIRST matches login/reset: a stale preregistration password must never issue
    // a session after ownership is established. The candidate is untrusted until locked revalidation.
    const candidate = (await rows(db, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND purpose = 'VERIFY' AND expires_at > UTC_TIMESTAMP(3)", [tokenHash]))[0];
    if (!candidate) throw new HttpError(400, "This link is invalid or expired");
    const credential = (await rows(db, "SELECT user_id FROM crm_auth_credentials WHERE user_id = ? FOR UPDATE", [candidate.user_id]))[0];
    if (!credential) throw new HttpError(400, "This link is invalid or expired");
    await lockSecurity(db);
    // User before token matches issueMail's user -> tokens order, preventing a resend deadlock.
    const user = (await rows(db, "SELECT * FROM crm_users WHERE id = ? FOR UPDATE", [candidate.user_id]))[0];
    const token = (await rows(db, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND user_id = ? AND purpose = 'VERIFY' AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE", [tokenHash, candidate.user_id]))[0];
    if (!token || !user || user.email_verified_at || !["UNVERIFIED", "PENDING_APPROVAL"].includes(user.status)) throw new HttpError(400, "This link is invalid or expired");
    // The mailed owner form, not registration, establishes the durable credential. All pre-owner
    // sessions disappear before verified/ACTIVE state becomes visible at this transaction's commit.
    await run(db, "UPDATE crm_auth_credentials SET password_hash = ?, changed_at = UTC_TIMESTAMP(3) WHERE user_id = ?", [encoded, user.id]);
    await run(db, "DELETE FROM crm_auth_sessions WHERE user_id = ?", [user.id]);
    await run(db, "DELETE FROM crm_auth_tokens WHERE user_id = ? AND purpose = 'VERIFY'", [user.id]);
    const bootstrap = shouldBootstrap(user.email_normalized, true, !!user.bootstrap_completed);
    const status = bootstrap ? "ACTIVE" : "PENDING_APPROVAL";
    await run(db, "UPDATE crm_users SET email_verified_at = UTC_TIMESTAMP(3), status = ?, bootstrap_completed = ?, updated_by = ? WHERE id = ? AND email_verified_at IS NULL", [status, bootstrap || !!user.bootstrap_completed, user.id, user.id]);
    if (bootstrap) await run(db, "INSERT IGNORE INTO crm_user_roles (user_id, role_code) VALUES (?, 'admin')", [user.id]);
    await audit(db, user.id, bootstrap ? "auth.verified_admin_bootstrap" : "auth.email_verified", "user", user.id, { status });
  });
  return res.json({ message: "Email verified. Sign in to view your account status." });
}));
authRouter.post("/resend", asyncRoute(async (req, res) => {
  setup(); const parsed = z.object({ email: emailSchema }).strict().safeParse(req.body); await limitAuth(req, "resend", parsed.success ? parsed.data.email : undefined);
  if (parsed.success) { const user = (await rows(getPool(), "SELECT id, email_normalized FROM crm_users WHERE email_normalized = ? AND email_verified_at IS NULL AND status IN ('UNVERIFIED','PENDING_APPROVAL')", [parsed.data.email]))[0]; if (user) await issueMail(user.id, user.email_normalized, "VERIFY"); }
  return res.json({ message });
}));
authRouter.post("/forgot", asyncRoute(async (req, res) => {
  setup(); const parsed = z.object({ email: emailSchema }).strict().safeParse(req.body); await limitAuth(req, "forgot", parsed.success ? parsed.data.email : undefined);
  if (parsed.success) {
    const db = getPool();
    const record = (await rows(db, "SELECT id FROM crm_users WHERE email_normalized = ?", [parsed.data.email]))[0];
    // getUser derives owner completion from database proof, not an email match or requested role.
    const user = record ? await getUser(db, record.id) : null;
    const completedOwner = user?.accessAuthorized === true && user.accessMethod === "OWNER_PROVISIONED" && BOOTSTRAP_EMAILS.has(user.email);
    // Recovery changes credentials only; suspension, demotion and pending approval still apply.
    if (user && (user.emailVerified || completedOwner)) await issueMail(user.id, user.email, "RESET");
  }
  return res.json({ message });
}));
authRouter.post("/reset", asyncRoute(async (req, res) => {
  setup(); await limitAuth(req, "reset");
  const parsed = z.object({ token: tokenSchema, password: passwordSchema }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid reset request. Use a valid link and a password of 12–128 characters.");
  const encoded = await hashPassword(parsed.data.password);
  await transaction(async db => {
    // Password lock order is credential, then token, matching login and avoiding credential/session races.
    const candidate = (await rows(db, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND purpose = 'RESET' AND expires_at > UTC_TIMESTAMP(3)", [hash(parsed.data.token)]))[0];
    if (!candidate) throw new HttpError(400, "This link is invalid or expired");
    await rows(db, "SELECT user_id FROM crm_auth_credentials WHERE user_id = ? FOR UPDATE", [candidate.user_id]);
    const token = await rows(db, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND purpose = 'RESET' AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE", [hash(parsed.data.token)]); if (!token.length) throw new HttpError(400, "This link is invalid or expired");
    await run(db, "UPDATE crm_auth_credentials SET password_hash = ?, changed_at = UTC_TIMESTAMP(3) WHERE user_id = ?", [encoded, candidate.user_id]);
    await run(db, "DELETE FROM crm_auth_tokens WHERE user_id = ? AND purpose = 'RESET'", [candidate.user_id]);
    await run(db, "DELETE FROM crm_auth_sessions WHERE user_id = ?", [candidate.user_id]);
    await audit(db, candidate.user_id, "auth.password_reset", "user", candidate.user_id);
  });
  return res.json({ message: "Password reset. Sign in with your new password." });
}));
