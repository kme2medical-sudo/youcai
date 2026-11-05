import express, { type ErrorRequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: Object.freeze({ name: "fake-pool" }),
  transactionDb: Object.freeze({ name: "fake-transaction" }),
  getPool: vi.fn(),
  rows: vi.fn(),
  run: vi.fn(),
  transaction: vi.fn(),
  limitAuth: vi.fn(),
  hashPassword: vi.fn(),
  emailReady: vi.fn(),
  sendAccountMail: vi.fn(),
}));

vi.mock("../server/crm/db", async importOriginal => ({
  ...await importOriginal<typeof import("../server/crm/db")>(),
  getPool: mocks.getPool,
  rows: mocks.rows,
  run: mocks.run,
  transaction: mocks.transaction,
}));
vi.mock("../server/crm/security", async importOriginal => {
  const original = await importOriginal<typeof import("../server/crm/security")>();
  return {
    ...original,
    // Keep the real joined-row getUser/accessProof implementation, observable for assertions.
    getUser: vi.fn(original.getUser),
    limitAuth: mocks.limitAuth,
    hashPassword: mocks.hashPassword,
  };
});
vi.mock("../server/crm/mail", () => ({
  emailReady: mocks.emailReady,
  // In-memory fake: never calls fetch, Resend or another delivery provider.
  sendAccountMail: mocks.sendAccountMail,
}));

import { authRouter } from "../server/crm/auth";
import { getUser, hash, HttpError } from "../server/crm/security";

const owners = [
  "alberto@youcaimedical.com",
  "eniodeleon87@gmail.com",
  "eadlr1@gmail.com",
  "kme2medical@gmail.com",
  "wangxukai@youcaimedical.com",
];
const generic = { message: "If your request is eligible, an email will be sent with next steps." };
const joinedUserSql = "SELECT u.*, rr.role_code AS requested_role, oa.completed_at AS owner_completed_at FROM crm_users u LEFT JOIN crm_role_requests rr ON rr.user_id = u.id LEFT JOIN crm_owner_admin_access oa ON oa.user_id = u.id WHERE u.id = ?";
const roleSql = "SELECT r.code FROM crm_user_roles ur JOIN crm_roles r ON r.code = ur.role_code AND r.active = TRUE WHERE ur.user_id = ? ORDER BY r.code";
const permissionSql = "SELECT DISTINCT p.code FROM crm_user_roles ur JOIN crm_roles r ON r.code = ur.role_code AND r.active = TRUE JOIN crm_role_permissions rp ON rp.role_code = r.code JOIN crm_permissions p ON p.code = rp.permission_code AND p.active = TRUE WHERE ur.user_id = ? ORDER BY p.code";
const userLockSql = "SELECT id FROM crm_users WHERE id = ? FOR UPDATE";
const idLookupSql = "SELECT id FROM crm_users WHERE email_normalized = ?";

type UserRow = Record<string, unknown> & { id: string; email_normalized: string };
function userRow(email: string, overrides: Record<string, unknown> = {}): UserRow {
  return {
    id: "synthetic-account",
    email_normalized: email,
    full_name: "Recovery Test",
    status: "ACTIVE",
    email_verified_at: null,
    owner_completed_at: null,
    requested_role: "employee",
    created_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

function arrangeUser(row: UserRow, roles = ["employee"], lookup: Record<string, unknown> = { id: row.id }) {
  mocks.rows.mockResolvedValueOnce([lookup]);
  mocks.rows.mockResolvedValueOnce([row]);
  mocks.rows.mockResolvedValueOnce(roles.map(code => ({ code })));
  mocks.rows.mockResolvedValueOnce([{ code: "customers.read" }]);
}
function arrangeMailLock(row: UserRow) {
  mocks.rows.mockResolvedValueOnce([{ id: row.id }]);
}
function expectProofReads(row: UserRow, normalizedEmail = row.email_normalized) {
  expect(mocks.rows.mock.calls.slice(0, 4)).toEqual([
    [mocks.pool, idLookupSql, [normalizedEmail]],
    [mocks.pool, joinedUserSql, [row.id]],
    [mocks.pool, roleSql, [row.id]],
    [mocks.pool, permissionSql, [row.id]],
  ]);
  expect(vi.mocked(getUser).mock.calls).toEqual([[mocks.pool, row.id]]);
}
function expectResetMail(row: UserRow) {
  expect(mocks.rows).toHaveBeenCalledTimes(5);
  expect(mocks.rows.mock.calls[4]).toEqual([mocks.transactionDb, userLockSql, [row.id]]);
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  expect(mocks.sendAccountMail).toHaveBeenCalledTimes(1);
  const [recipient, purpose, token] = mocks.sendAccountMail.mock.calls[0];
  expect(recipient).toBe(row.email_normalized);
  expect(purpose).toBe("RESET");
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(mocks.run.mock.calls).toEqual([
    [mocks.transactionDb, "DELETE FROM crm_auth_tokens WHERE user_id = ? AND purpose = ?", [row.id, "RESET"]],
    [mocks.transactionDb, "INSERT INTO crm_auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", [hash(token), row.id, "RESET", expect.any(Date)]],
  ]);
  expect(mocks.run.mock.calls[1][2][3].getTime()).toBeGreaterThan(Date.now());
  expect(JSON.stringify(mocks.run.mock.calls)).not.toContain(token);
}
function expectNoMail() {
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.sendAccountMail).not.toHaveBeenCalled();
}

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof HttpError ? error.status : 500).json({ error: error.message });
  };
  app.use(errorHandler);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPool.mockReturnValue(mocks.pool);
  // Unexpected reads fail closed, instead of falling through to a real database.
  mocks.rows.mockReset().mockImplementation(async () => { throw new Error("Unexpected mocked database read"); });
  mocks.run.mockReset().mockResolvedValue({ affectedRows: 1 });
  mocks.transaction.mockImplementation(async work => work(mocks.transactionDb));
  mocks.limitAuth.mockReset().mockResolvedValue(undefined);
  mocks.hashPassword.mockResolvedValue("synthetic-test-password-hash");
  mocks.emailReady.mockReturnValue(true);
  mocks.sendAccountMail.mockReset().mockResolvedValue(undefined);
});
async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// Only this file is needed to run these cases; it never imports the live integration harness.
describe("isolated /forgot owner recovery", () => {
  it.each(owners)("allows completed exact owner %s without claiming email verification", async email => {
    const row = userRow(email, { owner_completed_at: "2026-01-01 00:00:00", requested_role: "admin" });
    arrangeUser(row, ["admin"]);
    arrangeMailLock(row);
    expect(await post("/forgot", { email })).toEqual({ status: 200, body: generic });
    expectProofReads(row);
    expect(await vi.mocked(getUser).mock.results[0].value).toMatchObject({
      emailVerified: false, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED",
    });
    expectResetMail(row);
    expect(mocks.limitAuth.mock.calls).toEqual([[expect.anything(), "forgot", email]]);
  });

  it.each(["ACTIVE", "PENDING_APPROVAL"])("retains recovery for verified ordinary %s users", async status => {
    const row = userRow("ordinary@example.invalid", { status, email_verified_at: "2026-01-01 00:00:00" });
    arrangeUser(row);
    arrangeMailLock(row);
    expect(await post("/forgot", { email: row.email_normalized })).toEqual({ status: 200, body: generic });
    expectProofReads(row);
    expect(await vi.mocked(getUser).mock.results[0].value).toMatchObject({
      emailVerified: true, accessAuthorized: true, accessMethod: "EMAIL_VERIFIED",
    });
    expectResetMail(row);
  });

  it.each([
    ["ordinary unverified signup", "ordinary@example.invalid", { status: "UNVERIFIED" }],
    ["ordinary unverified pending approval", "ordinary@example.invalid", { status: "PENDING_APPROVAL" }],
    ["pending owner without credentials", owners[3], { status: "UNVERIFIED", owner_authorized_at: "2026-01-01", credential_user_id: null, requested_role: "admin" }],
    ["allowlisted public admin request", owners[3], { status: "PENDING_APPROVAL", requested_role: "admin" }],
    ["uncompleted owner with forged DTO claims", owners[3], { accessAuthorized: true, accessMethod: "OWNER_PROVISIONED", emailVerified: true, bootstrap_completed: true }],
    ["completed outsider", "outsider@example.invalid", { owner_completed_at: "2026-01-01", accessAuthorized: true, accessMethod: "OWNER_PROVISIONED" }],
  ] as const)("denies %s using the real joined proof", async (_label, email, overrides) => {
    const row = userRow(email, overrides);
    arrangeUser(row, ["admin"]);
    expect(await post("/forgot", { email })).toEqual({ status: 200, body: generic });
    expectProofReads(row);
    expect(await vi.mocked(getUser).mock.results[0].value).toMatchObject({
      emailVerified: false, accessAuthorized: false, accessMethod: null,
    });
    expectNoMail();
  });

  it("does not trust email verification or access claims on the initial identity lookup", async () => {
    const row = userRow(owners[3]);
    arrangeUser(row, ["admin"], {
      id: row.id, email_normalized: row.email_normalized, email_verified_at: "2026-01-01",
      emailVerified: true, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED", requestedRole: "admin",
    });
    expect(await post("/forgot", { email: row.email_normalized })).toEqual({ status: 200, body: generic });
    expectProofReads(row);
    expectNoMail();
  });

  it.each([
    "kme2medical+admin@gmail.com",
    "k.me2medical@gmail.com",
    "kme2medical@googlemail.com",
    "other@youcaimedical.com",
    "fakealberto@youcaimedical.com",
    "alberto@youcaimedical.com.attacker.example",
    "wangxukai+admin@youcaimedical.com",
  ])("does not grant completed-owner recovery to alias or wildcard %s", async email => {
    const row = userRow(email, { owner_completed_at: "2026-01-01 00:00:00" });
    arrangeUser(row, ["admin"]);
    expect(await post("/forgot", { email })).toEqual({ status: 200, body: generic });
    expectProofReads(row);
    expectNoMail();
  });

  it("keeps existing trim/lowercase normalization without alias rewriting", async () => {
    const row = userRow(owners[3], { owner_completed_at: "2026-01-01" });
    arrangeUser(row);
    arrangeMailLock(row);
    expect(await post("/forgot", { email: "  KME2MEDICAL@GMAIL.COM  " })).toEqual({ status: 200, body: generic });
    expectProofReads(row);
    expectResetMail(row);
    expect(mocks.limitAuth.mock.calls).toEqual([[expect.anything(), "forgot", owners[3]]]);
  });

  it("returns the same generic response for a missing identity", async () => {
    mocks.rows.mockResolvedValueOnce([]);
    expect(await post("/forgot", { email: "missing@example.invalid" })).toEqual({ status: 200, body: generic });
    expect(mocks.rows.mock.calls).toEqual([[mocks.pool, idLookupSql, ["missing@example.invalid"]]]);
    expect(getUser).not.toHaveBeenCalled();
    expectNoMail();
  });

  it("fails closed if the identity disappears before trusted proof is read", async () => {
    mocks.rows.mockResolvedValueOnce([{ id: "missing-account" }]).mockResolvedValueOnce([]);
    expect(await post("/forgot", { email: owners[3] })).toEqual({ status: 200, body: generic });
    expect(vi.mocked(getUser).mock.calls).toEqual([[mocks.pool, "missing-account"]]);
    expectNoMail();
  });

  it.each([
    { email: "not-an-email" },
    { email: owners[3], requestedRole: "admin" },
    { email: owners[3], emailVerified: true, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED" },
  ])("keeps malformed/claim-bearing public requests generic and rate limited", async body => {
    expect(await post("/forgot", body)).toEqual({ status: 200, body: generic });
    expect(mocks.limitAuth.mock.calls).toEqual([[expect.anything(), "forgot", undefined]]);
    expect(mocks.getPool).not.toHaveBeenCalled();
    expectNoMail();
  });

  it("retains the configuration-required 503 before persistence or delivery", async () => {
    mocks.emailReady.mockReturnValue(false);
    expect(await post("/forgot", { email: owners[3] })).toEqual({
      status: 503,
      body: { error: "Email setup is required. Registration and password recovery are unavailable until delivery is configured." },
    });
    expect(mocks.getPool).not.toHaveBeenCalled();
    expect(mocks.limitAuth).not.toHaveBeenCalled();
    expectNoMail();
  });

  it("retains the rate-limit rejection before identity lookup or mail", async () => {
    mocks.limitAuth.mockRejectedValueOnce(new HttpError(429, "Too many attempts. Please try again later"));
    expect(await post("/forgot", { email: owners[3] })).toEqual({
      status: 429, body: { error: "Too many attempts. Please try again later" },
    });
    expect(mocks.getPool).not.toHaveBeenCalled();
    expectNoMail();
  });

  it("keeps delivery failure generic and removes only the failed token hash", async () => {
    const row = userRow(owners[3], { owner_completed_at: "2026-01-01" });
    arrangeUser(row);
    arrangeMailLock(row);
    mocks.sendAccountMail.mockRejectedValueOnce(new Error("Synthetic private provider detail"));
    expect(await post("/forgot", { email: row.email_normalized })).toEqual({ status: 200, body: generic });
    const token = mocks.sendAccountMail.mock.calls[0][2];
    expect(mocks.run.mock.calls[2]).toEqual([mocks.pool, "DELETE FROM crm_auth_tokens WHERE token_hash = ?", [hash(token)]]);
    expect(JSON.stringify(mocks.run.mock.calls)).not.toContain(token);
  });
});

describe("isolated /reset preserves owner account restrictions", () => {
  it.each([
    ["suspended", "SUSPENDED", ["admin"]],
    ["demoted", "ACTIVE", ["employee"]],
  ] as const)("recovers a %s owner but writes credentials, token/session revocation and audit only", async (_label, status, roles) => {
    const row = userRow(owners[3], { status, owner_completed_at: "2026-01-01", bootstrap_completed: true });
    arrangeUser(row, [...roles]);
    arrangeMailLock(row);
    expect(await post("/forgot", { email: row.email_normalized })).toEqual({ status: 200, body: generic });
    expectProofReads(row);
    expectResetMail(row);
    const token = mocks.sendAccountMail.mock.calls[0][2];
    const previousReadCount = mocks.rows.mock.calls.length;
    const previousWriteCount = mocks.run.mock.calls.length;
    mocks.rows.mockResolvedValueOnce([{ user_id: row.id }]);
    mocks.rows.mockResolvedValueOnce([{ user_id: row.id }]);
    mocks.rows.mockResolvedValueOnce([{ user_id: row.id }]);
    expect(await post("/reset", { token, password: "synthetic recovery password" })).toEqual({
      status: 200, body: { message: "Password reset. Sign in with your new password." },
    });
    expect(mocks.rows.mock.calls.slice(previousReadCount)).toEqual([
      [mocks.transactionDb, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND purpose = 'RESET' AND expires_at > UTC_TIMESTAMP(3)", [hash(token)]],
      [mocks.transactionDb, "SELECT user_id FROM crm_auth_credentials WHERE user_id = ? FOR UPDATE", [row.id]],
      [mocks.transactionDb, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND purpose = 'RESET' AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE", [hash(token)]],
    ]);
    expect(mocks.run.mock.calls.slice(previousWriteCount)).toEqual([
      [mocks.transactionDb, "UPDATE crm_auth_credentials SET password_hash = ?, changed_at = UTC_TIMESTAMP(3) WHERE user_id = ?", ["synthetic-test-password-hash", row.id]],
      [mocks.transactionDb, "DELETE FROM crm_auth_tokens WHERE user_id = ? AND purpose = 'RESET'", [row.id]],
      [mocks.transactionDb, "DELETE FROM crm_auth_sessions WHERE user_id = ?", [row.id]],
      [mocks.transactionDb, "INSERT INTO crm_audit_logs (id, actor_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)", [expect.any(String), row.id, "auth.password_reset", "user", row.id, "{}"]],
    ]);
    const writes = mocks.run.mock.calls.map(([, sql]) => sql).join("\n");
    expect(writes).not.toMatch(/UPDATE crm_users|crm_user_roles|crm_owner_admin_access|email_verified_at|bootstrap_completed/);
    expect(JSON.stringify(mocks.run.mock.calls)).not.toContain(token);
    expect(JSON.stringify(mocks.run.mock.calls)).not.toContain("synthetic recovery password");
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(mocks.sendAccountMail).toHaveBeenCalledTimes(1);
    expect(mocks.limitAuth.mock.calls.map(([, operation]) => operation)).toEqual(["forgot", "reset"]);
  });
});
