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

## Follow-up: five initial administrators

Added wangxukai@youcaimedical.com to the exact four original bootstrap addresses. The update passes 29 backend tests (18 real-TiDB integration plus 11 policy), 43 frontend tests, typecheck and production build. All five verified addresses qualify; registration/role requests alone never qualify. Wang regression proves one ACTIVE/Admin bootstrap, distinct owner-selected credentials, old-session revocation, replay rejection, no automatic reinstatement after suspension/demotion/password recovery and no domain/plus-alias matching. The outer transaction and nested savepoints leave zero persisted accounts/business fixtures. Email values are being configured through protected input; settings/delivery and this update publication are separate live gates, not inferred from test results. Historical counts above describe the preceding release.

## Alibaba-safe sending revision evidence

Native email/password delivery investigation is documented in authentication-email-decision.md. This project exposes Manus OAuth and owner-only notifications, not native verification/reset delivery for CRM-owned passwords. Sender-domain and corporate recipient-domain remain independent; no Alibaba Mail/DNS change is made. The new mail adapter rejects malformed keys/senders and HTTPS link origins containing credentials, non-root paths, query strings or fragments. Its readiness is configuration shape only, not provider/inbox confirmation. Latest affected checks: 11 policy + 5 mail tests PASS, 18 real TiDB/Express rollback integration tests PASS, TypeScript and production build PASS; prior unchanged frontend suite 43 PASS. Post-suite counts for users/credentials/roles/requests/sessions/tokens/rate records/customers/contacts/audits are zero. Runtime health is 200, anonymous customers 401 and emailReady false. The canceled card was not reopened. First-owner activation remains blocked pending a user-controlled sending domain, verified sender and genuine protected settings. Publication of this revision is reported by its returned result, not inferred from these checks.

## Latest owner-provisioned direct-login release

The owner canceled Firebase and explicitly authorized no-email-provider personal-password login for the five exact designated admins. The implemented exception requires private, owner-issued, one-use password-setup capabilities; it never grants from a public signup email string. Completed owner authorization is stored separately from email verification and is checked with ACTIVE/current roles. No default/shared password, Firebase integration or false verified-email timestamp is present. Users choose their own name/password once; after setup they sign in directly. Initial private reservations are pending and cannot log in until setup. All five proof/capability records are created only through an authorized shell command, not seeds/startup/public API.

Evidence: additive migration002 applied and rerun safely; no real user writes in migration. 52 backend tests PASS (28 rollback SQL integration, 13 policy), 91 frontend tests PASS, whole TypeScript check and full production build PASS. New tests cover exact-five ownership capability, no mail readiness dependency, completion/token replay/personal password uniqueness, owner-versus-email metadata, preserved suspension/demotion and last-admin checks, ordinary unverified/pending denial, non-consuming check/form contract and route manifest. Before issuance, user/proof/credential/session/token counts remain zero. HTTP health200, config emailReadyfalse/adminSetupAvailabletrue, anonymousbusinessAPI401, static manifest200 including /admin-setup. Final independent read-only review and actual deployment/provisioning outcomes are reported separately; source/test success alone is not a live-login claim.

Independent read-only security review found two material handoff/privacy issues; both were corrected. Issuer now awaits private-file write/sync/close callback inside SQL transaction before commit; a callback-failure regression preserves all five prior capabilities and SQL snapshots. Targeted owner suite: 11 PASS, 18 unchanged original integration tests skipped (the original full 52-test run had passed). Automatic dev browser collector injection is disabled; HTTP login/setup/verification HTML contains no collector. Typecheck and full production build rerun after remediation PASS. Hosting visibility is confirmed public after the owner's dedicated approval; business authentication remains intact. Real invitation issuance and release URL are reported after publication.

Live sign-in rendering and anonymous denial were confirmed after publication. Live non-consuming setup check exposed a proxy/internal-Host origin mismatch while the old mail URL setting was invalid. Targeted fix records actual non-secret public origin in project metadata and preserves Origin/CSRF checks; 15 policy tests (including proxy/lookalike regressions), typecheck and production build PASS. Five issued private links remain unconsumed and unchanged; real account passwords remain user-selected. A subsequent publication completes the same approved working direct-login request.
