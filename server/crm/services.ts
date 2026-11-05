import { randomUUID } from "node:crypto";
import type { Customer, Contact, Company, CustomerInput, ContactInput, CompanyInput, User } from "../../shared/crm";
import { type Db, getPool, rows, run, transaction, iso } from "./db";
import { HttpError, audit, getUser, requirePermission, lockSecurity, effectiveAdminCount, validateRoleChange, protectRole } from "./security";
const customerFields = { displayName: "display_name", legalName: "legal_name", customerType: "customer_type", legalEntityType: "legal_entity_type", countryCode: "country_code", email: "email", phone: "phone", website: "website", taxId: "tax_id", addressLine1: "address_line1", addressLine2: "address_line2", city: "city", state: "state", postalCode: "postal_code", notes: "notes" } as const;
const contactFields = { salutation: "salutation", fullName: "full_name", alias: "alias", jobTitle: "job_title", phone: "phone", email: "email", isPrimary: "is_primary" } as const;
const companyFields = { tradingName: "trading_name", legalName: "legal_name", logoUrl: "logo_url", website: "website", email: "email", phone: "phone", countryCode: "country_code", addressLine1: "address_line1", city: "city", state: "state", postalCode: "postal_code", timezone: "timezone", defaultCurrency: "default_currency", description: "description" } as const;
const mapFields = (row: Record<string, any>, fields: Record<string, string>) => Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column] ?? null]));
export function customerDTO(row: Record<string, any>): Customer { return { id: row.id, ...mapFields(row, customerFields), regionCode: row.region_code, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) } as Customer; }
export function contactDTO(row: Record<string, any>): Contact { return { id: row.id, customerId: row.customer_id, ...mapFields(row, contactFields), isPrimary: !!row.is_primary } as Contact; }
export function companyDTO(row: Record<string, any>): Company { return { ...mapFields(row, companyFields), updatedAt: iso(row.updated_at), updatedBy: row.updated_by ?? null } as Company; }
export async function validCountry(db: Db, code: string | null): Promise<void> { if (!code) return; const found = await rows(db, "SELECT c.code FROM crm_countries c JOIN crm_country_regions cr ON cr.country_code = c.code JOIN crm_business_regions r ON r.code = cr.region_code AND r.active = TRUE WHERE c.code = ? AND c.active = TRUE", [code]); if (!found.length) throw new HttpError(422, "Choose an active ISO country"); }
const customerSelect = "SELECT c.*, cr.region_code FROM crm_customers c JOIN crm_country_regions cr ON cr.country_code = c.country_code";
export async function getCustomer(db: Db, id: string): Promise<Customer> { const row = (await rows(db, `${customerSelect} WHERE c.id = ?`, [id]))[0]; if (!row) throw new HttpError(404, "Customer not found"); return customerDTO(row); }
export interface CustomerFilters { q?: string; type?: string; country?: string; region?: string; status?: string; page: number; }
export async function listCustomers(filters: CustomerFilters) {
  const parts: string[] = [], values: any[] = [];
  if (filters.q) { parts.push("(c.display_name LIKE ? OR c.legal_name LIKE ? OR c.email LIKE ? OR c.tax_id LIKE ?)"); const search = `%${filters.q.replace(/[\\%_]/g, v => `\\${v}`)}%`; values.push(search, search, search, search); }
  for (const [key, column] of [["type", "c.customer_type"], ["country", "c.country_code"], ["region", "cr.region_code"], ["status", "c.status"]] as const) if (filters[key]) { parts.push(`${column} = ?`); values.push(filters[key]); }
  const where = parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
  const db = getPool(), pageSize = 25;
  const total = Number((await rows(db, `SELECT COUNT(*) AS total FROM crm_customers c JOIN crm_country_regions cr ON cr.country_code = c.country_code${where}`, values))[0].total);
  // Bound integer literals avoid TiDB prepared LIMIT incompatibilities; all user strings remain bound.
  const items = (await rows(db, `${customerSelect}${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ${pageSize} OFFSET ${(filters.page - 1) * pageSize}`, values)).map(customerDTO);
  return { items, total, page: filters.page, pageSize };
}
export async function duplicateWarnings(db: Db, input: CustomerInput, excludeId: string): Promise<string[]> {
  const matches = await rows(db, "SELECT id, display_name FROM crm_customers WHERE id <> ? AND (LOWER(TRIM(display_name)) = LOWER(TRIM(?)) OR (? IS NOT NULL AND email = ?) OR (? IS NOT NULL AND tax_id = ?)) ORDER BY created_at DESC LIMIT 5", [excludeId, input.displayName, input.email, input.email, input.taxId, input.taxId]);
  return matches.map(row => `Possible duplicate: ${row.display_name} (${row.id}). Please review; duplicates are allowed.`);
}
export async function saveCustomer(actorId: string, input: CustomerInput, id?: string) {
  return transaction(async db => {
    requirePermission(await getUser(db, actorId), id ? "customers.update" : "customers.create");
    await validCountry(db, input.countryCode);
    if (id) { const existing = (await rows(db, "SELECT status FROM crm_customers WHERE id = ? FOR UPDATE", [id]))[0]; if (!existing) throw new HttpError(404, "Customer not found"); if (existing.status === "ARCHIVED") throw new HttpError(409, "Restore the customer before editing"); }
    const customerId = id || randomUUID(); const warnings = await duplicateWarnings(db, input, customerId);
    const columns = Object.values(customerFields), values = Object.keys(customerFields).map(key => input[key as keyof CustomerInput]);
    if (id) await run(db, `UPDATE crm_customers SET ${columns.map(v => `${v} = ?`).join(", ")}, updated_by = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [...values, actorId, id]);
    else await run(db, `INSERT INTO crm_customers (id, ${columns.join(", ")}, created_by, updated_by) VALUES (${Array(columns.length + 3).fill("?").join(", ")})`, [customerId, ...values, actorId, actorId]);
    await audit(db, actorId, id ? "customer.updated" : "customer.created", "customer", customerId, { fields: Object.keys(customerFields), duplicateWarnings: warnings.length });
    return { customer: await getCustomer(db, customerId), warnings };
  });
}
export async function archiveCustomer(actorId: string, id: string, archived: boolean) {
  return transaction(async db => {
    requirePermission(await getUser(db, actorId), "customers.archive");
    const row = (await rows(db, "SELECT status FROM crm_customers WHERE id = ? FOR UPDATE", [id]))[0]; if (!row) throw new HttpError(404, "Customer not found");
    const status = archived ? "ARCHIVED" : "ACTIVE";
    await run(db, "UPDATE crm_customers SET status = ?, updated_by = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [status, actorId, id]);
    await audit(db, actorId, archived ? "customer.archived" : "customer.restored", "customer", id, { before: row.status, after: status });
    return { customer: await getCustomer(db, id) };
  });
}
export async function listContacts(db: Db, customerId: string): Promise<Contact[]> { return (await rows(db, "SELECT * FROM crm_customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, full_name, id", [customerId])).map(contactDTO); }
export async function saveContact(actorId: string, customerId: string, input: ContactInput, id?: string): Promise<{contact: Contact}> {
  return transaction(async db => {
    requirePermission(await getUser(db, actorId), "contacts.manage");
    // Every contact mutation locks this same parent first. Concurrent inserts and primary changes serialize.
    const parent = (await rows(db, "SELECT status FROM crm_customers WHERE id = ? FOR UPDATE", [customerId]))[0];
    if (!parent) throw new HttpError(404, "Customer not found"); if (parent.status === "ARCHIVED") throw new HttpError(409, "Restore the customer before editing contacts");
    if (id && !(await rows(db, "SELECT id FROM crm_customer_contacts WHERE id = ? AND customer_id = ?", [id, customerId])).length) throw new HttpError(404, "Contact not found");
    const contactId = id || randomUUID();
    if (input.isPrimary) await run(db, "UPDATE crm_customer_contacts SET is_primary = FALSE, updated_by = ? WHERE customer_id = ? AND is_primary = TRUE", [actorId, customerId]);
    const columns = Object.values(contactFields), values = Object.keys(contactFields).map(key => input[key as keyof ContactInput]);
    if (id) await run(db, `UPDATE crm_customer_contacts SET ${columns.map(v => `${v} = ?`).join(", ")}, updated_by = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND customer_id = ?`, [...values, actorId, id, customerId]);
    else await run(db, `INSERT INTO crm_customer_contacts (id, customer_id, ${columns.join(", ")}, created_by, updated_by) VALUES (${Array(columns.length + 4).fill("?").join(", ")})`, [contactId, customerId, ...values, actorId, actorId]);
    await run(db, "UPDATE crm_customers SET updated_at = UTC_TIMESTAMP(3), updated_by = ? WHERE id = ?", [actorId, customerId]);
    await audit(db, actorId, id ? "contact.updated" : "contact.created", "contact", contactId, { customerId, isPrimary: input.isPrimary });
    return { contact: contactDTO((await rows(db, "SELECT * FROM crm_customer_contacts WHERE id = ? AND customer_id = ?", [contactId, customerId]))[0]) };
  });
}
export async function deleteContact(actorId: string, customerId: string, id: string) {
  await transaction(async db => {
    requirePermission(await getUser(db, actorId), "contacts.manage");
    const parent = (await rows(db, "SELECT status FROM crm_customers WHERE id = ? FOR UPDATE", [customerId]))[0];
    if (!parent) throw new HttpError(404, "Customer not found"); if (parent.status === "ARCHIVED") throw new HttpError(409, "Restore the customer before editing contacts");
    const deleted = await run(db, "DELETE FROM crm_customer_contacts WHERE id = ? AND customer_id = ?", [id, customerId]); if (!deleted.affectedRows) throw new HttpError(404, "Contact not found");
    await run(db, "UPDATE crm_customers SET updated_at = UTC_TIMESTAMP(3), updated_by = ? WHERE id = ?", [actorId, customerId]);
    await audit(db, actorId, "contact.deleted", "contact", id, { customerId });
  });
}
export async function getCompany(db: Db): Promise<Company> { const row = (await rows(db, "SELECT * FROM crm_company WHERE id = 1"))[0]; if (!row) throw new HttpError(503, "Company setup is incomplete"); return companyDTO(row); }
export async function saveCompany(actorId: string, input: CompanyInput) {
  return transaction(async db => {
    requirePermission(await getUser(db, actorId), "company.update", true); await validCountry(db, input.countryCode);
    await rows(db, "SELECT id FROM crm_company WHERE id = 1 FOR UPDATE");
    const values = Object.keys(companyFields).map(key => input[key as keyof CompanyInput]);
    await run(db, `UPDATE crm_company SET ${Object.values(companyFields).map(column => `${column} = ?`).join(", ")}, updated_by = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = 1`, [...values, actorId]);
    await audit(db, actorId, "company.updated", "company", "1", { fields: Object.keys(companyFields) });
    return getCompany(db);
  });
}
export async function listUsers(db: Db): Promise<User[]> {
  const users = await rows(db, "SELECT u.*, rr.role_code AS requested_role FROM crm_users u LEFT JOIN crm_role_requests rr ON rr.user_id = u.id ORDER BY u.created_at DESC, u.id DESC");
  const assignments = await rows(db, "SELECT ur.user_id, r.code FROM crm_user_roles ur JOIN crm_roles r ON r.code = ur.role_code AND r.active = TRUE ORDER BY r.code");
  const effective = await rows(db, "SELECT DISTINCT ur.user_id, p.code FROM crm_user_roles ur JOIN crm_roles r ON r.code = ur.role_code AND r.active = TRUE JOIN crm_role_permissions rp ON rp.role_code = r.code JOIN crm_permissions p ON p.code = rp.permission_code AND p.active = TRUE ORDER BY p.code");
  const roleMap = new Map<string, string[]>(), permissionMap = new Map<string, string[]>();
  for (const row of assignments) roleMap.set(row.user_id, [...(roleMap.get(row.user_id) || []), row.code]);
  for (const row of effective) permissionMap.set(row.user_id, [...(permissionMap.get(row.user_id) || []), row.code]);
  return users.map(row => ({ id: row.id, fullName: row.full_name, email: row.email_normalized, status: row.status, emailVerified: !!row.email_verified_at, roles: roleMap.get(row.id) || [], permissions: row.status === "ACTIVE" && row.email_verified_at ? permissionMap.get(row.id) || [] : [], requestedRole: row.requested_role || null, createdAt: iso(row.created_at) }));
}
export async function updateUser(actorId: string, targetId: string, input: { status: string; roles: string[] }) {
  return transaction(async db => {
    await lockSecurity(db);
    const target = await getUser(db, targetId); if (!target) throw new HttpError(404, "User not found");
    const approval = ["UNVERIFIED", "PENDING_APPROVAL"].includes(target.status) && ["ACTIVE", "REJECTED", "PENDING_APPROVAL"].includes(input.status);
    requirePermission(await getUser(db, actorId), approval ? "users.approve" : "users.manage", true);
    validateRoleChange(actorId, targetId, target.emailVerified, input.status, input.roles, 1);
    await rows(db, "SELECT id FROM crm_users WHERE id = ? FOR UPDATE", [targetId]);
    const activeRoles = await rows(db, "SELECT code FROM crm_roles WHERE active = TRUE"); if (input.roles.some(code => !activeRoles.some(r => r.code === code))) throw new HttpError(422, "Choose active system roles");
    await run(db, "DELETE FROM crm_user_roles WHERE user_id = ?", [targetId]);
    for (const role of input.roles) await run(db, "INSERT INTO crm_user_roles (user_id, role_code, assigned_by) VALUES (?, ?, ?)", [targetId, role, actorId]);
    await run(db, "UPDATE crm_users SET status = ?, updated_by = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [input.status, actorId, targetId]);
    await run(db, "UPDATE crm_role_requests SET reviewed_at = UTC_TIMESTAMP(3), reviewed_by = ? WHERE user_id = ?", [actorId, targetId]);
    validateRoleChange(actorId, targetId, target.emailVerified, input.status, input.roles, await effectiveAdminCount(db));
    await audit(db, actorId, approval ? "user.approval_changed" : "user.roles_status_changed", "user", targetId, { before: { status: target.status, roles: target.roles }, after: input });
    return { status: input.status, roles: input.roles };
  });
}
export async function listRoles(db: Db) {
  const roleRows = await rows(db, "SELECT code, name, protected FROM crm_roles WHERE active = TRUE ORDER BY protected DESC, name");
  const assignments = await rows(db, "SELECT rp.role_code, rp.permission_code FROM crm_role_permissions rp JOIN crm_permissions p ON p.code = rp.permission_code AND p.active = TRUE");
  return { items: roleRows.map(role => ({ code: role.code, name: role.name, protected: !!role.protected, permissions: assignments.filter(v => v.role_code === role.code).map(v => v.permission_code).sort() })), permissions: await rows(db, "SELECT code, name FROM crm_permissions WHERE active = TRUE ORDER BY code") };
}
export async function updateRole(actorId: string, code: string, permissions: string[]) {
  return transaction(async db => {
    await lockSecurity(db); requirePermission(await getUser(db, actorId), "roles.manage", true);
    const role = (await rows(db, "SELECT code FROM crm_roles WHERE code = ? AND active = TRUE FOR UPDATE", [code]))[0]; if (!role) throw new HttpError(404, "Role not found");
    protectRole(code, permissions);
    const active = await rows(db, "SELECT code FROM crm_permissions WHERE active = TRUE"); if (permissions.some(p => !active.some(v => v.code === p))) throw new HttpError(422, "Choose active system permissions");
    const before = (await rows(db, "SELECT permission_code FROM crm_role_permissions WHERE role_code = ?", [code])).map(v => v.permission_code);
    await run(db, "DELETE FROM crm_role_permissions WHERE role_code = ?", [code]);
    for (const permission of permissions) await run(db, "INSERT INTO crm_role_permissions (role_code, permission_code) VALUES (?, ?)", [code, permission]);
    if (await effectiveAdminCount(db) < 1) throw new HttpError(409, "At least one effective active administrator must remain");
    await audit(db, actorId, "role.permissions_changed", "role", code, { before, after: permissions });
    return { code, permissions };
  });
}
export async function mapCountry(actorId: string, code: string, regionCode: string) {
  return transaction(async db => {
    await lockSecurity(db); requirePermission(await getUser(db, actorId), undefined, true);
    const country = await rows(db, "SELECT code FROM crm_countries WHERE code = ? AND active = TRUE", [code]); const region = await rows(db, "SELECT code FROM crm_business_regions WHERE code = ? AND active = TRUE", [regionCode]);
    if (!country.length || !region.length) throw new HttpError(422, "Choose an active country and business region");
    const before = (await rows(db, "SELECT region_code FROM crm_country_regions WHERE country_code = ? FOR UPDATE", [code]))[0];
    await run(db, "UPDATE crm_country_regions SET region_code = ?, updated_by = ? WHERE country_code = ?", [regionCode, actorId, code]);
    await audit(db, actorId, "country.region_changed", "country", code, { before: before?.region_code, after: regionCode });
    return { code, regionCode };
  });
}
