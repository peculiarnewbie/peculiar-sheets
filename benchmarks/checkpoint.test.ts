import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Result } from "better-result";
import { appendSampleCheckpoint } from "./checkpoint";

test("each completed sample is a durable independent journal record", async (context) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sheet-checkpoint-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const file = path.join(directory, "samples.ndjson");
	for (const sample of [
		{ iteration: 0, value: 1 },
		{ iteration: 1, value: 2 },
	]) {
		const result = await appendSampleCheckpoint(file, sample);
		if (Result.isError(result)) throw result.error;
		assert.ok(result.value.bytes > 0);
	}
	const records = (await readFile(file, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.deepEqual(records, [
		{ iteration: 0, value: 1 },
		{ iteration: 1, value: 2 },
	]);
	const failure = await appendSampleCheckpoint(path.join(file, "invalid-child"), {});
	assert.ok(Result.isError(failure));
});
