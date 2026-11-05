# Foundation V1 acceptance report

Report date: 5 November 2026. Scope: the requested CRM foundation only. This is a secure staging prototype with implemented persistent business modules, not a claim that live account onboarding is operational before email setup.

## Observed automated and runtime evidence

| Check | Observed result |
| --- | --- |
| TypeScript (`pnpm check`) | PASS after the verification remediation |
| Production frontend + Express build (`pnpm build`) | PASS after the verification remediation |
| Backend policy/security/validation tests | 11 PASS |
| Real TiDB / real Express Router integration tests | 17 PASS, outer transaction + route savepoints, then rollback |
| Frontend contract/validation/guard tests | 43 PASS |
| Unchanged starter compatibility tests | 6 PASS in the earlier whole-project run; these are not evidence of CRM native OAuth authentication |
| Migration + reference seed reruns | PASS twice; company, role-permission and region edits preserved; no identity/bootstrap seeded |
| Public HTTPS Preview | Real signed-out page rendered with truthful email-setup notice |
| Local serving / manifest | `/api/health`, `/api/auth/me`, `/api/auth/config`, `/manus-routes.json` HTTP 200; manifest returned actual JSON |
| Anonymous business API | Customers, company, users and roles HTTP 401; products HTTP 404 |
| Post-integration SQL counts | Zero CRM users, credentials, sessions, tokens, auth rate records, customers, contacts and audit logs |
| Backup exporter | Type/help/argument and six synthetic-driver cases passed; no real DB export or restore performed |

The backend test transport is isolated to tests and forbidden in production. All integration fixtures were visible only inside the rollback transaction. There is no published developer identity or bypass. Reference storage contains six exact roles, thirteen current permissions, 249 ISO countries, seven regions, and a blank singleton company with UTC/USD defaults.

## Requested acceptance clauses

| # | Acceptance criterion | Status and evidence |
| --- | --- | --- |
| 1 | Registration, verification, pending approval and password reset | Implemented and PASS in real-router/SQL tests with injected mail. **BLOCKED live:** actual delivery requires Resend credentials, a verified sender and the correct HTTPS public origin. |
| 2 | Pending/suspended users denied business data, including direct HTTP | PASS: unverified/pending/suspended sessions blocked; anonymous requests 401. |
| 3 | Only verified exact allowlist initially Admin | PASS: all four exact emails covered, role request grants nothing, domain-only address never bootstraps. |
| 4 | Approval and multiple roles; union permissions | PASS with existing sessions, audited assignments and immediate subsequent-request revocation. |
| 5 | Employee/Technician, Sales and Pricing restrictions | PASS default role policy and direct endpoint tests; General Settings additionally requires Admin/CEO. |
| 6 | Admin/CEO edit company information | PASS persisted authorized update/actor metadata; unauthorized edit denied. |
| 7 | Customer creation/update/archive/search/filter/contact persistence | PASS real SQL writes and subsequent reads within isolated rollback test; durable managed schema is applied. Cross-session live business UI not demonstrated because there is no verified real account yet. |
| 8 | Many contacts, zero/one primary | PASS sequential real-SQL tests and shared parent `FOR UPDATE` lock path. Separate simultaneous-connection stress test not run. |
| 9 | ISO country/region and independent entity/customer types | PASS all 249 countries/seven mappings, TR/EG are country codes, editable mappings dynamically affect region filtering. |
| 10 | Products placeholder only | PASS disabled ACTIVE-user navigation; no product table or route/download implementation; direct API 404. |
| 11 | Idempotent safe seeds | PASS reruns preserve edits; seeds never create identities or roles for users. |
| 12 | Working preview/demo and automated results | Signed-out Preview and real API available, automated results above. Authenticated browser walkthrough and live cookie acceptance remain UNVERIFIED until a real verified account can be onboarded. Staging publication status is reported separately in the delivery message/card. |

## Security review and remediation

A read-only cross-module review confirmed a preregistration credential-ownership issue. It was fixed before release: initial verification explicitly requires the mailbox owner to choose a password. The transaction locks credentials first, revalidates token/user eligibility, installs a fresh scrypt hash, removes all preverification sessions and verification tokens, and only then records ownership/approval/bootstrap. Regression tests prove an attacker's preregistration password, a duplicate-registration password, and both old sessions cannot gain access; only the password chosen in the mailed verification form works. Replay, stale, rejected/suspended, expired, malformed and wrong-purpose tokens fail. The reviewed administrator and contact locking paths remain intact.

The public HTTPS session cookie is HttpOnly/Secure/SameSite=None. Server queries recompute current ACTIVE/verified status and permissions on every request. Role claims are not cached in browser credentials. Auth mutations enforce JSON/origin rules and authenticated mutations have session-bound CSRF. Passwords use salted scrypt; tokens/sessions store only hashes in separate auth tables, never audit logs. Injected site analytics and badge scripts have been disabled to reduce token-query exposure; other gateway/provider logs may remain and require operational redaction.

## Operational limitations, not hidden shortcuts

Email/password auth is self-managed because the platform's native app login is Manus OAuth, not this requested lifecycle. Register/recovery currently fails closed without `RESEND_API_KEY`, `EMAIL_FROM` and `APP_PUBLIC_URL`; no verified Admin exists. No password or API key is included in source. Configure through protected hosting inputs, validate actual inbox delivery, and register one exact allowlisted owner to bootstrap the first administrator securely. Successful verification also signs out preverification sessions, so sign in again with the verification-form password.

The managed TiDB database is shared by development and deployment, not separate staging/production storage. Tests now refuse to touch any existing allowlisted identity; after real onboarding use an isolated database copy for the integration suite. The default untrusted-proxy policy avoids spoofed forwarded headers but may aggregate clients into a rate bucket; configure trust only from actual hosting topology. HTTPS browser login/cookie acceptance, email retries/availability, multi-connection stress, large directory scale, actual backup snapshot compatibility and restore are not verified. No MFA/SSO or durable email retry queue is promised.

Existing-repository canonical sync is unsupported: native export would create a new private repository, and was not invoked. Manus code history remains separate; the intended existing GitHub destination receives only a feature-branch PR with its original history and README preserved. GitHub/checkpoint source is **not** a database backup. See `operations.md` for the separate authorized export/recovery plan; no automatic backups, point-in-time recovery or live backup are claimed.
