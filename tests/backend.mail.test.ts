import { describe, it, expect, afterEach, vi } from "vitest";
import { emailReady, sendAccountMail, setTestMailTransport } from "../server/crm/mail";

function configured() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "re_synthetic_unit_test_not_a_live_credential");
  vi.stubEnv("EMAIL_FROM", "Youcai CRM <no-reply@auth.example.org>");
  vi.stubEnv("APP_PUBLIC_URL", "https://youcai-usq7zhae.manus.space");
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setTestMailTransport(undefined);
});
describe("email configuration and independent sending domain", () => {
  it("accepts a separate verified-format sender without corporate DNS assumptions", () => {
    configured();
    expect(emailReady()).toBe(true);
    vi.stubEnv("APP_PUBLIC_URL", " https://youcai-usq7zhae.manus.space/ ");
    expect(emailReady()).toBe(true);
  });
  it("rejects credentials, path, query, fragment and non-HTTPS account-link origins", () => {
    configured();
    for (const url of ["http://example.org", "https://user:password@example.org", "https://example.org/admin", "https://example.org/?token=unsafe", "https://example.org/#unsafe", "APP_PUBLIC_URL", "not a url"]) {
      vi.stubEnv("APP_PUBLIC_URL", url);
      expect(emailReady()).toBe(false);
    }
  });
  it("rejects empty, placeholder and header-injection settings", () => {
    configured();
    for (const key of ["", "  ", "RESEND_API_KEY", "not a valid key"]) {
      vi.stubEnv("RESEND_API_KEY", key);
      expect(emailReady()).toBe(false);
    }
    vi.stubEnv("RESEND_API_KEY", "re_synthetic_unit_test_not_a_live_credential");
    for (const sender of ["EMAIL_FROM", "no-reply", "Name <bad address@example.org>", "sender@example.org\r\nBcc: attacker@example.org"]) {
      vi.stubEnv("EMAIL_FROM", sender);
      expect(emailReady()).toBe(false);
    }
  });
  it("sends verification to Alibaba-hosted and Gmail recipients independently of the sender domain", async () => {
    configured();
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetcher);
    for (const recipient of ["alberto@youcaimedical.com", "eniodeleon87@gmail.com", "eadlr1@gmail.com", "kme2medical@gmail.com", "wangxukai@youcaimedical.com"]) {
      await sendAccountMail(recipient, "VERIFY", "synthetic_test_token");
      const call = fetcher.mock.calls.at(-1)!;
      const body = JSON.parse(call[1].body);
      expect(call[0]).toBe("https://api.resend.com/emails");
      expect(body.from).toBe("Youcai CRM <no-reply@auth.example.org>");
      expect(body.to).toBe(recipient);
      expect(body.text).toContain("https://youcai-usq7zhae.manus.space/verify-email?token=synthetic_test_token");
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("uses the same separate sender for reset and returns no token/provider details", async () => {
    configured();
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetcher);
    await expect(sendAccountMail("kme2medical@gmail.com", "RESET", "synthetic_test_token")).resolves.toBeUndefined();
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.text).toContain("/reset-password?token=synthetic_test_token");
    fetcher.mockResolvedValue({ ok: false, privateProviderBody: "not exposed" });
    await expect(sendAccountMail("kme2medical@gmail.com", "VERIFY", "synthetic_test_token")).rejects.toThrow("Email delivery failed");
  });
});
