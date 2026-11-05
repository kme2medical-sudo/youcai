import { useEffect, useState } from "react";
import { LockKeyhole, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, useResource } from "./api";
import { useAuth } from "./session";
import { hasPermission } from "./types";
import { Badge, Button, ErrorState, Loading, Notice, PageHeader } from "./ui";

type Role = {
  code: string;
  name: string;
  permissions: string[];
  protected: boolean;
};
type RolesData = {
  items: Role[];
  permissions: { code: string; name: string }[];
};
const groups: Record<string, string> = {
  users: "Team administration",
  roles: "Role administration",
  company: "Company information",
  customers: "Customer management",
  contacts: "Customer contacts",
  audit: "Governance",
};
export function RolesSettings() {
  const auth = useAuth();
  const resource = useResource<RolesData>("/roles");
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasPermission(auth.user, "roles.manage");
  useEffect(() => {
    if (resource.data)
      setDrafts(
        Object.fromEntries(
          resource.data.items.map(role => [role.code, [...role.permissions]])
        )
      );
  }, [resource.data]);
  async function save(role: Role) {
    if (role.protected || role.code === "admin" || role.code === "ceo") return;
    setBusy(role.code);
    setError(null);
    try {
      await api(`/roles/${role.code}`, {
        method: "PUT",
        body: { permissions: drafts[role.code] ?? [] },
      });
      toast.success(`${role.name} permissions saved.`);
      resource.reload();
      void auth.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="GENERAL SETTINGS"
        title="Roles & permissions"
        description="Define what each role can do. Assigned roles combine to form a user’s effective access."
      />
      <Notice title="Core administration is protected">
        Admin and CEO retain their mandatory administration rights. Dashboard
        and profile are available to all active users. Products is informational
        only and has no V1 permission or API.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      {resource.loading ? (
        <Loading label="Loading permission matrix…" />
      ) : resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : (
        resource.data && (
          <section className="panel roles-panel">
            <div className="panel-heading">
              <div>
                <h2>Permission matrix</h2>
                <p>
                  Changes apply immediately on the server. Save each modified
                  role individually.
                </p>
              </div>
              <Badge>{resource.data.permissions.length} permissions</Badge>
            </div>
            <div className="table-scroll">
              <table className="permission-matrix">
                <thead>
                  <tr>
                    <th>Workspace permission</th>
                    {resource.data.items.map(role => (
                      <th key={role.code}>
                        <strong>{role.name}</strong>
                        {role.protected ||
                        ["admin", "ceo"].includes(role.code) ? (
                          <span className="protected-role">
                            <LockKeyhole size={11} />
                            Protected
                          </span>
                        ) : (
                          <span className="role-code">{role.code}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resource.data.permissions.map((permission, index, arr) => {
                    const group = permission.code.split(".")[0];
                    const newGroup =
                      index === 0 ||
                      arr[index - 1].code.split(".")[0] !== group;
                    return (
                      <tr
                        key={permission.code}
                        className={newGroup ? "permission-group-start" : ""}
                      >
                        <td>
                          {newGroup && (
                            <span className="permission-group">
                              {groups[group] || group}
                            </span>
                          )}
                          <strong>{permission.name || permission.code}</strong>
                          <code>{permission.code}</code>
                        </td>
                        {resource.data!.items.map(role => {
                          const protectedRole =
                            role.protected ||
                            ["admin", "ceo"].includes(role.code);
                          return (
                            <td key={role.code}>
                              <input
                                type="checkbox"
                                aria-label={`${permission.name || permission.code} for ${role.name}`}
                                checked={(
                                  drafts[role.code] ?? role.permissions
                                ).includes(permission.code)}
                                disabled={!canManage || protectedRole || !!busy}
                                onChange={e =>
                                  setDrafts(old => ({
                                    ...old,
                                    [role.code]: e.target.checked
                                      ? [
                                          ...(old[role.code] ?? []),
                                          permission.code,
                                        ]
                                      : (old[role.code] ?? []).filter(
                                          p => p !== permission.code
                                        ),
                                  }))
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>
                      <span className="muted">Save changes by role</span>
                    </td>
                    {resource.data.items.map(role => {
                      const changed =
                        [...(drafts[role.code] ?? [])].sort().join() !==
                        [...role.permissions].sort().join();
                      const protectedRole =
                        role.protected || ["admin", "ceo"].includes(role.code);
                      return (
                        <td key={role.code}>
                          {protectedRole ? (
                            <span className="protected-role">
                              <LockKeyhole size={12} />
                              Core role
                            </span>
                          ) : (
                            <div className="matrix-actions">
                              <Button
                                variant="secondary"
                                disabled={!canManage || !changed || !!busy}
                                busy={busy === role.code}
                                onClick={() => void save(role)}
                              >
                                <Save size={13} />
                                Save
                              </Button>
                              {changed && (
                                <Button
                                  variant="ghost"
                                  aria-label={`Reset ${role.name} changes`}
                                  disabled={!!busy}
                                  onClick={() =>
                                    setDrafts(old => ({
                                      ...old,
                                      [role.code]: [...role.permissions],
                                    }))
                                  }
                                >
                                  <RotateCcw size={13} />
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )
      )}
      <div className="page-footnote">
        <ShieldCheck size={15} />
        Permissions are resolved from current database assignments on every
        business request.
      </div>
    </>
  );
}
