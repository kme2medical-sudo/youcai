# GitHub handoff: preserve the existing repository

## Verified repository and platform boundary

The intended source destination is **https://github.com/kme2medical-sudo/youcai**. The initial inspection found a README-only `main` at commit `f7efa0d1c40d27b0ef3b60f418f046dc81fd8646`. This is an inspection baseline, not a claim that the remote still has no newer commits.

Manus WebDev's native GitHub export supports creating a **new private repository**. It does not provide native linking/synchronization to this already-existing repository. Do not use that export to create a replacement destination, and do not describe the existing repository as synchronized unless an actual authorized branch push has been verified.

Manus-managed checkpoints/publication history and the user's existing GitHub repository are separate histories. A Manus checkpoint is not a commit in `kme2medical-sudo/youcai`, nor is it a pull request. Publication, a checkpoint, and GitHub delivery should each be reported separately, with their actual references when available.

## Safe feature-branch / pull-request procedure

The procedure below is an operator handoff, **not a record of commands already run**. Use it only with an account/connector authorized to write to the existing repository. If the connector is unavailable or scoped only to Manus's managed repository, supply a private source archive and have an authorized maintainer perform the handoff instead. Do not broaden credential scope silently.

1. Obtain a source-only export of the finished app. Exclude `.git`, `.env*` other than `.env.example`, dependencies, build output, local platform credentials, database exports, logs and temporary test artifacts. Keep the reviewed lockfile, source, migrations, tests and documentation.
2. Clone the existing repository into a **new, separate working directory**. Fetch its current `main`; never copy the generated app's `.git` over it.
3. Create a feature branch from the latest remote `main`, for example `feature/crm-foundation-v1`. Before replacing the top-level README, preserve the existing remote README at `docs/original-repository-README.md`. If this file is already present in the export, verify it matches the original; do not overwrite later upstream content without review.
4. Overlay the reviewed source files, keeping all existing unrelated files and history. Inspect differences against current `main`, including any changes since the inspection baseline. Resolve conflicts rather than overwriting them.
5. Review the staged file list and scan for secrets, personal data and database JSON exports. Run the documented checks and attach the actual test report, including blocked live-email checks.
6. Make an authorized commit on the feature branch, push **only that branch**, and open a pull request targeting `main`. Have a maintainer review before merging. Report the actual branch, commit SHA and pull-request URL; if no push occurred, explicitly say so.

Illustrative maintainer commands, run in the separate clone after reviewing the export:

```bash
git clone https://github.com/kme2medical-sudo/youcai.git youcai-existing
cd youcai-existing
git fetch origin
git switch -c feature/crm-foundation-v1 origin/main
mkdir -p docs
# Preserve this before overlaying the new top-level README:
git show origin/main:README.md > docs/original-repository-README.md
# Overlay source-only export here; retain this clone's .git and unrelated files.
git diff --stat
git diff
# Stage only reviewed files. Check the staged diff before committing.
git diff --cached --stat
git diff --cached
# Commit and push only after the authorized maintainer's review.
git push -u origin feature/crm-foundation-v1
```

These commands intentionally do not contain an automatic blanket add, force push, history replacement or direct push to `main`. If the branch already exists, choose a new branch name or inspect it first; never force-update it to bypass conflicts.

## Code is not a database backup

Neither GitHub export nor a Manus checkpoint should be treated as a recoverable copy of customer records, user approvals or authentication data. The managed development and production app use the same database in this project. Source transfer does not create database isolation or transfer managed credentials, database data, runtime secrets or hosted files.

Use the separate, authorized [database export and recovery procedure](operations.md#database-export-and-recovery). Keep all exports private, encrypted and outside every source repository. Restore into an isolated, version-compatible target first; never run a destructive restore against the shared managed database as part of a code handoff.
