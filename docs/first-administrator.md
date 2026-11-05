# Register and sign in as the first Youcai administrator

## Application and current readiness

Published application: **https://youcai-usq7zhae.manus.space**. Registration page: **https://youcai-usq7zhae.manus.space/register**. CRM sign-in: **https://youcai-usq7zhae.manus.space/login**.

The five-account update is saved/tested in source; its deployment status and latest commit are reported in the delivery message. The previously published version included the first four emails, not Wang's new address. Do not assume the fifth email is live until the updated publication is confirmed.

At the most recent runtime check, the application reports **emailReady false**. Protected settings were supplied, but the origin/key validation did not pass; valid provider credentials, a verified sender and the exact HTTPS origin are still required. No real CRM users or administrators exist. Registration cannot complete and no administrator can be activated until a genuine verification email can be delivered. No developer bypass or mailbox-password check is available.

The site is currently private at the Manus hosting layer. If you first see a Manus sign-in/access screen, it is a hosting access gate—not the CRM account or email-verification process. The project owner can access it; other administrators need an appropriate platform invitation/access or the owner must approve changing site visibility through the Publish panel. This update does not silently make the site public. Passing the platform gate never grants CRM Admin.

## Exact initial Admin allowlist

| Verified normalized email | Initial result |
| --- | --- |
| alberto@youcaimedical.com | ACTIVE + Admin |
| eniodeleon87@gmail.com | ACTIVE + Admin |
| eadlr1@gmail.com | ACTIVE + Admin |
| kme2medical@gmail.com | ACTIVE + Admin |
| wangxukai@youcaimedical.com | ACTIVE + Admin |

The follow-up says 'four' but enumerates five addresses; the five explicit addresses are authoritative. Email is trimmed and lowercased. No other `@youcaimedical.com` account, plus alias, lookalike address or requested role receives automatic privileges. Other verified registrations remain PENDING_APPROVAL without assigned roles until Admin/CEO approves them.

## One-time email setup, before the first registration

Manus native CRM password verification/reset email was investigated and is not exposed by this project. Use a separate sending domain whose DNS you control; do not modify youcaimedical.com or Alibaba Mail. The sender can differ from all administrator recipient addresses. Read [the native-capability investigation and Alibaba-safe sending-domain proposal](authentication-email-decision.md) for sourced findings and exact DNS/provider steps. No canceled input card is reopened and no sending domain is assumed.

Configure the following **server-side protected hosting values**; do not paste the key or personal passwords into chat, source code or a frontend variable.

| Setting | Value to configure |
| --- | --- |
| RESEND_API_KEY | Your real Resend key authorized to send mail |
| EMAIL_FROM | A sender approved by Resend after domain verification; choose an actual address you control |
| APP_PUBLIC_URL | `https://youcai-usq7zhae.manus.space` |

Complete sender-domain DNS verification in the provider, deploy the updated source and settings, and test actual inbox delivery. A true `emailReady` response means settings pass shape checks, not that an email arrived. Keys/senders are deliberately not invented. Provider setup is independent of CRM roles, so you do not need a CRM Admin to configure it. Use Manus's protected input/settings tools, not a General Settings page inside this not-yet-onboarded CRM.

## Exact registration and first login

1. Open the published `/register` URL above in a standalone HTTPS browser tab. Pass the separate Manus private-site gate if shown. If the page says email delivery is not configured, stop and complete the provider setup; there is no secure workaround.
2. Enter your full name and **one exact email from the allowlist**, select **Admin** as the requested role, and enter your own strong password of **12–128 characters**. Confirm it in the registration form. Every administrator must choose their own password; no shared/hardcoded/default password exists. The requested role is informational and does not grant access before verification.
3. Submit **Request access**. Check that mailbox, including spam, for **Verify your Youcai account**. The message contains a private one-use link that expires in **24 hours**. Do not forward or publish the link.
4. Open the link. On the verification form enter and confirm your personal sign-in password, then explicitly submit **Confirm email and secure account**. You can enter the same password you chose in registration. This extra owner-controlled confirmation is intentional: it replaces any password entered before mailbox ownership was proved, and revokes every preverification session to prevent account preregistration takeover. Opening the link alone never grants privileges.
5. Successful verification automatically makes this exact account **ACTIVE** and assigns **Admin** in one audited transaction. **No approval by another administrator is required**, including for the first account. A new sign-in is required after verification.
6. Open the published `/login` URL and enter your normalized email and the password confirmed on the verification form. Confirm your profile shows **Admin** and **Active**; the Dashboard and authorized General Settings become available.
7. Repeat independently for the other four owners. Once signed in, use **General Settings → User Management** to approve ordinary verified applicants, assign multiple roles, or suspend access. Completing another verification/reset never restores roles that an administrator later removed or reactivates a suspended account.

If no email arrives, use the sign-in page's **Need to verify your email?** link and request a new link for the same email after correcting the provider problem. Duplicate registration does not change another registration's password or reveal account existence. Resending supersedes the old verification token. If a link is expired/used, request another; if already verified, use **Forgot password?** rather than attempting bootstrap again.

## Security and idempotence

Successful verification is atomic across ownership marker, salted scrypt credential, session invalidation, token consumption, ACTIVE status, many-to-many Admin assignment, bootstrap-completed flag and audit. Only a valid hashed, unexpired, purpose-bound token sent to the exact mailbox can authorize it; client-submitted email/roles do not. The user-role link has composite uniqueness and insert-ignore semantics, and the bootstrap flag records completion. Replay is rejected rather than duplicating roles or audit events. Rejected/suspended users and already-verified accounts cannot use stale verification links to regain Admin. Every backend business request reloads current ACTIVE status and effective permissions.

Automated verification uses a private test mail transport and rollback-isolated real TiDB requests. It is not evidence of live inbox delivery or real browser-session acceptance; the latest observed counts are reported separately. No real administrator account was created on anyone's behalf and no owner passwords were collected.

## Observed update checks

The five-account update passes 29 backend tests (11 policy and 18 real-TiDB rollback integration), 43 frontend tests, TypeScript checking and production build. The Wang regression confirms verified ACTIVE/Admin without manual approval, individual passwords, one role link/one bootstrap audit event, rejection of replay, no regrant after suspension/demotion or password recovery, and denial of domain/plus-alias lookalikes. Post-suite SQL counts for identities, credentials, roles/requests, sessions/tokens, customers/contacts and audits are zero. Live mail delivery and real-owner browser onboarding are not claimed by these tests.
