# Performance optimization handoff

This draft parks the work for continuation on a stronger machine. Timed runs on
the ARM host were stopped at the user's request. **Do not resume the repeatability
studies.** Establish one baseline on the new host, then profile and optimize the
remaining library gaps.

## Goal and current evidence

The goal remains **all 39 headline observations within 20% of the best library**,
using unrounded values. Detailed metrics are diagnostics, not additional goals.
The goal has not been achieved on this host.

- Library checkpoint: `405e3c158fb2b5dffa5abd528b09d5d200d1eb84`.
- Measurement checkpoint: `2b2062b778559f2d2046d5d7de40d629d9e4d6fb`.
- Latest complete full run: 1,740 samples, 117 supported pairs, 31 scenarios,
  39 headlines; all 16 integrity checks passed. It took 79.5 minutes here.
- Result: **36/39 within target**; 33 best/tied at displayed precision and 3 near.
- Remaining gaps, in milliseconds, lower is better:
  - Batch API writes: Peculiar Sheets **4.75**, RevoGrid **0.90**.
  - Streaming frame p95: Peculiar Sheets **33.3**, AG Grid **16.8**.
  - Slow-wheel frame p95: Peculiar Sheets **33.4**, AG Grid/RevoGrid **16.8**.

CPU placement, API timing and sampling corrections are **measurement changes,
not library speedups**. Historical timings from another protocol or host cannot
prove a code improvement. Across the latest full run and the relevant earlier
controls, 146/149 library medians stayed within 20%; three retained larger shifts.
Do not claim that measurement repeatability is completely solved.

## What is preserved

The accepted code uses shared row geometry and viewport offset observation,
native Solid 2 keyed owners and row-scoped memos, stable overlapping column
owners, and immediate row-window projection when focus scrolls. Owned integer
rows use bounded blocks only when enough row metadata can be saved; smaller
sheets keep ordinary arrays. Sparse blank tails and common mutation/history
object shapes are retained. Experimental regressions were reverted.

The harness awaits asynchronous API writes and immediately verifies their model
values. Three write headlines use API-completion time; two-frame settled times
remain diagnostics. Streaming completes all 50 batches/5,000 writes for every
library. Samples are journaled durably, order rotates evenly, and Linux runs use
one homogeneous CPU cluster. The default is 12 repetitions, with 96 only for
`replace-large-disjoint`; explicit `BENCHMARK_ITERATIONS` overrides all cases.

Raw results, source hashes, audits, current check logs, exact-version upstream
review links and the diagnostic profiler are in the
[portable evidence bundle](evidence/2026-11-04-arm/README.md).
One later 96-repetition control completed 1,056 samples; its independent repeat
was stopped after 9 samples. **The pair has no passing repeatability verdict.**

## Resume on the new machine

1. Check out this draft and install the locked dependencies with
   `pnpm install --frozen-lockfile`. Supply a local Chrome through
   `BENCHMARK_CHROME_PATH` if discovery does not find it. Do not carry this host's
   absolute browser paths or hardcoded CPU IDs onto the new host.
2. Run the quick checks: `pnpm benchmark:test`, `pnpm benchmark:typecheck`,
   `pnpm test`, and `pnpm test:solid2` (`pnpm test` requires Bun).
3. Run **one** new-host baseline in a fresh output directory:

   ```sh
   BENCHMARK_OUTPUT_DIR=.benchmark/new-host-baseline pnpm benchmark
   ```

   Keep this host's archived results separate. A faster machine is not evidence
   of a library speedup. Compare code changes on the same host and browser.
4. Profile the three gaps above. Use short focused runs while iterating:

   ```sh
   BENCHMARK_ITERATIONS=3 \
   BENCHMARK_SCENARIOS=batch-writes,streaming-updates,scroll-wheel-slow \
   BENCHMARK_OUTPUT_DIR=.benchmark/focused-candidate pnpm benchmark
   ```

   These are diagnostics, not full-suite completion evidence. Do not restart
   broad sampling experiments or increase repetition counts as an optimization.
5. Preserve the benchmark workload, versions, capability defaults, public API,
   data ownership, history, formulas, selection, custom rendering and visible
   cell coverage. Do not defer required work past a timing boundary or change
   frame phase to improve a score. Use Solid 2's native state, ownership and
   scheduling model. Keep `better-result` at orchestration boundaries.
6. Verify the final candidate with complete default-suite runs. The existing
   completion plan calls for two independent passing full runs at identical
   source, all 39 unrounded ratios at most 1.2, and relevant functional checks.
   Do not infer success from a focused subset or a rounded chart.

## Profiling leads, not established causes

- Batch writes currently take longer than independent writes. Inspect cold API
  execution, mutation preparation, duplicate identity lookups and intermediate
  arrays before choosing a change. Preserve every history entry and notification.
- `GridBody` keys rows by index modulo the current virtual-row count. A partial
  row changing that count may rebind overlapping owners. Count actual DOM/owner
  rebindings in a diagnostic trace before changing it. An earlier three-sample
  stable-slot trial did not test the slow-wheel case and proved no broad win.
- Focus scrolling reads layout after render. A phase change reduced some old
  profile costs but did not establish a reliable headline gain. Preserve header,
  pinned-column, resize and selection geometry.

Avoid reviving rejected CSS-rule, layout, presentation-cache or DOM-move trials
without new profile evidence. Intrusive profiles are diagnostics, never rankings.

## Checks when parked

At unchanged production source `2b2062b`, the final quick checks passed:
243 core tests, 17 Solid 2 tests, 20 benchmark tests and both benchmark typechecks.
Their logs are archived. No additional timed suite was run for parking the PR.
