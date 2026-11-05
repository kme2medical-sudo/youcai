# Secure CRM verification without changing Alibaba Mail

The supported Manus WebDev authentication available to this project is Manus account OAuth. It is not an exposed managed email/password service for the CRM's own accounts, and no native arbitrary-recipient verification/password-reset delivery interface was found in this project's current capability catalog or operational authentication contract. The available managed notification API addresses the project owner only, so it cannot verify ownership of each of the five CRM administrator mailboxes. A Manus sign-in page or Manus account password-reset page must not be presented as the CRM's own password service.

The public Manus website-builder documentation describes full-stack authentication generally, and its release announcement describes registration/login and notifications, but neither provides a concrete app-owned email/password verification/reset delivery contract. The connector catalog lists Resend as a separate transactional-email integration; connectors do not turn that provider into native CRM authentication. Therefore no claim is made that Manus lacks every possible future/other-plan capability—only that the required service is not available through this project's supported implementation surface. [1] [2] [3]

Because native delivery was not confirmed, removing `RESEND_API_KEY` and `EMAIL_FROM` would disable the only working mail transport rather than replace it. They remain server-side adapter settings. The canceled replacement card was not reopened, and no accounts or verification bypass were created. Existing malformed settings do not mean email delivery is operational. They should be replaced only after a sending domain and verified sender are chosen.

## Recommended minimum-dependency setup

Keep the CRM's existing password/session/token implementation, managed TiDB database, approval workflow and multi-role RBAC. Use one transactional-email transport for verification and password reset. The implemented adapter is Resend, so continuing with it avoids another identity provider, another user database, another login protocol or external SMTP server. It can later be replaced without changing the administrator allowlist or permission model. No self-hosted email server or mailbox-password authentication is recommended.

Choose a **different domain whose DNS you control**, or a dedicated subdomain of that controlled domain—for example `auth.example.org`, where `example.org` is only an illustration, not a supplied/owned domain. Do not choose a subdomain of `youcaimedical.com` unless you separately obtain authority over its DNS. Configure a sender such as `Youcai CRM <no-reply@auth.example.org>`. The sender domain and recipient domains need not match; recipients remain the exact Alibaba Mail/Gmail addresses below.

Resend requires ownership/domain verification, supports sending subdomains and recommends disabling open/click tracking for sensitive password-reset messages. Receiving mail is optional. [4] Provider-generated DKIM and SPF/return-path records must be added only under the **controlled sending domain**, using the exact names/types/values shown in its dashboard. Depending on provider/domain setup, these can include TXT, CNAME and a bounce/return-path MX record. Do not copy invented DNS values, replace unrelated root mail-routing records, enable receiving, or touch the Alibaba Mail MX/DKIM/SPF records at `youcaimedical.com`. The bounce record authenticates sending feedback; it is not an instruction to migrate corporate inboxes. [5] [6]

A separate sender must be clearly labeled **Youcai CRM** so administrators recognize a legitimate verification message; announce the exact sender before onboarding. Keep verification links on the published CRM HTTPS origin. The default `onboarding@resend.dev` sender is testing-only and cannot reliably onboard all five owners: it is restricted to the email associated with the Resend account. It is not the production workaround. [7]

## Setup steps before anyone registers

1. Supply the name of a separate domain you control and can edit DNS for. If you have none, choose/acquire one yourself; no domain purchase or DNS change has been made by this task.
2. Add the chosen sending subdomain in the mail provider. Add only its exact generated verification records in that domain's DNS and wait until the provider marks sending verified. Leave `youcaimedical.com` and Alibaba Mail unchanged. Disable email link/open tracking for verification/reset messages.
3. Create a send-only API key scoped to that sender where supported. Through Manus's **protected server-settings card**, supply the actual key as `RESEND_API_KEY`, the verified sender as `EMAIL_FROM`, and exactly `https://youcai-usq7zhae.manus.space` as `APP_PUBLIC_URL`. Include Production availability. Do not paste keys or personal passwords into chat/source or client variables.
4. Publish the five-account update and load those settings into the deployed runtime. Configuration readiness is not proof of provider authorization or delivery. Send a genuine onboarding message and check both provider acceptance and actual inbox receipt. Do not expose verification tokens in logs, screenshots, API responses, or analytics.
5. Resolve the separate private-site hosting gate if needed: project owner access or an appropriate invitation is required while the site is private. Changing visibility is a separate owner choice. Passing this gate never grants a CRM role.

## Exact first-administrator activation

Use **https://youcai-usq7zhae.manus.space/register** once the five-account release is confirmed live and real email delivery is ready.

1. Enter **Full name**, one exact allowlisted **Email address**, your own **Password** and **Confirm password**. Use a unique password of 12–128 characters. Choose **Admin** under **Requested role**, then press **Request access**. This role selection does not grant privileges before verification.
2. Open **Verify your Youcai account** in that mailbox, including spam if necessary. The private link expires in 24 hours. It may arrive from the separate verified sending domain; the receiving corporate mailbox stays on Alibaba Mail.
3. Follow the link to the CRM. Enter and confirm your own final sign-in password; you may reuse the password you chose in registration. Press **Confirm email and secure account**. Opening the link alone does not verify an account. This owner-controlled password confirmation prevents a preregistration attacker from retaining the credential and revokes all earlier sessions.
4. Successful initial verification atomically grants **ACTIVE + Admin** to that exact allowlisted account. **The first administrator does not need approval from another administrator.** No other email automatically receives Admin.
5. Open **https://youcai-usq7zhae.manus.space/login**. Enter the same email and the password confirmed on the emailed verification form; press **Sign in to workspace**. Check that your profile shows Active/Admin, then use **General Settings → User Management** to manage ordinary applicants.
6. Each of the other four owners repeats these steps with their own password. Other verified applicants remain Pending Approval with no business API access until approved and assigned roles. Use **Forgot password?** for subsequent recovery; never repeat bootstrap to restore roles that were later removed.

The exact five addresses are:

- alberto@youcaimedical.com
- eniodeleon87@gmail.com
- eadlr1@gmail.com
- kme2medical@gmail.com
- wangxukai@youcaimedical.com

The request says four but explicitly lists five; all five are preserved. No domain wildcard, Gmail plus-alias substitution, shared/default password, token-return endpoint, unverified Admin or unauthenticated administrative access is allowed. Verification and bootstrap are audited and one-time; consumed links cannot duplicate role grants, and suspended/demoted accounts cannot automatically regain access through reset or replay.

## Current evidence and remaining blocker

The five-account source update passed **29 backend tests** including 18 real-TiDB rollback integration tests, and **43 frontend tests**, typecheck and production build. Wang's test verifies independent owner credentials, automatic verified Active/Admin, one role/audit event, replay denial, no regrant after suspension/demotion/reset, and denial of domain/alias lookalikes. Tests leave no real administrator or customer fixtures. Additional mail-configuration tests are reported in the subsequent delivery evidence, not invented here.

The five-account checkpoint was saved but had not yet been published when this investigation began. The current deployment state will be reported explicitly after publication. Actual email delivery, first-owner browser login and provider DNS verification remain blocked until a controlled sending domain and genuine mail settings are supplied; no such domain was assumed or changed. The original corporate mail service is untouched.

## References

[1]: https://manus.im/docs/website-builder/getting-started "Manus Website Builder getting started"
[2]: https://manus.im/blog/manus-1.5-release "Manus 1.5 full-stack authentication and notification overview"
[3]: https://manus.im/docs/integrations/connectors "Manus connector catalog including third-party Resend"
[4]: https://resend.com/docs/dashboard/domains/introduction "Resend verified sending domains and optional receiving"
[5]: https://resend.com/docs/add-a-domain "Resend add and verify a controlled domain"
[6]: https://resend.com/docs/dashboard/domains/manage-domains "Resend DKIM SPF and bounce MX domain management"
[7]: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain "Resend testing sender recipient restrictions"
