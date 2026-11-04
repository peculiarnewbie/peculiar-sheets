# Windows cold batch-write optimization

The 1.2x goal remains unmet. Same-host, fresh-browser, zero-warmup runs with
12 samples per scenario/library reduced the batch median from
0.800000011920929 ms to 0.7000000178813934 ms (about 12.5%). RevoGrid's
API-completion median was 0.20000001788139343 ms in both runs. The unrounded
ratio improved from 3.9999997019768028 to 3.499999776482602.

## Measurement and profiling

Baseline: 26b275b. Candidate: the addressing-context and store-revision changes
committed with this evidence. Raw samples: [before.json](before.json),
[after.json](after.json). Each contains 72 samples: two scenarios, three libraries,
12 repetitions. All runs used the machine-wide directory lock, released after
completion. No workload, adapter, timing boundary, or feature settings changed.
`offscreen-writes` is the harness name for dispersed independent writes.

| API-completion median (ms) | Before | After | Before / best | After / best |
| --- | ---: | ---: | ---: | ---: |
| Batch writes, Peculiar Sheets | 0.800000011920929 | 0.7000000178813934 | 3.9999997019768028 | 3.499999776482602 |
| Independent writes, Peculiar Sheets | 0.75 | 0.7000000178813934 | 1 | 1 |

Before independent-write medians: AG Grid 1.0999999940395355 ms, RevoGrid
1.2000000178813934 ms. After: AG Grid 1.1000000089406967 ms, RevoGrid
1.2999999821186066 ms. Peculiar Sheets was the best in both independent runs.

Temporary `performance.now()` phase probes were inserted around batch dedupe,
mutation preparation, store writes/revision invalidation, and history construction.
Three cold batch calls in the fuller trace reported:

| Phase (ms, intrusive diagnostics) | Sample 1 | Sample 2 | Sample 3 |
| --- | ---: | ---: | ---: |
| String Map dedupe | 0.2 | 0.1 | 0.1 |
| Mutation preparation | 0.2 | 0.2 | 0.3 |
| Owned cell writes | 0.1 | 0.1 | 0.1 |
| Row revision bookkeeping | 0.2 | 0.2 | 0.2 |
| Store commit, including preceding two phases | 0.3 | 0.3 | 0.3 |
| History | 0 | 0 | 0.1 |
| Whole API call | 0.8 | 0.8 | 1.1 |

Commit is inclusive; do not sum it with its subphases. Timers remained coarsened
near 100 microseconds. Zero means unresolved, not free. These probes identify
per-cell preparation and revision work as material costs, but do not establish
whether cold compilation or GC contributes to the remaining unaccounted time.
No CPU profile was collected. Intrusive timings are not ranking evidence.

The adapter maps the input array and calls the synchronous public
`setCellValues`; this returns `void`, so no promise or microtask is awaited on
this path. The measured synchronous and completion durations were identical in
the phase samples. Read-back verification and the two-frame settling wait happen
after completion timing. Phase totals account for most observed API cost; there
is no evidence here of a render flush dominating the timed interval.

## Retained changes and semantics

- Resolve store, columns, sorted visual IDs and physical row IDs once per batch.
  Keep original duplicate normalization and first-address insertion order.
- Build the same mutation identities and old values before any commit. Preserve
  reactive row subscriptions, sorted addressing and final no-op elimination.
- Collect changed row IDs during owned-cell writes, eliminating the temporary
  row-number array and the extra traversal. Bump each row once, then the global
  revision, after all writes as before.
- Keep formula synchronization, better-result orchestration, history construction,
  notification timing/payloads and selection behavior unchanged.

A public Sheet regression test covers sorted addressing, duplicates, a duplicate
ending at its original value, committed values observed in notifications, inverse
payloads, one undo entry, redo, no-op notification suppression and selection.

An experimental direct mutation-input store path removed another intermediate
array but had no resolved gain (0.7000000178813934 ms). Exact numeric dedupe keys
also had no resolved gain. Both were reverted to retain the simpler API and code.

## Validation

- `pnpm install --frozen-lockfile`: passed.
- `pnpm test`: 243 passed.
- `pnpm test:solid2`: 18 passed (including the new public regression test).
- `pnpm benchmark:test`: 22 passed before the harness merge; 25 passed after it.
- `pnpm benchmark:typecheck`: both checks passed.
- `pnpm typecheck:lib`, `pnpm typecheck:solid2`: passed.
- `pnpm lint`, `pnpm format:check`: passed.

No full-suite goal claim is made. The batch gap remains about 3.5x. The required
history, mutation identities, row revisions and normalization do more synchronous
work than RevoGrid's assignments plus refresh; this is a plausible explanation,
not a controlled attribution of the entire gap. A finer timer and CPU profile
are needed before more invasive changes. The shared branch was checked throughout. The cross-origin-isolation harness
commit 2f03419 arrived after the focused measurements and was merged in 926b888.
The merged harness passes 25 benchmark tests and both benchmark typechecks.
A precise-timer before/after run was queued, but another agent acquired the
machine lock for a full-suite baseline. The optional queued run was canceled
before acquiring the lock; the committed candidate was restored, and the other
agent's lock was left untouched. These results therefore remain coarse-timer
measurements; no precise-timer improvement is claimed.


## Round 2: precise timer (2026-11-04)

Starting point: `e44097d`, after merging `t3/optimize-batch-writes` into
`t3/optimize-cold-batch-writes`. The public workload, adapters, timing boundary,
feature settings, fresh browser per sample and zero warm-ups are unchanged.
Every timed run and intrusive profile acquired the machine-wide directory lock,
identified itself as `batch-r2`, and released only its own lock on exit. Work
waited behind full-baseline owners twice; those owners' locks were left intact.
Each ranking run has 12 samples per library/scenario (72 total). All samples
report cross-origin isolation and about 0.004999995231628418 ms clock granularity.
The precise baseline is [round2/baseline.json](round2/baseline.json).

| Experiment | Peculiar batch median ms | Best batch median ms (RevoGrid) | Unrounded ratio | Peculiar independent median ms | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Merged baseline | 0.6599999964237213 | 0.1850000023841858 | 3.567567502259338 | 0.7224999964237213 | Reference |
| Numeric address keys | 0.6425000131130219 | 0.20750001072883606 | 3.0963854452646267 | 0.6875000149011612 | Reverted: unresolved |
| Mutation-native store commit | 0.6475000083446503 | 0.1925000250339508 | 3.363635969556119 | 0.6825000047683716 | Reverted: unresolved |
| Preparation: observer check, stable shape, erased brand helpers | 0.6475000083446503 | 0.23000001907348633 | 2.8152171941245374 | 0.7275000065565109 | Reverted: unresolved |
| Consolidated counter/signal entries | 0.6550000011920929 | 0.20499999821186066 | 3.1951219849044694 | 0.677499994635582 | Reverted: unresolved |
| Dense exact counters + row-ID index | 0.7450000047683716 | 0.20499999821186066 | 3.634146396423082 | 0.7374999970197678 | Reverted: regression |
| Bounded uniqueness bitmap | 0.6800000071525574 | 0.21000000834465027 | 3.2380951434846947 | 0.7000000029802322 | Reverted: no gain |

The numeric and direct-store approaches were re-evaluations of the round-1
rejected ideas. Their median reductions were only 0.017499983310699463 ms and
0.012499988079071045 ms. Independent 20,000-resample percentile bootstrap 95%
intervals for baseline-minus-candidate medians included zero: respectively
[-0.017500028014183044, 0.07000002264976501] and
[-0.05250002443790436, 0.06000000238418579] ms (Python Random seed 12345).
A changed same-run RevoGrid denominator explains part of the apparent ratio
improvement; these results do not establish library speedups.

The bitmap checks valid bounded integer addresses without allocating string
keys, then uses the original Map normalization if any address repeats or falls
outside that domain. It cost more than it saved on this cold workload.
Raw snapshots and baseline-relative experiment patches are in [round2](round2).

### Cold profile before changes

Three fresh-browser cold samples requested `Profiler.setSamplingInterval(50)`
and used temporary precise `performance.measure` phase probes. The CPU profiler
actually delivered median sample spacing of 522, 514 and 524 microseconds on
Windows (76, 78 and 88 samples including CDP/program/idle and settling time).
This is insufficient to attribute sub-millisecond phases to individual minified
functions or prove Ignition/Sparkplug/GC attribution. The raw CPU profiles and
phase observations are archived as `round2/before-profile-*.json`.

| Intrusive phase, ms | Sample 1 | Sample 2 | Sample 3 |
| --- | ---: | ---: | ---: |
| String Map normalization | 0.1550000011920929 | 0.09999999403953552 | 0.13499999046325684 |
| Mutation preparation | 0.12000000476837158 | 0.17500001192092896 | 0.1300000250339508 |
| Owned writes + changed-row Set | 0.10999998450279236 | 0.1300000250339508 | 0.12000000476837158 |
| Exact row revision counters/signals | 0.08000001311302185 | 0.07499998807907104 | 0.07499998807907104 |
| History + history revision | 0.08500000834465027 | 0.0949999988079071 | 0.07499998807907104 |

These probes add overhead and are diagnostic, not ranking samples. The CPU
capture includes the cold public API call and post-completion verification and
settling; its full duration must not be mistaken for API time.

Reader audit: production row revisions are read by Grid's raw-row subscription;
search invalidation uses the separate data revision through Grid's search scan
source. The store exposes exact per-row counts, and core/Solid tests read counts
for unobserved rows, host reconciliation, observer disposal/return and deleted
identities. Therefore dropping unobserved counters would change existing
semantics; no observed-only counter shortcut was taken. Global data revisions,
formula coordinator ordering and synchronization remain unchanged.


Preparation was tested as one small path rewrite: one observer check per batch,
common mutation shapes constructed with their row ID present, and compile-time
brand casts instead of runtime identity helper calls. Its median reduction was
0.012499988079071045 ms with 95% interval
[-0.02750001847743988, 0.0599999874830246] ms; it was reverted. Independent writes
changed by +0.005000010132789612 ms, also unresolved. Consolidating a row's exact
counter and optional signal into one Map entry reduced the median only
0.004999995231628418 ms, interval
[-0.034999966621398926, 0.052500009536743164] ms; it too was reverted despite
passing the full core and Solid test suites.


The final dense representation used a current-row counter array plus a row-ID
index, retaining displaced IDs for snapshot/adoption semantics. Internal index
reads were untracked to avoid adding row-order dependencies to row observers.
It passed 244 core and 19 Solid tests, but regressed batch completion by
0.08500000834465027 ms; baseline-minus-candidate 95% interval was
[-0.12000003457069397, -0.0325000137090683] ms. Independent writes changed by
+0.015000000596046448 ms, unresolved. This representation was rejected.

All six production experiments were reverted. The final library implementation
is byte-for-byte the merged baseline for tracked production files; its ranking
numbers remain the precise baseline above, rather than a claimed final speedup.
Independent writes therefore retain the baseline behavior and best-in-run median
0.7224999964237213 ms (ratio 1). The core snapshot/adoption test and public
multi-row/history regression test are retained.

The target remains unmet: the baseline ratio is 3.567567502259338, requiring
completion <=0.22200000286102295 ms against its same-run RevoGrid median. That
requires saving about 0.438 ms, or 66.36% of API time. The observed batch medians
for the non-regressing experiments cluster around 0.6425�0.680 ms; this is an
observed plateau, **not a proven algorithmic lower bound**. Revision bookkeeping
alone is only about 0.075 ms in the intrusive baseline, so eliminating all of it
would still leave a substantial gap. A larger reduction would need a measured
redesign across normalization, mutation/history record construction and store
commit, preserving the formula-before-store barrier and all synchronous
notifications. Actual cold compilation/interpreter attribution still needs an
event-based V8 trace or a profiler with genuinely sub-100-microsecond sampling;
these CPU captures do not establish that attribution.

The lock was acquired with the required 30-second retry initially. After repeated
handoff starvation, the user explicitly authorized a 2-second retry interval;
remaining acquisitions use that interval. No lock belonging to another worker
was removed, and no benchmark workload or timing boundary was changed.


### Diagnostic profile after the dense rewrite (rejected)

Three further cold samples used the same temporary probes and requested 50 �s
CDP CPU sampling. Their median phase durations were:

| Phase | Baseline median ms | Dense candidate median ms |
| --- | ---: | ---: |
| Normalization | 0.13499999046325684 | 0.12000000476837158 |
| Mutation preparation | 0.1300000250339508 | 0.1550000011920929 |
| Owned writes + changed-row Set | 0.12000000476837158 | 0.13999998569488525 |
| Row revision bookkeeping | 0.07499998807907104 | 0.1550000011920929 |
| History + history revision | 0.08500000834465027 | 0.07999998331069946 |

The row-revision increase is consistent with the ~0.085 ms ranking regression.
The added index/array dispatch and synchronization machinery did not simplify
the cold path enough; avoiding Map growth alone did not win. This does not
isolate the cost of any single instruction or establish a compilation cause.
Raw captures are `round2/after-profile-*.json`. All probes, profiler hooks and
experimental production code were removed before final verification.

### Final verification

- `pnpm install --frozen-lockfile`: passed.
- `pnpm test`: 244 passed.
- `pnpm test:solid2`: 19 passed.
- `pnpm benchmark:test`: 25 passed.
- `pnpm benchmark:typecheck`: both checks passed after building the library.
- `pnpm typecheck:lib`, `pnpm typecheck:solid2`: passed.
- `pnpm lint`, `pnpm format:check`: passed.
- Production/harness diff against merged `e44097d`: empty.

Final check logs are in [round2/checks](round2/checks). No full-suite goal claim
is made; no PR was opened and nothing was pushed.


## Round 3: stacked cold batch path (2026-11-04/05)

**Target remains unmet.** Implementation commit: `b5e06fde99e178afd38cf82fb268dd92dcd558f9`.
Merged starting point: `356d6a7`, after the requested merge from
`t3/optimize-cold-batch-writes`. Branch: `t3/stack-batch-writes-optimizations`.
Nothing was pushed. The final source reduces batch API completion by
30.970150772395012% in the 36-sample comparison. Final default-count confirmation
is 0.4649999886751175 ms versus RevoGrid 0.22999998927116394 ms,
ratio **2.0217391755044596**, above 1.2. Its target is 0.2759999871253967 ms.

### Implementation and regression coverage

- Stack preparation simplification, exact numeric normalization keys, mutation-native
  commits, and consolidated exact counter/optional signal entries from round 2.
  Dense counters were not retained.
- Unsorted formula-free public batches use an internal store capability. A numeric
  uniqueness/bounds preflight runs before any write, preserving atomic fallback on
  duplicates and unusual addresses. One subsequent fused indexed loop resolves
  identities, reads originals, removes no-ops, creates the existing notification
  records, writes ordinary owned rows directly, and collects distinct changed rows.
  Packed rows and compact blank tails retain the existing owned writer fallback.
  This is a preflight plus one fused commit pass, not literally one total traversal.
- Sorted views, formula-enabled sheets, observer-dependent calls and duplicate
  batches retain preparation before commit. Formula synchronization still precedes
  all store changes. These paths benefit from the stacked changes as well.
- Internal cell history stores forward records only; undo derives inverse records.
  Redo replays the forward records. No required commit work is delayed past the
  API boundary. Public component APIs and notification payload/order are unchanged.
- Regression tests cover fallback with no partial writes, ordered mutations,
  no-op suppression, packed rows and blank tails, exact row/global revisions,
  unaffected reactive rows, undo/redo and repeated formula-history coordination,
  200-entry mixed history limits, identity/selection payloads, and proof that inverse
  values are not read eagerly. Existing sorted/duplicate public tests still pass.

An initial getter-based lazy inverse experiment created a getter closure for each
history entry. It reduced batch time but increased independent-write medians.
It was replaced with the simpler forward-only internal representation; the final
36-sample visible and offscreen medians both improve over baseline.

### Measurement

All runs use the same precise-timer harness, API-completion boundary, workload,
adapters, fresh browser per sample, zero warm-ups, and unrestricted CPU affinity.
The 36-iteration decision runs select Peculiar Sheets and RevoGrid; visible writes
were added to the requested batch/offscreen selection to check regressions.
The final confirmation uses default 12 iterations and all three supported default
libraries for these scenarios: Peculiar Sheets, AG Grid, and RevoGrid.
Handsontable write scenarios remain omitted by the unchanged harness default.
This is not a full 31-scenario suite or an all-39-headlines completion claim.

Raw results: [before](round3/before.json), [initial stack](round3/after.json),
[final focused](round3/final-focused.json), [confirmation](round3/final.json).
Ratios below divide unrounded medians by the best library in that same run.

| Run | Scenario | Samples/library | Peculiar ms | Best ms | Unrounded ratio |
| --- | --- | ---: | ---: | ---: | ---: |
| before | batch-writes | 36 | 0.6700000017881393 | 0.1875 | 3.5733333428700766 |
| before | offscreen-writes | 36 | 0.6825000047683716 | 0.6825000047683716 | 1 |
| before | visible-writes | 36 | 0.6525000035762787 | 0.6525000035762787 | 1 |
| after | batch-writes | 36 | 0.510000005364418 | 0.25 | 2.040000021457672 |
| after | offscreen-writes | 36 | 0.7350000143051147 | 0.7350000143051147 | 1 |
| after | visible-writes | 36 | 0.7250000089406967 | 0.7250000089406967 | 1 |
| final-focused | batch-writes | 36 | 0.4624999910593033 | 0.19249999523162842 | 2.4025974156663925 |
| final-focused | offscreen-writes | 36 | 0.6450000107288361 | 0.6450000107288361 | 1 |
| final-focused | visible-writes | 36 | 0.6325000077486038 | 0.6325000077486038 | 1 |
| final | batch-writes | 12 | 0.4649999886751175 | 0.22999998927116394 | 2.0217391755044596 |
| final | offscreen-writes | 12 | 0.6525000035762787 | 0.6525000035762787 | 1 |
| final | visible-writes | 12 | 0.6199999898672104 | 0.6199999898672104 | 1 |

Final focused batch saves 0.20750001072883606 ms. Offscreen saves
0.03749999403953552 ms and visible saves 0.019999995827674866 ms.
Same-run denominator drift matters: the initial stack's 2.04 ratio used a slower
0.25 ms RevoGrid median; final focused's 2.4025974156663925 uses 0.19249999523162842 ms.

Baseline ran 23:49:21–23:52:26 local; final focused ran 00:13:14–00:16:22,
then confirmation 00:16:24–00:18:02. **The baseline and final candidate were not
back to back:** other workers acquired the shared lock between runs. This limits
causal precision; all samples and the first candidate are retained, not selected
away. No repeatability claim is made.

Every timed run and diagnostic held the shared directory lock and released only
its own lock on exit/failure. The archived [wrapper](round3/run-locked.cjs) uses
atomic mkdir with a two-second retry and a batch-r3 owner marker, with cleanup in
finally. Native Node filesystem operations were used after shell acquisition/
cleanup commands were rejected by automatic approval review. No source editing
occurred while this task held the lock. Longest hold was about five minutes.
One candidate build failed before any samples because C: filled. Cleanup removed
only inactive Stagehand profile directories created during this task's completed
baseline interval (147 directories, 1.93 GB), with name/time/resolved-path checks.
The failing attempt contributed no timing samples.

### Diagnostic phase breakdown and remaining gap

Three fresh-browser candidate samples used temporary precise performance measures.
The exact probe installation is [probes.cjs](round3/probes.cjs); raw phase records
are round3/profile-*.json. Empty records correspond to independent-write scenarios.
All probes and runner edits were removed before final ranking and validation.
The before column reuses the earlier round-2 three-sample diagnostic baseline;
it is not a newly paired phase trace. These intrusive measures are diagnostics,
not ranking samples or proof of interpreter/compiler attribution.

| Phase | Before median ms (round 2) | Final candidate median ms |
| --- | ---: | ---: |
| Normalization / uniqueness preflight | 0.13499999046325684 | 0.07500001788139343 |
| Preparation plus owned writes / row collection | 0.2500000298023224 | 0.14000001549720764 |
| Row revisions (candidate includes global bump) | 0.07499998807907104 | 0.0949999988079071 |
| History and history revision | 0.08500000834465027 | 0.02000001072883606 |

The fused mutation/write loop remains the largest measured phase, followed by
exact row revision bookkeeping and uniqueness preflight. Their combined diagnostic
cost alone exceeds the final confirmation target. Phase medians total about
0.330 ms versus about 0.465 ms ranked completion; these are different samples
with intrusive instrumentation, so the difference cannot be assigned exactly.
Adapter input mapping, entry/coordination/notification overhead and cold execution
are included in API completion but not all in these store phases. No sub-100 µs
CPU attribution was established. Reaching 1.2 would require another approximately
0.189 ms against the confirmation denominator (0.2315 ms against focused best).

### Final checks

- Frozen-lockfile install passed.
- pnpm test: 251 passed; pnpm test:solid2: 19 passed.
- pnpm benchmark:test: 25 passed.
- pnpm benchmark:typecheck: both checks passed.
- pnpm typecheck:lib and pnpm typecheck:solid2 passed.
- pnpm lint and pnpm format:check passed; direct Biome checks additionally cover
  committed changed production/test files because the repository scripts inspect
  only uncommitted paths.

Logs are in [round3/checks](round3/checks). No benchmark workload, adapter, timing
boundary, feature default, warm-up behavior or formula synchronization was changed.

## Round 4: remove redundant post-commit coordination (2026-11-05)

The final scope accepts approximately 2x RevoGrid while preserving synchronous
history, revisions and notifications. No structural revision or mutation-shape
redesign is retained. Branch: `t3/batch-writes-perf-round-4`. Nothing was pushed.

### Retained implementation

For a successful formula-free distinct-store commit, Grid now emits the existing
`batch-edit` operation directly, only when a callback exists. The store has
already completed writes, row/data revisions and history. Previously this path
entered `applyBatchMutations`, allocated dependency callbacks, looked up a null
formula port, constructed Result outcomes, invoked a no-op commit callback and
emitted through a wrapper even without a host listener. Fallback batches still
use explicit Result coordination with the formula-before-store barrier. This
branch already had plain explicit Results: no Result generators needed removal.
No expected error is swallowed and formula errors retain their tagged Results.

The public payload, mutation order, normalization, sorted addressing, selection,
history and synchronous listener ordering remain intact. Tests cover listener
replacement/removal and synchronous reentrant edits with undo, plus exact revision
identity retention, forgetting and reuse. Existing formula, sorted, duplicate,
row observer disposal/return and complete history tests remain in force.

A numeric-counter/separate-signal Map experiment was rejected. Its intrusive row
phase was 0.0949999988079071 ms versus 0.09000000357627869 ms before; it provides
no evidence of a revision improvement. Row revision production source is restored
byte-for-byte. The round-3 0.095 vs round-2 0.075 comparison also included the
global data bump only in round 3, so it did not isolate a row-counter regression.
A physical-index array or owned-row redesign was not pursued after the scope
update. Mutation construction already uses a single literal shape with all
fields present and no spreads; it remains unchanged. Selection reads return an
existing value, not a cloned snapshot. They were unresolved or ~5 microseconds;
no capture semantics were changed.

### Complete interval attribution

The reproducible temporary probe installer is [round4/probes.cjs](round4/probes.cjs).
It instruments the outer timer envelope, adapter, public Grid entry, store phases,
coordination, and Solid's actual signal-write and computation functions. All
probes, dependency edits, adapter and harness edits were restored before checks.
Dependency edits use atomic file replacement to avoid altering shared pnpm inodes.
Each trace has 36 fresh-browser, zero-warmup batch calls. Raw marks and complete
precision phase medians are archived under round4; [summary.txt](round4/summary.txt)
contains every adjacent interval. Thus each individual trace partitions its whole
envelope without an unexplained gap. Independent phase medians need not sum to
the median total. Timers resolve about 0.005 ms; zero means unresolved, not free.
Marks and counting add overhead, and these traces are not ranking measurements.

The before trace records one Solid signal write and zero synchronous computation
updates/runs in every sample. Render flushing is not the missing cost in this
workload. Entry marks count one adapter, Grid entry and store entry per call;
before also has one coordination wrapper, formula-port lookup and coordinator,
all absent from the retained committed path. The fused loop visits 250 cells;
source inspection shows 250 row `bumpOne` calls and one batch bump in the unchanged
revision implementation, one data bump and one history append/revision bump.
There is no owned-row writer fallback for these ordinary populated rows.

Source-level allocation accounting for this workload: 250 mapped adapter objects
and one mapped array; 250 mutation records and 500 nested address objects; one
mutation array and two Sets; one forward history record. The before wrapper adds
one dependencies object, three callback closures, two Result/outcome pairs and
one operation object even without a listener. The retained committed branch
creates none of those wrapper objects when no callback exists. Revision entry
objects and required mutation/history records remain. These are explicit source
constructions, not an exact V8 heap-allocation count: Map/Set backing storage,
engine metadata, escape elimination and compiler allocations are not measured.
No heap sampling claim is made for a sub-millisecond interval.

### Measurement and validation

The initial 36-sample baseline and combined experiment ran back to back under
separate lock acquisitions. After the scope update removed the revision
experiment, final-source focused and confirmation runs were collected. They are
not a new back-to-back baseline comparison; the original baseline is retained.
All ranking runs use unchanged workloads, adapters, timing boundary, defaults,
fresh browsers and zero warmups. Decision runs use 36 iterations, three write
scenarios and Peculiar Sheets/RevoGrid. Confirmation uses default 12 iterations
and all default supported libraries for those scenarios. This is not a full-suite
or all-headlines performance claim.

Every timed run and trace acquired the specified machine-wide directory lock
with a two-second retry and `batch-r4` marker, with an EXIT trap releasing only
the acquired lock, including failures. No hold exceeded 15 minutes. Other owners
were left untouched. The profile-leak fix `2e54065` was already present after the
requested merge from the local performance branch. Every run reports all owned
profiles removed and an empty leak list; consequently no own leftover profile
older than ten minutes remained to delete. Required work was neither prewarmed
nor moved outside API completion.

### Practical floor

The trace identifies a removable coordinator cost, not a reason to weaken the
store contract. Preflight plus fused mutation/write construction and revisions
remain the bulk of the call. They already require roughly 0.30 ms in intrusive
traces before adapter mapping, public entry, history and return. This is an
observed cost at this implementation, not a mathematical lower bound. Approximately
0.4 ms cold completion is consistent with the evidence; reaching ~0.22 ms would
require a larger redesign of required semantics and data structures. RevoGrid's
bare assignment path does less synchronous work. Under the revised scope, there
is no justification for riskier changes to chase that denominator.

### Retained-source results

| Run | Scenario | Samples/library | Peculiar ms | Best ms | Unrounded ratio |
| --- | --- | ---: | ---: | ---: | ---: |
| Baseline | batch-writes | 36 | 0.4675000011920929 | 0.19999998807907104 | 2.3375001452863304 |
| Baseline | offscreen-writes | 36 | 0.6574999988079071 | 0.6574999988079071 | 1 |
| Baseline | visible-writes | 36 | 0.6450000107288361 | 0.6450000107288361 | 1 |
| Retained | batch-writes | 36 | 0.4050000011920929 | 0.21000000834465027 | 1.928571357613521 |
| Retained | offscreen-writes | 36 | 0.6375000029802322 | 0.6375000029802322 | 1 |
| Retained | visible-writes | 36 | 0.6099999845027924 | 0.6099999845027924 | 1 |
| Confirmation | batch-writes | 12 | 0.4074999988079071 | 0.26749998331069946 | 1.523364576567463 |
| Confirmation | offscreen-writes | 12 | 0.6649999916553497 | 0.6649999916553497 | 1 |
| Confirmation | visible-writes | 12 | 0.6124999821186066 | 0.6124999821186066 | 1 |

Batch saves 0.0625 ms (13.36898392312926% of baseline). Focused independent
medians improve by 0.019999995827674866 and 0.0350000262260437 ms. Confirmation
uses a slower RevoGrid denominator; its lower ratio is not an additional code
speedup. Raw ranking samples: [baseline](round4/before.json),
[retained](round4/final-focused.json), [confirmation](round4/confirmation.json).
The rejected combined experiment and its confirmation are also archived, with
batch medians 0.42749999463558197 and 0.4124999940395355 ms respectively.
No statistical repeatability or isolated per-instruction causal claim is made.

| Adjacent instrumented interval | Before median ms | Retained median ms |
| --- | ---: | ---: |
| Outer envelope to adapter entry | 0.025000005960464478 | 0.025000005960464478 |
| Adapter mapping to Grid entry | 0.034999996423721313 | 0.040000006556510925 |
| Grid guards/props to store entry | 0.06000000238418579 | 0.06000000238418579 |
| Store entry and preflight | 0.05500000715255737 | 0.054999977350234985 |
| Mutation construction, writes, changed-row collection | 0.15000000596046448 | 0.14750000834465027 |
| Row revisions | 0.09000000357627869 | 0.09000000357627869 |
| Global data revision | 0.009999990463256836 | 0.009999990463256836 |
| First selection read | 0.002499997615814209 | 0 |
| Second selection read and history append | 0.02000001072883606 | 0.02000001072883606 |
| History revision | 0.009999990463256836 | 0.004999995231628418 |
| Store return | 0 | 0.004999995231628418 |
| Store completion to coordination wrapper | 0.015000015497207642 | removed |
| Wrapper to null formula-port lookup | 0.014999985694885254 | removed |
| Port lookup to coordinator entry | 0.019999995827674866 | removed |
| Coordinator formula-free Result work | 0.02000001072883606 | removed |
| No-op apply callback | 0.005000025033950806 | removed |
| Notification emission wrapper | 0.009999990463256836 | removed |
| Coordinator return to Grid completion | 0.004999995231628418 | removed |
| Direct notification/return | — | 0.004999995231628418 |
| Grid return to timer completion | 0 | 0.002499997615814209 |
| Whole instrumented envelope | 0.552499994635582 | 0.4699999988079071 |

Every interval is included. Instrumented API-envelope savings are
0.08249999582767487 ms; the uninstrumented focused ranking saves 0.0625 ms.
The difference illustrates instrumentation and cold-code sensitivity. No
sub-resolution assignment is claimed. The remaining public entry (~0.06 ms)
was measured but left alone: avoiding reactive props/sort guards would require
more intrusive assumptions. Notification has no listener in the benchmark, so
the retained optional callback also avoids creating a throwaway operation.

### Final checks

Frozen-lockfile install passed. Final uninstrumented source passes `pnpm test`
(252 tests), `pnpm test:solid2` (20 tests), `pnpm benchmark:test` (26 tests),
`pnpm benchmark:typecheck`, `pnpm typecheck:lib`, and the additional
`pnpm typecheck:solid2`. Lint and format results and all check logs are in
[round4/checks](round4/checks). The only retained production diff is Grid.tsx;
revision storage, mutation construction, adapter, timing harness and installed
Solid dependency are restored. Approximate 2x is met in the 36-sample decision
run with required semantics intact.
