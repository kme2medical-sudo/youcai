import { z } from "zod";

export const ROLE_CODES = ["admin", "ceo", "pricing", "sales", "employee", "technician"] as const;
export const ROLE_NAMES: Record<typeof ROLE_CODES[number], string> = { admin: "Admin", ceo: "CEO", pricing: "Pricing", sales: "Sales Representative", employee: "Employee", technician: "Technician" };
export const PERMISSION_CODES = ["users.read", "users.approve", "users.manage", "roles.read", "roles.manage", "company.read", "company.update", "customers.read", "customers.create", "customers.update", "customers.archive", "contacts.manage", "audit.read"] as const;
export const CUSTOMER_TYPES = ["Medical Device Manufacturer", "Distributor", "Doctor/Individual Practitioner", "Hospital/Clinic", "Government/Public Institution", "Other"] as const;
export const LEGAL_ENTITY_TYPES = ["Corporation/S.A.", "LLC/Limited Liability Company", "Individual/Sole Proprietor", "Government Entity", "Other"] as const;
export const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Prof.", "Lic.", "Dr.", "Sr.", "Srita.", "Other"] as const;
export const USER_STATUSES = ["UNVERIFIED", "PENDING_APPROVAL", "ACTIVE", "REJECTED", "SUSPENDED"] as const;
export const REGION_CODES = ["NA", "CA", "SA", "EU", "MENA", "APAC", "OTHER"] as const;
export type RoleCode = typeof ROLE_CODES[number];
export type PermissionCode = typeof PERMISSION_CODES[number];
export type UserStatus = typeof USER_STATUSES[number];
export interface User { id: string; fullName: string; email: string; status: UserStatus; emailVerified: boolean; accessAuthorized?: boolean; accessMethod?: "EMAIL_VERIFIED" | "OWNER_PROVISIONED" | null; roles: string[]; permissions: string[]; requestedRole?: string | null; createdAt?: string; }
export interface Customer { id: string; displayName: string; legalName: string | null; customerType: string; legalEntityType: string | null; countryCode: string; regionCode: string; email: string | null; phone: string | null; website: string | null; taxId: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null; notes: string | null; status: "ACTIVE" | "ARCHIVED"; createdAt: string; updatedAt: string; }
export interface Contact { id: string; customerId: string; salutation: string | null; fullName: string; alias: string | null; jobTitle: string | null; phone: string | null; email: string | null; isPrimary: boolean; }
export interface Company { tradingName: string | null; legalName: string | null; logoUrl: string | null; website: string | null; email: string | null; phone: string | null; countryCode: string | null; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null; timezone: string; defaultCurrency: string; description: string | null; updatedAt: string; updatedBy: string | null; }
export interface AuthResponse { user: User | null; csrfToken?: string; }
const optionalText = (length: number) => z.string().trim().max(length).nullable().optional().transform(v => v || null);
const optionalEmail = z.union([z.email().max(254), z.literal(""), z.null()]).optional().transform(v => v ? v.trim().toLowerCase() : null);
const optionalUrl = z.union([z.url().max(2048).refine(v => /^https?:\/\//i.test(v), "Use an HTTP(S) URL"), z.literal(""), z.null()]).optional().transform(v => v || null);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(12, "Use at least 12 characters").max(128);
export const registerSchema = z.object({ fullName: z.string().trim().min(2).max(160), email: emailSchema, password: passwordSchema, requestedRole: z.enum(ROLE_CODES) }).strict();
export const customerSchema = z.object({
  displayName: z.string().trim().min(1).max(200), legalName: optionalText(240), customerType: z.enum(CUSTOMER_TYPES), legalEntityType: z.enum(LEGAL_ENTITY_TYPES).nullable().optional().transform(v => v || null), countryCode: z.string().trim().toUpperCase().length(2),
  email: optionalEmail, phone: optionalText(60), website: optionalUrl, taxId: optionalText(100), addressLine1: optionalText(240), addressLine2: optionalText(240), city: optionalText(120), state: optionalText(120), postalCode: optionalText(32), notes: optionalText(10000),
}).strict().superRefine((value, ctx) => { if (value.legalEntityType && ["Corporation/S.A.", "LLC/Limited Liability Company", "Government Entity"].includes(value.legalEntityType) && !value.legalName) ctx.addIssue({ code: "custom", path: ["legalName"], message: "Legal name is required for a registered legal entity" }); });
export const contactSchema = z.object({ salutation: z.enum(SALUTATIONS).nullable().optional().transform(v => v || null), fullName: z.string().trim().min(1).max(160), alias: optionalText(120), jobTitle: optionalText(160), phone: optionalText(60), email: optionalEmail, isPrimary: z.boolean().default(false) }).strict();
export const companySchema = z.object({ tradingName: optionalText(240), legalName: optionalText(240), logoUrl: optionalUrl, website: optionalUrl, email: optionalEmail, phone: optionalText(60), countryCode: z.union([z.string().trim().toUpperCase().length(2), z.literal(""), z.null()]).optional().transform(v => v || null), addressLine1: optionalText(240), city: optionalText(120), state: optionalText(120), postalCode: optionalText(32), timezone: z.string().max(80).refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Use an IANA timezone"), defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/), description: optionalText(10000) }).strict();
export const userUpdateSchema = z.object({ status: z.enum(["PENDING_APPROVAL", "ACTIVE", "REJECTED", "SUSPENDED"]), roles: z.array(z.enum(ROLE_CODES)).max(6).refine(v => new Set(v).size === v.length, "Duplicate roles") }).strict();
export type CustomerInput = z.infer<typeof customerSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type CompanyInput = z.infer<typeof companySchema>;
