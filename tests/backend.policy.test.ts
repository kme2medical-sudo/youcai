import { describe, it, expect, afterEach, vi } from "vitest";
import { hashPassword, checkPassword, hash, opaque, csrfFor, shouldBootstrap, BOOTSTRAP_EMAILS, accessProof, getUser, requirePermission, validateRoleChange, protectRole, checkOrigin } from "../server/crm/security";
import * as database from "../server/crm/db";
import { listUsers } from "../server/crm/services";
import { setTestMailTransport, emailReady } from "../server/crm/mail";
import { PERMISSION_CODES, CUSTOMER_TYPES, LEGAL_ENTITY_TYPES, SALUTATIONS, customerSchema, contactSchema, companySchema, registerSchema, type User } from "../shared/crm";
const base: User = { id: "actor", fullName: "Tester", email: "tester@example.invalid", status: "ACTIVE", emailVerified: true, roles: ["sales", "pricing"], permissions: ["customers.read", "customers.create", "customers.update", "contacts.manage"] };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setTestMailTransport(undefined); });
describe("backend policy and credential isolation", () => {
  it("only bootstraps verified exact allowlist entries once", () => {
    expect([...BOOTSTRAP_EMAILS].sort()).toEqual(["alberto@youcaimedical.com", "eniodeleon87@gmail.com", "eadlr1@gmail.com", "kme2medical@gmail.com", "wangxukai@youcaimedical.com"].sort());
    for (const email of BOOTSTRAP_EMAILS) { expect(shouldBootstrap(email, false)).toBe(false); expect(shouldBootstrap(email, true)).toBe(true); expect(shouldBootstrap(email, true, true)).toBe(false); expect(shouldBootstrap(`  ${email.toUpperCase()}  `, true)).toBe(true); }
    for (const email of ["admin@youcaimedical.com", "alberto@youcaimedical.com.attacker.example", "fakealberto@youcaimedical.com", "eniodeleon87+admin@gmail.com", "wangxukai+admin@youcaimedical.com", "wangxukai@youcaimedical.com.attacker.example", "other@youcaimedical.com"]) expect(shouldBootstrap(email, true)).toBe(false);
  });
  it("scrypt salts differ, valid passwords check, plaintext is absent", async () => {
    const password = "correct horse battery staple";
    const a = await hashPassword(password), b = await hashPassword(password);
    expect(a).not.toBe(b); expect(a).not.toContain(password); expect(await checkPassword(password, a)).toBe(true); expect(await checkPassword("bad password", a)).toBe(false); expect(await checkPassword(password, "plain")).toBe(false);
  });
  it("random opaque session and bound CSRF tokens are 256-bit and nonplaintext hashes", () => {
    const a = opaque(), b = opaque(); expect(a).toHaveLength(43); expect(a).not.toBe(b); expect(hash(a)).toHaveLength(64); expect(csrfFor(a)).toHaveLength(43); expect(csrfFor(a)).not.toBe(csrfFor(b)); expect(hash(csrfFor(a))).not.toBe(csrfFor(a));
  });
  it("denies all unverified/inactive business access and defaults to no permissions", () => {
    expect(() => requirePermission(null, "customers.read")).toThrow();
    for (const status of ["UNVERIFIED", "PENDING_APPROVAL", "REJECTED", "SUSPENDED"] as const) expect(() => requirePermission({ ...base, status }, "customers.read")).toThrow();
    expect(() => requirePermission({ ...base, emailVerified: false }, "customers.read")).toThrow(); expect(() => requirePermission({ ...base, permissions: [] }, "customers.read")).toThrow();
    expect(() => requirePermission(base, "customers.read")).not.toThrow(); expect(() => requirePermission(base, "customers.archive")).toThrow();
    expect(() => requirePermission({ ...base, permissions: [...PERMISSION_CODES] }, "roles.manage", true)).toThrow();
  });
  it("owner-completed exact proof authorizes access without falsely asserting email verification", () => {
    for (const email of BOOTSTRAP_EMAILS) {
      expect(accessProof({ email_normalized: email })).toEqual({ accessAuthorized: false, accessMethod: null });
      expect(accessProof({ email_normalized: email, owner_authorized_at: "now" })).toEqual({ accessAuthorized: false, accessMethod: null });
      expect(accessProof({ email_normalized: email, owner_completed_at: "now" })).toEqual({ accessAuthorized: true, accessMethod: "OWNER_PROVISIONED" });
      expect(() => requirePermission({ ...base, email, emailVerified: false, accessAuthorized: false }, "customers.read")).toThrow();
    }
    for (const email of ["outsider@example.invalid", "wangxukai+admin@youcaimedical.com", "wangxukai@youcaimedical.com.attacker.example"]) expect(accessProof({ email_normalized: email, owner_completed_at: "now", accessAuthorized: true })).toEqual({ accessAuthorized: false, accessMethod: null });
    expect(accessProof({ email_normalized: "ordinary@example.invalid", email_verified_at: "now", owner_completed_at: "now" })).toEqual({ accessAuthorized: true, accessMethod: "EMAIL_VERIFIED" });
    const owner: User = { ...base, emailVerified: false, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED", roles: ["admin"], permissions: [...PERMISSION_CODES] };
    expect(() => requirePermission(owner, "roles.manage", true)).not.toThrow();
    expect(() => requirePermission({ ...owner, status: "SUSPENDED" }, "roles.manage", true)).toThrow();
  });
  it("getUser and listUsers compute access from joined database proof rather than supplied DTO claims", async () => {
    const row = { id: "owner", full_name: "Administrator", email_normalized: "wangxukai@youcaimedical.com", status: "ACTIVE", email_verified_at: null, owner_completed_at: "2026-01-01", created_at: "2026-01-01 00:00:00", accessAuthorized: false };
    const mock = vi.spyOn(database, "rows");
    mock.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ code: "admin" }]).mockResolvedValueOnce(PERMISSION_CODES.map(code => ({ code })));
    expect(await getUser({} as any, row.id)).toMatchObject({ emailVerified: false, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED", permissions: [...PERMISSION_CODES] });
    mock.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ user_id: row.id, code: "admin" }]).mockResolvedValueOnce(PERMISSION_CODES.map(code => ({ user_id: row.id, code })));
    expect((await listUsers({} as any))[0]).toMatchObject({ emailVerified: false, accessAuthorized: true, accessMethod: "OWNER_PROVISIONED", permissions: [...PERMISSION_CODES] });
    mock.mockResolvedValueOnce([{ ...row, owner_completed_at: null, accessAuthorized: true }]).mockResolvedValueOnce([{ code: "admin" }]).mockResolvedValueOnce(PERMISSION_CODES.map(code => ({ code })));
    expect(await getUser({} as any, row.id)).toMatchObject({ emailVerified: false, accessAuthorized: false, accessMethod: null, permissions: [] });
    expect(mock.mock.calls.every(([, sql]) => typeof sql === "string")).toBe(true);
  });
  it("forbids self modification, unverified activation and last effective admin loss", () => {
    expect(() => validateRoleChange("a", "a", true, "ACTIVE", ["admin"], 2)).toThrow(); expect(() => validateRoleChange("a", "b", false, "ACTIVE", ["employee"], 2)).toThrow(); expect(() => validateRoleChange("a", "b", true, "ACTIVE", [], 2)).toThrow(); expect(() => validateRoleChange("a", "b", true, "SUSPENDED", [], 0)).toThrow(); expect(() => validateRoleChange("a", "b", true, "ACTIVE", ["sales", "pricing"], 1)).not.toThrow();
  });
  it("preserves every top-level core permission", () => { for (const code of ["admin", "ceo"]) { expect(() => protectRole(code, [])).toThrow(); expect(() => protectRole(code, [...PERMISSION_CODES])).not.toThrow(); } expect(() => protectRole("employee", [])).not.toThrow(); });
  it("origin checks accept trusted HTTPS public host without internal scheme inference and reject attackers", () => {
    const req = (headers: Record<string,string>) => ({ get: (key:string) => headers[key] }) as any;
    expect(() => checkOrigin(req({ origin: "https://preview.example", host: "preview.example" }))).not.toThrow(); expect(() => checkOrigin(req({ origin: "https://evil.example", host: "preview.example" }))).toThrow(); expect(() => checkOrigin(req({ origin: "http://preview.example", host: "preview.example" }))).toThrow();
    vi.stubEnv("APP_PUBLIC_URL", "https://app.youcaimedical.example"); expect(() => checkOrigin(req({ origin: "https://app.youcaimedical.example", host: "internal.service" }))).not.toThrow(); expect(() => checkOrigin(req({ referer: "https://evil.example/login", host: "preview.example" }))).toThrow();
  });
  it("mail is unavailable without config and injection is forbidden in production", () => {
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("EMAIL_FROM", ""); vi.stubEnv("APP_PUBLIC_URL", ""); expect(emailReady()).toBe(false);
    setTestMailTransport(async () => {}); expect(emailReady()).toBe(true); vi.stubEnv("NODE_ENV", "production"); expect(emailReady()).toBe(false); expect(() => setTestMailTransport(async () => {})).toThrow();
  });
});
describe("backend strict validation", () => {
  it("keeps exact independent enums and rejects registered entities without legal name", () => {
    expect(CUSTOMER_TYPES).toHaveLength(6); expect(LEGAL_ENTITY_TYPES).toHaveLength(5); expect(SALUTATIONS).toHaveLength(9);
    const input = { displayName:"Clinic", customerType:"Hospital/Clinic", countryCode:"TR", legalEntityType:"Corporation/S.A." };
    expect(customerSchema.safeParse(input).success).toBe(false); expect(customerSchema.parse({ ...input, legalName:"Registered Company" }).countryCode).toBe("TR");
    expect(customerSchema.safeParse({ ...input, legalName:"Company", status:"ARCHIVED" }).success).toBe(false);
    expect(customerSchema.parse({ displayName:"Practitioner", customerType:"Doctor/Individual Practitioner", countryCode:"eg", legalEntityType:"Individual/Sole Proprietor" }).countryCode).toBe("EG");
  });
  it("normalizes signup email and makes requested role a valid code, never permission", () => {
    const value = registerSchema.parse({ fullName:" Test User ", email:" TEST@EXAMPLE.COM ", password:"long secure password", requestedRole:"admin" }); expect(value.email).toBe("test@example.com"); expect(value.fullName).toBe("Test User"); expect(registerSchema.safeParse({ ...value, roles:["admin"] }).success).toBe(false);
  });
  it("rejects executable URLs, invalid contacts, and unknown timezone", () => {
    expect(customerSchema.safeParse({ displayName:"Company", customerType:"Other", countryCode:"US", website:"javascript:alert(1)" }).success).toBe(false); expect(contactSchema.safeParse({ fullName:"", isPrimary:true }).success).toBe(false); expect(contactSchema.safeParse({ fullName:"Name", salutation:"Sir" }).success).toBe(false); expect(companySchema.safeParse({ timezone:"Unknown/Somewhere", defaultCurrency:"USD" }).success).toBe(false);
  });
});
