# Operations — Foundation V1

## Deployment and configuration

The runtime is a same-origin React/TypeScript SPA and Express REST backend. `pnpm dev` serves Vite through Express; `pnpm build` produces `dist/index.js` and `dist/public/`; `pnpm start` runs the production backend. Manus publication uses the project's Dockerfile and managed runtime. Static-only Vite commands do **not** provide authentication or CRM APIs and are not a full application deployment.

The observed managed SQL engine is **`8.0.11-TiDB-v8.5.3-serverless`**. This project's managed development and production applications share the same database. Publishing another app revision does not make an isolated staging database. Do not run experimental migrations, business-data fixtures, destructive tests or restore commands against that shared database without explicit authorization.

Use Node.js 22+ and the lockfile's pnpm version (10.18.0). The following sequence is for a **new, isolated local/test database** or an explicitly approved managed deployment, not permission to modify production data:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
chmod 600 .env
# Edit .env privately; use an isolated DB and never paste credentials into logs.
pnpm db:migrate
pnpm db:seed
pnpm dev
# Production build/start, after configuration and deployment review:
pnpm build
pnpm start
```

Migrations and seeds are separate, explicit commands. The server does not automatically migrate, seed, or create an administrator on startup. `pnpm db:migrate` invokes the checked-in CRM migration runner, **not** the starter Drizzle migration path. Do not use a generic schema-push command to manage these `crm_*` tables. The runner checks applied migration checksums; add a migration rather than editing an applied one. DDL can partially apply, so inspect and safely rerun after fixing a failure rather than assuming rollback removed it.

### Server variables

| Variable         | Required for                                                      | Operational guidance                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | All persisted auth and CRM operations, migrations, seeds, exports | Private MySQL-compatible URL. Manus supplies it in the managed environment; local development needs its own isolated DB. The CRM connection uses `mysql2`, UTC/date strings, parameterized SQL and certificate-verified TLS for non-loopback hosts. |
| `RESEND_API_KEY` | Live verification/reset mail                                      | Provision privately through server secrets; never a `VITE_*` value. No real provider credential is supplied in the example.                                                                                                                         |
| `EMAIL_FROM`     | Live verification/reset mail                                      | A real, provider-verified sender mailbox or display-name/mailbox value. Configure domain verification in the email provider before using it. It is not a user's mailbox password.                                                                   |
| `APP_PUBLIC_URL` | Account-link origin and allowed request origin                    | The canonical public **HTTPS origin**, e.g. your published application hostname; no query, token or credentials. Set the final hostname before sending mail.                                                                                        |
| `PORT`           | Express listen port                                               | Default 3000; must match the managed publication/container contract.                                                                                                                                                                                |
| `NODE_ENV`       | Runtime mode                                                      | Set by the `dev`/`start` scripts. Production forbids injected test mail transports.                                                                                                                                                                 |

The actual variable names above come from `server/crm/db.ts`, `mail.ts`, `security.ts` and `server/_core/index.ts`. The checked-in [`.env.example`](../.env.example) contains placeholders only. Do not use starter Manus OAuth/JWT settings to attempt CRM email/password login. Keep `.env`, private connection URLs and exports out of source control and all frontend bundles.

## Email/password identity and first administrator

Native starter authentication is Manus-account OAuth, not the application's required email/password registration, verification and recovery service. Foundation V1 therefore owns its CRM identities and auth lifecycle. Starter OAuth helper files/legacy `users` may remain in the scaffold, but the CRM runtime does **not** register their OAuth endpoints and does not use them for CRM access. There is no Google, Alibaba, mailbox-password check, mock sign-in, seeded administrator or verification bypass.

Provision Resend, a verified sender and the exact public origin first. `GET /api/auth/config` reports `emailReady`, but this is only a configuration-shape check: it does not prove domain verification, provider acceptance or delivery to an inbox. Registration/resend/forgot/reset reject missing configuration with a setup-required response; no account can become an initial administrator by simply typing an allowlisted email. Already-created valid verification tokens can still be redeemed by their POST endpoint; lack of mail configuration does not generate or reveal new tokens.

**Live email delivery is currently blocked until real provider settings are supplied.** Tests may inject a transport outside production to capture mail privately and verify token flows; that is test evidence, not proof of live mail delivery. Account-mail responses stay generic to avoid disclosing account existence. A provider delivery failure invalidates the just-issued token and does not expose provider bodies or mail URLs; an applicant may need to request a new verification link after the provider issue is fixed. A generic “email will be sent” response is not delivery confirmation.

The first-Admin procedure after configuration is:

1. The owner of one of the five exact addresses registers normally, entering name, email, their own password and one requested role. There is no shared or default password.
2. The owner receives the verification mail, opens its link, and explicitly submits verification with their chosen password and confirmation (the registration password can be reused). Backend token validation—not possession of an email string—confirms ownership; all preverification sessions are revoked before access is granted.
3. On successful first verification, an eligible exact allowlisted account receives Admin and ACTIVE status idempotently. Other verified applicants remain PENDING_APPROVAL and receive no business data until an Admin/CEO approves them and assigns roles.
4. Admin/CEO can assign multiple roles, reject or suspend applicants. Selecting a desired role is never an assignment. Administrative mutations are audited and prevent self-role/status change or loss of the last effective active top-level administrator.

Exact addresses, not a domain rule:

```text
alberto@youcaimedical.com
eniodeleon87@gmail.com
eadlr1@gmail.com
kme2medical@gmail.com
wangxukai@youcaimedical.com
```

### Session and account-token behavior

Passwords use salted Node scrypt (`N=32768`, `r=8`, `p=1`, 64-byte derived key); registration/reset validation requires 12–128 characters. Eight-hour opaque server-side sessions store only SHA-256 token hashes and CSRF hashes. The `youcai_session` cookie is HttpOnly, Secure, SameSite=None and path `/`. Relative, credentialed API calls keep frontend/backend on one origin. Mutations of authenticated state require `X-CSRF-Token`; the backend checks request origin and accepts JSON bodies, not a public HTML-form bypass.

The Secure cookie requires browser HTTPS. A plain local HTTP page is not a reliable end-to-end session environment; use a trusted HTTPS development origin/reverse proxy. Do not weaken cookie settings to make an insecure demo appear functional. Review trusted reverse-proxy handling before exposure: the implementation does not blindly trust client `X-Forwarded-For`, and a managed proxy can aggregate IP throttle buckets. Persistent auth rate limits also use hashed normalized-email buckets.

Verification and reset mails use **`?token=...` query parameters**, not fragments. The link opens a SPA page, which submits the token in a JSON **POST** to `/api/auth/verify` or `/api/auth/reset`; opening a GET URL must not itself grant access or reset a password. Verification tokens expire after 24 hours; reset tokens after 30 minutes. Tokens are hashed, purpose-bound, expiring and consumed once. Password reset invalidates that user's sessions and reset tokens. Browser query strings/mail links are sensitive: avoid third-party analytics on these pages, redact query strings in upstream access logs, and never share a screenshot or HAR containing a token. The backend sets `Referrer-Policy: no-referrer` and no-store on APIs; these headers alone do not erase browser history or redact an upstream proxy's logs. Validate final SPA route aliases against the mail link paths before release.

## Access and operational checks

Business APIs require a current session, verified ACTIVE account and permission on every request. Roles and status are reloaded from SQL rather than trusted from cached client state, so later role/status changes affect subsequent requests immediately. An already-in-flight transaction may finish; this is not a claim of canceling work already running. Only actual Admin/CEO membership plus the required permission can open General Settings. Protect the `crm_security_guard` row and do not administer roles/status with direct SQL.

`GET /api/health` is a minimal process liveness check (`{"status":"ok"}`), **not** a database, migration, mail-delivery or authorization-readiness assertion. A public auth config response exposes readiness metadata only. Before making a deployment available, verify an authorized API request against the migrated database, final HTTPS cookie behavior, direct unauthorized API denial and mail delivery from the final hostname.

Customers and contacts are personal/business data. Audit events record selected metadata rather than passwords, tokens or unrestricted request bodies. Default customer removal is archiving. Do not fabricate company legal details or deployed customers for a demonstration. The Products item is disabled/informational for ACTIVE users; no Products API, storage workflow or product/pricing/inventory tables exist in V1.

### Tests and reporting discipline

Use `pnpm check`, `pnpm build` and the current `pnpm test` suite after reviewing test configuration. Do not assume an integration test is safe just because it is called a test: confirm isolation, gating and cleanup before granting it shared-database access. Never add fake deployed identities or relax verification to get a green test. The acceptance report must distinguish unit/injected-transport evidence, database integration evidence, browser/session evidence and live email/publication evidence.

This operations guide does **not** assert that all acceptance tests passed or a site/PR was published. Consult the delivered test report and final delivery references for observed results. A blocked live-email check stays blocked until actual provider/inbox evidence exists. Backups and restores also need separate evidence; the exporter's help/type check is not an executed database backup or a tested restore.

Exporter-only validation observed during documentation delivery: isolated TypeScript checking, help/unsafe-argument checks, and six synthetic-driver cases passed (default auth exclusion, explicit auth inclusion, schema-change rejection, new sensitive-column rejection, missing-table rejection and stream-failure cleanup). Synthetic checks verified row counts/hashes, lossless string/binary serialization and mode-0600 output without any real database connection; temporary synthetic files were removed. This is not evidence that the managed engine accepted the snapshot syntax, that real customer data was exported, or that recovery was exercised.

V1 operational limits include a complete batched user directory rather than server-side applicant pagination, no MFA/SSO, and no durable email retry queue. Company logos are optional external URLs, not a file-upload/repository workflow. Review these boundaries before increasing deployment scale or making stronger availability/security claims.

Initial email verification also requires the mailbox owner to choose and confirm a password on the mailed verification form. The verification transaction replaces any preregistration credential and invalidates every preverification session before ACTIVE bootstrap or PENDING_APPROVAL, preventing a preregistration attacker from inheriting access after the owner verifies. Entering an email or a requested role alone never grants access.

## Database export and recovery

### Authorization and coverage

GitHub source sync, a source archive and Manus checkpoints are **not database backups**. The shared managed database requires a separate backup/export policy. No unattended schedule or provider point-in-time recovery capability is configured or promised here. Decide retention, storage region, encryption recipients and recovery objectives with the data owner/provider; this manual script alone is not a disaster-recovery service.

Running an export requires explicit permission to read/export the database, including customer/contact/audit/user personal data. Use a narrowly scoped read-only database principal where the provider supports one: SELECT on reviewed tables and access to schema metadata/SHOW CREATE TABLE. Do not publish or upload a backup to a public URL. No real database export has been run as part of writing this guide, even if the database currently contains no customer records.

[`scripts/backup.ts`](../scripts/backup.ts) is a manual **read-only logical JSON exporter**. It does not import migration/seed routines, create users or issue business-data writes. It discovers actual base tables through INFORMATION_SCHEMA and exports only its reviewed allowlist from a single `REPEATABLE READ` transaction started with `WITH CONSISTENT SNAPSHOT, READ ONLY`. If the engine rejects that snapshot/read-only contract, the operation fails closed rather than downgrading consistency. Freeze migrations during export; it rechecks table definitions/table names and discards caught failed exports. Very large exports are subject to provider snapshot lifetime/resource limits; coordinate with the provider rather than falling back to an inconsistent series of queries.

The complete reviewed business schema must be visible, and auth-included mode additionally requires all reviewed auth tables. Missing tables/permissions abort instead of producing an apparently complete backup. A newly added business column with an authentication-sensitive name also stops a default export pending review. After adding migrations, update and review the script's allowlist/security assumptions before treating its coverage as complete.

By default it exports the V1 `crm_*` business/reference/security-guard/migration tables, **including `crm_users` identity metadata** so role and actor relationships remain intact. It excludes:

- `crm_auth_credentials`: salted password hashes.
- `crm_auth_sessions`: hashed session and CSRF state.
- `crm_auth_tokens`: hashed verification/reset state.
- `crm_auth_rate_limits`: hashed throttling state.

The legacy starter `users` table and unreviewed future tables are skipped in both modes. The manifest lists exclusions/ignored tables; review them before accepting completeness. Default identity metadata still includes names, normalized emails, approvals and bootstrap state and is confidential. Auth exclusion means a recovered app cannot sign in from this export alone; it does **not** mean identity/role/actor metadata is omitted.

### Run an authorized manual export

Supply `DATABASE_URL` through the private environment or `.env`, never in a command argument or terminal transcript. Create a user-designated private directory **outside every source repository**:

```bash
# Example location; choose a private destination approved by the data owner.
install -d -m 700 /home/ubuntu/private-youcai-backups
pnpm exec tsx scripts/backup.ts --help
# Only after explicit data-export authorization:
pnpm db:backup --directory /home/ubuntu/private-youcai-backups
```

For a separately approved credential-bearing export:

```bash
pnpm db:backup --directory /home/ubuntu/private-youcai-backups \
  --include-auth --acknowledge-sensitive-export
```

`--include-auth` includes all four reviewed auth tables and therefore password hashes. Both flags are required to acknowledge the sensitive cleartext output; **neither flag encrypts it**. Encrypt externally with the organization's approved tool (for example age/GPG with verified recipients), store decryption keys separately, and transfer only ciphertext through approved private storage. All exports, including the default business-only mode, deserve encryption and access controls. The exporter requires a destination owned by the current OS user without group/other permissions and creates a unique file exclusively with mode 0600. It rejects locations within the app or any detected Git working tree. Counts/table names/completion location may be printed, but row values, database URLs and driver error details are not logged.

The normal export streams rows with bounded driver buffering and awaits filesystem writes; it does not load an entire table into memory. JSON contains table DDL/column metadata, schema SHA-256, rows and row counts, plus a final manifest with format version, server version, UTC start/completion timestamps, snapshot contract, total/table counts, exclusions and row hashes. Dates are SQL date strings in UTC connection context; BIGINT/DECIMAL and JSON columns are preserved as strings; binary values use `{"$binary":"base64","data":"..."}`. A restore must use column metadata to decode types, not guess from strings.

Check that the JSON parses, has `formatVersion: 1`, a completed manifest, the expected tables/exclusions and counts matching each table's row array. The per-table row hash is SHA-256 of each serialized row followed by `\n`, in exported order; a validator must preserve the original row key order/serialization. An encrypted artifact checksum and a real isolated restore exercise are stronger operational evidence than file existence alone. Caught failures remove the incomplete file; a forced process kill/system crash may leave a private incomplete JSON file. Do not accept a partial file without a completed, validated manifest. Snapshot export does not include managed hosted assets, external logo URLs, email-provider settings, secrets, infrastructure or provider transaction logs.

Never commit a `.json` database export, even on a private branch. The current generic `.gitignore` is not a blanket JSON-export exclusion: manifests and legitimate project JSON are tracked. Keep backup files outside the repository; review staged files and secret scans independently. Do not attach plaintext exports to an issue or delivery report. Normal filesystem unlink is not guaranteed secure erasure on modern/cloud storage; use your approved retention/encrypted-storage controls.

### Reviewed, isolated recovery — no automated destructive restore

No destructive restore script is supplied. Recovery is a separate, explicitly authorized operator task, never part of deployment or GitHub handoff:

1. Verify ownership/permission, encrypted-artifact integrity, JSON format, completed manifest, table coverage/counts and source server version. Record the exact source revision and migration checksums alongside the private artifact. Do not trust an unreviewed export's DDL as executable input.
2. Provision a **new isolated database** on TiDB 8.5.3 or a deliberately validated compatible target. Use the matching source/lockfile and the same migration versions as the manifest. Inspect captured DDL and engine differences, foreign keys, collations, date/JSON/numeric handling. Do not blindly apply current newer migrations to an older export or run restored migration history before the actual schema exists.
3. Keep the recovering application inaccessible. Have a DBA write/review a parameterized importer for the documented format, decoding tagged binary values and JSON/numeric strings using column metadata. Load parent/reference/identity tables before dependents; `crm_users.updated_by` is self-referential, so use a reviewed two-pass actor assignment. Do not globally disable foreign keys to conceal missing data. Treat audit logs and security history as sensitive evidence, not disposable test fixtures.
4. For a **default auth-excluded export**, restore CRM identity/role/business data but leave sessions/tokens/credentials absent. Existing password hashes are not recoverable from it. The current reset endpoint updates an existing `crm_auth_credentials` row; it must not be assumed to create a missing one. A secure, reviewed credential-reenrollment/recovery procedure or an approved encrypted credential backup is required before anyone can sign in. Never set verified/ACTIVE/Admin values, invent shared passwords or rerun bootstrap merely to bypass recovery.
5. For an **auth-included export**, restore approved password hashes only under the restricted recovery process; discard/invalidate all restored sessions and verification/reset tokens before exposure. Old links/cookies must not become usable merely because a historical snapshot was restored. Normally do not replay stale rate-limit buckets. Reassess password rotation according to incident policy; hashes remain sensitive even without plaintext passwords.
6. Restore reference/role assignments and company/customer/contact/audit records in dependency order. Validate unique normalized emails, join keys and foreign keys, verified ACTIVE access, at least one effective top-level administrator, company singleton use, contact primary counts and country/region coverage. Confirm row counts and check permissions with direct APIs. Explicitly address approvals/suspensions changed after the snapshot: restoring older authorization state can re-enable access that was subsequently revoked.
7. Run isolated security/CRM acceptance checks, including logout/reset session revocation, before an approved cutover. Provision fresh target credentials and runtime secrets separately. Confirm public origin/email delivery and HTTPS behavior. Keep the original shared database untouched until the data owner approves a documented cutover and rollback plan.

A successful export is not a demonstrated recovery. Record restore-drill evidence and unresolved gaps separately. For data beyond the exporter's reviewed tables or for point-in-time recovery, use the managed provider's documented export/backup service only after confirming its actual availability and permissions.

## Alibaba Mail remains the receiving service

No CRM login checks an Alibaba Mail password or requires its server administration. The currently exposed native Manus OAuth and owner-only notification capabilities do not provide CRM-owned password verification/reset to arbitrary users. A separate sending domain controlled by the user works with the existing sender/recipient-independent mail adapter; corporate recipients and Gmail accounts remain unchanged. Configure DKIM/SPF/return-path only under the controlled sender domain, never replace youcaimedical.com MX records. See authentication-email-decision.md for primary-source findings, setup and exact first-owner steps. Email readiness validates setting shape, not domain ownership/provider credentials/inbox delivery. Canonical origins reject URL credentials, paths, queries, fragments and non-HTTPS protocols.
