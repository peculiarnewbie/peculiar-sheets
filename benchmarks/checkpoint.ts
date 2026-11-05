import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { Result, TaggedError } from "better-result";

class SampleCheckpointError extends TaggedError("SampleCheckpointError")<{
	file: string;
	cause: unknown;
}> {}

/** Persist only between browser samples; a completed line survives a runner interruption. */
export function appendSampleCheckpoint(file: string, record: unknown) {
	return Result.tryPromise({
		try: async () => {
			await mkdir(path.dirname(file), { recursive: true });
			const line = JSON.stringify(record) + "\n";
			const handle = await open(file, "a");
			try {
				await handle.writeFile(line, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			return { file, bytes: Buffer.byteLength(line) };
		},
		catch: (cause) => new SampleCheckpointError({ file, cause }),
	});
}
