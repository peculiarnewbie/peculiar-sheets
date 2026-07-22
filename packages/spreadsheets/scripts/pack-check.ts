#!/usr/bin/env bun
/**
 * Pack peculiar-sheets and fail if HyperFormula appears in production deps
 * or in packed package.json. Source-level absence alone is not enough.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const packageDir = join(import.meta.dir, "..");
const packDir = mkdtempSync(join(tmpdir(), "peculiar-sheets-pack-"));

function fail(message: string): never {
	console.error(message);
	rmSync(packDir, { recursive: true, force: true });
	process.exit(1);
}

const pack = spawnSync(
	"pnpm",
	["pack", "--pack-destination", packDir],
	{ cwd: packageDir, encoding: "utf8", shell: true },
);

if (pack.status !== 0) {
	fail(`pnpm pack failed:\n${pack.stdout}\n${pack.stderr}`);
}

const tgzMatch = /[\w./\\-]+\.tgz/.exec(`${pack.stdout}\n${pack.stderr}`);
if (!tgzMatch) {
	fail(`Could not locate packed tarball in pack output:\n${pack.stdout}\n${pack.stderr}`);
}

const tarball = tgzMatch[0]!.includes(packDir)
	? tgzMatch[0]!
	: join(packDir, tgzMatch[0]!.split(/[/\\]/).pop()!);

const extractDir = join(packDir, "extract");
const extract = spawnSync(
	"tar",
	["-xzf", tarball, "-C", packDir],
	{ encoding: "utf8", shell: true },
);
if (extract.status !== 0) {
	// Windows often lacks tar flags consistency; fall back to PowerShell.
	const ps = spawnSync(
		"powershell",
		[
			"-NoProfile",
			"-Command",
			`New-Item -ItemType Directory -Force -Path '${extractDir.replaceAll("'", "''")}' | Out-Null; tar -xzf '${tarball.replaceAll("'", "''")}' -C '${packDir.replaceAll("'", "''")}'`,
		],
		{ encoding: "utf8" },
	);
	if (ps.status !== 0) {
		fail(`Failed to extract tarball ${tarball}:\n${extract.stderr}\n${ps.stderr}`);
	}
}

const packedManifestPath = join(packDir, "package", "package.json");
let manifestRaw: string;
try {
	manifestRaw = readFileSync(packedManifestPath, "utf8");
} catch {
	fail(`Packed package.json missing at ${packedManifestPath}`);
}

const manifest = JSON.parse(manifestRaw) as {
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const productionDeps = {
	...(manifest.dependencies ?? {}),
	...(manifest.optionalDependencies ?? {}),
};

if ("hyperformula" in productionDeps) {
	fail(
		"Packed peculiar-sheets still declares hyperformula as a production dependency. Formula-free core gate failed.",
	);
}

if ("hyperformula" in (manifest.peerDependencies ?? {})) {
	fail(
		"Packed peculiar-sheets still declares hyperformula as a peerDependency. Keep HyperFormula only in local devDependencies.",
	);
}

const packedReadme = readFileSync(join(packDir, "package", "README.md"), "utf8");
if (packedReadme.includes("peculiar-sheets-hyperformula")) {
	fail(
		"Packed README points consumers at the private peculiar-sheets-hyperformula package. Document direct HyperFormula installation instead.",
	);
}

console.log("pack-check ok:");
console.log(`  tarball: ${tarball}`);
console.log(`  dependencies: ${JSON.stringify(manifest.dependencies ?? {}, null, 2)}`);
console.log(`  peerDependencies: ${JSON.stringify(manifest.peerDependencies ?? {}, null, 2)}`);

rmSync(packDir, { recursive: true, force: true });
