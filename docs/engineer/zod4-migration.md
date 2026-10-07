# Zod 4 package boundary

Stagebook's exported schemas use Zod 4. Hosts that compose them with their own
schemas must install Zod `>=4.3.6 <5`. The minimum version is also the exact
development baseline, so a newer local Zod installation cannot hide a dependency
on an API absent at the lower peer bound. Zod 3 schema composition is unsupported.

Upgrade Stagebook and the host's first-party Zod dependencies together. A nested
Zod 3 installation belonging to an independent dependency such as
Empirica/Tajriba may remain; do not force it onto Zod 4 with an override.

## Reproduce the packed-package check

From the repository root, after installing dependencies:

```sh
npm run build -w stagebook
node scripts/verify-packed-consumer.mjs
STAGEBOOK_ZOD_VERSION=4.4.3 node scripts/verify-packed-consumer.mjs
```

The optional version must be an exact Zod 4 version. Each invocation creates and
prints a temporary directory containing the tarball, an independent consumer
manifest and lockfile, TypeScript fixtures, and a browser bundle/metafile. It
installs the actual `npm pack` result, without workspace aliases, linked source,
peer overrides, or a published release. Registry access or a populated npm cache
is required for the consumer's dependencies.

The check verifies:

- The package and consumer resolve the same physical Zod peer, and `npm ls`
  reports a valid dependency tree.
- Both `.mts` and `.cts` consumers compose Stagebook's treatment, prompt, and
  condition schemas inside a host `z.object`, with strict TypeScript checking
  and `skipLibCheck: false`.
- The ESM and CJS schemas accept representative valid inputs and reject malformed
  treatment, prompt, and condition inputs with structured issues.
- Omitted deferred authoring fields remain omitted, including template content,
  treatment stages, intro elements/steps, and consent steps. These checks cover
  the optional-field behavior that changed in Zod 4.4.
- `stagebook/validate` handles valid and malformed source through its public API.
- All runtime entry points import in ESM and CJS and bundle for a browser, with
  the Zod 4 implementation. `stagebook/dispatch/contract` is a Vitest test harness,
  not a runtime/browser entry point, and is excluded from this runtime smoke test.

Keep this package test alongside the schema, validation, viewer, CLI, and browser
tests: it catches declaration and peer-resolution failures that workspace tests
can miss. CI runs the packed check with both Zod 4.3.6 and 4.4.3.

## Coordinate host adoption

Use the same packed candidate in isolated copies of each host before publishing.
Record the checked commit, installed Stagebook/Zod versions, relevant commands,
and any remaining failures. Dependency changes belong in each host's own release
or adoption change; this repository's package test does not prove that a host has
deployed the new version.

| Host      | Packages that must adopt together                          | Relevant integration checks                                                                                                                  |
| --------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner    | `server`, `client`, `contracts`, `playwright/manager-mock` | Shared contract validation, preflight parsing, participant rendering, client build; preserve independent Empirica/Tajriba Zod 3 dependencies |
| Annotator | `src/backend`, `src/frontend`                              | Treatment expansion and prompt rendering, frontend typecheck/build, single-participant provider contract                                     |
| Manager   | Root service                                               | Treatment hydration/asset validation, dispatcher contract, TypeScript build                                                                  |
| Talkbench | `apps/core-api`, `apps/web`                                | Treatment validation and preview, strict schema composition, service/frontend typechecks and browser build                                   |

The Zod major migration does not require changes to authored treatment, prompt,
or condition files. Host-owned Zod 3 code may need the same mechanical changes as
the library: two-argument `z.record(key, value)`, `error` customization in place of
removed constructor options, `.issues` instead of `.errors`, and explicit
`.optional()` on fields that are allowed to be absent. Preserve each host's
validation behavior when making those changes.

## Candidate verification, 2026-10-06–07

Candidates were packed from the migrated source while retaining the existing
`0.34.0` package version; they were not published. The isolated package check passed
on Zod **4.3.6** and **4.4.3**, including strict ESM/CJS declaration composition,
rejection of a boolean numeric-field input at compile time, malformed-input
diagnostics, peer identity, runtime imports, and browser bundling.

The October 6 candidate was installed in isolated copies of all four consumers.
On October 7, Annotator and Talkbench were rechecked at their default-branch
commits below with a freshly packed candidate. The fresh candidate has identical
runtime files, declarations, manifests, and assets to the October 6 candidate;
only build-location paths in CJS source maps differ. The original working trees
and databases were not modified.

| Consumer source commit                               | Resolved Zod | Passed checks                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner `c73debf0a30afb441ab5f0fa6c398700d499f698`    | 4.3.6        | 1,238 server, 207 contract, 31 mock, and 106 adapter tests; server/client builds; final-candidate recheck of 280 preflight tests plus contracts, mock, adapters, composition, and peer identity                              |
| Annotator `c76d48899030e8c3bb8b4e8fc770164ff2fe1879` | 4.3.6        | 94 treatment-expansion tests; 22 provider/adapter/media-path tests; frontend TypeScript and Vite build; strict schema composition and ESM/CJS probes                                                                         |
| Manager `1cb71313b373274452f2d06b70a09aa56d3e1e30`   | 4.4.1        | 167 hydration, asset, service, treatment-listing, and dispatcher tests; TypeScript build; strict schema composition and ESM/CJS probes                                                                                       |
| Talkbench `47618d644a5dd01ac0b8276625162cf9ccde49a3` | 4.4.3        | 98 preflight, asset-snapshot, contract, and existing pin-consistency tests using a disposable database; 5 validation/preview tests; service/frontend typechecks; browser build; strict schema composition and ESM/CJS probes |

All source commits above were the respective default-branch heads when last
checked. Annotator verification includes its prepared single-participant state
reader: explicit seat zero reads work, other seats remain absent, and stored
arrays retain their singleton transport envelope. The adapter adjustment was
rebased over the provider's media-path changes and still belongs in Annotator's
adoption PR. Talkbench verification required only the candidate dependency
replacement; its coordinated release pins remain unchanged.

These checks establish candidate compatibility. Release adoption still requires
regenerating consumer lockfiles against the published release. Talkbench's
`STAGEBOOK_VERSION`, `RUNTIME_STAGEBOOK_VERSION`, Runner image, and vendored
contract pin must move together. Its existing pin-consistency tests were run
without editing those constants; they compare the existing recorded pins and do
not establish that a future Runner image has been published. Do not update only
the Talkbench package manifests and call that release adoption complete.

## Diagnostics and compatibility

Validation failures expose Zod 4 `error.issues`. Union branches now use `errors`
(issue arrays), and an unmatched discriminator is an `invalid_union` issue with
`discriminator` metadata. Do not read Zod 3's `unionErrors` or depend on its native
message wording. Stagebook retains source paths and limits recursive expression
diagnostics; the source validators continue to report YAML positions.

The migration preserves parsed output, defaults, omitted optional properties,
strict keys, reference typing, and expression semantics. Explicit optional
wrappers preserve deferred authoring fields on Zod 4.4 and newer, which otherwise
require keys containing `z.any()` or `z.unknown()`. The existing valid example
fixtures were compared directly with the Zod 3 implementation, including hydrated
treatments and parsed prompts.

Talkbench's final adoption also updates its coordinated runtime pins: Stagebook,
the Runner image, and the Runner contract version must agree. A packed-candidate
check does not supply a future Runner image tag or replace that release gate.

See Zod's [migration guide](https://zod.dev/v4/changelog) and
[library-author guidance](https://zod.dev/library-authors) for host schema changes.
