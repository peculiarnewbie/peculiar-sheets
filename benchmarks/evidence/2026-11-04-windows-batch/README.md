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
