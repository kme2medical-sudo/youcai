# Youcai Foundation V1 frontend

This folder implements the application-owned email/password CRM frontend. `App.tsx` declares every page unconditionally; protected pages render only after `/api/auth/me` confirms an email-verified `ACTIVE` account and the required effective permission. General Settings additionally checks exact `admin` or `ceo` role membership. Backend authorization remains authoritative on every request.

## Features

Registration requests exactly one of the six shared roles without assigning privileges. Verification/reset read the `token` query parameter and submit it only to the matching authentication endpoint. Pending, unverified, rejected and suspended accounts see only their access status and account actions, not business modules. A failed session check fails closed. The email-provider readiness banner is driven by `/api/auth/config`, and unavailable registration/recovery delivery is not presented as working.

### Safe email verification

Opening `/verify-email?token=…` never redeems the link automatically. The mailbox owner must explicitly choose and confirm the password they will use to sign in, even when a password was entered during registration. The form explains: “Confirm your email and secure your account. Choose the password you will use to sign in; this replaces any password entered before verification.”

The existing accessible password input and show/hide toggle are reused. Both `password` and `confirmPassword` inputs require 12–128 characters; an exact-match validator runs before submission. The request is strictly `POST /api/auth/verify` with `{ token, password }`; confirmation is client-side only. No email-provider readiness, account role or approval requirement blocks submission of a delivered token. Server-side validation remains authoritative for token validity, expiry and reuse. The submit button is disabled while busy, and duplicate submissions are guarded.

After a successful verification response, the browser URL becomes `/verify-email` before refreshing the session. A failed request leaves the link available for retry without claiming success. Password inputs are cleared on success. Verification tokens remain in component memory only: they are never written to local/session storage, logged or rendered. Without a token, the email-only resend form and its existing delivery-readiness guard are unchanged. Approval-based business access remains unchanged.

The active workspace includes a real persisted dashboard, customer search/type/country/region/status filters and pagination, complete customer create/edit/detail fields, duplicate-warning feedback, archive/restore, contact create/edit/remove with primary-contact controls, company information, country-region mapping, user review and multi-role/status management, protected role permission matrix, read-only audit trail and profile/logout. Archived customers and contacts are read-only until restored. Products is a disabled navigation item only; there is no products page or request.

The REST client uses relative `/api` URLs and `credentials: include`. The session CSRF token exists only in memory and is sent as `X-CSRF-Token` for mutations, including logout. No native OAuth, local-storage session, fake identity, business fixtures, verification bypass or product upload is used by the frontend. Test-only fixtures use `.invalid` addresses and never connect to the database.

## Checks

Run `pnpm check` for integrated TypeScript diagnostics, and `pnpm exec vite build` to compile frontend assets. Frontend-only automated checks run independently without editing the root test configuration:

```sh
pnpm exec vitest run --config client/src/crm/vitest.config.ts
```

The checks cover credentialed relative REST, CSRF inclusion/clearing, bodyless deletions, validation messages, authorization-denial refresh, network/invalid-response handling, exact roles/customer/legal/salutation dimensions, fail-closed permission helpers, website scheme safety, meaningful date fallbacks, explicit field labels and route/General Settings declarations. Verification regressions additionally cover password boundaries and confirmation, accessible password fields, no redemption during server rendering, provider-independent delivered-token submission, unchanged resend gating, busy-button state, the exact verification payload, success-only URL cleanup, pending/expired-link handling and no token storage/logging. These isolated helper, transport and server-rendered tests are not a substitute for authenticated browser or live email-delivery testing.

## Integration notes

Constants and DTO types reuse `shared/crm.ts`, which was checked after backend creation. All frontend payloads are projected to the strict backend input schemas: immutable IDs, derived region, status and timestamps are not submitted in customer edits; company actor/time metadata is not sent in company updates. Blank legal entity and salutation values become `null`. Company defaults are `UTC` and `USD`, with all company-specific facts blank until persisted by an authorized administrator.

`client/public/manus-routes.json` contains the complete page set, excluding `/404`, API routes and Products. The parent owns `main.tsx`, the public favicon, platform app logo, development service and publication. Live verification/reset delivery and registration remain blocked until the real provider, verified sender and public origin are configured. No deployed applicant or customer record was created during frontend validation.
