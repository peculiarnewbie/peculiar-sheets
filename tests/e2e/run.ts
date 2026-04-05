/**
 * E2E test orchestrator.
 *
 * Starts the apps/e2e Vite dev server, waits for it to be ready,
 * runs the test suite, then tears everything down.
 *
 * Usage:  bun run tests/e2e/run.ts
 */
import { spawn, type ChildProcess } from "node:child_process";

const PORT = 3141;
const BASE_URL = `http://localhost:${PORT}`;
const POLL_INTERVAL = 200;
const STARTUP_TIMEOUT = 30_000;

async function waitForServer(url: string): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < STARTUP_TIMEOUT) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// Server not ready yet
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
	}
	throw new Error(`Server at ${url} did not become ready within ${STARTUP_TIMEOUT}ms`);
}

function startDevServer(): ChildProcess {
	const proc = spawn("pnpm", ["--filter", "@peculiarnewbie/e2e", "dev"], {
		stdio: "pipe",
		cwd: process.cwd(),
	});

	// Surface Vite errors but keep the rest quiet
	proc.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		if (text.includes("ERROR") || text.includes("error")) {
			process.stderr.write(`[vite] ${text}`);
		}
	});

	return proc;
}

function runTests(): Promise<number> {
	const proc = spawn("bun", ["test", "--max-concurrency=1", "--timeout=30000", "tests/e2e/"], {
		stdio: "inherit",
		cwd: process.cwd(),
		env: { ...process.env, E2E_BASE_URL: BASE_URL },
	});

	return new Promise<number>((resolve) => {
		proc.on("close", (code) => resolve(code ?? 1));
	});
}

// ── Main ────────────────────────────────────────────────────────────────────

let server: ChildProcess | null = null;

try {
	console.log("Starting e2e dev server…");
	server = startDevServer();

	await waitForServer(BASE_URL);
	console.log(`Dev server ready at ${BASE_URL}\n`);

	const exitCode = await runTests();

	server.kill("SIGTERM");
	server = null;

	process.exit(exitCode);
} catch (err) {
	console.error(err);
	server?.kill("SIGTERM");
	process.exit(1);
}
