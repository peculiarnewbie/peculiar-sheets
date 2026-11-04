const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const lock = 'C:/Users/Ryzen/.peculiar-bench-lock';
async function main() {
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; await new Promise(resolve => setTimeout(resolve, 2000)); }
  }
  fs.writeFileSync(lock + '/owner', 'batch-r3 ' + new Date().toISOString());
  try {
    const result = spawnSync('C:/Users/Ryzen/.vite-plus/bin/pnpm.exe', ['benchmark'], {stdio:'inherit', env: {...process.env, BENCHMARK_ITERATIONS:process.argv[3] || '36', BENCHMARK_SCENARIOS:'batch-writes,offscreen-writes,visible-writes', BENCHMARK_IMPLEMENTATIONS:process.argv[4] || 'peculiar-sheets,revogrid', BENCHMARK_OUTPUT_DIR:'.benchmark/' + process.argv[2]}});
    process.exitCode = result.status ?? 1;
    if (result.status === 0 && process.argv[5] === 'confirm') {
      const confirmation = spawnSync('C:/Users/Ryzen/.vite-plus/bin/pnpm.exe', ['benchmark'], {stdio:'inherit', env: {...process.env, BENCHMARK_ITERATIONS:'12', BENCHMARK_SCENARIOS:'batch-writes,offscreen-writes,visible-writes', BENCHMARK_IMPLEMENTATIONS:'peculiar-sheets,ag-grid,revogrid', BENCHMARK_OUTPUT_DIR:'.benchmark/round3-final'}});
      process.exitCode = confirmation.status ?? 1;
    }
  } finally { fs.rmSync(lock + '/owner'); fs.rmdirSync(lock); }
}
main();
