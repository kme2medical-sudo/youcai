export interface TransactionalMail { to: string; subject: string; text: string; }
export type MailTransport = (message: TransactionalMail) => Promise<void>;
let testTransport: MailTransport | undefined;
export function setTestMailTransport(transport?: MailTransport): void {
  if (process.env.NODE_ENV === "production") throw new Error("Test mail transport is forbidden in production");
  testTransport = transport;
}
interface MailConfiguration { apiKey: string; from: string; origin: string; }
function configuration(): MailConfiguration | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const publicUrl = process.env.APP_PUBLIC_URL?.trim();
  if (!apiKey || !from || !publicUrl || /\s/.test(apiKey) || apiKey === "RESEND_API_KEY") return null;
  if (/[\r\n]/.test(from)) return null;
  const address = from.replace(/^.*<([^>]+)>$/, "$1");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) return null;
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return { apiKey, from, origin: url.origin };
  } catch { return null; }
}
export function emailReady(): boolean {
  if (testTransport && process.env.NODE_ENV !== "production") return true;
  // Shape readiness only: provider authorization, sender ownership and inbox delivery need real evidence.
  return configuration() !== null;
}
export async function sendAccountMail(to: string, purpose: "VERIFY" | "RESET", token: string): Promise<void> {
  const testing = !!testTransport && process.env.NODE_ENV !== "production";
  const config = configuration();
  if (!testing && !config) throw new Error("Email delivery is not configured");
  const url = new URL(purpose === "VERIFY" ? "/verify-email" : "/reset-password", config?.origin || "https://test.invalid");
  url.searchParams.set("token", token);
  const message: TransactionalMail = {
    to,
    subject: purpose === "VERIFY" ? "Verify your Youcai account" : "Reset your Youcai password",
    text: `${purpose === "VERIFY" ? "Confirm ownership of your email and confirm your personal sign-in password on the secure form" : "Choose a new password"} by opening this link:\n${url.toString()}\n\nThis link expires ${purpose === "VERIFY" ? "in 24 hours" : "in 30 minutes"}. If you did not request it, ignore this email.`,
  };
  if (testing) return testTransport!(message);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config!.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config!.from, ...message }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Email delivery failed");
  // Never print provider bodies, passwords, mail URLs, or account tokens. No Alibaba connection is used.
}
