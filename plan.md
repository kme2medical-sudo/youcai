# Youcai CRM Foundation V1 — implementation plan

## Confirmed platform and repository facts

The existing `kme2medical-sudo/youcai` repository was inspected at `f7efa0d1c40d27b0ef3b60f418f046dc81fd8646`; it contains only its README. Preserve that file and its Git history. Manus supports canonical GitHub export to a **new private repository**, not adoption of this existing repository. Do not invoke that export. Keep Manus-managed code history for checkpoints and publication; deliver a separate feature branch/PR to the existing repository with its original README preserved in `docs/original-repository-README.md`, if connector scope permits. Never push directly to the user's main or force-push.

The initialized stack is React 19 / TypeScript / Vite / Express with managed server and SQL database. Actual SQL version queried is `8.0.11-TiDB-v8.5.3-serverless`. Use portable tables, foreign keys, unique indexes, parameterized queries and explicit transactions, no triggers or stored procedures. Development and production share the managed DB.

Native app authentication offers Manus account OAuth, not application-owned email/password registration, verification or reset. The requested email/password identity will be self-managed using Node scrypt, opaque server-side sessions and hashed single-use expiring tokens in separate auth tables. A transactional-email provider (Resend API key plus verified sender and public origin) is needed to send verification/reset mail. Without it, show a truthful setup notice and fail closed: no verification bypass, developer login, seeded admin or exposed token. Implement and automatically test the full mail-provider flow with an injected test transport outside production; live delivery remains blocked until configured. No Google/Alibaba SSO or mailbox-password checks.

## Scope and architecture

Build only authentication, approval, multi-role RBAC, user/permission administration, single company record, customer/contact CRM, dashboard/profile, audit trail and documentation. Every business endpoint resolves the current session, ACTIVE status, and effective permissions from SQL on every request. No role claims cached in a cookie. Admin/CEO exact system role membership additionally protects General Settings. Lock a singleton security guard row for administrator changes to prevent concurrent last-admin removal. Restrict self-role/status modification, preserve mandatory top-level permissions, and bootstrap only verified exact allowlisted emails idempotently.

Use immutable UUID IDs and unique normalized emails. Role requests are separate from assignments. Reserve future permission names only in documentation. Products is a disabled navigation label for ACTIVE users, with no table, API or uploads.

Customers support list/detail/create/update/archive, duplicate warnings, country/type/region/status filters, search and pagination. Customer type and legal entity type remain independent. ISO countries and configurable business regions are persisted reference tables. Contacts support multiple rows; serialize changes by locking the parent customer so zero or one primary contact is guaranteed transactionally. Company data starts blank, apart from neutral currency/timezone defaults.

## Project structure

- `shared/crm.ts`: validation, role/permission constants and public DTO contracts.
- `server/crm/db.ts`, `scripts/migrate.ts`, `scripts/seed.ts`, `migrations/`: MySQL pool, deterministic migrations and rerunnable reference seeds.
- `server/crm/auth.ts`, `security.ts`, `mail.ts`: email/password identity, session/token handling, authorization, bootstrap and transactional email adapter.
- `server/crm/api.ts`, `services.ts`: protected REST API and transactional business services with safe audit metadata.
- `client/src/crm/`: API/session hooks, responsive layout and feature pages; existing component library available where useful.
- `tests/`: isolated policy/auth tests and rollback-isolated managed-DB integration tests; never seed fake deployed business records or privilege shortcuts.
- `docs/`: API/data relationships, security limitations, acceptance report, operational setup, and database backup/export/restore procedure separate from Git.

Serve the frontend and `/api/*` from one Express origin. Preserve `/api/health`, runtime port 3000, and Dockerfile-based publication; production uses `DATABASE_URL` at runtime. Use app-owned HttpOnly `youcai_session`, `SameSite=None; Secure` on public HTTPS, credentialed relative fetches and a session-bound CSRF token on mutations. Rate-limit authentication persistently. Never log secrets/tokens/passwords. Only public readiness metadata is exposed before login.

## Design

Reuse the requested professional, clean B2B medical-manufacturing visual language. The application is an operational workbench, not a marketing landing page: crisp typography, muted off-white canvas, deep teal navigation and a restrained jade accent, strong whitespace, precise table alignment and compact contextual status badges. Use a distinctive geometric Y mark with YOUCAI / MEDICAL wordmark, English text, keyboard-accessible controls and responsive sidebar/drawers. Use Manrope headings and system/Inter-style body typography. No stock illustrations or decorative charts, fabricated customers or company facts. Dashboard summaries derive only from permitted persisted records; honest empty and setup states are first-class UI. Animations are minimal (short opacity transitions), with reduced-motion support.

## Delivery workflow

Apply additive schema/reference seeds, implement authentication and server authorization, then admin/company/customer/contact UI and audit. Run automated checks and a read-only independent security/requirements review; correct confirmed defects. Save a Manus checkpoint and publish staging if supported and authorized by the original requested deliverable. Send a feature branch PR to the existing GitHub repository when authorized scope allows, otherwise supply source and exact safe export commands. Report pass/fail/blocked evidence separately, especially live email delivery, browser session behavior and publication status. Backups require a separate database export, not a GitHub sync.
