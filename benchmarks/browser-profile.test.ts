import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withBrowserProfile } from "./browser-profile";

test("owned profiles are removed after success, failed initialization, failed sample and failed close", async (context) => {
	const unrelated = await mkdtemp(path.join(os.tmpdir(), "unrelated-browser-profile-"));
	context.after(() => rm(unrelated, { recursive: true, force: true }));
	context.mock.method(console, "debug", () => {});
	for (const failure of ["none", "constructor", "init", "sample", "close"] as const) {
		let profile = "";
		let closed = false;
		const result = await withBrowserProfile({
			create(userDataDir) {
				profile = userDataDir;
				if (failure === "constructor") throw new Error("constructor failed");
				return {
					async close() {
						await access(profile);
						closed = true;
						if (failure === "close") throw new Error("close failed");
					},
				};
			},
			async run() {
				if (failure === "init") throw new Error("init failed");
				await writeFile(path.join(profile, "Chrome profile"), "owned sample data");
				if (failure === "sample") throw new Error("sample failed");
				return 42;
			},
		});
		assert.equal(closed, failure !== "constructor");
		assert.equal(result.isErr(), ["constructor", "init", "sample"].includes(failure));
		await assert.rejects(access(profile));
		await access(unrelated);
	}
});
