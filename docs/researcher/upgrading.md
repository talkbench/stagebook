# Upgrading a Study

Most Stagebook releases only add things: a study that validated before still validates, and still runs the same way. Some releases change what valid YAML means. The same file runs differently after the upgrade, and nothing reports an error. The validator finds each construct a change affects and warns about it. These are **upgrade warnings**.

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

No release has upgrade rules yet.
