import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildCommandOptions } from "./command";

test(
	"Windows build commands can launch a cmd shim",
	{ skip: process.platform !== "win32" },
	() => {
		const directory = mkdtempSync(path.join(tmpdir(), "benchmark-command-"));
		try {
			const shim = path.join(directory, "build.cmd");
			writeFileSync(shim, "@echo benchmark-shim-ok\r\n");
			const result = spawnSync(`"${shim}"`, [], {
				...buildCommandOptions(),
				encoding: "utf8",
			});
			assert.ifError(result.error);
			assert.equal(result.status, 0);
			assert.equal(result.stdout.trim(), "benchmark-shim-ok");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
);

test("Unix build commands continue to spawn directly", () => {
	for (const platform of ["linux", "darwin"] as const) {
		const result = spawnSync(process.execPath, ["--version"], {
			...buildCommandOptions(platform),
			encoding: "utf8",
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0);
		assert.equal(result.stdout.trim(), process.version);
	}
});
