import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ArrowUpRight,
  Building2,
  ChevronDown,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth, EmailSetupBanner } from "./session";
import { hasPermission, isActive, isLeadership, roleName } from "./types";
import { Button } from "./ui";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${light ? "brand-light" : ""}`}
      aria-label="Youcai Medical home"
    >
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 38 42" fill="none">
          <path
            d="M3 3h10l6 11L25 3h10L23 25v14h-8V25L3 3Z"
            fill="currentColor"
          />
          <path d="m13 3 6 11 6-11" stroke="currentColor" strokeWidth="1" />
        </svg>
      </span>
      <span className="brand-text">
        YOUCAI<small>MEDICAL</small>
      </span>
    </Link>
  );
}
export function Layout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const active = isActive(user);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    setOpen(false);
    setProfileOpen(false);
  }, [location]);
  useEffect(() => {
    if (!open || !mobile || !active) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current
      ?.querySelector<HTMLElement>("a, button:not(:disabled)")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        const focusable = Array.from(
          sidebarRef.current?.querySelectorAll<HTMLElement>(
            "a[href], button:not(:disabled)"
          ) ?? []
        );
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, mobile, active]);
  useEffect(() => {
    if (!profileOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [profileOpen]);
  if (loading || !active)
    return (
      <div className="plain-shell">
        <header>
          <Brand />
        </header>
        {children}
      </div>
    );
  const admin = isLeadership(user);
  const nav = (href: string, label: string, Icon: typeof Users) => (
    <Link
      href={href}
      className={`nav-item ${location === href || (href === "/customers" && location.startsWith("/customers/")) ? "nav-active" : ""}`}
      aria-current={location === href ? "page" : undefined}
    >
      <Icon size={19} />
      <span>{label}</span>
      {location === href && <span className="nav-dot" />}
    </Link>
  );
  const title = location.startsWith("/settings")
    ? "General settings"
    : location.startsWith("/customers")
      ? "Customer workspace"
      : location === "/profile"
        ? "Your account"
        : location === "/audit"
          ? "Audit trail"
          : "Workspace overview";
  async function signOut() {
    setBusy(true);
    try {
      await logout();
      navigate("/login");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {open && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="main-navigation"
        inert={mobile && !open}
        role={mobile && open ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        className={`sidebar ${open ? "sidebar-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-brand">
          <Brand light />
          <Button
            variant="ghost"
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <PanelLeftClose size={20} />
          </Button>
        </div>
        <div className="workspace-label">
          <span className="workspace-dot" />
          CRM Workspace
          <BadgeVersion />
        </div>
        <nav>
          <div className="nav-label">WORKSPACE</div>
          {nav("/", "Dashboard", LayoutDashboard)}
          {hasPermission(user, "customers.read") &&
            nav("/customers", "Customers", Users)}
          <button
            className="nav-item nav-disabled"
            disabled
            title="Product management is outside Foundation V1"
          >
            <Package size={19} />
            <span>
              Products<small>Coming Soon</small>
            </span>
          </button>
          {admin && (
            <>
              <div className="nav-label nav-label-settings">
                GENERAL SETTINGS
              </div>
              {hasPermission(user, "users.read") &&
                nav("/settings/users", "User management", Users)}
              {hasPermission(user, "roles.read") &&
                nav("/settings/roles", "Roles & permissions", ShieldCheck)}
              {hasPermission(user, "company.read") &&
                nav("/settings/company", "Youcai information", Building2)}
            </>
          )}
          {hasPermission(user, "audit.read") && (
            <>
              <div className="nav-label nav-label-settings">GOVERNANCE</div>
              {nav("/audit", "Audit trail", Activity)}
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="foundation-note">
            <ShieldCheck size={20} />
            <div>
              Foundation V1<span>Focused. Connected. Controlled.</span>
            </div>
          </div>
          <Link href="/profile" className="sidebar-person">
            <span className="avatar">
              {user!.fullName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{user!.fullName}</strong>
              <small>
                {user!.roles.map(roleName).join(" · ") || "No assigned roles"}
              </small>
            </span>
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </aside>
      <div className="app-main" inert={mobile && open}>
        <header className="topbar">
          <div className="topbar-context">
            <Button
              variant="ghost"
              className="mobile-menu"
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="main-navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={22} />
            </Button>
            <span className="topbar-parent">Youcai Medical</span>
            <span className="topbar-divider">/</span>
            <span>{title}</span>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <span />
              Foundation V1
            </span>
            <div className="profile-control">
              <button
                className="profile-button"
                aria-expanded={profileOpen}
                aria-label="Account menu"
                onClick={() => setProfileOpen(v => !v)}
              >
                <span className="avatar avatar-small">
                  {user!.fullName.slice(0, 1).toUpperCase()}
                </span>
                <span className="topbar-name">
                  <strong>{user!.fullName}</strong>
                  <small title={user!.roles.map(roleName).join(" · ")}>
                    {user!.roles.length
                      ? `${roleName(user!.roles[0])}${user!.roles.length > 1 ? ` +${user!.roles.length - 1}` : ""}`
                      : "No assigned roles"}
                  </small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <>
                  <button
                    className="menu-dismiss"
                    aria-label="Close account menu"
                    onClick={() => setProfileOpen(false)}
                  />
                  <div className="profile-menu">
                    <strong>{user!.fullName}</strong>
                    <small>{user!.email}</small>
                    <div className="profile-menu-roles">
                      {user!.roles.map(roleName).join(" · ")}
                    </div>
                    <Link href="/profile">
                      <Settings2 size={16} />
                      My profile
                    </Link>
                    <button disabled={busy} onClick={signOut}>
                      <LogOut size={16} />
                      {busy ? "Signing out…" : "Sign out"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <EmailSetupBanner />
          {children}
        </main>
        <footer className="app-footer">
          <span>
            YOUCAI MEDICAL <span> / </span> CRM Foundation
          </span>
          <span>V1 · Customer relationships, clearly organized.</span>
        </footer>
      </div>
    </div>
  );
}
function BadgeVersion() {
  return <span className="workspace-version">V1</span>;
}
