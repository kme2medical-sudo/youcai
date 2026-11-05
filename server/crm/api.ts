import { Router, type Request, type Response, type NextFunction } from "express";
import express from "express";
import { z, ZodError } from "zod";
import { CUSTOMER_TYPES, PERMISSION_CODES, ROLE_CODES, REGION_CODES, customerSchema, contactSchema, companySchema, userUpdateSchema } from "../../shared/crm";
import { getPool, rows, iso } from "./db";
import { authRouter } from "./auth";
import { HttpError, permission, checkOrigin, type AuthContext } from "./security";
import { getCustomer, listCustomers, saveCustomer, archiveCustomer, listContacts, saveContact, deleteContact, getCompany, saveCompany, listUsers, updateUser, listRoles, updateRole, mapCountry } from "./services";
export const crmRouter = Router();
const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };
const actor = (res: Response): AuthContext => res.locals.auth;
const id = (value: string): string => z.uuid().parse(value);
const page = z.coerce.number().int().min(1).max(100000).default(1);
crmRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
crmRouter.use((req, _res, next) => { try { if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) { checkOrigin(req); const bodyless = !req.get("transfer-encoding") && (!req.get("content-length") || req.get("content-length") === "0") && (req.method === "DELETE" || req.path === "/auth/logout"); if (!bodyless && !req.is("application/json")) throw new HttpError(415, "Use application/json requests"); } next(); } catch (error) { next(error); } });
crmRouter.use(express.json({ limit: "128kb" }));
crmRouter.use("/auth", authRouter);
crmRouter.get("/reference", permission(), asyncRoute(async (_req, res) => {
  const db = getPool();
  return res.json({ countries: await rows(db, "SELECT c.code, c.name, cr.region_code AS regionCode FROM crm_countries c JOIN crm_country_regions cr ON cr.country_code = c.code JOIN crm_business_regions r ON r.code = cr.region_code AND r.active = TRUE WHERE c.active = TRUE ORDER BY c.name"), regions: await rows(db, "SELECT code, name FROM crm_business_regions WHERE active = TRUE ORDER BY FIELD(code, 'NA', 'CA', 'SA', 'EU', 'MENA', 'APAC', 'OTHER')"), roles: await rows(db, "SELECT code, name FROM crm_roles WHERE active = TRUE ORDER BY protected DESC, name"), permissions: await rows(db, "SELECT code, name FROM crm_permissions WHERE active = TRUE ORDER BY code") });
}));
crmRouter.get("/dashboard", permission(), asyncRoute(async (_req, res) => {
  const db = getPool(), user = actor(res).user;
  const summary: Record<string, any> = { customersTotal: 0, customersActive: 0, customersArchived: 0, contactsTotal: 0, recentActivity: [] };
  if (user.permissions.includes("customers.read")) { const count = (await rows(db, "SELECT COUNT(*) AS total, COALESCE(SUM(status = 'ACTIVE'), 0) AS active, COALESCE(SUM(status = 'ARCHIVED'), 0) AS archived FROM crm_customers"))[0]; summary.customersTotal = Number(count.total); summary.customersActive = Number(count.active); summary.customersArchived = Number(count.archived); summary.contactsTotal = Number((await rows(db, "SELECT COUNT(*) AS total FROM crm_customer_contacts"))[0].total); }
  if (user.permissions.includes("users.read") && user.roles.some(r => ["admin", "ceo"].includes(r))) summary.pendingUsers = Number((await rows(db, "SELECT COUNT(*) AS total FROM crm_users WHERE status = 'PENDING_APPROVAL' AND email_verified_at IS NOT NULL"))[0].total);
  const canAudit = user.permissions.includes("audit.read");
  const logs = await rows(db, `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.full_name AS actor_name FROM crm_audit_logs a LEFT JOIN crm_users u ON u.id = a.actor_id ${canAudit ? "" : "WHERE a.actor_id = ?"} ORDER BY a.created_at DESC, a.id DESC LIMIT 8`, canAudit ? [] : [user.id]);
  summary.recentActivity = logs.map(row => ({ id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, actorName: row.actor_name, createdAt: iso(row.created_at) }));
  return res.json(summary);
}));
crmRouter.get("/customers", permission("customers.read"), asyncRoute(async (req, res) => {
  const filters = z.object({ q: z.string().trim().max(160).optional(), type: z.enum(CUSTOMER_TYPES).optional(), country: z.string().length(2).toUpperCase().optional(), region: z.enum(REGION_CODES).optional(), status: z.enum(["ACTIVE", "ARCHIVED"]).optional(), page }).strict().parse(req.query);
  return res.json(await listCustomers(filters));
}));
crmRouter.get("/customers/:id", permission("customers.read"), asyncRoute(async (req, res) => { const customerId = id(req.params.id); const db = getPool(); return res.json({ customer: await getCustomer(db, customerId), contacts: await listContacts(db, customerId) }); }));
crmRouter.post("/customers", permission("customers.create"), asyncRoute(async (req, res) => res.status(201).json(await saveCustomer(actor(res).user.id, customerSchema.parse(req.body)))));
crmRouter.put("/customers/:id", permission("customers.update"), asyncRoute(async (req, res) => res.json(await saveCustomer(actor(res).user.id, customerSchema.parse(req.body), id(req.params.id)))));
crmRouter.post("/customers/:id/archive", permission("customers.archive"), asyncRoute(async (req, res) => { const input = z.object({ archived: z.boolean() }).strict().parse(req.body); return res.json(await archiveCustomer(actor(res).user.id, id(req.params.id), input.archived)); }));
crmRouter.post("/customers/:id/contacts", permission("contacts.manage"), asyncRoute(async (req, res) => res.status(201).json(await saveContact(actor(res).user.id, id(req.params.id), contactSchema.parse(req.body)))));
crmRouter.put("/customers/:id/contacts/:contactId", permission("contacts.manage"), asyncRoute(async (req, res) => res.json(await saveContact(actor(res).user.id, id(req.params.id), contactSchema.parse(req.body), id(req.params.contactId)))));
crmRouter.delete("/customers/:id/contacts/:contactId", permission("contacts.manage"), asyncRoute(async (req, res) => { await deleteContact(actor(res).user.id, id(req.params.id), id(req.params.contactId)); return res.status(204).end(); }));
crmRouter.get("/company", permission("company.read", true), asyncRoute(async (_req, res) => res.json(await getCompany(getPool()))));
crmRouter.put("/company", permission("company.update", true), asyncRoute(async (req, res) => res.json(await saveCompany(actor(res).user.id, companySchema.parse(req.body)))));
crmRouter.get("/users", permission("users.read", true), asyncRoute(async (_req, res) => res.json({ items: await listUsers(getPool()) })));
crmRouter.put("/users/:id", permission(undefined, true), asyncRoute(async (req, res) => res.json(await updateUser(actor(res).user.id, id(req.params.id), userUpdateSchema.parse(req.body)))));
crmRouter.get("/roles", permission("roles.read", true), asyncRoute(async (_req, res) => res.json(await listRoles(getPool()))));
crmRouter.put("/roles/:code", permission("roles.manage", true), asyncRoute(async (req, res) => { const code = z.enum(ROLE_CODES).parse(req.params.code); const input = z.object({ permissions: z.array(z.enum(PERMISSION_CODES)).max(PERMISSION_CODES.length).refine(v => new Set(v).size === v.length, "Duplicate permissions") }).strict().parse(req.body); return res.json(await updateRole(actor(res).user.id, code, input.permissions)); }));
crmRouter.put("/reference/countries/:code", permission(undefined, true), asyncRoute(async (req, res) => { const code = z.string().length(2).toUpperCase().parse(req.params.code); const input = z.object({ regionCode: z.enum(REGION_CODES) }).strict().parse(req.body); return res.json(await mapCountry(actor(res).user.id, code, input.regionCode)); }));
crmRouter.get("/audit", permission("audit.read"), asyncRoute(async (req, res) => {
  const input = z.object({ page, action: z.string().max(80).optional() }).strict().parse(req.query), db = getPool(), pageSize = 25;
  const where = input.action ? "WHERE a.action = ?" : "", args = input.action ? [input.action] : [];
  const total = Number((await rows(db, `SELECT COUNT(*) AS total FROM crm_audit_logs a ${where}`, args))[0].total);
  const logs = await rows(db, `SELECT a.*, u.full_name AS actor_name FROM crm_audit_logs a LEFT JOIN crm_users u ON u.id = a.actor_id ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${pageSize} OFFSET ${(input.page - 1) * pageSize}`, args);
  const items = logs.map(row => ({ id: row.id, actorId: row.actor_id, actorName: row.actor_name, action: row.action, entityType: row.entity_type, entityId: row.entity_id, metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata, createdAt: iso(row.created_at) }));
  return res.json({ items, pagination: { total, page: input.page, pageSize } });
}));
crmRouter.use((req, _res, next) => { if (/^\/(auth|customers|company|users|roles|reference|dashboard|audit|products)(\/|$)/.test(req.path)) return next(new HttpError(404, "Endpoint not found")); next(); });
crmRouter.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) return res.status(422).json({ message: "Please check the submitted fields", errors: error.issues.map(v => ({ field: v.path.join("."), message: v.message })) });
  if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
  if (error?.type === "entity.too.large") return res.status(413).json({ message: "Request is too large" });
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ message: "Invalid JSON request" });
  // Deliberately omit SQL error bodies, request payloads, credentials and tokens from logs and responses.
  console.error("[Youcai] CRM request failed", { category: error?.code === "ER_NO_SUCH_TABLE" ? "setup_required" : "internal_error" });
  return res.status(500).json({ message: "The request could not be completed. Please try again." });
});
