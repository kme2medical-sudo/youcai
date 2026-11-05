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
  requiresLegalName,
  type User,
} from "./types";
import { Button, Field, safeWebsite, formatDate } from "./ui";
import { AuthPage, validatePasswordConfirmation, verifyEmail } from "./auth";

const authState = vi.hoisted(() => ({
  user: null,
  loading: false,
  error: null,
  emailReady: true as boolean | null,
  refresh: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./session", () => ({
  useAuth: () => authState,
  EmailSetupBanner: () => null,
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
