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

# Round 2: precise-timer frame investigation (Windows, 2026-11-04)
**The all-replacement 1.2x goal remains unmet.** Each candidate pass has seven of eight headlines within target, but different failing scenarios. This is not repeatable completion evidence.
## Source, lock and protocol
- Branch: `t3/optimize-replace-frame-timing`. Round-1 merge: `12ab446`; diagnostic capture: `792607f`, directory fix `9f516a4`; library candidate: `0ed8a4a`. No push.
- All normal runs use 12 repetitions, all eight replace scenarios, all four libraries: 384 samples each, zero retries or discarded samples. The roundtrip headline is the median of per-sample sums of both steps. All replacement integrity scans passed.
- Before: `.benchmark/replace-r2-before/`; after A/B: `.benchmark/replace-r2-after-a/`, `.benchmark/replace-r2-after-b/`. Full values, journals and logs remain local. Before includes round 1 and diagnostic tooling with tracing disabled; candidate runs include the geometry cache.
- Waited for the full baseline and other agents using the mandatory directory lock. Own holds: 22:49:04 to approximately 22:54:35 (before plus failed trace save), 22:56:35 to approximately 22:57:06 (27 successful traces), and 23:03:05 to approximately 23:14:04 (both candidate passes and three candidate traces). Every hold was under 15 minutes; the EXIT trap released each owned lock, including on failure. No lock owned by another task was removed. No editing during own timed holds.
- Before and after were separated by analysis/editing and intervening lock owners; the two after passes were consecutive in the same hold. Thus the requested uninterrupted before/after sequence was not obtained. No full-suite run was added. Row reorder and insert/delete were left untouched.
## What happens frame by frame
27 diagnostic Chrome traces cover small-disjoint, small-large and few-cells, three captures per adapter for Peculiar Sheets, AG Grid and RevoGrid. Three additional candidate traces cover Peculiar Sheets. CDP categories include devtools.timeline, V8, user timing, compositor and viz. Adapter entry, submission and both rAF completions are marked only in diagnostic mode. Tracing starts before navigation, avoiding an extra driver roundtrip just before the adapter. Traces perturb scheduling and are not rankings. The initial save failed because the trace directory did not exist; `9f516a4` fixes directory creation, and the complete diagnostic run was repeated.
All times below are milliseconds relative to adapter entry. These are representative individual traces, not medians. Raw traces are in `.benchmark/replace-r2-traces/` and `.benchmark/replace-r2-candidate-traces/`. `replacementTimeline` extracts nested renderer-thread events; overlapping parent/child durations must not be summed as CPU time.
| Trace | Frame-by-frame sequence |
| --- | --- |
| PS small-large `1793807807471` | Submit 0.181; Solid flush 0.204–3.959; forced style 2.684–2.746 and layout 2.749–2.928 inside that flush; rAF1 4.009; second style/layout 4.034–4.250; observer callbacks 4.362–4.438; paint starts 4.475; rAF2 9.192. Required viewport expansion is rendered in the first measured paint cycle. |
| PS few-cells `1793807817467` | Submit 0.160; flush 0.189–1.735; idle until rAF1 14.766; style/layout 14.821–15.206; paint starts 15.292; commit starts 15.489; rAF2 31.406. No large main-thread task fills the idle gap. |
| AG small-disjoint `1793807800085` | Submit 2.703; timer flush 2.736–2.757; grid rAF 2.777–3.322 includes style/layout; grid secondary callback 3.322–3.335; measured rAF1 3.343; paint in that cycle; measured rAF2 14.589. |
| AG small-large `1793807810180` | Submit 16.000; synchronous layout 12.370–12.472; timer 16.069–16.099; grid rAF 16.124–19.530 includes layout/style and more scheduled callbacks; measured rAF1 19.561; paint starts 19.835; measured rAF2 20.381, only 0.820 after rAF1. |
| Candidate PS small-disjoint `1793808840466` | Submit 0.112; flush 0.142–1.207 with no forced style/layout; rAF1 1.261; normal style/layout 1.287–1.494; paint starts 1.594; rAF2 7.920. The unnecessary in-flush geometry pass is removed. |
| Candidate PS small-large `1793808841383` | Flush 0.230–4.195 still includes forced layout 2.909–3.092 because geometry actually changes; rAF1 8.253; normal style/layout follows; rAF2 24.812 (second interval 16.559). The cache does not solve growth. |
There is no evidence here of a large observer-triggered second render or a long task postponing required PS rendering past the boundary. There is evidence of a forced geometry read during the flush, followed by ordinary pre-paint layout; the equal-geometry fix removes the former for same-size replacement. Short observer callbacks do not show another large style/layout pass. Commit events are present; the traces do not establish physical presentation of pixels, and two rAF callbacks must not be described as two complete presented frames.
The large-small timing gap is substantially affected by frame phase. The untraced before run has these diagnostic medians (the first-wait includes async reconciliation; component medians need not sum to headline medians):
| Scenario / library | Synchronous adapter | First-frame wait after submission | Second interval |
| --- | ---: | ---: | ---: |
| small-disjoint PS | 0.03999999165534973 | 11.61999998986721 | 16.605000004172325 |
| small-disjoint AG | 2.727500006556511 | 0.6075000017881393 | 13.972499996423721 |
| small-large PS | 0.125 | 9.377499997615814 | 16.59749999642372 |
| small-large AG | 13.127500027418137 | 3.207499995827675 | 0.7149999886751175 |
| few-cells PS | 0.09000000357627869 | 6.752500012516975 | 13.167500019073486 |
| few-cells AG | 12.902499988675117 | 1.4300000220537186 | 8.58500000834465 |
The slower synchronous AG operation can be followed by two closely spaced callbacks, while PS finishes earlier and waits nearly a full additional display interval. These traces support a phase-sensitive proxy, not a claim that PS misses an extra rendering frame because of greater CPU work. The exact losing small-disjoint median was not reproduced by the three baseline traced PS samples; their total intervals were 12.129, 5.454 and 10.081. That limits causal attribution of the entire headline gap. The newer full baseline also changes large-retained from failing to best without a library change.
## Library change versus harness
Library: cache the last row geometry per grid. Equal row count, default height and visual height overrides retain the same metrics object, so Solid does not invalidate the row-window effect and read scrollTop after DOM writes merely because replacement pruned identity state. Snapshot overrides to detect later mutable changes. Actual growth, shrink, resizing and mapped override changes invalidate it. Tests cover equal geometry across map order changes, mutation, count/default-height changes, remapping, clearing and empty data. No ownership, history, formula, selection, custom-renderer or public component API changes.
Harness: opt-in capture and a tested timeline extractor only. Normal workload, timer boundary, protocol, repetitions and frame scheduling are unchanged. No measurement change or phase alignment was implemented; these commits are diagnostic tooling, not speedups. A future uniform diagnostic improvement could record rAF timestamps/start phase per step for every library and distinguish callback completion from presentation. Any change to ranked metrics would need a separate protocol decision; adding delays or aligning a phase just to pass this target is not justified by this investigation.
## Exact focused results
Times are milliseconds. Each best is the minimum median in that same run, including PS. Values and ratios below retain full stored numeric precision.

### before
| Scenario | PS | Best library | Best | PS / best |
| --- | ---: | --- | ---: | ---: |
| replace-large-disjoint | 26.985000014305115 | revogrid | 18.96500000357628 | 1.4228842609658046 |
| replace-large-retained | 28.747500002384186 | revogrid | 21.18250000476837 | 1.357134426810474 |
| replace-small-disjoint | 28.527499988675117 | ag-grid | 17.327500000596046 | 1.6463713742717532 |
| replace-small-large | 26.032499998807907 | ag-grid | 18.19999998807907 | 1.4303571437285216 |
| replace-filter-roundtrip | 60.75499999523163 | revogrid | 52.35249999165535 | 1.160498543620946 |
| replace-few-cells | 19.695000007748604 | peculiar-sheets | 19.695000007748604 | 1.0 |
| replace-wide-retained | 11.679999992251396 | revogrid | 7.939999997615814 | 1.4710327450577596 |
| replace-wide-grow | 28.177500009536743 | peculiar-sheets | 28.177500009536743 | 1.0 |

### after-a
| Scenario | PS | Best library | Best | PS / best |
| --- | ---: | --- | ---: | ---: |
| replace-large-disjoint | 9.04500000178814 | peculiar-sheets | 9.04500000178814 | 1.0 |
| replace-large-retained | 6.492499992251396 | peculiar-sheets | 6.492499992251396 | 1.0 |
| replace-small-disjoint | 12.154999986290932 | peculiar-sheets | 12.154999986290932 | 1.0 |
| replace-small-large | 25.88749998807907 | ag-grid | 20.157499998807907 | 1.2842614406354969 |
| replace-filter-roundtrip | 39.13500000536442 | peculiar-sheets | 39.13500000536442 | 1.0 |
| replace-few-cells | 7.450000002980232 | peculiar-sheets | 7.450000002980232 | 1.0 |
| replace-wide-retained | 10.275000005960464 | peculiar-sheets | 10.275000005960464 | 1.0 |
| replace-wide-grow | 22.75 | peculiar-sheets | 22.75 | 1.0 |

### after-b
| Scenario | PS | Best library | Best | PS / best |
| --- | ---: | --- | ---: | ---: |
| replace-large-disjoint | 10.5 | peculiar-sheets | 10.5 | 1.0 |
| replace-large-retained | 9.730000004172325 | peculiar-sheets | 9.730000004172325 | 1.0 |
| replace-small-disjoint | 28.55000001192093 | revogrid | 13.057500004768372 | 2.186482864368751 |
| replace-small-large | 18.360000014305115 | peculiar-sheets | 18.360000014305115 | 1.0 |
| replace-filter-roundtrip | 50.55250000953674 | peculiar-sheets | 50.55250000953674 | 1.0 |
| replace-few-cells | 7.915000006556511 | peculiar-sheets | 7.915000006556511 | 1.0 |
| replace-wide-retained | 19.189999997615814 | peculiar-sheets | 19.189999997615814 | 1.0 |
| replace-wide-grow | 24.129999980330467 | peculiar-sheets | 24.129999980330467 | 1.0 |

The first candidate pass fails small-large by 1.6984999895095827 ms above its 1.2x threshold. The second fails small-disjoint by 12.881000006198884 ms. Headline gains in a single pass cannot all be attributed to the modest geometry change; unchanged-source repeat variance is substantial. The target is still open.
## Final checks

Final check logs are in `.benchmark/replace-r2-checks/`. Core, Solid 2, benchmark tests, benchmark typechecks, library typecheck, lint and formatting are run on the final candidate. See the final check record appended below.

Final check record (2026-11-04 23:16):

- `pnpm test`: 247 passed, 0 failed.
- `pnpm test:solid2`: 17 passed, 0 failed.
- `pnpm benchmark:test`: 26 passed, 0 failed.
- `pnpm benchmark:typecheck`: runner and benchmark app passed.
- `pnpm typecheck:lib`: passed.
- `pnpm lint`: passed; explicit Biome lint of every TypeScript file touched by this task also passed.
- `pnpm format:check`: passed; explicit Biome format check of those files also passed.
- `git diff --check`: passed.
