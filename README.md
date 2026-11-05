# Youcai Medical CRM & ERP — Foundation V1

## Current administrator access — local password login

The five owner-designated administrators use private one-time personal-password setup, then ordinary email/password login directly as Active Admin. No Firebase or email-provider configuration is needed for them. Access is owner-authorized; email ownership is not falsely marked verified. See [administrator direct login](docs/administrator-direct-login.md). Other applicants keep email verification and approval.

A focused CRM foundation for Youcai's internal team: verified email/password accounts, administrator approval, multi-role authorization, company information, customers and contacts. Built with **React 19, TypeScript, Vite, Express and `mysql2`** on Manus-managed hosting and a persistent MySQL-compatible database.

> **Latest administrator access:** the five owner-designated administrators use private one-time personal-password setup, then ordinary email/password login directly as Active Admin. No Firebase or email-provider configuration is needed for them. Their access is owner-authorized, not falsely marked email-verified. See [administrator direct login](docs/administrator-direct-login.md). Other applicants retain verification and approval.

> **Operational gate for ordinary applicants/recovery:** live account verification and password recovery require a real Resend API key, verified sender and public HTTPS origin. No live provider credentials are supplied. Registration/recovery fail closed without configuration; there is no mock login, seeded administrator or email-verification bypass. A source implementation or injected-mail test is not evidence of live email delivery.

## Foundation V1 scope

The application source covers account registration/sign-in, verification/reset/logout, applicant approval/rejection/suspension, multiple assigned roles, permission administration, profile/dashboard, a singleton Youcai General Information record, searchable/filterable/paginated customer records, customer archiving, multiple customer contacts and an audit trail. Customer and legal-entity types are independent; country codes use ISO alpha-2 with persisted configurable business-region mappings. Customer/contact data is not seeded for a fake demonstration.

Every business endpoint requires a verified ACTIVE account and server-side permission checks. Navigation visibility is an additional UI convenience, not the security boundary. Admin/CEO membership additionally protects General Settings. A selected registration role is a **request only**; it never grants access automatically.

**Products — Coming Soon** is a disabled/informational navigation item for ACTIVE users. There is no Products module, product table/API/upload/download, pricing, quotes, inventory, technical-document repository, workflow engine, customer portal, Google sign-in or Alibaba SSO in V1. Future permission names remain reservations, not implemented features.

### Default role access

| Display role          | V1 business access                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Admin / CEO           | User approval/management, roles/permissions, company information, full customer/contact management and audit access. |
| Pricing               | Customer read only; dashboard/profile.                                                                               |
| Sales Representative  | Customer read/create/update and contact management; no customer archive or General Settings.                         |
| Employee / Technician | Dashboard/profile only; no customer/company/General Settings APIs by default.                                        |

The six stable role codes are `admin`, `ceo`, `pricing`, `sales`, `employee` and `technician`. Effective permissions are the union of assigned active roles/permissions and are resolved from SQL on each request. Security transactions prohibit self-role/status changes and loss of the last effective active top-level administrator; core Admin/CEO permission sets are protected.

Current permission codes are `users.read`, `users.approve`, `users.manage`, `roles.read`, `roles.manage`, `company.read`, `company.update`, `customers.read`, `customers.create`, `customers.update`, `customers.archive`, `contacts.manage` and `audit.read`.

## Platform facts and deliberate alternatives

- **Database:** the observed server reports `8.0.11-TiDB-v8.5.3-serverless`. This is TiDB, not a stock MySQL server. Schema/service design uses compatible relational tables, declared foreign keys/indexes, parameterized SQL and explicit transactions, without triggers or stored procedures. Managed development and production share the database; another preview/publication is not data isolation.
- **Authentication:** native starter Manus-account OAuth does not supply the requested CRM email/password lifecycle. V1 therefore uses self-managed salted Node scrypt passwords, opaque server-side sessions and hashed expiring single-use verification/reset tokens. Resend is the mail adapter. The legacy starter `users` table is unused by CRM, and starter OAuth endpoints are not registered by this runtime.
- **GitHub:** the existing destination is [kme2medical-sudo/youcai](https://github.com/kme2medical-sudo/youcai). Initial inspection found a README-only `main` at `f7efa0d1c40d27b0ef3b60f418f046dc81fd8646`. Native Manus export creates a **new private repository** only; it does not link this existing repository. Preserve its README/history and use an authorized feature branch/PR, not a replacement repo, direct `main` push or force push. Manus checkpoints are separate from existing-repository commits.

These are capability boundaries, not promises that production email, a deployed URL, a backup or a GitHub PR has already been verified. Actual evidence belongs in the delivery/test report.

## Setup and commands

Use Node.js 22+ and pnpm 10.18.0. Configure an **isolated local/test database**, or obtain explicit approval before running schema/data-writing commands against the shared managed database:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
chmod 600 .env
# Privately configure the DB and email settings; never commit .env.
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` serves the complete Express/Vite app on `PORT` (default 3000). `pnpm build` and `pnpm start` build/serve the production app. Browser sessions use Secure cookies, so use an HTTPS preview/development origin for end-to-end sign-in rather than weakening cookies for plain HTTP.

| Command                                                  | Purpose                                                                                                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate`                                        | Apply checked-in CRM SQL migrations; verify applied checksums.                                                                                                                     |
| `pnpm db:seed`                                           | Insert missing six roles, thirteen permissions, 249 ISO countries, seven regions and blank/default company record; preserve existing edits. Creates no login identity or customer. |
| `pnpm check`                                             | TypeScript check.                                                                                                                                                                  |
| `pnpm test`                                              | Automated suite; review current integration gating/isolation before allowing database access.                                                                                      |
| `pnpm build` / `pnpm start`                              | Build and serve frontend plus Express backend.                                                                                                                                     |
| `pnpm db:backup --directory /absolute/private/directory` | Separately authorized read-only logical JSON export; excludes credential/session/token/rate-limit tables by default.                                                               |

Use `.env.example` as a placeholder reference for **`DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_PUBLIC_URL` and `PORT`**. Managed hosting provisions secrets server-side. Configure `APP_PUBLIC_URL` to the canonical public HTTPS origin and `EMAIL_FROM` to a provider-verified sender. No secret belongs in a `VITE_*` variable or frontend bundle. `GET /api/health` is process liveness only; `GET /api/auth/config` is configuration readiness metadata, not a delivery/inbox check.

The CRM migration runner is separate from the unused starter Drizzle schema. Do not use starter schema-push/OAuth paths to provision CRM access. Migrations and seeding are explicit operations, not automatic server startup side effects.

## First access and account links

Register with name, normalized email, password and one requested role. On the emailed verification form, the mailbox owner chooses/confirms the final sign-in password; it replaces any preregistration password and revokes all earlier sessions before email verification. Non-allowlisted applicants then remain PENDING_APPROVAL with no business API access until Admin/CEO review. Admin/CEO may assign multiple roles later.

Only successful first verification of these **exact** addresses can bootstrap Admin idempotently:

```text
alberto@youcaimedical.com
eniodeleon87@gmail.com
eadlr1@gmail.com
kme2medical@gmail.com
wangxukai@youcaimedical.com
```

There is no blanket `@youcaimedical.com` administrator rule, shared default password, development backdoor or mailbox-password authentication. Users may sign in to see an unverified/pending/suspended status page without gaining business permissions.

All five become ACTIVE + Admin on successful initial email ownership verification without another administrator approving them. Every other verified applicant stays PENDING_APPROVAL. See the [first-administrator registration guide](docs/first-administrator.md) for the published URL, exact steps, security controls and current email-delivery gate.

Email links carry a sensitive `token` in the URL query and the SPA submits it by POST for verification/reset. Do not put these links in logs, screenshots or analytics. Configure real email first and verify final HTTPS routes/cookies/mail delivery before declaring the account lifecycle accepted.

## Source map and documentation

- `client/src/crm/`: application session/API hooks, navigation, auth and business screens.
- `shared/crm.ts`: server/shared role/permission constants, DTOs and validation.
- `server/crm/`: `mysql2` persistence, auth/mail/security, protected REST routes and transactional services.
- `migrations/`, `scripts/migrate.ts`, `scripts/seed.ts`: additive schema/history and rerunnable reference seeding.
- `scripts/backup.ts`: manual read-only exporter; no automated restore or backup schedule.
- `tests/`: automated checks; actual results and database/browser/mail evidence are reported separately.

Read the [backend API and security contract](docs/backend.md), [operations, security and backup/recovery guide](docs/operations.md), [actual table relationships and ERD](docs/data-model.md), and [safe existing-GitHub-repository handoff](docs/github-sync.md). The existing repository's original README is preserved at [docs/original-repository-README.md](docs/original-repository-README.md).

## Known limitations and release evidence

Read the [acceptance report](docs/acceptance-report.md) for observed pass/blocked evidence. Run `pnpm test:all` for the backend/starter and frontend suites; tests with live SQL must use the documented rollback isolation or a separate database copy after real onboarding.

Live verification/recovery delivery is blocked until a real provider/sender/origin is configured; metadata readiness does not prove delivery. Native existing-repository sync is unsupported, and a Manus checkpoint/publication must not be presented as a GitHub commit/PR. Shared managed dev/production storage is not isolated staging. End-to-end HTTPS/session behavior, provider delivery, database restore and publication require their own observed checks; do not infer them from screenshots, TypeScript compilation or a green isolated unit test.

Company identity fields start blank apart from neutral UTC/USD defaults; admins must enter verified business information. Country-region mappings are business configuration, not verified pricing territories. There is no automatic backup schedule, destructive restore importer or claimed point-in-time recovery. Default exports contain confidential identity/business data but omit password hashes and authentication state, so recovering sign-in requires an approved credential-recovery procedure or separately authorized encrypted full export. **GitHub is not a database backup.** Keep all JSON exports private, encrypted, outside every source repository and out of commits.

## Alibaba Mail and verification sender

The corporate receiving domain remains on Alibaba Mail and must not be changed. This project does not expose native delivery for app-owned email/password verification/reset; Manus OAuth/private-site login and owner notifications are not substitutes. Use the existing mail adapter with a separate user-controlled sending domain, without moving corporate inboxes or sharing mailbox passwords. See [authentication/email decision and exact activation steps](docs/authentication-email-decision.md). Five exact owners remain verified-only ACTIVE/Admin; no shared/default password or unauthenticated administration is added. Provider setup and live delivery remain gated.
