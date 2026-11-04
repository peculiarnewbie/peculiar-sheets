// Temporary diagnostic installation; restore before ranking or checks.
const fs = require("node:fs");
const path = require("node:path");
const backup = ".benchmark/r4-probe-backup.json";
function write(file, source) {
	fs.writeFileSync(file + ".r4tmp", source);
	fs.renameSync(file + ".r4tmp", file);
}
if (process.argv[2] === "restore") {
	for (const [file, source] of Object.entries(JSON.parse(fs.readFileSync(backup))))
		write(file, source);
	process.exit(0);
}
const originals = {};
function edit(file, fn) {
	const raw = fs.readFileSync(file, "utf8");
	originals[file] = raw;
	write(file, fn(raw.replaceAll("\r\n", "\n")));
}
function mark(name) {
	return `performance.mark("r4.${name}");`;
}
edit("apps/benchmarks/src/write-probe.ts", (s) =>
	s
		.replace(
			"const start = timing.now();",
			"performance.clearMarks(); " + mark("timer-entry") + "\n const start = timing.now();",
		)
		.replace(
			"const completionDurationMs = timing.now() - start;",
			"const completionDurationMs = timing.now() - start; " + mark("timer-complete"),
		),
);
edit("apps/benchmarks/src/adapters/peculiar-sheets.tsx", (s) =>
	s
		.replace(
			"writeCells: (writes) =>\n",
			"writeCells: (writes) => { " + mark("adapter-entry") + "\n return ",
		)
		.replace("\n\t\t\treplaceDataset(nextDataset)", "\n },\n\t\t\treplaceDataset(nextDataset)")
		.replace("\n\t\t\t\t),\n\t\t\t},", "\n\t\t\t\t);\n\t\t\t},")
		.replace("\n\t\t\t\t),\n },", "\n\t\t\t\t);\n },"),
);
edit("packages/spreadsheets/src/grid/Grid.tsx", (s) =>
	s
		.replace("setCellValues: (writes) => {", "setCellValues: (writes) => { " + mark("grid-entry"))
		.replace(
			"if (committed !== undefined) {",
			mark("store-complete") + "\n if (committed !== undefined) {",
		)
		.replace(
			"if (committed !== undefined) applyBatchMutations(committed, true);",
			mark("store-complete") +
				"\n if (committed !== undefined) applyBatchMutations(committed, true);",
		)
		.replace(
			"else applyBatchMutations(buildExternalBatchMutations(writes));",
			"else applyBatchMutations(buildExternalBatchMutations(writes)); " + mark("grid-complete"),
		)
		.replace(
			"function applyBatchMutations(mutations: CellMutation[], committed = false) {",
			"function applyBatchMutations(mutations: CellMutation[], committed = false) { " +
				mark("coord-wrapper"),
		)
		.replace(
			"function getFormulaSyncPort(): FormulaSyncPort | null {",
			"function getFormulaSyncPort(): FormulaSyncPort | null { " + mark("formula-port"),
		),
);
edit("packages/spreadsheets/src/grid/mutationCoordination.ts", (s) =>
	s
		.replace(
			"if (mutations.length === 0) {",
			mark("coordinate-entry") + "\n if (mutations.length === 0) {",
		)
		.replace(
			"deps.applyMutations(mutations);",
			mark("sync-complete") + "\n deps.applyMutations(mutations);",
		)
		.replace(
			'deps.emitOperation({ type: "batch-edit", mutations });',
			mark("notification-entry") +
				'\n deps.emitOperation({ type: "batch-edit", mutations }); ' +
				mark("notification-complete"),
		),
);
edit("packages/spreadsheets/src/core/state.ts", (s) =>
	s
		.replace(
			"trySetDistinctCells(writes, columns) {",
			"trySetDistinctCells(writes, columns) { " + mark("state-entry"),
		)
		.replace(
			"const mutations: CellMutation[] = [];\n\t\t\tconst changedIds",
			mark("preflight-complete") +
				"\n const mutations: CellMutation[] = [];\n\t\t\tconst changedIds",
		)
		.replace(
			"if (mutations.length) {\n\t\t\t\trowRevisions.bump(changedIds);",
			mark("fused-complete") +
				"\n if (mutations.length) {\n rowRevisions.bump(changedIds); " +
				mark("rows-complete"),
		)
		.replace(
			"appendMutationHistory(ownedHistory, mutations, selection(), selection());",
			mark("data-complete") +
				"\n const r4selection = selection(); " +
				mark("selection-complete") +
				"\n appendMutationHistory(ownedHistory, mutations, r4selection, selection()); " +
				mark("history-append"),
		)
		.replace(
			"historyChanged();\n\t\t\t}\n\t\t\treturn mutations;",
			"historyChanged(); " + mark("history-complete") + "\n\t\t\t}\n\t\t\treturn mutations;",
		),
);
edit("benchmarks/run.ts", (s) =>
	s.replace(
		'\n\t\t\tawait page.sendCDP("HeapProfiler.collectGarbage");',
		'\n const r4marks = await page.evaluate(() => performance.getEntriesByType("mark").filter(e => e.name.startsWith("r4.")).map(e => ({name:e.name,time:e.startTime})));\n await mkdir(OUTPUT_DIRECTORY,{recursive:true});\n await writeFile(path.join(OUTPUT_DIRECTORY, `phases-${Date.now()}.json`),JSON.stringify(r4marks));\n\t\t\tawait page.sendCDP("HeapProfiler.collectGarbage");',
	),
);
// Count actual Solid writes/computation updates, filtered to the timed interval.
edit(
	"node_modules/.pnpm/@solidjs+signals@2.0.0-rc.20/node_modules/@solidjs/signals/dist/prod/core/core.js",
	(s) =>
		s
			.replace(
				"function setSignal(e, t) {",
				'function setSignal(e, t) { performance.mark("r4.signal-write");',
			)
			.replace(
				"function updateIfNecessary(e) {",
				'function updateIfNecessary(e) { performance.mark("r4.computation-update");',
			)
			.replace(
				"function recompute(e, t = false) {",
				'function recompute(e, t = false) { performance.mark("r4.computation-run");',
			),
);
fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.writeFileSync(backup, JSON.stringify(originals));
