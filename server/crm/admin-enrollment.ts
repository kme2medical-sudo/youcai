import { randomUUID } from "node:crypto";
import { type Db, getPool, rows, run, transaction } from "./db";
import { BOOTSTRAP_EMAILS, HttpError, audit, hash, hashPassword, lockSecurity, opaque } from "./security";

const invalid = () => new HttpError(400, "This link is invalid or expired");
const eligible = (user: Record<string, any>): boolean =>
  BOOTSTRAP_EMAILS.has(user.email_normalized) && user.status === "UNVERIFIED" &&
  !user.bootstrap_completed && !user.email_verified_at && !!user.owner_authorized_at &&
  !user.owner_completed_at && !user.credential_user_id && !user.assigned_role;
const setupUserSql = `SELECT u.*, oa.authorized_at AS owner_authorized_at,
  oa.completed_at AS owner_completed_at, c.user_id AS credential_user_id,
  (SELECT role_code FROM crm_user_roles WHERE user_id = u.id LIMIT 1) AS assigned_role
  FROM crm_users u LEFT JOIN crm_owner_admin_access oa ON oa.user_id = u.id
  LEFT JOIN crm_auth_credentials c ON c.user_id = u.id`;

export interface OwnerAdminInvitation { userId: string; email: string; token: string; expiresAt: string; }

// Owner-operated shell entry point only: never exposed by an HTTP issuer, mail or logs.
// An explicit rerun rotates pending capabilities, retaining identity and all completed/revoked state.
export async function issueOwnerAdminInvitations(onPrepared?: (invitations: OwnerAdminInvitation[]) => Promise<void>): Promise<OwnerAdminInvitation[]> {
  return transaction(async db => {
    await lockSecurity(db);
    const invitations: OwnerAdminInvitation[] = [];
    for (const email of BOOTSTRAP_EMAILS) {
      let user = (await rows(db, `${setupUserSql} WHERE u.email_normalized = ? FOR UPDATE`, [email]))[0];
      if (user) {
        if (user.owner_completed_at || user.bootstrap_completed || ["SUSPENDED", "REJECTED"].includes(user.status)) continue;
        // A matching public signup is not owner authorization. Never take over a preexisting identity.
        if (!eligible(user)) throw new HttpError(409, "An existing identity cannot be provisioned. Review owner authorization privately.");
      } else {
        const id = randomUUID();
        await run(db, "INSERT INTO crm_users (id, full_name, email_normalized, status) VALUES (?, 'Administrator', ?, 'UNVERIFIED')", [id, email]);
        await run(db, "INSERT INTO crm_owner_admin_access (user_id, authorized_at) VALUES (?, UTC_TIMESTAMP(3))", [id]);
        user = { id };
      }
      const token = opaque(), expiresAt = new Date(Date.now() + 24 * 3600000);
      await run(db, "DELETE FROM crm_auth_tokens WHERE user_id = ? AND purpose = 'ADMIN_SETUP'", [user.id]);
      await run(db, "INSERT INTO crm_auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, 'ADMIN_SETUP', ?)", [hash(token), user.id, expiresAt]);
      await audit(db, null, "owner.admin_setup_issued", "user", user.id);
      invitations.push({ userId: user.id, email, token, expiresAt: expiresAt.toISOString() });
    }
    await onPrepared?.(invitations);
    return invitations;
  });
}

async function pendingSetupUser(db: Db, tokenHash: string): Promise<Record<string, any>> {
  const token = (await rows(db, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND purpose = 'ADMIN_SETUP' AND expires_at > UTC_TIMESTAMP(3)", [tokenHash]))[0];
  if (!token) throw invalid();
  const user = (await rows(db, `${setupUserSql} WHERE u.id = ?`, [token.user_id]))[0];
  if (!user || !eligible(user)) throw invalid();
  return user;
}

export async function checkOwnerAdminInvitation(token: string): Promise<{ email: string }> {
  const user = await pendingSetupUser(getPool(), hash(token));
  return { email: user.email_normalized };
}

export async function completeOwnerAdminSetup(input: { token: string; fullName: string; password: string }): Promise<void> {
  const tokenHash = hash(input.token);
  // Cheap eligibility check precedes expensive scrypt; the transaction revalidates everything.
  await pendingSetupUser(getPool(), tokenHash);
  const encoded = await hashPassword(input.password);
  await transaction(async db => {
    await lockSecurity(db);
    const candidate = (await rows(db, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND purpose = 'ADMIN_SETUP' AND expires_at > UTC_TIMESTAMP(3)", [tokenHash]))[0];
    if (!candidate) throw invalid();
    // Shared lock order: guard, user, then fresh capability. No credential exists before completion.
    const user = (await rows(db, `${setupUserSql} WHERE u.id = ? FOR UPDATE`, [candidate.user_id]))[0];
    const token = (await rows(db, "SELECT user_id FROM crm_auth_tokens WHERE token_hash = ? AND user_id = ? AND purpose = 'ADMIN_SETUP' AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE", [tokenHash, candidate.user_id]))[0];
    if (!token || !user || !eligible(user)) throw invalid();
    await run(db, "INSERT INTO crm_auth_credentials (user_id, password_hash) VALUES (?, ?)", [user.id, encoded]);
    await run(db, "DELETE FROM crm_auth_sessions WHERE user_id = ?", [user.id]);
    await run(db, "DELETE FROM crm_auth_tokens WHERE user_id = ?", [user.id]);
    await run(db, "UPDATE crm_owner_admin_access SET completed_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND completed_at IS NULL", [user.id]);
    // Owner provisioning is deliberately NOT an email verification assertion.
    await run(db, "UPDATE crm_users SET full_name = ?, status = 'ACTIVE', bootstrap_completed = TRUE, updated_by = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [input.fullName, user.id, user.id]);
    await run(db, "INSERT IGNORE INTO crm_user_roles (user_id, role_code) VALUES (?, 'admin')", [user.id]);
    await audit(db, user.id, "owner.admin_setup_completed", "user", user.id, { status: "ACTIVE", accessMethod: "OWNER_PROVISIONED" });
  });
}
