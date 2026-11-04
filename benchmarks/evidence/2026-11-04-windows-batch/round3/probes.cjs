const fs = require('node:fs');
function edit(file, fn) { const s = fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'); fs.writeFileSync(file,fn(s)); }
edit('packages/spreadsheets/src/core/state.ts', s => s
 .replace('trySetDistinctCells(writes, columns) {','trySetDistinctCells(writes, columns) {\n const r3start = performance.now();')
 .replace('const mutations: CellMutation[] = [];\n\t\t\tconst changedIds', 'performance.measure("r3.preflight", {start:r3start});\n const r3fused = performance.now();\n const mutations: CellMutation[] = [];\n\t\t\tconst changedIds')
 .replace('if (mutations.length) {\n\t\t\t\trowRevisions.bump(changedIds);', 'performance.measure("r3.fused", {start:r3fused});\n if (mutations.length) {\n const r3revs = performance.now();\n\t\t\t\trowRevisions.bump(changedIds);')
 .replace('appendMutationHistory(ownedHistory, mutations, selection(), selection());', 'performance.measure("r3.revisions", {start:r3revs});\n const r3history = performance.now();\n appendMutationHistory(ownedHistory, mutations, selection(), selection());')
 .replace('historyChanged();\n\t\t\t}\n\t\t\treturn mutations;', 'historyChanged();\n performance.measure("r3.history", {start:r3history});\n\t\t\t}\n\t\t\treturn mutations;'));
edit('benchmarks/run.ts', s => s.replace('\n\t\tawait page.sendCDP("HeapProfiler.collectGarbage");', '\n const phases = await page.evaluate(() => performance.getEntriesByType("measure").filter(e => e.name.startsWith("r3.")).map(e => ({name:e.name,duration:e.duration})));\n await mkdir(OUTPUT_DIRECTORY, {recursive:true});\n await writeFile(path.join(OUTPUT_DIRECTORY, `profile-${Date.now()}.json`), JSON.stringify({phases}));\n\t\tawait page.sendCDP("HeapProfiler.collectGarbage");'));
