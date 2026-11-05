import "dotenv/config";
import { mkdir, open, realpath, chmod, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { issueOwnerAdminInvitations } from "../server/crm/admin-enrollment";
import { closePool } from "../server/crm/db";

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const originIndex = args.indexOf("--origin");
  if (outputIndex < 0 || originIndex < 0 || !args[outputIndex + 1] || !args[originIndex + 1]) {
    throw new Error("Supply --output /absolute/private/file.md --origin https://your-published-app");
  }
  const output = resolve(args[outputIndex + 1]);
  const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  if (output === root || output.startsWith(root + sep)) throw new Error("Private links must be written outside the source repository");
  const origin = new URL(args[originIndex + 1]);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Supply only the trusted HTTPS application origin");
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await chmod(dirname(output), 0o700);
  const directory = await realpath(dirname(output));
  if (directory === root || directory.startsWith(root + sep)) throw new Error("Private directory must be outside the repository");
  const file = await open(output, "wx", 0o600);
  let completed = false;
  let fileClosed = false;
  try {
    const invitations = await issueOwnerAdminInvitations(async prepared => {
      const content = [
        "# Private administrator password setup",
        "",
        "These links are credentials. Keep this document private and share each individual link only with its named administrator. Never send the whole document to a group or place it in Git, a public upload, screenshots or analytics.",
        "",
        "Each administrator opens their own link, enters their full name, chooses and confirms a personal password (12–128 characters), and presses Create my password. Then sign in normally. No shared/default password, Firebase, verification-email delivery or another administrator's approval is required. Access is owner-provisioned; mailbox ownership is not claimed to be email-verified.",
        "",
        `Sign in after setup: ${origin.origin}/login`,
        "",
        "Setup links are single-use and expire in 24 hours. Opening a link alone does not activate the account; explicit password submission is required. A consumed link cannot change the password or restore removed roles. Anyone possessing an unused link could set that account's password, so deliver it privately to the correct person.",
        "",
        "The owner approved a publicly reachable sign-in page. CRM business data still requires an active authenticated account and current server-side permissions.",
        "",
        ...prepared.flatMap(item => [
          `## ${item.email}`,
          "",
          `[Choose my password](${origin.origin}/admin-setup?token=${encodeURIComponent(item.token)})`,
          "",
          `Expires: ${item.expiresAt} UTC.`,
          "",
        ]),
        prepared.length ? "Share only each named person's individual link. Keep or remove this private handoff according to your internal credential-handling policy." : "No new links were issued. Completed accounts were preserved; this operation does not overwrite passwords or restore suspended/demoted administrators.",
        "",
      ].join("\n");
      // Persist and close the owner-only handoff BEFORE the database commits token rotation.
      // Failure here rolls back SQL, retaining any previously valid pending capabilities.
      await file.writeFile(content, "utf8");
      await file.sync();
      await file.close();
      fileClosed = true;
    });
    completed = true;
    console.log(`Created ${invitations.length} private administrator setup links in the owner-only output file. No tokens or passwords are printed.`);
  } finally {
    try {
      if (!fileClosed) await file.close();
    } finally {
      // Also remove a complete-looking handoff if the database transaction failed to commit.
      if (!completed) await rm(output, { force: true });
    }
  }
}
main().catch(() => {
  console.error("Private administrator provisioning was not completed. Check the output location and eligible accounts; no secret details are logged.");
  process.exitCode = 1;
}).finally(closePool);
