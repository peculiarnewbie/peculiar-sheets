import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const consumer = mkdtempSync(join(tmpdir(), "peculiar-sheets-solid2-"));
const releases = join(root, "dist", "releases");
mkdirSync(releases, { recursive: true });
function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
run("pnpm", ["build:lib"], root);
cpSync(join(root, "tests/solid2-consumer"), consumer, { recursive: true });
run("pnpm", ["pack", "--pack-destination", releases], join(root, "packages/spreadsheets"));
const manifest = JSON.parse(
	readFileSync(join(root, "packages/spreadsheets/package.json"), "utf8"),
) as { version: string };
copyFileSync(
	join(releases, `peculiar-sheets-${manifest.version}.tgz`),
	join(consumer, "package.tgz"),
);
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
run("npm", ["ls", "solid-js", "@solidjs/web", "@solidjs/signals"], consumer);
const lock = JSON.parse(readFileSync(join(consumer, "package-lock.json"), "utf8")) as {
	packages: Record<string, { version?: string }>;
};
for (const name of ["solid-js", "@solidjs/web", "@solidjs/signals"]) {
	const instances = Object.entries(lock.packages).filter(([path]) =>
		path.endsWith(`node_modules/${name}`),
	);
	if (instances.length !== 1 || instances[0]?.[1].version !== "2.0.0-rc.7")
		throw new Error(`Expected exactly one ${name}@2.0.0-rc.7`);
}
run("npm", ["run", "build"], consumer);
console.log(`Verified isolated install and build. Consumer: ${consumer}`);
console.log(
	`Run npm run preview in that directory, then await window.__PACKED_CHECKS__.run() in the browser.`,
);
