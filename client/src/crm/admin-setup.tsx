import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError } from "./api";
import { AuthShell, validatePasswordConfirmation } from "./auth";
import { Button, Field, Loading, Notice } from "./ui";

export const INVALID_ADMIN_SETUP_LINK =
  "This private setup link is invalid, expired, or already used. Ask the workspace owner for a new link.";

export function isAdminSetupToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function validateAdminSetup(
  fullName: string,
  password: string,
  confirmPassword: string
): string | null {
  const name = fullName.trim();
  if (name.length < 2 || name.length > 160)
    return "Enter your full name using 2–160 characters.";
  return validatePasswordConfirmation(password, confirmPassword);
}

// This non-consuming check may run on mount; it never creates an account/session.
export async function checkAdminSetup(token: string, signal?: AbortSignal) {
  if (!isAdminSetupToken(token)) throw new Error(INVALID_ADMIN_SETUP_LINK);
  const result = await api<{ email: string }>("/auth/admin-setup/check", {
    method: "POST",
    body: { token },
    signal,
  });
  if (typeof result?.email !== "string" || !result.email)
    throw new Error(INVALID_ADMIN_SETUP_LINK);
  return { email: result.email };
}

// Only the form's explicit submit handler calls this single-use claim.
export async function createAdminPassword(
  token: string,
  fullName: string,
  password: string,
  confirmPassword: string
) {
  if (!isAdminSetupToken(token)) throw new Error(INVALID_ADMIN_SETUP_LINK);
  const validationError = validateAdminSetup(
    fullName,
    password,
    confirmPassword
  );
  if (validationError) throw new Error(validationError);
  const result = await api<{ message: string }>("/auth/admin-setup", {
    method: "POST",
    body: { token, fullName: fullName.trim(), password },
  });
  window.history.replaceState(null, "", "/admin-setup");
  return result;
}

function invalidLinkError(error: unknown) {
  return (
    error instanceof ApiError &&
    [400, 401, 403, 404, 409, 410, 422].includes(error.status)
  );
}

export function AdminSetupForm({
  token,
  email,
  onCreated,
  onInvalid,
}: {
  token: string;
  email: string;
  onCreated: (message: string) => void;
  onInvalid: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    const validationError = validateAdminSetup(
      fullName,
      password,
      confirmPassword
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await createAdminPassword(
        token,
        fullName,
        password,
        confirmPassword
      );
      setPassword("");
      setConfirmPassword("");
      onCreated(result.message);
    } catch (e) {
      setPassword("");
      setConfirmPassword("");
      if (invalidLinkError(e)) onInvalid();
      else
        setError(
          "Your password could not be created. Try again or contact the workspace owner."
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="auth-form">
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Full name" required>
        <input
          name="fullName"
          autoComplete="name"
          required
          minLength={2}
          maxLength={160}
          disabled={busy}
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          placeholder="Your full name"
        />
      </Field>
      <Field
        label="Email address"
        hint="Assigned by the workspace owner. This address cannot be changed here."
      >
        <div className="input-icon">
          <Mail size={17} />
          <input type="email" autoComplete="username" readOnly value={email} />
        </div>
      </Field>
      <Field
        label="Password"
        required
        hint="Use a unique password of 12–128 characters."
      >
        <div className="password-input">
          <LockKeyhole size={17} />
          <input
            type={visible ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Create a strong password"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => setVisible(v => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
          >
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </Field>
      <Field label="Confirm password" required>
        <input
          type={visible ? "text" : "password"}
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          disabled={busy}
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          placeholder="Enter your password again"
        />
      </Field>
      <div className="auth-approval-note">
        <ShieldCheck size={18} />
        <span>
          Your administrator access is authorized by the workspace owner. No
          verification email or approval request is needed. This private link
          expires after 24 hours and can only be used once.
        </span>
      </div>
      <Button type="submit" busy={busy} className="auth-submit">
        Create my password
        <ArrowRight size={17} />
      </Button>
    </form>
  );
}

export function AdminSetupPage() {
  const [token, setToken] = useState(() => {
    const values = new URLSearchParams(window.location.search).getAll("token");
    return values.length === 1 ? values[0] : "";
  });
  const [email, setEmail] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "checking" | "ready" | "invalid" | "error" | "done"
  >(() => (isAdminSetupToken(token) ? "checking" : "invalid"));
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!isAdminSetupToken(token)) return;
    const controller = new AbortController();
    setPhase("checking");
    setEmail(null);
    void checkAdminSetup(token, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setEmail(result.email);
        setPhase("ready");
      })
      .catch(e => {
        if (controller.signal.aborted) return;
        setEmail(null);
        setPhase(
          invalidLinkError(e) || !(e instanceof ApiError) ? "invalid" : "error"
        );
      });
    return () => controller.abort();
  }, [token, revision]);

  return (
    <AuthShell mode="admin-setup">
      <div className="auth-form-inner">
        <div className="eyebrow">PRIVATE ADMINISTRATOR SETUP</div>
        <h1>
          {phase === "done"
            ? "Your account is ready."
            : "Make your access yours."}
        </h1>
        <p className="auth-description">
          {phase === "done"
            ? "Your administrator account is active. Sign in with your assigned email and the password you just created."
            : "Choose your name and personal password to complete your owner-authorized administrator setup."}
        </p>
        {phase === "checking" && (
          <Loading label="Checking your private setup link…" />
        )}
        {phase === "invalid" && (
          <Notice tone="error">{INVALID_ADMIN_SETUP_LINK}</Notice>
        )}
        {phase === "error" && (
          <>
            <Notice tone="error">
              We couldn’t check this setup link. Try again or contact the
              workspace owner.
            </Notice>
            <Button
              variant="secondary"
              onClick={() => setRevision(value => value + 1)}
            >
              Try again
            </Button>
          </>
        )}
        {phase === "ready" && email && (
          <AdminSetupForm
            token={token}
            email={email}
            onCreated={resultMessage => {
              setToken("");
              setEmail(null);
              setMessage(resultMessage);
              setPhase("done");
            }}
            onInvalid={() => {
              setEmail(null);
              setPhase("invalid");
            }}
          />
        )}
        {phase === "done" && (
          <div className="auth-success-actions">
            <Notice tone="success" title="Password created">
              {message}
            </Notice>
            <Link href="/login" className="btn btn-primary">
              Sign in <ArrowRight size={17} />
            </Link>
          </div>
        )}
        {phase !== "done" && (
          <div className="auth-alternate">
            Already set up your account? <Link href="/login">Sign in</Link>
          </div>
        )}
        <div className="auth-secure">
          <LockKeyhole size={13} />
          Application-owned sign-in · Owner-authorized access
        </div>
      </div>
    </AuthShell>
  );
}
