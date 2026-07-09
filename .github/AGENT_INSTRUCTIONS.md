# Agent instructions for working GitHub issues

These instructions are for Claude Code agents (via `@claude` on issues or
cloud sessions) working issues in this repo.

## Setup

- Read `CLAUDE.md` for repo conventions: TDD (red/green/refactor),
  fast-forward merges, Prettier + ESLint (zero warnings), TypeScript with
  type-checked rules.
- This is an npm workspaces monorepo: `packages/stagebook` (library),
  `apps/viewer` (study previewer), `apps/vscode` (VS Code extension).

## Workflow

1. **Check for an existing claim.** Read the issue comments
   (`gh issue view <number> --comments`). If any comment contains
   the marker `🔧 Working on this`, check whether there is also an
   open PR for this issue (`gh pr list --state open --search "<number>"`).
   - If there is an open PR: another agent is actively handling this.
     **Stop immediately** — do not duplicate the work.
   - If there is NO open PR: the previous agent likely stalled. Proceed
     and post your own claim (it's safe to pick up where they left off).
2. **Claim the issue.** Post a comment on the issue:
   `🔧 Working on this — started <current UTC timestamp>`
   This prevents other agents from picking up the same issue.
3. Read the issue fully, then investigate the relevant code.
4. If anything about the spec is unclear or you hit a design question,
   **comment on the issue tagging @jamesphoughton** with your question
   and **wait for a response** before proceeding.
5. Follow TDD: write a failing test first, then implement the fix, then
   refactor.
6. Run `npm test` and `npm run lint` — fix any failures before committing.
7. Create a branch (e.g. `fix/issue-<number>`), commit, push, and open a
   **draft** PR to `main` referencing the issue.
8. Watch CI (`gh pr checks <number> --watch`). If checks fail, read the
   failure, fix, push, and re-check. Keep iterating until CI is green.
9. Once CI is green, **mark the PR ready for review**
   (`gh pr ready <number>`). This triggers Copilot review.
10. Wait for Copilot review comments
    (`gh api repos/talkbench/stagebook/pulls/<number>/comments`).
    Address each with a follow-up commit, push, and re-check CI.
11. Once CI is green and all Copilot comments are addressed, comment on the
    PR: **"Ready for review — @jamesphoughton"** and stop.

## Rules

- Do not guess if the spec is unclear — ask on the issue first.
- Do not modify files outside the scope of the issue.
- Do not amend commits — always create new ones.
- Assign the PR to `jamesphoughton`.
- Do not push to `main` directly — always use a PR.
