# Windows replace-small-large investigation

The gap remains: the candidate measured **26.900 ms / 21.350 ms = 1.259953x**
against AG Grid. This is not completion evidence for the 39-headline goal.

## Source and measurement

- Host: Windows 11 Ryzen; branch `t3/optimize-replace-small-large`.
- Baseline: `26b275b`; candidate library change: `257635e`.
- Both runs: 12 repetitions, all eight `replace-*` scenarios, all four default
  libraries, no retries or discarded samples, 384 samples per run.
- Local evidence: `.benchmark/replace-before/` and `.benchmark/replace-after/`;
  each contains `latest.json`, `summary.json`, the sample journal and `run.log`.
- Machine-wide lock held separately for each run and the CPU trace; each hold
  lasted under six minutes. Other agents' lock holds intervened between runs.
- These matched runs both use `api-completion-v2` **before** the isolated-timer
  protocol. The later harness merge `bc78fbc` includes `54ce8c8` (editor fix) and
  `2f03419` (timer isolation). Do not compare these numbers with isolated-timer
  results or attribute a protocol difference to this library change.
- An additional isolated baseline was queued, then cancelled while waiting for
  the harness full-suite lock. It acquired no lock and produced no samples.

## What is timed and profile findings

The Peculiar Sheets adapter sets the controlled matrix signal and maps row IDs
through `rowId`. Its model reconciler runs during Solid's flush. AG Grid converts
the matrix into keyed row objects and calls `setGridOption("rowData", ...)`.
The measurement starts before the adapter call and ends after two animation
frames. Replacement construction and the complete cell integrity scan are
outside that measured interval. No workload, adapter or frame-phase changes were
made here.

The 10-row to 10,000-row replacement does not use packed integer blocks: the
initial store falls below the metadata-savings threshold, and replacement adopts
ordinary owned arrays. Materialization copies host rows, installation preserves
the stable storage handle, and authoritative replacement clears incompatible
history and prunes identity state. Shared uniform-height row metrics are O(1).

Existing phase marks, supplemented by CDP CPU and timeline profiling, identified
row-ID validation and owned-row installation as small avoidable costs. The trace
sample had 1.3 ms of marked reconciliation and 11.6 ms settled time; its complete
diagnostic interval contained 0.30 ms of layout and 0.17 ms of style updates.
The trace includes integrity verification, so total CPU/GC costs cannot all be
assigned to the headline. Local trace files are
`.benchmark/replace-profiles/baseline-replace-small-large.{cpuprofile,trace.json,json}`.

Across the baseline's 12 target samples, the median first-frame interval was
12.20 ms and second-frame interval 16.55 ms. Individual settled times ranged from
5.8 to 33.2 ms. This evidence points to substantial frame-phase sensitivity;
it does not establish a large CPU bottleneck capable of explaining the headline
gap. Required work and scheduling remain synchronous/unchanged.

## Changes

- Validate valid IDs with native `Set` construction, avoiding separate `has`
  and `add` lookups. Invalid IDs retain the first-duplicate diagnostic scan.
- Reserve owned row storage before installation, preserving the existing outer
  storage reference, row references and iterator behavior.
- Add regression coverage for large unique identity sets, first duplicate
  reporting, stable storage, growth, shrink and empty replacement.

Median marked target phases (ms):

| Phase | Before | After |
| --- | ---: | ---: |
| Host row materialization | 0.500 | 0.500 |
| Owned row installation | 0.350 | 0.300 |
| Complete identity replacement | 1.100 | 1.000 |

These are modest internal improvements; the pair does not demonstrate a
meaningful improvement in the headline ratio.

## All replacement headlines

Times are medians in milliseconds. Ratios use unrounded stored values; displayed
times are rounded here. Best library abbreviations: PS = Peculiar Sheets,
AG = AG Grid, RV = RevoGrid.

| Scenario / step | Before PS | Before best | Before ratio | After PS | After best | After ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| replace-large-disjoint | 11.000 | 11.000 PS | 1.000000 | 8.800 | 8.800 PS | 1.000000 |
| replace-large-retained | 8.000 | 8.000 PS | 1.000000 | 9.450 | 9.450 PS | 1.000000 |
| replace-small-disjoint | 3.900 | 3.900 PS | 1.000000 | 7.100 | 7.100 PS | 1.000000 |
| replace-small-large | 29.000 | 22.850 RV | 1.269147 | 26.900 | 21.350 AG | 1.259953 |
| replace-filter-roundtrip / replace | 8.800 | 8.800 PS | 1.000000 | 11.450 | 11.450 PS | 1.000000 |
| replace-filter-roundtrip / restore | 33.450 | 33.350 AG | 1.002999 | 33.400 | 33.300 AG | 1.003003 |
| replace-few-cells | 9.150 | 9.150 PS | 1.000000 | 7.900 | 7.900 PS | 1.000000 |
| replace-wide-retained | 19.650 | 9.600 RV | 2.046875 | 11.600 | 11.600 PS | 1.000000 |
| replace-wide-grow | 25.600 | 25.600 PS | 1.000000 | 25.200 | 25.200 PS | 1.000000 |

All other replacement headlines remain within 1.004x in the candidate run.
Absolute medians move in both directions, including 3.9 to 7.1 ms for small
disjoint replacement. Given frame sensitivity, this pair cannot prove absence
of absolute-time regressions. Every replacement cell passed the harness's
integrity scan. The target would require 25.620 ms at the candidate run's best
time; it remains 1.280 ms above that threshold.

## Final checks

After restoring the candidate and merging the harness changes:

- `pnpm test`: 245 passed, 0 failed.
- `pnpm test:solid2`: 17 passed, 0 failed.
- `pnpm benchmark:test`: 25 passed, 0 failed.
- `pnpm benchmark:typecheck`: both typechecks passed.
- `git diff --check`: passed.

No push was performed. Further isolated-protocol measurements are needed before
claiming performance on the merged harness, and the target gap remains open.
