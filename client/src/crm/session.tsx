import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Redirect, useLocation } from "wouter";
import { api, setCsrfToken } from "./api";
import {
  hasAccessProof,
  isActive,
  isLeadership,
  type Session,
  type User,
} from "./types";
import { Button, ErrorState, Loading, Notice } from "./ui";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  emailReady: boolean | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    try {
      const session = await api<Session>("/auth/me");
      if (id === generation.current) {
        setUser(session.user);
        setCsrfToken(session.csrfToken);
        setError(null);
      }
    } catch (e) {
      if (id === generation.current) {
        setUser(null);
        setCsrfToken();
        setError((e as Error).message);
      }
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    api<{ emailReady: boolean }>("/auth/config")
      .then(c => setEmailReady(c.emailReady))
      .catch(() => setEmailReady(null));
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("youcai:session-refresh", onFocus);
    const interval = window.setInterval(onFocus, 60000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("youcai:session-refresh", onFocus);
      window.clearInterval(interval);
      generation.current++;
    };
  }, [refresh]);
  const login = async (email: string, password: string) => {
    const session = await api<Session>("/auth/login", {
      method: "POST",
      body: { email: email.trim().toLowerCase(), password },
    });
    generation.current++;
    setUser(session.user);
    setCsrfToken(session.csrfToken);
    setError(null);
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    generation.current++;
    setUser(null);
    setCsrfToken();
    setError(null);
  };
  return (
    <AuthContext.Provider
      value={{ user, loading, error, emailReady, refresh, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider is required");
  return ctx;
}
export function EmailSetupBanner() {
  const { emailReady } = useAuth();
  return emailReady === false ? (
    <Notice tone="warning" title="Email delivery is not configured">
      Verification and password-reset emails cannot be sent yet. An
      administrator must configure the email provider and verified sender for
      registration and email-based recovery. Existing password sign-in and
      private administrator setup do not require email delivery.
    </Notice>
  ) : emailReady === null ? (
    <Notice>
      Email service availability has not been confirmed. If delivery is
      unavailable, contact your administrator.
    </Notice>
  ) : null;
}
export function Gate({
  children,
  permission,
  leadership = false,
}: {
  children: ReactNode;
  permission?: string;
  leadership?: boolean;
}) {
  const auth = useAuth();
  const [location] = useLocation();
  if (auth.loading) return <Loading />;
  if (auth.error)
    return <ErrorState error={auth.error} retry={() => void auth.refresh()} />;
  if (!auth.user) return <Redirect to="/login" />;
  if (!isActive(auth.user)) return <AccountStatus />;
  if (
    (permission && !auth.user.permissions.includes(permission)) ||
    (leadership && !isLeadership(auth.user))
  )
    return (
      <div className="access-state">
        <Notice tone="warning" title="You don’t have access to this page">
          Your current roles do not allow this action. Contact an administrator
          if your responsibilities have changed.
        </Notice>
        <Button
          variant="secondary"
          onClick={() => {
            window.location.href = "/";
          }}
        >
          Return to dashboard
        </Button>
      </div>
    );
  return (
    <div key={auth.user.id} data-page={location}>
      {children}
    </div>
  );
}
export function AccountStatus() {
  const { user, logout, refresh, emailReady } = useAuth();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!user) return <Redirect to="/login" />;
  const restricted = user.status === "SUSPENDED" || user.status === "REJECTED";
  const unverified = !restricted && !hasAccessProof(user);
  const title = unverified
    ? "Verify your email address"
    : user.status === "PENDING_APPROVAL"
      ? "Your access request is under review"
      : user.status === "SUSPENDED"
        ? "Your account is suspended"
        : user.status === "REJECTED"
          ? "Your access request was not approved"
          : "Your account is not active";
  const description = unverified
    ? "Confirm ownership of your email before your access request can be reviewed."
    : user.status === "PENDING_APPROVAL"
      ? "An Admin or CEO needs to approve your account and assign your roles. Business modules are unavailable until then."
      : "Business modules are unavailable for this account. Please contact your administrator for assistance.";
  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ message: string }>("/auth/resend", {
        method: "POST",
        body: { email: user!.email },
      });
      setMessage(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-status">
      <div className="eyebrow">Account access</div>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="account-identity">
        <strong>{user.fullName}</strong>
        <span>{user.email}</span>
      </div>
      {unverified && <EmailSetupBanner />}
      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="button-row">
        {unverified && (
          <Button busy={busy} disabled={emailReady === false} onClick={resend}>
            Resend verification email
          </Button>
        )}
        <Button variant="secondary" onClick={() => void refresh()}>
          Check account status
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await logout();
              navigate("/login");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
