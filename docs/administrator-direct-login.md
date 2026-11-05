# Administrator login without Firebase or email-provider setup

The original Youcai email/password login is retained. Firebase was not integrated and no newly created external account is used or deleted. Under the owner's revised instruction, the five initial administrator accounts use **owner-authorized private password setup**, rather than email verification or another administrator's approval. This is not represented as proof that a mailbox was verified.

## What each administrator does

The website owner privately supplies each person their own one-use setup link. Open it, enter your full name, choose and confirm your own password of 12–128 characters, and press **Create my password**. Then open **https://youcai-usq7zhae.manus.space/login** and sign in with your email and that password. Successful password login takes an ACTIVE administrator directly into the application. No Firebase sign-in, verification email, email-provider configuration or CRM approval step is required for these five owner-provisioned accounts.

There is no shared, generated default or hardcoded password. Nobody can claim Admin merely by typing one of the addresses into public registration. The private capability is necessary only for the first personal-password creation, because no CRM accounts/passwords existed when the owner requested this change. An existing or consumed setup link cannot reset passwords or reinstate revoked access.

Exact owner-authorized addresses:

- alberto@youcaimedical.com
- eniodeleon87@gmail.com
- eadlr1@gmail.com
- kme2medical@gmail.com
- wangxukai@youcaimedical.com

Other users retain the original email verification and administrator-approval requirements. Email-based registration/recovery for them remains unavailable until real email delivery is configured. This exception is not a blanket `@youcaimedical.com` grant and does not create public unauthenticated business access.

## Private owner handoff

Generate links only through the authorized shell command; no HTTP endpoint can issue them:

```bash
pnpm exec tsx scripts/provision-owner-admins.ts \
  --output /home/ubuntu/private/administrator-password-setup.md \
  --origin https://youcai-usq7zhae.manus.space
```

The file is created exclusively outside the source repository in an owner-only directory, with mode 0600. Tokens are 256-bit, stored only as hashes in SQL and expire after 24 hours. The raw capabilities appear only in this private handoff, never source, logs, a source archive, public storage or audit metadata. Share each individual link only with its intended owner—anyone holding an unused link could choose that account's password. Do not circulate the complete five-link document.

Reruns preserve immutable IDs and completed credentials/status/roles. They must not auto-reactivate a suspended/rejected/demoted administrator. Any pending-link rotation supersedes the old capability; never rerun casually after sharing links. The issuer refuses an existing public signup/credential-bearing account that was not reserved through owner authorization rather than overwriting its password. No seeds or server startup process grant this exception.

The website's hosting privacy is separate from CRM login. While the Manus website is private, users also need hosting access. A publicly reachable sign-in page requires the owner's visibility approval; it does not remove CRM password/RBAC checks. The owner approved public visibility, confirmed by the platform on 5 November 2026. The current deployment version is still reported by the actual publication result.

## Security and identity metadata

`emailVerified` continues to mean actual completed email verification. Owner-authorized accounts retain false email-verification metadata and report `accessMethod: OWNER_PROVISIONED` and completed `accessAuthorized`. The separate `crm_owner_admin_access` record permits access only after its protected password-setup capability is successfully consumed for an exact eligible address. ACTIVE status, current roles and permissions are still checked on every API request. Suspended users remain blocked regardless of owner authorization.

Password setup atomically stores a fresh salted scrypt hash, consumes setup tokens, clears earlier sessions, records completion, assigns Admin once, and audits the event. The last effective administrator cannot be removed; self-role/status changes and protected core permission edits remain restricted. No passwords or tokens enter audit logs.

Password recovery for these local accounts still needs a trusted administrator/owner process while outgoing email is unavailable; this update does not pretend the email-based Forgot Password flow works without a provider. The email provider and Alibaba Mail remain unchanged.

The private handoff is written, synced and closed before the issuance transaction commits. Filesystem failure rolls back capability rotation; commit failure removes the handoff. Success is reported only after both complete. Automatic development browser debug/session replay collection is disabled for this CRM, rather than relying only on password-body redaction. Published analytics and the injected badge remain disabled.

The canonical non-secret website origin is recorded in app.config.ts so same-site login/setup works when the hosting proxy supplies an internal Host header, independently of optional mail settings. A separately configured valid HTTPS root APP_PUBLIC_URL can add another trusted origin; malformed values and hostile lookalikes do not bypass validation. If the published website domain changes, update this public metadata in a reviewed release.
