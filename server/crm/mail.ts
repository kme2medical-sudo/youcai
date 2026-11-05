export interface TransactionalMail { to: string; subject: string; text: string; }
export type MailTransport = (message: TransactionalMail) => Promise<void>;
let testTransport: MailTransport | undefined;
export function setTestMailTransport(transport?: MailTransport): void { if (process.env.NODE_ENV === "production") throw new Error("Test mail transport is forbidden in production"); testTransport = transport; }
export function emailReady(): boolean {
  if (testTransport && process.env.NODE_ENV !== "production") return true;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.APP_PUBLIC_URL) return false;
  try { const url = new URL(process.env.APP_PUBLIC_URL); return url.protocol === "https:" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.EMAIL_FROM.replace(/^.*<([^>]+)>$/, "$1")); } catch { return false; }
}
export async function sendAccountMail(to: string, purpose: "VERIFY" | "RESET", token: string): Promise<void> {
  if (!emailReady()) throw new Error("Email delivery is not configured");
  const base = process.env.APP_PUBLIC_URL || "https://test.invalid";
  const url = new URL(purpose === "VERIFY" ? "/verify-email" : "/reset-password", base);
  url.searchParams.set("token", token);
  const message: TransactionalMail = { to, subject: purpose === "VERIFY" ? "Verify your Youcai account" : "Reset your Youcai password", text: `${purpose === "VERIFY" ? "Confirm ownership of your email" : "Choose a new password"} by opening this link:\n${url.toString()}\n\nThis link expires ${purpose === "VERIFY" ? "in 24 hours" : "in 30 minutes"}. If you did not request it, ignore this email.` };
  if (testTransport && process.env.NODE_ENV !== "production") return testTransport(message);
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, ...message }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Email delivery failed");
  // Never print provider bodies, passwords, mail URLs, or account tokens.
}
