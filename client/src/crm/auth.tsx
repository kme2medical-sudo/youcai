import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Redirect, useLocation } from "wouter";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "./api";
import { Brand } from "./layout";
import { EmailSetupBanner, useAuth, AccountStatus } from "./session";
import { isActive, ROLES } from "./types";
import { Button, Field, Loading, Notice } from "./ui";

type AuthMode = "login" | "register" | "verify" | "forgot" | "reset";
export function validatePasswordConfirmation(
  password: string,
  confirmPassword: string
): string | null {
  if (password.length < 12 || password.length > 128)
    return "Choose a password of 12–128 characters.";
  if (password !== confirmPassword) return "The passwords do not match.";
  return null;
}

// Called only on explicit form submission, never while mounting a token link.
export async function verifyEmail(token: string, password: string) {
  const result = await api<{ message: string }>("/auth/verify", {
    method: "POST",
    body: { token, password },
  });
  // Remove the bearer token before any subsequent session refresh can fail.
  window.history.replaceState(null, "", "/verify-email");
  return result;
}

const copy: Record<
  AuthMode,
  { eyebrow: string; title: string; description: string }
> = {
  login: {
    eyebrow: "YOUR CRM WORKSPACE",
    title: "Good to have you back.",
    description:
      "Sign in to manage the relationships that move your business forward.",
  },
  register: {
    eyebrow: "JOIN THE WORKSPACE",
    title: "Request your access.",
    description:
      "Create an account, verify your email, and request the role that matches your work.",
  },
  verify: {
    eyebrow: "EMAIL VERIFICATION",
    title: "Confirm it’s you.",
    description:
      "Verify ownership of your email address to continue your access request.",
  },
  forgot: {
    eyebrow: "ACCOUNT RECOVERY",
    title: "Let’s reset your password.",
    description:
      "Enter your account email. If eligible, you’ll receive a secure password-reset link.",
  },
  reset: {
    eyebrow: "A FRESH START",
    title: "Choose a new password.",
    description:
      "Use a strong, unique password that you haven’t used elsewhere.",
  },
};
export function AuthPage({ mode }: { mode: AuthMode }) {
  const auth = useAuth();
  const [, navigate] = useLocation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [requestedRole, setRequestedRole] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get("token") ?? ""
  );
  useEffect(() => {
    setPassword("");
    setConfirm("");
    setMessage(null);
    setError(null);
    setDone(false);
  }, [mode]);
  const recovery = mode === "forgot" || mode === "reset" || mode === "verify";
  const emailRequired =
    mode === "login" ||
    mode === "register" ||
    mode === "forgot" ||
    (mode === "verify" && !token);
  const passwordRequired =
    mode === "login" ||
    mode === "register" ||
    mode === "reset" ||
    (mode === "verify" && !!token);
  const confirmationRequired =
    mode === "register" || mode === "reset" || (mode === "verify" && !!token);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setMessage(null);
    if (confirmationRequired) {
      const validationError = validatePasswordConfirmation(password, confirm);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await auth.login(email, password);
        setPassword("");
        navigate("/");
      } else {
        const path =
          mode === "register"
            ? "/auth/register"
            : mode === "forgot"
              ? "/auth/forgot"
              : mode === "reset"
                ? "/auth/reset"
                : "/auth/resend";
        const body =
          mode === "register"
            ? {
                fullName: fullName.trim(),
                email: email.trim().toLowerCase(),
                password,
                requestedRole,
              }
            : mode === "reset"
              ? { token, password }
              : { email: email.trim().toLowerCase() };
        const result =
          mode === "verify" && token
            ? await verifyEmail(token, password)
            : await api<{ message: string }>(path, {
                method: "POST",
                body,
              });
        setMessage(result.message);
        setPassword("");
        setConfirm("");
        setDone(true);
        if (mode === "verify" && token) {
          await auth.refresh();
        }
        if (mode === "reset")
          window.history.replaceState(null, "", "/reset-password");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (auth.loading)
    return (
      <div className="auth-loading">
        <Brand />
        <Loading label="Checking your session…" />
      </div>
    );
  if (!recovery && isActive(auth.user)) return <Redirect to="/" />;
  if (!recovery && auth.user && !isActive(auth.user))
    return (
      <AuthShell mode={mode}>
        <AccountStatus />
      </AuthShell>
    );
  const cfg = copy[mode];
  return (
    <AuthShell mode={mode}>
      <div className="auth-form-inner">
        <div className="eyebrow">{cfg.eyebrow}</div>
        <h1>{cfg.title}</h1>
        <p className="auth-description">
          {mode === "verify" && token
            ? "Confirm your email and secure your account. Choose the password you will use to sign in; this replaces any password entered before verification."
            : cfg.description}
        </p>
        <EmailSetupBanner />
        {auth.error && (
          <Notice tone="warning">
            The current session could not be checked. You can still try signing
            in.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {message && (
          <Notice
            tone="success"
            title={
              mode === "register"
                ? "Access request received"
                : mode === "reset"
                  ? "Password updated"
                  : mode === "verify" && token
                    ? "Email confirmed"
                    : "Check your inbox"
            }
          >
            {message}
          </Notice>
        )}
        {done ? (
          <div className="auth-success-actions">
            {mode === "register" && (
              <p>
                Verify your email and confirm your personal password. Authorized
                initial administrators are activated automatically; other accounts
                wait for Admin or CEO approval. A requested role alone grants no access.
              </p>
            )}
            <Link href="/login" className="btn btn-primary">
              {mode === "verify" && auth.user
                ? "Check my account"
                : "Back to sign in"}
              <ArrowRight size={17} />
            </Link>
            {mode === "verify" && auth.user && (
              <Link href="/" className="text-link">
                View account status
              </Link>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="auth-form">
            {mode === "register" && (
              <Field label="Full name" required>
                <input
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={160}
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Your full name"
                />
              </Field>
            )}
            {emailRequired && (
              <Field label="Email address" required>
                <div className="input-icon">
                  <Mail size={17} />
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="name@company.com"
                  />
                </div>
              </Field>
            )}
            {passwordRequired && (
              <Field
                label={mode === "reset" ? "New password" : "Password"}
                required
                hint={
                  mode === "login"
                    ? undefined
                    : "At least 12 characters. Use a unique password."
                }
              >
                <div className="password-input">
                  <LockKeyhole size={17} />
                  <input
                    type={visible ? "text" : "password"}
                    name="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    required
                    minLength={mode === "login" ? undefined : 12}
                    maxLength={128}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={
                      mode === "login"
                        ? "Enter your password"
                        : "Create a strong password"
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setVisible(v => !v)}
                    aria-label={visible ? "Hide password" : "Show password"}
                    aria-pressed={visible}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </Field>
            )}
            {confirmationRequired && (
              <Field label="Confirm password" required>
                <input
                  type={visible ? "text" : "password"}
                  name="confirmPassword"
                  required
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Enter your password again"
                />
              </Field>
            )}
            {mode === "register" && (
              <Field
                label="Requested role"
                required
                hint="A request only, not a grant. Verified initial administrators are assigned Admin automatically."
              >
                <select
                  required
                  value={requestedRole}
                  onChange={e => setRequestedRole(e.target.value)}
                >
                  <option value="">Select the role you need</option>
                  {ROLES.map(r => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {mode === "login" && (
              <div className="auth-forgot">
                <Link href="/forgot-password">Forgot password?</Link>
              </div>
            )}
            {mode === "register" && (
              <div className="auth-approval-note">
                <ShieldCheck size={18} />
                <span>
                  Email verification is required. Authorized initial administrators
                  become active automatically; all other accounts need approval.
                </span>
              </div>
            )}
            {mode === "reset" && !token ? (
              <Notice tone="warning">
                This page needs a valid reset link. Request a new link below.
              </Notice>
            ) : (
              <Button
                type="submit"
                busy={busy}
                className="auth-submit"
                disabled={
                  (mode === "register" ||
                    mode === "forgot" ||
                    (mode === "verify" && !token)) &&
                  auth.emailReady === false
                }
              >
                {mode === "login"
                  ? "Sign in to workspace"
                  : mode === "register"
                    ? "Request access"
                    : mode === "forgot"
                      ? "Send reset link"
                      : mode === "reset"
                        ? "Update password"
                        : token
                          ? "Confirm email and secure account"
                          : "Resend verification email"}
                <ArrowRight size={17} />
              </Button>
            )}
          </form>
        )}
        <div className="auth-alternate">
          {mode === "login" ? (
            <>
              New to Youcai? <Link href="/register">Request access</Link>
            </>
          ) : mode === "reset" && !token ? (
            <Link href="/forgot-password">Request a new reset link</Link>
          ) : (
            <>
              Already have an account? <Link href="/login">Sign in</Link>
            </>
          )}
        </div>
        {mode === "login" && (
          <Link className="auth-verify-link" href="/verify-email">
            Need to verify your email?
          </Link>
        )}
        <div className="auth-secure">
          <LockKeyhole size={13} />
          Application-owned sign-in · Approval-based access
        </div>
      </div>
    </AuthShell>
  );
}
function AuthShell({
  children,
  mode,
}: {
  children: ReactNode;
  mode: AuthMode;
}) {
  return (
    <div className={`auth-shell auth-${mode}`}>
      <aside className="auth-story">
        <Brand light />
        <div className="auth-story-content">
          <div className="auth-story-kicker">
            <span />
            CRM FOUNDATION · V1
          </div>
          <h2>
            Better relationships.
            <br />
            <em>Clearer operations.</em>
          </h2>
          <p>
            One focused workspace for your team, your customers, and the details
            that matter.
          </p>
          <div className="auth-story-features">
            <div>
              <span>
                <Users size={21} />
              </span>
              <section>
                <h3>Relationships, organized</h3>
                <p>Customer records and contacts, in one place.</p>
              </section>
            </div>
            <div>
              <span>
                <ShieldCheck size={21} />
              </span>
              <section>
                <h3>The right access, for every role</h3>
                <p>Verified accounts. Approved access. Clear accountability.</p>
              </section>
            </div>
          </div>
          <div className="auth-scope">
            <span className="scope-line" />
            <span>
              Built for the work you do.
              <br />
              <strong>Ready for what comes next.</strong>
            </span>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>YOUCAI MEDICAL</span>
          <span>CRM & ERP · Foundation</span>
        </div>
      </aside>
      <main className="auth-form-side">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-top-label">
          <span>TEAM WORKSPACE</span>
          <span>
            <ShieldCheck size={14} />
            Controlled access
          </span>
        </div>
        {children}
        <footer className="auth-form-footer">
          Customer relationships. Connected teams. Youcai.
        </footer>
      </main>
    </div>
  );
}
