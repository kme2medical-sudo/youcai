import { ROLE_CODES, ROLE_NAMES, LEGAL_ENTITY_TYPES } from "@shared/crm";
import type { User } from "@shared/crm";
export { CUSTOMER_TYPES, SALUTATIONS, USER_STATUSES } from "@shared/crm";
export type { User, Customer, Contact, Company } from "@shared/crm";
export const ROLES = ROLE_CODES.map(code => ({ code, name: ROLE_NAMES[code] }));
export const LEGAL_TYPES = LEGAL_ENTITY_TYPES;
export type Session = { user: User | null; csrfToken?: string };
export type Country = { code: string; name: string; regionCode: string };
export type Reference = {
  countries: Country[];
  regions: { code: string; name: string }[];
  roles: { code: string; name: string }[];
  permissions: { code: string; name: string }[];
};
export type AuditEntry = {
  id: string;
  action: string;
  entityType?: string;
  entityId?: string;
  actorName?: string | null;
  actorEmail?: string | null;
  actorId?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};
export function roleName(code: string) {
  return ROLES.find(r => r.code === code)?.name ?? code;
}
export function hasAccessProof(user: User | null | undefined) {
  return !!user && (user.emailVerified || user.accessAuthorized === true);
}
export function isOwnerProvisioned(user: User | null | undefined) {
  return (
    !!user &&
    user.accessAuthorized === true &&
    user.accessMethod === "OWNER_PROVISIONED"
  );
}
export function accessMethodLabel(user: User) {
  if (isOwnerProvisioned(user)) return "Owner-provisioned";
  if (user.emailVerified) return "Email verified";
  return user.accessAuthorized === true
    ? "Access authorized"
    : "Not authorized";
}
export function isActive(user: User | null | undefined) {
  return !!user && user.status === "ACTIVE" && hasAccessProof(user);
}
export function isLeadership(user: User | null | undefined) {
  return !!user && user.roles.some(r => r === "admin" || r === "ceo");
}
export function hasPermission(user: User | null | undefined, code: string) {
  return isActive(user) && !!user?.permissions.includes(code);
}
export function requiresLegalName(type: string) {
  return [
    "Corporation/S.A.",
    "LLC/Limited Liability Company",
    "Government Entity",
  ].includes(type);
}
