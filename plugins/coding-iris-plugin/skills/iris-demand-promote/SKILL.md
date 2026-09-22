---
name: iris-demand-promote
description: Promote committed IRIS demand changes from a DEV on-demand-export repository into a PRD on-demand-export repository by refreshing the PRD server baseline, applying DEV Git patches, and creating local PRD commits without deploying remotely.
---

# IRIS Demand Promote

## Purpose

Use this skill when a requirement already committed in a DEV Git workspace must be transferred to a separate PRD Git workspace. Both repositories may contain only files exported on demand and have unrelated Git histories.

The source of the requirement is the DEV Git patch. The target baseline is the latest version exported from the PRD IRIS server. Never replace a PRD file with the complete DEV file merely because their baselines differ.

PRD is a production environment context. This skill may update and commit only the local PRD repository after explicit confirmation. It never authorizes upload, compile, SFTP, deployment, database changes, or any other remote production write.

## Deterministic Execution Contract

The CLI is the source of truth for selection, baseline hashes, commit grouping, and verification. This contract applies to every Agent or model:

- Do not hand-edit a plan JSON, fabricate a plan, bypass a CLI stop, or replace the scripted commit sequence with ad hoc Git commands.
- Do not infer that comma-separated demand numbers may be combined. The CLI must validate the DEV subject declarations before any server export or PRD write.
- Present the plan and obtain explicit confirmation before `apply`. Treat changed HEAD, dirty worktrees, remote hash drift, unsupported files, provenance ambiguity, or a failed invariant as a hard stop.
- During conflict resolution, preserve the PRD server baseline and apply only the DEV demand semantics. Never choose an entire DEV file merely to remove conflict markers.
- `verify` must pass before reporting completion. Local commits are not evidence of remote deployment.

## Required Inputs

- Demand identifier.
- Absolute DEV and PRD repository roots supplied by the current workspace or user.
- Clean DEV and PRD worktrees.
- Working PRD `.agents/config/project-env.json` and `coding-iris-plugin` export tooling.

Do not discover sibling repositories by scanning parent directories. Do not store repository roots, server addresses, namespaces, credentials, or remote paths in this skill.

## Demand Commit Boundary

Treat the demand-number set declared by DEV as the atomic PRD commit boundary.

- DEV commits for different demand numbers must be promoted with separate plans and separate PRD demand commits. A comma-separated CLI argument is not permission to squash independent demands together.
- Multiple DEV commits for the same single demand may be squashed into one PRD demand commit.
- Multiple demand numbers may share one PRD demand commit only when every selected DEV commit explicitly declares the same combined demand-number set in its subject, for example `fix(123,456):修复123；修复456`. Preserve that subject and write one `Demand-Id` trailer per declared number.
- A combined demand subject is not a Git merge commit. Actual Git merge commits remain unsupported by the automatic patch workflow.
- If independent demands share files, promote them oldest first and use `--prior-plan` for the later demand as described below.

For a batch of independent demands, use this fixed sequence:

1. Determine DEV commit order and create a plan for only the oldest demand number.
2. Refresh every PRD server baseline in that plan. Commit `export(...)` only when the local PRD baseline changes, then apply and verify that demand commit.
3. Create the next demand plan against the new PRD HEAD. If it shares an undeployed file with the immediately preceding demand, pass that verified plan through `--prior-plan` so the earlier demand layer is preserved while its server baseline hash is revalidated.
4. If a remote hash changes between plan and apply, stop and regenerate the current demand plan. Never weaken or skip the drift gate.
5. Repeat one demand at a time. At the end, verify each PRD demand commit independently and confirm the worktree is clean.

## Workflow

1. Read both repositories' `AGENTS.md`, project profiles, and IRIS workflow rules.
2. Run the promotion CLI in `plan` mode. Present the selected DEV commits, duplicate assessment, file classification, PRD server probes, risks, and proposed commit messages.
3. Wait for explicit confirmation before `apply`. That confirmation authorizes only local PRD source changes and Git commits.
4. Run `apply` with the generated plan file. For every planned document that exists on the PRD server, export it even when the corresponding PRD local file already exists. Export every baseline into the temporary staging directory first; only after all exports succeed, replace the PRD local copies.
5. Stage the refreshed PRD baseline before applying any DEV patch. If it differs from the current PRD commit, create `export(<PRD IP>):从服务器同步最新文件`; if it is identical, do not create an empty commit.
6. Apply the DEV requirement patches only after the baseline commit decision is complete.
7. If the CLI reports a conflict, compare the DEV parent, DEV result, and exported PRD baseline. Resolve only the demand behavior, stage every resolution, and run `continue`. The CLI must revalidate DEV/PRD HEAD and reject unstaged or untracked state before resuming.
8. Run `verify` and report the export commit, demand commit, exact/adapted mode, and remaining risks.

When several demands must remain as separate PRD commits, process them oldest first. If a later demand touches a file already changed by the immediately preceding, verified promotion and that earlier change has not been deployed, create the next plan with `--prior-plan <previous-plan.json>`. The CLI must verify that PRD HEAD is exactly the prior demand commit and that the shared file's recorded PRD server baseline has not drifted. It then preserves the prior local demand layer for the shared file while still exporting every other target from PRD. Never refresh the shared file in a way that silently reverses the earlier local demand commit.

## Frontend Boundary

The project's configured frontend root is authoritative. For HNYL it is `src/imedical/web`; normalize path separators before comparison. Only `.js`, `.csp`, and `.css` files below that root are exported as frontend documents. Files outside the configured root are not inferred to be frontend assets from their extension alone.

Run the UTF-8 byte gate for every touched frontend file. Unsupported static assets such as HTML, images, fonts, and source maps stop the automatic workflow and are reported for manual handling.

## Safety Stops

- Dirty DEV or PRD worktree.
- DEV or PRD HEAD changed since planning.
- PRD server content changed since planning.
- Same demand number exists in PRD but provenance and patch equivalence are ambiguous.
- Different demand numbers come from independent DEV commits but are requested in one plan, or a plan omits a demand number declared by a selected DEV commit.
- A DEV-modified/deleted file does not exist on the PRD server.
- A DEV-added file already exists on the PRD server and cannot be merged unambiguously.
- Unsupported path or file type, invalid frontend encoding, unmerged conflicts, or changes outside the planned file set.

Never upload, compile, deploy, perform SFTP writes, modify a database, or reset/delete user work as part of this skill.

## CLI

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/promote-demand.js plan --demand <id-or-combined-id-set> --dev-root <path> --prd-root <path> [--prior-plan <verified-plan.json>]
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/promote-demand.js apply --plan <plan.json>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/promote-demand.js continue --plan <plan.json>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/promote-demand.js verify --plan <plan.json>
```

Plan files and staged exports live below the operating-system temporary directory under `codex-iris-demand-promote`; the directory includes a stable identity derived from both absolute repository roots so same-named DEV/PRD repositories cannot overwrite one another's plan. They are never written to tracked source directories during planning.
