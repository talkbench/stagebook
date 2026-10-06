# Upgrading a Study

Most Stagebook releases only add things: a study that validated before still validates, and still runs the same way. Some releases change what valid YAML means. The same file runs differently after the upgrade, and nothing reports an error. The validator finds each construct a change affects and warns about it. These are **upgrade warnings**.

Stagebook is still in 0.x, so a minor release (0.33 → 0.34) can make such a change. From 1.0 on, changes like these will come only in major releases (1.x → 2.0): a study written for 1.2 will keep its meaning on every later 1.x release.

Upgrade warnings fire only on files written for an older release. A file says which release it was written for in its `stagebook:` field:

```yaml
stagebook: "0.33"
```

A file with no `stagebook:` field is treated as written before the first such change, so every upgrade warning applies to it. See [Stagebook version](treatment-files.md#stagebook-version) for the field itself.

## How to upgrade

1. **Validate every file in the study,** including the files it imports and its prompt files:

   ```bash
   npx --package=stagebook stagebook validate \
     'stagebook/**/*.stagebook.yaml' \
     'prompts/**/*.prompt.md'
   ```

2. **Review each upgrade warning.** It names the change and the construct it affects. Check that the construct still does what the study needs under the new behavior, using the release's notes below, and rewrite it if not.
3. **Set the file's `stagebook:` field to the current release** once its warnings are reviewed. That silences them: the warnings mark constructs to review, not mistakes, so a reviewed construct that's still correct needs no change.
4. **Bring every file to the same version.** When the study's entry file declares a version, an imported file or a prompt file that declares an older one, or none, gets a warning at the reference that brings it in. Review that file the same way and raise its field.

Upgrade warnings never change the exit code: the CLI still exits `0` when a study has only warnings.

A condition is judged by the version of the file that contains it. For a template, that's the file that defines the template, so its warnings appear when you validate that file, at the definition.

## Changes by release

Each release that changes what valid YAML means gets a section here. Each section lists the release's upgrade rules by id, what changed, and how to review the affected constructs.

## 0.34 — unified expressions (unreleased)

This is the first versioned grammar migration. It adds calculations and explicit group quantifiers, removes implicit numeric coercion, and uses one Missing value for unanswered inputs. Read [Conditions](conditions.md) for the full grammar and examples. The package version is not bumped by the implementation PR; these rules describe the next release.

Validate all treatment files, imported modules, and prompt files before updating their version fields. Review these warnings against the intended participant experience, especially at stage load and after an answer is cleared:

| Rule ID | Change and review |
| --- | --- |
| `prompt-blank-answers` | Empty selections and empty or whitespace-only prompt text are Missing. Check presence tests, length tests, regex checks, and comparisons to blank values. Use `exists` / `doesNotExist` for answer presence. |
| `none-before-answers` | `none:` can be true before anyone answers. If an element or discussion should wait, add an explicit presence test or phrase the condition positively. Surrounding Boolean structure still determines the whole gate. |
| `none-stage-termination` | The same missing-answer rule changes early termination: a stage gate using `none:` can remain true at load instead of advancing immediately. Check the entire stage condition, including nested negation and sibling branches. |
| `text-comparison-normalization` | Equality and membership, including their negative forms, trim and lowercase text. Check labels, free-text answers, and URL parameters whose case or surrounding spaces previously distinguished groups. Internal whitespace is unchanged. |
| `numeric-text-comparison` | Two numeric-looking strings compare as text: `"100.00"` differs from `"100"`, and `"007"` differs from `"7"`. Use numeric prompt values when numerical equality is intended. |
| `strict-comparison-types` | Text is not coerced to a number, and numbers are not coerced to quoted text. Known mismatches are validation errors in either direction. Match literals to the stored type; see [Prompts that save numbers](conditions.md#prompts-that-save-numbers). |
| `regex-delimiter-parsing` | Leaf `/pattern/flags` values now separate the pattern from flags correctly and preserve internal slashes. Review patterns affected by the former slash-stripping behavior. Supported flags are `i`, `s`, and `u`; see the [regex limits](../engineer/regex-execution.md). |
| `everyone-reference` | Replace the reference position `all` with `everyone`. For an `exists` leaf, use `any:` to retain “someone answered.” Wrap negative leaves and `doesNotExist` in `all:`. Positive leaves under `all:` are stricter than before: every seat must answer and satisfy the comparison. Display and URL-parameter references also use `everyone`. |

Warnings on template definitions can be conservative when a placeholder hides the eventual value. Review the definition and its uses together. Imported templates are judged by their defining file's version; raising the entry file's version does not certify the imported module.

After reviewing each file, set `stagebook: "0.34"` in that file. This suppresses these upgrade warnings; it does not suppress syntax/type errors or unknown-reference-type warnings, and it does not select an older runtime behavior.

Host integrations must also replace `resolve` / `useResolve` with the new scalar-or-Missing `readReference` / `useReadReference` API and remove their `get(key, "all")` branch. See the [engineer migration guide](../engineer/platform-requirements.md#breaking-reference-read-migration-757).
