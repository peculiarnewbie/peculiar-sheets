import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tracked = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], {
	cwd: root,
	encoding: "utf8",
});
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
	cwd: root,
	encoding: "utf8",
});
const paths = [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/))].filter((path) =>
	/\.(?:tsx?|mts|json)$/.test(path),
);
if (paths.length > 0) {
	const result = spawnSync(
		process.execPath,
		[resolve(root, "node_modules/@biomejs/biome/bin/biome"), ...process.argv.slice(2), ...paths],
		{ cwd: root, stdio: "inherit" },
	);
	process.exit(result.status ?? 1);
}
