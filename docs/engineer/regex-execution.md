# Regex execution

Stagebook evaluates `matches` and `doesNotMatch` with native JavaScript
`RegExp`, synchronously in the caller's thread. This retains the JavaScript
regex contract in [#299](https://github.com/talkbench/stagebook/issues/299).
The evaluator has input and pattern length caps, but **no execution timeout or
guarantee against catastrophic backtracking**. A sufficiently expensive
researcher-authored pattern can still block a browser or Node event loop.

## Current behavior

The expression form accepts a nonempty list of literal pattern strings, without
`/…/` delimiters. Every pattern must match the raw input string. The optional
`flags` string allows `i`, `s`, and `u`, each at most once; its default is `""`.
Leaf comparators also accept a literal `/pattern/flags` string. No regex flag
is added implicitly, and text normalization used by equality does not apply.
Backreferences and lookaround retain the behavior of the host JavaScript engine.

| Limit or input                                      | Behavior                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| Pattern longer than 1,024 UTF-16 code units         | Authoring validation rejects it; a direct runtime call returns Missing    |
| Invalid regex syntax or unsupported/duplicate flags | Authoring validation rejects it; a direct runtime call returns Missing    |
| Input longer than 4,096 UTF-16 code units           | Positive `matches` returns false without matching or truncating the input |
| Missing input and otherwise valid pattern           | Positive `matches` returns false                                          |

`doesNotMatch` and `none` around `matches` follow ordinary negation, so they
return true for an over-limit or missing input with a valid pattern. The
limits measure JavaScript string `.length`; an emoji represented by a surrogate
pair occupies two units. A regex literal's surrounding slashes and flags are
not part of its pattern-length limit.

Authoring validation compiles patterns to check syntax. It does not run them
against participant data or synthetic examples. Runtime validation also checks
patterns before testing the input, including when the input is missing or over
its cap. A successful syntax check says nothing about matching cost.

## Why the caps are insufficient

Native backtracking can take exponential time on short, failing inputs. V8's
own explanation uses nested repetition to demonstrate this behavior; it also
describes an experimental fallback with restrictions that exclude, among other
things, backreferences, lookaround, and `i`/`u` flags. Stagebook cannot rely on
that engine-specific feature as a portable browser-and-Node contract.
See [V8's account of catastrophic backtracking](https://v8.dev/blog/non-backtracking-regexp).

The benchmark below demonstrates the remaining risk through Stagebook's public
API. It is not a safety certification for other patterns or engines. Adding a
timer around a synchronous expression call would not interrupt matching on
that same thread.

There is no static safety screen or alternate regex engine in this
implementation. A heuristic screen would need its own explicit rejection
policy: for example, the
[`safe-regex` project documents false positives and false negatives](https://github.com/davisjam/safe-regex).
A linear engine would also change the accepted language; for example,
[RE2 excludes backreferences and lookaround](https://github.com/google/re2/wiki/Syntax).
Neither option silently preserves the current JavaScript contract.

A future hard execution budget needs a separate API/compatibility decision.
Isolated workers or subprocesses can be terminated externally, but collecting
their results requires asynchronous host integration in the browser. Browser
[`Worker.terminate()`](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate)
provides termination; it is not part of the current synchronous expression API.

## Reproducing the benchmark

From the repository root, with the package's supported Node version:

```sh
npm run build -w stagebook
node scripts/benchmark-regex.mjs
```

The [benchmark script](../../scripts/benchmark-regex.mjs) imports the built
`evaluateExpression` and `Missing` exports. It supplies each sample through a
`readReference` callback and evaluates the real `matches` operator. Each case
runs in a fresh subprocess; the parent never evaluates a pattern. Node's
[`spawnSync` timeout](https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options)
sends `SIGKILL` after the configured budget. The default is 2,000 ms per case,
including process startup and package import; override it with
`--timeout-ms=1000` (accepted range: 100–10,000 ms).

The output includes engine/platform versions, input and pattern lengths, total
wall time, and evaluation time for completed cases. A timeout on an adversarial
case is an observation and does not fail the script. A wrong completed result,
a subprocess error, or a timeout on a cap/control case exits nonzero. Do not
copy the adversarial samples into a test that runs in the test runner's own
process.

One run on 2026-10-06 used Node 24.15.0, V8 13.6.233.17-node.48, macOS arm64,
while browser tests were also running. Rounded observations:

| Case                                      | Input units | Pattern units | Result               | Evaluation time |
| ----------------------------------------- | ----------: | ------------: | -------------------- | --------------: |
| `^a+$` at the input cap                   |       4,096 |             4 | true                 |          2.4 ms |
| `^a+$` over the input cap                 |       4,097 |             4 | false                |          2.7 ms |
| Over-length pattern                       |           1 |         1,025 | Missing              |          4.2 ms |
| `^(a+)+$` against 20 `a`s followed by `!` |          21 |             7 | false                |        370.3 ms |
| Same pattern, 24 `a`s followed by `!`     |          25 |             7 | External 2 s timeout |               — |
| Same pattern, 32 `a`s followed by `!`     |          33 |             7 | External 2 s timeout |               — |

The timed-out rows include startup and have no completed evaluation timing.
Timings vary with engine, machine, and concurrent work. The controls completed
and verified the caps; the adversarial cases remained within both caps. The
external benchmark deadline does not exist in production evaluation.
