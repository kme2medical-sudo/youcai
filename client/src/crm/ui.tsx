import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Inbox,
  LoaderCircle,
  X,
} from "lucide-react";

export function Button({
  children,
  className = "",
  variant = "primary",
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`btn btn-${variant} ${className}`}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function LinkButton({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`btn btn-${secondary ? "secondary" : "primary"}`}
    >
      {children}
    </Link>
  );
}
export function Field({
  label,
  hint,
  children,
  required,
  wide,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
  wide?: boolean;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  function associateControls(nodes: ReactNode): ReactNode {
    return Children.map(nodes, node => {
      if (!isValidElement<Record<string, unknown>>(node)) return node;
      if (["input", "select", "textarea"].includes(String(node.type))) {
        return cloneElement(node, { id, "aria-describedby": hintId });
      }
      if (node.props.children !== undefined) {
        return cloneElement(node, {
          children: associateControls(node.props.children as ReactNode),
        });
      }
      return node;
    });
  }
  return (
    <div className={`field ${wide ? "field-wide" : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
        {required && (
          <span aria-hidden="true" className="required">
            {" "}
            *
          </span>
        )}
      </label>
      {associateControls(children)}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? "green"
      : status === "SUSPENDED" || status === "REJECTED"
        ? "red"
        : status.includes("PENDING") || status === "UNVERIFIED"
          ? "amber"
          : "neutral";
  return <Badge tone={tone}>{status.toLowerCase().replaceAll("_", " ")}</Badge>;
}
export function Notice({
  children,
  tone = "info",
  title,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "error" | "success";
  title?: string;
}) {
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon size={19} />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}
export function Loading({
  label = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={25} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  return (
    <div className="error-state">
      <Notice tone="error" title="Something needs your attention">
        {error}
      </Notice>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={26} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  back,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="page-header">
      <div>
        {back && (
          <Link href={back.href} className="back-link">
            <ArrowLeft size={15} />
            {back.label}
          </Link>
        )}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </header>
  );
}
export function Section({
  title,
  description,
  children,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function formatDate(value?: string | null, withTime = false) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not available";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(date);
}
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
          : "0 records"}
      </span>
      <div>
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ArrowLeft size={15} />
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ArrowRight size={15} />
        </Button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("input, button, select, textarea")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
          ) ?? []
        );
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <div className="modal-heading">
          <h2 id={id}>{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function DataValue({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="data-value">
      <dt>{label}</dt>
      <dd>{children || <span className="muted">Not provided</span>}</dd>
    </div>
  );
}
export function safeWebsite(url?: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
