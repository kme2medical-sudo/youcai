import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { api, ApiError, setCsrfToken } from "./api";
import {
  ROLES,
  CUSTOMER_TYPES,
  LEGAL_TYPES,
  SALUTATIONS,
  isActive,
  isLeadership,
  hasPermission,
  hasAccessProof,
  accessMethodLabel,
  requiresLegalName,
  type User,
} from "./types";
import { Button, Field, safeWebsite, formatDate } from "./ui";
import { AuthPage, validatePasswordConfirmation, verifyEmail } from "./auth";
import {
  AdminSetupPage,
  AdminSetupForm,
  checkAdminSetup,
  createAdminPassword,
  INVALID_ADMIN_SETUP_LINK,
  isAdminSetupToken,
  validateAdminSetup,
} from "./admin-setup";
import { Profile } from "./dashboard";
import { UserModal } from "./users";

const authState = vi.hoisted(() => ({
  user: null as User | null,
  loading: false,
  error: null,
  emailReady: true as boolean | null,
  refresh: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./session", () => ({
  useAuth: () => authState,
  EmailSetupBanner: () =>
    authState.emailReady === false ? "Test email setup warning" : null,
  AccountStatus: () => null,
}));

const fixture = (overrides: Partial<User> = {}): User => ({
  id: "test-only-user",
  fullName: "Isolated Test",
  email: "test@example.invalid",
  status: "ACTIVE",
  emailVerified: true,
  roles: ["sales"],
  permissions: [
    "customers.read",
    "customers.create",
    "customers.update",
    "contacts.manage",
  ],
  ...overrides,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  setCsrfToken();
  vi.clearAllMocks();
  authState.user = null;
  authState.emailReady = true;
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    location: { search: "", pathname: "/verify-email", hash: "" },
    history: { replaceState: vi.fn() },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("credentialed REST client", () => {
  it("uses relative /api requests and includes credentials", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ user: null }));
    await api("/auth/me");
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ method: "GET", credentials: "include" })
    );
  });
  it("sends the session CSRF token and JSON on business mutations", async () => {
    setCsrfToken("test-only-csrf");
    vi.mocked(fetch).mockResolvedValue(json({ customer: { id: "test-only" } }));
    await api("/customers", {
      method: "POST",
      body: { displayName: "Test only" },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/customers",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          "X-CSRF-Token": "test-only-csrf",
          "Content-Type": "application/json",
        }),
        body: '{"displayName":"Test only"}',
      })
    );
  });
  it("clears CSRF when a session is cleared", async () => {
    setCsrfToken("test-only-csrf");
    setCsrfToken();
    vi.mocked(fetch).mockResolvedValue(json({ message: "Signed out" }));
    await api("/auth/logout", { method: "POST" });
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect(init.headers).not.toHaveProperty("X-CSRF-Token");
    expect(init.headers).not.toHaveProperty("Authorization");
  });
  it("supports bodyless contact deletion responses", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    expect(
      await api("/customers/test/contacts/test", { method: "DELETE" })
    ).toBeNull();
  });
  it("refreshes session after business authorization denial", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ message: "Access denied" }, 403));
    await expect(api("/customers")).rejects.toMatchObject({
      status: 403,
      message: "Access denied",
    });
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "youcai:session-refresh" })
    );
  });
  it("does not trigger native auth or session refresh on invalid login", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ message: "Invalid email or password" }, 401)
    );
    await expect(
      api("/auth/login", { method: "POST", body: {} })
    ).rejects.toBeInstanceOf(ApiError);
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
  it("shows field-specific server validation rather than a generic error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json(
        {
          message: "Please check the submitted fields",
          errors: [{ field: "legalName", message: "Legal name is required" }],
        },
        422
      )
    );
    await expect(
      api("/customers", { method: "POST", body: {} })
    ).rejects.toThrow("Legal Name: Legal name is required");
  });
  it("rejects unexpected HTML and network failures honestly", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("<html>fallback</html>"));
    await expect(api("/auth/me")).rejects.toThrow("unexpected response");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api("/auth/me")).rejects.toThrow("Unable to connect");
  });
});
describe("mailbox-owner verification", () => {
  const token = "test-only-verification-link";
  const password = "Test-only mailbox-owner password";
  const renderVerification = () =>
    renderToStaticMarkup(
      createElement(Router, {
        ssrPath: "/verify-email",
        children: createElement(AuthPage, { mode: "verify" }),
      })
    );

  it.each([0, 1, 11, 129])(
    "rejects a %s-character password before submission",
    length => {
      const value = "x".repeat(length);
      expect(validatePasswordConfirmation(value, value)).toBe(
        "Choose a password of 12–128 characters."
      );
    }
  );
  it.each([12, 128])("accepts matching %s-character passwords", length => {
    const value = "x".repeat(length);
    expect(validatePasswordConfirmation(value, value)).toBeNull();
  });
  it("requires an exact confirmation without trimming the chosen password", () => {
    expect(validatePasswordConfirmation(password, `${password} `)).toBe(
      "The passwords do not match."
    );
    expect(
      validatePasswordConfirmation(` ${password} `, ` ${password} `)
    ).toBeNull();
  });
  it("renders required accessible new-password fields without redeeming a link", () => {
    window.location.search = `?token=${token}`;
    const markup = renderVerification();
    expect(markup).toContain(
      "Confirm your email and secure your account. Choose the password you will use to sign in; this replaces any password entered before verification."
    );
    for (const name of ["password", "confirmPassword"]) {
      const input = markup.match(
        new RegExp(`<input[^>]*name="${name}"[^>]*>`)
      )?.[0];
      expect(input).toBeTruthy();
      expect(input).toContain('type="password"');
      expect(input).toContain('autoComplete="new-password"');
      expect(input).toContain('minLength="12"');
      expect(input).toContain('maxLength="128"');
      expect(input).toContain('required=""');
      const id = input?.match(/id="([^"]+)"/)?.[1];
      expect(markup).toContain(`for="${id}"`);
    }
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain("Email address");
    expect(fetch).not.toHaveBeenCalled();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });
  it.each([false, null])(
    "does not require email-provider readiness (%s) to redeem a delivered token",
    readiness => {
      authState.emailReady = readiness;
      window.location.search = `?token=${token}`;
      const markup = renderVerification();
      const button = markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0];
      expect(button).toBeTruthy();
      expect(button).not.toContain("disabled");
      expect(markup).toContain("Confirm email and secure account");
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it("keeps the tokenless resend form and delivery-readiness guard", () => {
    authState.emailReady = false;
    const markup = renderVerification();
    expect(markup).toContain("Email address");
    expect(markup).toContain("Resend verification email");
    expect(markup).toContain(
      "Verify ownership of your email address to continue your access request."
    );
    expect(markup).not.toContain('name="password"');
    expect(markup).not.toContain('name="confirmPassword"');
    const button = markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0];
    expect(button).toContain('disabled=""');
    expect(fetch).not.toHaveBeenCalled();
  });
  it("disables the existing submit button while busy", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, {
        type: "submit",
        busy: true,
        children: "Confirm email and secure account",
      })
    );
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
  });
  it("POSTs only token and chosen password, then removes the browser URL token", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ message: "Email confirmed" }));
    await expect(verifyEmail(token, password)).resolves.toEqual({
      message: "Email confirmed",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/verify",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ token, password }),
      })
    );
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/verify-email"
    );
  });
  it("does not clear the link while the request is still pending", async () => {
    let complete!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise(resolve => {
        complete = resolve;
      })
    );
    const submission = verifyEmail(token, password);
    expect(window.history.replaceState).not.toHaveBeenCalled();
    complete(json({ message: "Email confirmed" }));
    await submission;
    expect(window.history.replaceState).toHaveBeenCalledTimes(1);
  });
  it.each([400, 410])(
    "preserves invalid/expired-link errors (%s) without claiming success",
    async status => {
      vi.mocked(fetch).mockResolvedValue(
        json({ message: "This link is invalid or expired" }, status)
      );
      await expect(verifyEmail(token, password)).rejects.toThrow(
        "This link is invalid or expired"
      );
      expect(window.history.replaceState).not.toHaveBeenCalled();
    }
  );
  it("never stores or logs a verification token", async () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    Object.assign(window, { localStorage: storage, sessionStorage: storage });
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    try {
      window.location.search = `?token=${token}`;
      renderVerification();
      vi.mocked(fetch).mockResolvedValue(json({ message: "Email confirmed" }));
      await verifyEmail(token, password);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem).not.toHaveBeenCalled();
      for (const spy of [log, warn, error]) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
        expect(JSON.stringify(spy.mock.calls)).not.toContain(password);
      }
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
describe("fail-closed frontend permissions", () => {
  it.each(["UNVERIFIED", "PENDING_APPROVAL", "SUSPENDED", "REJECTED"] as const)(
    "denies business access for %s regardless of claimed permissions",
    status => {
      const user = fixture({
        status,
        roles: ["admin"],
        permissions: ["customers.read"],
      });
      expect(isActive(user)).toBe(false);
      expect(hasPermission(user, "customers.read")).toBe(false);
    }
  );
  it("also denies active but email-unverified accounts", () => {
    expect(isActive(fixture({ emailVerified: false }))).toBe(false);
    expect(hasPermission(null, "customers.read")).toBe(false);
  });
  it("uses the effective permission union but exact top-level roles", () => {
    expect(
      hasPermission(
        fixture({ roles: ["sales", "pricing"] }),
        "customers.update"
      )
    ).toBe(true);
    expect(hasPermission(fixture(), "customers.archive")).toBe(false);
    expect(isLeadership(fixture({ roles: ["admin"] }))).toBe(true);
    expect(isLeadership(fixture({ roles: ["ceo"] }))).toBe(true);
    expect(isLeadership(fixture({ roles: ["Admin"] }))).toBe(false);
    expect(
      isLeadership(fixture({ roles: ["sales"], permissions: ["company.read"] }))
    ).toBe(false);
  });
});
describe("exact foundation dimensions", () => {
  it("has exactly six role requests with agreed codes", () =>
    expect(ROLES).toEqual([
      { code: "admin", name: "Admin" },
      { code: "ceo", name: "CEO" },
      { code: "pricing", name: "Pricing" },
      { code: "sales", name: "Sales Representative" },
      { code: "employee", name: "Employee" },
      { code: "technician", name: "Technician" },
    ]));
  it("keeps six customer types and five legal types independent", () => {
    expect(CUSTOMER_TYPES).toHaveLength(6);
    expect(LEGAL_TYPES).toHaveLength(5);
    expect(SALUTATIONS).toEqual([
      "Mr.",
      "Mrs.",
      "Ms.",
      "Prof.",
      "Lic.",
      "Dr.",
      "Sr.",
      "Srita.",
      "Other",
    ]);
  });
  it.each([
    "Corporation/S.A.",
    "LLC/Limited Liability Company",
    "Government Entity",
  ])("requires legal name for %s", type =>
    expect(requiresLegalName(type)).toBe(true)
  );
  it("does not require legal name for blank or individual entity type", () => {
    expect(requiresLegalName("")).toBe(false);
    expect(requiresLegalName("Individual/Sole Proprietor")).toBe(false);
  });
});
describe("safe interface output", () => {
  it("only links HTTP(S) websites", () => {
    expect(safeWebsite("https://example.invalid")).toBe(
      "https://example.invalid/"
    );
    expect(safeWebsite("javascript:alert(1)")).toBeNull();
    expect(safeWebsite("data:text/html,hello")).toBeNull();
    expect(safeWebsite(null)).toBeNull();
  });
  it("handles missing and invalid dates without fake dates", () => {
    expect(formatDate(null)).toBe("Not available");
    expect(formatDate("invalid")).toBe("Not available");
    expect(formatDate("2026-01-02T12:00:00Z")).toContain("2026");
  });
});
describe("accessible form fields", () => {
  it("associates an explicit label and hint with a nested input", () => {
    const markup = renderToStaticMarkup(
      createElement(Field, {
        label: "Password",
        hint: "At least 12 characters",
        children: createElement(
          "div",
          null,
          createElement("input", { type: "password" }),
          createElement(
            "button",
            { type: "button", "aria-label": "Show password" },
            "Show"
          )
        ),
      })
    );
    const id = markup.match(/for="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain(`aria-describedby="${id}-hint"`);
    expect(markup.indexOf("</label>")).toBeLessThan(markup.indexOf("<button"));
  });
  it("labels selects and textareas independently", () => {
    for (const control of ["select", "textarea"]) {
      const markup = renderToStaticMarkup(
        createElement(Field, {
          label: "Test label",
          children: createElement(control),
        })
      );
      const id = markup.match(/for="([^"]+)"/)?.[1];
      expect(markup).toContain(`id="${id}"`);
    }
  });
});
describe("unconditional route manifest", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "client/public/manus-routes.json"), "utf8")
  );
  const source = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
  it("declares every page without entities, APIs, products or 404", () => {
    const routes = manifest.routes.map((route: { path: string }) => route.path);
    expect(routes).toEqual([
      "/",
      "/login",
      "/register",
      "/admin-setup",
      "/verify-email",
      "/forgot-password",
      "/reset-password",
      "/profile",
      "/customers",
      "/customers/new",
      "/customers/:id",
      "/customers/:id/edit",
      "/settings/users",
      "/settings/roles",
      "/settings/company",
      "/audit",
    ]);
    for (const route of routes) expect(source).toContain(`path="${route}"`);
  });
  it("gates all settings on exact Admin/CEO roles and appropriate permissions", () => {
    for (const permission of ["users.read", "roles.read", "company.read"])
      expect(source).toContain(`leadership permission="${permission}"`);
    expect(source).not.toContain("startLogin");
    expect(source).not.toContain("trpc");
  });
});

describe("private owner-provisioned administrator setup", () => {
  const token = "A".repeat(43); // Synthetic test input, never a provisioned capability.
  const password = "Synthetic test password only";
  const renderSetup = () =>
    renderToStaticMarkup(
      createElement(Router, {
        ssrPath: "/admin-setup",
        children: createElement(AdminSetupPage),
      })
    );
  const renderForm = () =>
    renderToStaticMarkup(
      createElement(AdminSetupForm, {
        token,
        email: "invited@example.invalid",
        onCreated: vi.fn(),
        onInvalid: vi.fn(),
      })
    );

  it.each(["", "short", "A".repeat(42), "A".repeat(44), "!".repeat(43)])(
    "rejects malformed private capabilities before any request (%s)",
    async value => {
      expect(isAdminSetupToken(value)).toBe(false);
      await expect(checkAdminSetup(value)).rejects.toThrow(
        INVALID_ADMIN_SETUP_LINK
      );
      await expect(
        createAdminPassword(value, "Test Name", password, password)
      ).rejects.toThrow(INVALID_ADMIN_SETUP_LINK);
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it("accepts only the specified base64url token shape", () => {
    expect(isAdminSetupToken(token)).toBe(true);
    expect(isAdminSetupToken("_-".repeat(21) + "A")).toBe(true);
  });
  it.each(["", " ", "x", "x".repeat(161)])(
    "validates the trimmed full name (%s)",
    async name => {
      expect(validateAdminSetup(name, password, password)).toBe(
        "Enter your full name using 2–160 characters."
      );
      await expect(
        createAdminPassword(token, name, password, password)
      ).rejects.toThrow("Enter your full name");
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([2, 160])("accepts a %s-character name", length => {
    expect(
      validateAdminSetup("x".repeat(length), password, password)
    ).toBeNull();
  });
  it.each([0, 11, 129])(
    "rejects a %s-character setup password before submission",
    async length => {
      const value = "x".repeat(length);
      await expect(
        createAdminPassword(token, "Test Name", value, value)
      ).rejects.toThrow("12–128");
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([12, 128])(
    "accepts matching %s-character setup passwords",
    length => {
      const value = "x".repeat(length);
      expect(validateAdminSetup("Test Name", value, value)).toBeNull();
    }
  );
  it("requires exact password confirmation and preserves spaces", async () => {
    await expect(
      createAdminPassword(token, "Test Name", password, `${password} `)
    ).rejects.toThrow("The passwords do not match.");
    expect(fetch).not.toHaveBeenCalled();
    expect(
      validateAdminSetup(" Test Name ", ` ${password} `, ` ${password} `)
    ).toBeNull();
  });
  it("checks the private capability via strict token-only POST, not GET", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ email: "invited@example.invalid" })
    );
    const controller = new AbortController();
    await expect(checkAdminSetup(token, controller.signal)).resolves.toEqual({
      email: "invited@example.invalid",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/admin-setup/check",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ token }),
        signal: controller.signal,
      })
    );
    expect(window.history.replaceState).not.toHaveBeenCalled();
    expect(authState.login).not.toHaveBeenCalled();
    expect(authState.refresh).not.toHaveBeenCalled();
  });
  it("does not accept an unexpected check response as a valid invitation", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ message: "Not a check DTO" }));
    await expect(checkAdminSetup(token)).rejects.toThrow(
      INVALID_ADMIN_SETUP_LINK
    );
  });
  it("renders a clear invalid-link message without exposing an email or creating an account", () => {
    const markup = renderSetup();
    expect(markup).toContain(INVALID_ADMIN_SETUP_LINK);
    expect(markup).not.toContain("Email address");
    expect(markup).not.toContain('name="password"');
    expect(markup).not.toContain("Create my password");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects ambiguous repeated token parameters", () => {
    window.location.search = `?token=${token}&token=${token}`;
    expect(renderSetup()).toContain(INVALID_ADMIN_SETUP_LINK);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows only the non-consuming check state on initial private-link rendering", () => {
    window.location.search = `?token=${token}`;
    const markup = renderSetup();
    expect(markup).toContain("Checking your private setup link");
    expect(markup).not.toContain(token);
    expect(markup).not.toContain("Email address");
    expect(markup).not.toContain('name="password"');
    expect(fetch).not.toHaveBeenCalled();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });
  it("limits the mount effect to check, never claim or login", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "admin-setup.tsx"),
      "utf8"
    );
    const effect = source.slice(
      source.indexOf("  useEffect(() => {"),
      source.indexOf("  }, [token, revision]);")
    );
    expect(effect).toContain("checkAdminSetup(token, controller.signal)");
    expect(effect).not.toContain("createAdminPassword");
    expect(effect).not.toContain('/auth/admin-setup"');
    expect(source).not.toContain("useAuth");
    expect(source).not.toContain("emailReady");
    expect(source).not.toContain("EmailSetupBanner");
  });
  it("renders readonly owner-assigned email and accessible exact-contract fields", () => {
    const markup = renderForm();
    expect(markup).toContain("Create my password");
    const emailInput = markup.match(/<input[^>]*type="email"[^>]*>/)?.[0];
    expect(emailInput).toContain('readOnly=""');
    expect(emailInput).toContain('value="invited@example.invalid"');
    expect(emailInput).not.toContain("name=");
    const nameInput = markup.match(/<input[^>]*name="fullName"[^>]*>/)?.[0];
    expect(nameInput).toContain('minLength="2"');
    expect(nameInput).toContain('maxLength="160"');
    for (const name of ["password", "confirmPassword"]) {
      const input = markup.match(
        new RegExp(`<input[^>]*name="${name}"[^>]*>`)
      )?.[0];
      expect(input).toContain('type="password"');
      expect(input).toContain('autoComplete="new-password"');
      expect(input).toContain('minLength="12"');
      expect(input).toContain('maxLength="128"');
      expect(input).toContain('required=""');
      const id = input?.match(/id="([^"]+)"/)?.[1];
      expect(markup).toContain(`for="${id}"`);
    }
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).not.toContain('name="token"');
    expect(markup).not.toContain('name="roles"');
    expect(markup).not.toContain("Requested role");
    expect(markup).not.toContain(token);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false, null])(
    "does not depend on email-provider availability (%s)",
    readiness => {
      authState.emailReady = readiness;
      const markup = renderForm();
      const button = markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0];
      expect(button).toBeTruthy();
      expect(button).not.toContain("disabled");
      expect(markup).not.toContain("Test email setup warning");
    }
  );
  it("claims only token, trimmed fullName, and exact password, clears URL, and never auto-signs-in", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ message: "Password created. Sign in to continue." })
    );
    const chosen = ` ${password} `;
    await expect(
      createAdminPassword(token, " Test Name ", chosen, chosen)
    ).resolves.toEqual({ message: "Password created. Sign in to continue." });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/admin-setup",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          token,
          fullName: "Test Name",
          password: chosen,
        }),
      })
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(Object.keys(body).sort()).toEqual(["fullName", "password", "token"]);
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("roles");
    expect(body).not.toHaveProperty("confirmPassword");
    expect(window.history.replaceState).toHaveBeenCalledTimes(1);
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/admin-setup"
    );
    expect(authState.login).not.toHaveBeenCalled();
    expect(authState.refresh).not.toHaveBeenCalled();
  });
  it("does not remove the link or claim success before the explicit claim completes", async () => {
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise(resolve => {
        complete = resolve;
      })
    );
    const claim = createAdminPassword(token, "Test Name", password, password);
    expect(window.history.replaceState).not.toHaveBeenCalled();
    complete(json({ message: "Password created" }));
    await claim;
    expect(window.history.replaceState).toHaveBeenCalledTimes(1);
  });
  it.each([400, 409, 410])(
    "preserves rejected private-link errors (%s) without claiming success",
    async status => {
      vi.mocked(fetch).mockResolvedValue(
        json({ message: "This link is invalid or expired" }, status)
      );
      await expect(
        createAdminPassword(token, "Test Name", password, password)
      ).rejects.toThrow("This link is invalid or expired");
      expect(window.history.replaceState).not.toHaveBeenCalled();
      expect(authState.login).not.toHaveBeenCalled();
    }
  );
  it("never persists or logs private credentials", async () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    Object.assign(window, { localStorage: storage, sessionStorage: storage });
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    try {
      window.location.search = `?token=${token}`;
      renderSetup();
      renderForm();
      vi.mocked(fetch)
        .mockResolvedValueOnce(json({ email: "invited@example.invalid" }))
        .mockResolvedValueOnce(json({ message: "Password created" }));
      await checkAdminSetup(token);
      await createAdminPassword(token, "Test Name", password, password);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem).not.toHaveBeenCalled();
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
        expect(JSON.stringify(spy.mock.calls)).not.toContain(password);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("owner-authorized access remains separate from email verification", () => {
  const ownerProvisioned = (overrides: Partial<User> = {}) =>
    fixture({
      emailVerified: false,
      accessAuthorized: true,
      accessMethod: "OWNER_PROVISIONED",
      roles: ["admin"],
      permissions: ["users.read", "users.manage", "users.approve"],
      ...overrides,
    });
  it("grants active owner-provisioned users only their effective permissions", () => {
    const user = ownerProvisioned();
    expect(user.emailVerified).toBe(false);
    expect(hasAccessProof(user)).toBe(true);
    expect(isActive(user)).toBe(true);
    expect(hasPermission(user, "users.manage")).toBe(true);
    expect(hasPermission(user, "customers.archive")).toBe(false);
    expect(isLeadership(user)).toBe(true);
    expect(accessMethodLabel(user)).toBe("Owner-provisioned");
  });
  it.each(["UNVERIFIED", "PENDING_APPROVAL", "SUSPENDED", "REJECTED"] as const)(
    "denies %s accounts even with owner authorization",
    status => {
      const user = ownerProvisioned({ status });
      expect(isActive(user)).toBe(false);
      expect(hasPermission(user, "users.manage")).toBe(false);
    }
  );
  it("never treats an access-method label, role, or truthy nonboolean value as proof", () => {
    expect(isActive(ownerProvisioned({ accessAuthorized: false }))).toBe(false);
    expect(isActive(ownerProvisioned({ accessAuthorized: undefined }))).toBe(
      false
    );
    expect(
      isActive(
        ownerProvisioned({ accessAuthorized: "true" as unknown as boolean })
      )
    ).toBe(false);
    expect(isActive(null)).toBe(false);
    expect(isActive(undefined)).toBe(false);
    expect(isActive(fixture())).toBe(true);
  });
  it("the actual page gate retains active-status and permission/leadership checks", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "session.tsx"),
      "utf8"
    );
    expect(source).toContain(
      "if (!isActive(auth.user)) return <AccountStatus />;"
    );
    expect(source).toContain("!auth.user.permissions.includes(permission)");
    expect(source).toContain("!isLeadership(auth.user)");
  });
  it("profile truthfully shows owner provisioning and unverified email separately", () => {
    authState.user = ownerProvisioned();
    const markup = renderToStaticMarkup(
      createElement(Router, {
        ssrPath: "/profile",
        children: createElement(Profile),
      })
    );
    expect(markup).toContain("Email ownership");
    expect(markup).toContain("Not verified");
    expect(markup).toContain("Access authorization");
    expect(markup).toContain("Owner-provisioned");
    expect(markup).not.toContain("Email verified");
  });
  it("user management permits active owner-authorized accounts without requiring email proof", () => {
    authState.user = ownerProvisioned();
    const markup = renderToStaticMarkup(
      createElement(UserModal, {
        account: ownerProvisioned({ id: "other-test-user" }),
        onClose: vi.fn(),
        onSaved: vi.fn(),
      })
    );
    const active = markup.match(/<option[^>]*value="ACTIVE"[^>]*>/)?.[0];
    expect(active).toBeTruthy();
    expect(active).not.toContain("disabled");
    expect(markup).not.toContain("This account has no access authorization.");
  });
  it("user management still disables activation without any proof", () => {
    authState.user = ownerProvisioned();
    const markup = renderToStaticMarkup(
      createElement(UserModal, {
        account: fixture({ id: "other-test-user", emailVerified: false }),
        onClose: vi.fn(),
        onSaved: vi.fn(),
      })
    );
    expect(markup.match(/<option[^>]*value="ACTIVE"[^>]*>/)?.[0]).toContain(
      'disabled=""'
    );
    expect(markup).toContain("This account has no access authorization.");
  });
  it.each([false, null])(
    "normal password login stays enabled with email availability %s",
    readiness => {
      authState.emailReady = readiness;
      const markup = renderToStaticMarkup(
        createElement(Router, {
          ssrPath: "/login",
          children: createElement(AuthPage, { mode: "login" }),
        })
      );
      expect(
        markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0]
      ).not.toContain("disabled");
      expect(markup).not.toContain("Test email setup warning");
      expect(markup).toContain(
        "Invited administrators can sign in with their password."
      );
    }
  );
  it.each(["register", "forgot"] as const)(
    "retains the email warning and readiness block for %s",
    mode => {
      authState.emailReady = false;
      const markup = renderToStaticMarkup(
        createElement(Router, {
          ssrPath: mode === "register" ? "/register" : "/forgot-password",
          children: createElement(AuthPage, { mode }),
        })
      );
      expect(markup).toContain("Test email setup warning");
      expect(markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain(
        'disabled=""'
      );
    }
  );
  it("the setup route is public-to-the-form and has no embedded capability or access gate", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../App.tsx"),
      "utf8"
    );
    const route = source.match(
      /<Route path="\/admin-setup">[\s\S]*?<\/Route>/
    )?.[0];
    expect(route).toContain("<AdminSetupPage />");
    expect(route).not.toContain("ProtectedPage");
    expect(route).not.toContain("Gate");
    const manifest = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../public/manus-routes.json"),
      "utf8"
    );
    expect(manifest).toContain('"path": "/admin-setup"');
    expect(manifest).not.toContain("token=");
  });
});
