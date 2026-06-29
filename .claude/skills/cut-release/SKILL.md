---
name: cut-release
description: Cut a new stagebook release. Bumps `packages/stagebook/package.json`, opens a release PR, then tags + creates a GitHub release after the PR merges. npm publish is handled by a GitHub Action — do not run `npm publish` manually.
---

# Cut a stagebook release

Use this when the user asks to "cut a release", "release stagebook", "ship v0.X.Y", or similar.

## 1. Decide the version

Read `packages/stagebook/package.json` for the current version, then list what's landed since the last release tag:

```sh
git fetch --tags
LAST_TAG=$(git tag --sort=-v:refname | head -1)
git log --oneline "$LAST_TAG"..origin/main
```

Ask the user which tier (patch / minor / major) unless it's obvious. Heuristics:

- **Patch** (`0.10.3 → 0.10.4`) — bug fixes only, no API surface change. Most common.
- **Minor** (`0.10.x → 0.11.0`) — additive features, new exports, new schema fields. Backward compatible.
- **Major** (`0.x.y → 1.0.0`) — breaking changes (renamed/removed exports, schema rejections that previously passed, behavior changes that could silently break consumers).

Note: prior versions are not strictly sequential — `0.10.2` was skipped. Don't infer the next version by looking at the tags alone; check the actual `package.json`.

## 2. Bump on a release branch

`main` is protected — direct pushes are rejected. Always go via a `release/X.Y.Z` branch:

```sh
git checkout main && git pull origin main
git checkout -b release/X.Y.Z
# edit packages/stagebook/package.json: bump "version" field only
git commit -am "chore(release): bump stagebook to X.Y.Z

<release notes — same shape as the PR body in step 3>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin release/X.Y.Z
```

The commit subject must follow the format `chore(release): bump stagebook to X.Y.Z` — the GitHub Action keys off this.

## 3. Open the release PR

Use this body shape (mirror what prior releases like [v0.10.4](https://github.com/deliberation-lab/stagebook/releases/tag/v0.10.4) and [v0.10.3](https://github.com/deliberation-lab/stagebook/releases/tag/v0.10.3) look like):

```
Patch release picking up <one-line summary>.

## What's in

- **#NNN** — <one-line description of what the PR did and why it matters to consumers>
<one bullet per merged PR since the previous tag>

## Compatibility

- No API changes. (or: list breaking changes)
- <other consumer-facing notes — e.g. "Existing X now produces a clear parse error rather than silent failure">
```

Open it:

```sh
gh pr create --title "Bump stagebook to X.Y.Z" --body "<body>"
```

A release PR is just a one-line `package.json` bump — no code to review. Try auto-merge first so it lands as soon as CI is green:

```sh
gh pr merge <PR#> --squash --auto
```

**This may fail with `Auto merge is not allowed for this repository (enablePullRequestAutoMerge)`** — the repo-level setting toggles between owners. Fall back to polling CI in the background and merging manually:

```sh
until result=$(gh pr view <PR#> --json statusCheckRollup \
    --jq '.statusCheckRollup[] | select(.name == "CI Gate") | .conclusion') \
    && [ -n "$result" ] && [ "$result" != "" ] && [ "$result" != "null" ]; do
  sleep 20
done
echo "CI Gate: $result"
# Then merge:
gh pr merge <PR#> --squash
```

Run the `until` loop via Bash's `run_in_background: true` so the user isn't blocked.

Auto-merge (when available) is safe **only** for release PRs (single-line version bump on a `release/X.Y.Z` branch, no other changes). If the PR diff touches anything else, do not auto-merge — wait for the user. The merge style is `--squash` to match the project convention (recent main has the squash-style `<message> (#N)` commits).

If the user is around, you can either merge automatically (auto or poll-then-merge) and notify them, or wait for them to merge manually — their call. If they're away, proceed automatically.

## 4. After the PR merges: tag + GitHub release

Once the PR merges (whether you enabled auto-merge or the user merged manually):

```sh
git checkout main && git pull origin main
# Tag the merge commit (HEAD of main), not the bump commit on the feature branch.
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes "<same body as the PR, or close to it>"
```

The GitHub Action triggers on the tag push and handles `npm publish`. **Do not run `npm publish` manually** — the Action has the auth scope and runs `prepublishOnly` (lint + test + build) first.

## 5. Verify

After a few minutes:

```sh
npm view stagebook version
```

Should show the new version. If it doesn't after ~10 minutes, check the Actions tab on GitHub for a failed publish job.

## 6. Close any straggler linked issues

GitHub's auto-close only attaches the "Fixes/Closes" keyword to the **first** issue in a comma-separated list — `Fixes #331, #359, #360` closes only #331. The remaining issues stay open even though the PR shipped.

For each PR in this release, scan the body for issue references and check each one's state:

```sh
# Example: PR #361 fixed three issues, only the first was auto-closed.
gh issue view 359 --json state,closedAt
gh issue view 360 --json state,closedAt
```

For any that's still `OPEN`, close it with a reference to the PR + release tag:

```sh
gh issue close <NNN> --comment "Fixed in #<PR> (released as [v<X.Y.Z>](https://github.com/deliberation-lab/stagebook/releases/tag/v<X.Y.Z>)). <one-line summary of what landed>"
```

## What to avoid

- Don't push the bump commit directly to `main` — it's rejected by branch protection.
- Don't tag the bump commit on the release branch — tag the merge commit on `main` instead, so the tag history is linear.
- Don't run `npm publish` manually — the GH Action owns this. Manual publish would race with the Action and may use the wrong credentials.
- Don't skip the `chore(release):` prefix on the bump commit — automation may rely on it.
- Don't infer the version from `git tag` alone — check `packages/stagebook/package.json` since the tag sequence has gaps (0.10.2 skipped).
- Don't use `gh pr merge --auto` for anything other than a release PR. Auto-merge is safe here because the diff is a single-line version bump with no code; for normal PRs the user reviews and merges.
