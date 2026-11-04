# Archived ARM-host benchmark evidence

These are historical results, not a baseline to reuse on a different machine.
The optimization goal remains unfinished. See the
[handoff](../../OPTIMIZATION_HANDOFF.md) for the next steps.

[summary.json](summary.json) contains all 39 latest observations, the remaining
three goal gaps, repeatability flags, check results and the run inventory.
[raw-results.tar.gz](raw-results.tar.gz) preserves 6,372 samples from six complete
runs/controls, plus the 9 samples of an intentionally interrupted second control.
It also includes source manifests, durable journals, audits, control plans,
fresh check logs, upstream review links and a diagnostic profiler.

The complete 1,056-sample first control is a subset, not a full suite. Its repeat
was stopped at the user's request, so that pair has no repeatability verdict.
`STOPPED.json` records the stop and the instruction to continue optimization on
stronger hardware instead of continuing measurement studies.

Verify the compressed archive from this directory:

```sh
sha256sum -c raw-results.tar.gz.sha256
```

Extract to an empty directory of your choice. `archive-manifest.json` inside
lists the byte count and SHA-256 of every payload file. Run metadata distinguishes
complete full suites, complete subset controls and the interrupted control.
No timing samples were discarded because of their values.

The latest full suite used `api-completion-v2`, CPU affinity `6,7`, 12 repetitions
per pair and 96 for `replace-large-disjoint`. Those CPU IDs describe the old
host. CPU placement, timing and sampling corrections are not library speedups.
