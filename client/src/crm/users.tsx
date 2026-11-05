import { useMemo, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  LockKeyhole,
  Pencil,
  Search,
  ShieldCheck,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api, useResource } from "./api";
import { useAuth } from "./session";
import {
  accessMethodLabel,
  hasAccessProof,
  hasPermission,
  ROLES,
  roleName,
  type User,
} from "./types";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  formatDate,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Section,
  StatusBadge,
} from "./ui";

export function UserManagement() {
  const auth = useAuth();
  const resource = useResource<{ items: User[] }>("/users");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState<User | null>(null);
  const items = useMemo(
    () =>
      resource.data?.items.filter(
        u =>
          (!status || u.status === status) &&
          `${u.fullName} ${u.email}`
            .toLowerCase()
            .includes(q.trim().toLowerCase())
      ) ?? [],
    [resource.data, q, status]
  );
  const pending =
    resource.data?.items.filter(u => u.status === "PENDING_APPROVAL").length ??
    0;
  return (
    <>
      <PageHeader
        eyebrow="GENERAL SETTINGS"
        title="User management"
        description="Review access requests, manage authorized accounts, and assign the roles your team needs."
      />
      <div className="admin-summary">
        <span className="admin-summary-icon">
          <UsersIcon size={22} />
        </span>
        <div>
          <strong>
            {resource.data
              ? `${resource.data.items.length} team ${resource.data.items.length === 1 ? "account" : "accounts"}`
              : "Team access"}
          </strong>
          <p>
            Email verification confirms mailbox ownership. Private owner
            provisioning is a separate authorization method. Status and assigned
            roles determine access.
          </p>
        </div>
        {pending > 0 && <Badge tone="amber">{pending} pending approval</Badge>}
      </div>
      <section className="panel">
        <div className="directory-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search users"
              placeholder="Search by name or email…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter users by status"
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="ACTIVE">Active</option>
            <option value="UNVERIFIED">Unverified</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        {resource.loading ? (
          <Loading label="Loading team accounts…" />
        ) : resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              q || status
                ? "No accounts match your filters."
                : "No team accounts to display."
            }
            description={
              q || status
                ? "Try a different name, email, or status."
                : "Registered accounts will appear here for verification and access review."
            }
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Authorization / status</th>
                  <th>Requested role</th>
                  <th>Assigned roles</th>
                  <th>Registered</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {items.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <span className="avatar">
                          {u.fullName.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>
                            {u.fullName}
                            {u.id === auth.user?.id && (
                              <small className="you-label">You</small>
                            )}
                          </strong>
                          <small>{u.email}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="user-status-cell">
                        <StatusBadge status={u.status} />
                        <small
                          className={
                            hasAccessProof(u) ? "verified-label" : "muted"
                          }
                        >
                          {hasAccessProof(u) ? (
                            <CheckCircle2 size={12} />
                          ) : (
                            <LockKeyhole size={12} />
                          )}
                          {accessMethodLabel(u)}
                        </small>
                        {!u.emailVerified && (
                          <small className="muted">Email not verified</small>
                        )}
                      </div>
                    </td>
                    <td>
                      {u.requestedRole ? (
                        roleName(u.requestedRole)
                      ) : (
                        <span className="muted">No request</span>
                      )}
                    </td>
                    <td>
                      <div className="role-chips">
                        {u.roles.length ? (
                          u.roles.map(role => (
                            <Badge key={role}>{roleName(role)}</Badge>
                          ))
                        ) : (
                          <span className="muted">None assigned</span>
                        )}
                      </div>
                    </td>
                    <td className="date-cell">{formatDate(u.createdAt)}</td>
                    <td>
                      {u.id === auth.user?.id ? (
                        <Button
                          variant="ghost"
                          disabled
                          title="You cannot modify your own account"
                        >
                          <LockKeyhole size={14} />
                          Protected
                        </Button>
                      ) : hasPermission(auth.user, "users.manage") ||
                        hasPermission(auth.user, "users.approve") ? (
                        <Button variant="secondary" onClick={() => setEdit(u)}>
                          <Pencil size={14} />
                          Manage
                        </Button>
                      ) : (
                        <span className="muted">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="page-footnote">
        <ShieldCheck size={15} />
        Self-role/status changes and last-administrator removal are blocked. All
        administrative changes are audited.
      </div>
      {edit && (
        <UserModal
          account={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            resource.reload();
            void auth.refresh();
          }}
        />
      )}
    </>
  );
}
export function UserModal({
  account,
  onClose,
  onSaved,
}: {
  account: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [status, setStatus] = useState<string>(account.status);
  const [roles, setRoles] = useState<string[]>(account.roles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manage = hasPermission(user, "users.manage");
  const approve = hasPermission(user, "users.approve");
  const self = user?.id === account.id;
  const unchanged =
    status === account.status &&
    [...roles].sort().join() === [...account.roles].sort().join();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (self) return;
    if (status === "ACTIVE" && !hasAccessProof(account)) {
      setError(
        "This account needs email verification or owner authorization before it can be activated."
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${account.id}`, {
        method: "PUT",
        body: { status, roles },
      });
      toast.success("User access updated.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Manage team access"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-user-summary">
        <span className="avatar">
          {account.fullName.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{account.fullName}</strong>
          <p>{account.email}</p>
        </div>
      </div>
      <form onSubmit={submit}>
        {error && <Notice tone="error">{error}</Notice>}
        {!hasAccessProof(account) && (
          <Notice tone="warning">
            This account has no access authorization. It cannot be activated
            until email verification or private owner provisioning is complete.
          </Notice>
        )}
        <div className="modal-field">
          <Field label="Account status" required>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              disabled={self || busy || (!manage && !approve)}
            >
              {account.status === "UNVERIFIED" && (
                <option value="UNVERIFIED" disabled>
                  Unverified
                </option>
              )}
              <option value="PENDING_APPROVAL" disabled={!manage}>
                Pending approval
              </option>
              <option
                value="ACTIVE"
                disabled={!hasAccessProof(account) || !approve}
              >
                Active — authorized
              </option>
              <option value="REJECTED" disabled={!approve && !manage}>
                Rejected
              </option>
              <option value="SUSPENDED" disabled={!manage}>
                Suspended
              </option>
            </select>
          </Field>
        </div>
        <div className="modal-field">
          <span className="field-label">Assigned roles</span>
          <p className="field-hint">
            Assign multiple roles where needed. Requested role:{" "}
            <strong>
              {account.requestedRole ? roleName(account.requestedRole) : "None"}
            </strong>
            .
          </p>
          <div className="role-selector">
            {ROLES.map(role => (
              <label
                key={role.code}
                className={`role-choice ${roles.includes(role.code) ? "role-choice-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={roles.includes(role.code)}
                  disabled={self || busy || !manage}
                  onChange={e =>
                    setRoles(old =>
                      e.target.checked
                        ? [...old, role.code]
                        : old.filter(r => r !== role.code)
                    )
                  }
                />
                <span>{role.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="panel-note">
          Role requests never grant privileges automatically. Only an active,
          authorized account can access business modules.
        </div>
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            busy={busy}
            disabled={self || unchanged || status === "UNVERIFIED"}
          >
            Save access changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
