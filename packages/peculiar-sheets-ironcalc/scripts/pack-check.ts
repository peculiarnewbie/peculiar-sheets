#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const packageDir = join(import.meta.dir, "..");
const packDir = mkdtempSync(join(tmpdir(), "peculiar-sheets-ironcalc-pack-"));
const sourceManifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
	version: string;
};

function fail(message: string): never {
	rmSync(packDir, { recursive: true, force: true });
	throw new Error(message);
}

try {
	const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir], {
		cwd: packageDir,
		encoding: "utf8",
		shell: true,
	});
	if (pack.status !== 0) {
		fail(`npm pack failed:\n${pack.stdout}\n${pack.stderr}`);
	}

	const tarballName = `${pack.stdout}\n${pack.stderr}`.match(/[\w.-]+\.tgz/)?.[0];
	if (!tarballName) fail(`Could not locate packed tarball:\n${pack.stdout}\n${pack.stderr}`);

	const extract = spawnSync("tar", ["-xzf", join(packDir, tarballName), "-C", packDir], {
		encoding: "utf8",
		shell: true,
	});
	if (extract.status !== 0) fail(`Failed to extract ${tarballName}:\n${extract.stderr}`);

	const manifestRaw = readFileSync(join(packDir, "package", "package.json"), "utf8");
	const manifest = JSON.parse(manifestRaw) as {
		version?: string;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	};

	if (manifestRaw.includes("workspace:")) {
		fail("Packed adapter contains a workspace: protocol that registry consumers cannot resolve.");
	}
	if (manifest.version !== sourceManifest.version) {
		fail(`Expected adapter version ${sourceManifest.version}, received ${manifest.version ?? "none"}.`);
	}
	if (manifest.peerDependencies?.["peculiar-sheets"] !== "0.11.x") {
		fail("Packed adapter must declare peculiar-sheets 0.11.x as a peer dependency.");
	}
	if ("peculiar-sheets" in (manifest.dependencies ?? {})) {
		fail("Packed adapter must not bundle peculiar-sheets as a production dependency.");
	}
	if (manifest.dependencies?.["@ironcalc/wasm"] !== "^0.7.0") {
		fail("Packed adapter must retain @ironcalc/wasm as its engine dependency.");
	}

	console.log("ironcalc pack-check ok:");
	console.log(`  version: ${manifest.version}`);
	console.log(`  peer peculiar-sheets: ${manifest.peerDependencies["peculiar-sheets"]}`);
} finally {
	rmSync(packDir, { recursive: true, force: true });
}
