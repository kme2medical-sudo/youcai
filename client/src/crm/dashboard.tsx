import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Archive,
  CheckCircle2,
  ContactRound,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useResource } from "./api";
import { useAuth } from "./session";
import {
  accessMethodLabel,
  hasAccessProof,
  hasPermission,
  roleName,
  type AuditEntry,
} from "./types";
import {
  Badge,
  Button,
  DataValue,
  EmptyState,
  ErrorState,
  formatDate,
  LinkButton,
  Loading,
  PageHeader,
  Section,
  StatusBadge,
} from "./ui";

type DashboardData = {
  customersTotal: number | null;
  customersActive: number | null;
  customersArchived: number | null;
  contactsTotal: number | null;
  pendingUsers?: number;
  recentActivity: AuditEntry[];
};
export function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } =
    useResource<DashboardData>("/dashboard");
  const customerRead = hasPermission(user, "customers.read");
  const firstName = user?.fullName.split(" ")[0] ?? "";
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE, AT A GLANCE"
        title={`Good to see you, ${firstName}.`}
        description="Keep your customer relationships and team operations moving."
        action={
          hasPermission(user, "customers.create") ? (
            <LinkButton href="/customers/new">
              <Plus size={17} />
              New customer
            </LinkButton>
          ) : undefined
        }
      />
      {loading ? (
        <Loading label="Loading workspace summary…" />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        data && (
          <>
            {customerRead && (
              <div className="stat-grid">
                {[
                  {
                    label: "Total customers",
                    value: data.customersTotal,
                    Icon: Users,
                    note: "Your customer directory",
                  },
                  {
                    label: "Active customers",
                    value: data.customersActive,
                    Icon: CheckCircle2,
                    note: "Current relationships",
                  },
                  {
                    label: "Customer contacts",
                    value: data.contactsTotal,
                    Icon: ContactRound,
                    note: "People behind the accounts",
                  },
                  {
                    label: "Archived customers",
                    value: data.customersArchived,
                    Icon: Archive,
                    note: "Retained for reference",
                  },
                ].map(({ label, value, Icon, note }) => (
                  <div className="stat-card" key={label}>
                    <div className="stat-heading">
                      <span>{label}</span>
                      <Icon size={20} />
                    </div>
                    <strong>
                      {value == null
                        ? "—"
                        : new Intl.NumberFormat("en").format(value)}
                    </strong>
                    <p>{note}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="dashboard-columns">
              <Section
                title={
                  customerRead
                    ? "Your relationship workspace"
                    : "Your workspace is ready"
                }
                description={
                  customerRead
                    ? "An organized foundation for every customer conversation."
                    : "Your current roles provide access to the dashboard and your profile."
                }
                className="workspace-panel"
              >
                <div className="dashboard-workspace">
                  <div className="workspace-graphic" aria-hidden="true">
                    <Users size={33} />
                    <span>
                      <ShieldCheck size={16} />
                    </span>
                  </div>
                  <h3>
                    {customerRead && data.customersTotal === 0
                      ? "Your next relationship starts here."
                      : customerRead
                        ? "The details that keep you connected."
                        : "Clarity starts with the right access."}
                  </h3>
                  <p>
                    {customerRead && data.customersTotal === 0
                      ? "Add your first customer to keep account details, regional information, and key contacts together. No sample records—only your real relationships."
                      : customerRead
                        ? "Find a customer, update their information, or connect with the right contact. Your directory is built around real, persisted records."
                        : "Manage your profile and review your assigned roles. Customer and administration access depends on the permissions granted by your administrator."}
                  </p>
                  {customerRead ? (
                    <LinkButton href="/customers" secondary>
                      Open customer directory
                      <ArrowRight size={16} />
                    </LinkButton>
                  ) : (
                    <LinkButton href="/profile" secondary>
                      View my profile
                      <ArrowRight size={16} />
                    </LinkButton>
                  )}
                </div>
              </Section>
              <Section
                title="Workspace essentials"
                description="A focused foundation, with controlled access."
              >
                <div className="essentials-list">
                  <Link href="/profile">
                    <span className="essential-icon">
                      <ShieldCheck size={20} />
                    </span>
                    <div>
                      <strong>Your access & profile</strong>
                      <p>
                        {user?.roles.map(roleName).join(" · ") ||
                          "No assigned roles"}
                      </p>
                    </div>
                    <ArrowUpRight size={17} />
                  </Link>
                  {hasPermission(user, "users.read") && (
                    <Link href="/settings/users">
                      <span className="essential-icon">
                        <Users size={20} />
                      </span>
                      <div>
                        <strong>Team access requests</strong>
                        <p>
                          {data.pendingUsers === undefined
                            ? "Review approvals and assigned roles"
                            : `${data.pendingUsers} pending ${data.pendingUsers === 1 ? "request" : "requests"}`}
                        </p>
                      </div>
                      <ArrowUpRight size={17} />
                    </Link>
                  )}
                  <div className="essential-static">
                    <span className="essential-icon">
                      <Archive size={20} />
                    </span>
                    <div>
                      <strong>Products</strong>
                      <p>Not included in Foundation V1</p>
                    </div>
                    <Badge>Coming Soon</Badge>
                  </div>
                </div>
                <div className="workspace-principle">
                  <span />
                  Authorized accounts. Permission-based access. A clear audit
                  trail.
                </div>
              </Section>
            </div>
            {hasPermission(user, "audit.read") && (
              <Section
                title="Recent activity"
                description="A traceable view of changes in your workspace."
                action={
                  <Link className="text-link" href="/audit">
                    View audit trail
                    <ArrowRight size={14} />
                  </Link>
                }
              >
                {data.recentActivity.length ? (
                  <div className="activity-list">
                    {data.recentActivity.map(item => (
                      <div className="activity-row" key={item.id}>
                        <span className="activity-icon">
                          <Activity size={16} />
                        </span>
                        <div>
                          <strong>{readableAction(item.action)}</strong>
                          <p>
                            {item.actorName || item.actorEmail || "System"}
                            {item.entityType ? ` · ${item.entityType}` : ""}
                          </p>
                        </div>
                        <time>{formatDate(item.createdAt, true)}</time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="A clear trail starts with the first change."
                    description="Customer updates and administrative changes will appear here when they occur."
                  />
                )}
              </Section>
            )}
          </>
        )
      )}
    </>
  );
}
export function readableAction(action: string) {
  return action.replaceAll(/[._]/g, " ").replace(/^./, c => c.toUpperCase());
}
export function Profile() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  return (
    <>
      <PageHeader
        eyebrow="YOUR ACCOUNT"
        title="My profile"
        description="Your identity, assigned roles, and workspace permissions."
        action={
          <Button
            variant="secondary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await logout();
                navigate("/login");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out
          </Button>
        }
      />
      <div className="profile-grid">
        <Section
          title="Account details"
          description="Access authorization and email ownership are separate from your requested role."
        >
          <div className="profile-summary">
            <span className="avatar avatar-large">
              {user.fullName.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h3>{user.fullName}</h3>
              <p>{user.email}</p>
              <StatusBadge status={user.status} />
            </div>
          </div>
          <dl className="detail-grid">
            <DataValue label="Full name">{user.fullName}</DataValue>
            <DataValue label="Email">{user.email}</DataValue>
            <DataValue label="Email ownership">
              <Badge tone={user.emailVerified ? "green" : "amber"}>
                {user.emailVerified ? "Verified" : "Not verified"}
              </Badge>
            </DataValue>
            <DataValue label="Access authorization">
              <Badge tone={hasAccessProof(user) ? "green" : "amber"}>
                {accessMethodLabel(user)}
              </Badge>
            </DataValue>
            <DataValue label="Account ID">
              <span className="mono">{user.id}</span>
            </DataValue>
          </dl>
          <div className="panel-note">
            Account name and email changes are not available in Foundation V1.
            Contact your administrator for account assistance.
          </div>
        </Section>
        <Section
          title="Roles & effective access"
          description="Your permissions are the union of your assigned roles."
        >
          <div className="profile-roles">
            {user.roles.length ? (
              user.roles.map(role => (
                <Badge tone="green" key={role}>
                  {roleName(role)}
                </Badge>
              ))
            ) : (
              <p className="muted">No roles assigned.</p>
            )}
          </div>
          <div className="permissions-list">
            {user.permissions.length ? (
              [...user.permissions].sort().map(permission => (
                <div key={permission}>
                  <CheckCircle2 size={15} />
                  <code>{permission}</code>
                </div>
              ))
            ) : (
              <p className="muted">Dashboard and profile access only.</p>
            )}
          </div>
          <div className="panel-note">
            <ShieldCheck size={17} />
            Roles and permissions are managed by your Admin or CEO. Changes take
            effect immediately on the server.
          </div>
        </Section>
      </div>
    </>
  );
}
