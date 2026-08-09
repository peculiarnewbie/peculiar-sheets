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
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const POLL_INTERVAL = 200;
const STARTUP_TIMEOUT = 30_000;
const PNPM_EXECUTABLE = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cliArgs = process.argv.slice(2);
const productionBundle = cliArgs.includes("--production");
const testPathArg = cliArgs.find((arg) => arg.startsWith("--test="));
const E2E_TEST_PATH = testPathArg?.slice("--test=".length)
	?? process.env.E2E_TEST_PATH
	?? "tests/e2e/";

function runCommand(command: string, args: string[]): Promise<void> {
	const proc = spawn(command, args, {
		stdio: "inherit",
		cwd: process.cwd(),
	});

	return new Promise<void>((resolve, reject) => {
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? 1}`));
		});
	});
}

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

function startServer(): ChildProcess {
	const command = productionBundle
		? ["--filter", "@peculiarnewbie/e2e", "preview", "--host", HOST, "--port", String(PORT)]
		: ["--filter", "@peculiarnewbie/e2e", "dev", "--host", HOST];
	const proc = spawn(PNPM_EXECUTABLE, command, {
		stdio: "inherit",
		cwd: process.cwd(),
	});

	return proc;
}

function runTests(): Promise<number> {
	const proc = spawn("bun", ["test", "--max-concurrency=1", "--timeout=30000", E2E_TEST_PATH], {
		stdio: "inherit",
		cwd: process.cwd(),
		env: {
			...process.env,
			E2E_BASE_URL: BASE_URL,
			E2E_PRODUCTION_BUNDLE: productionBundle ? "true" : "false",
		},
	});

	return new Promise<number>((resolve) => {
		proc.on("close", (code) => resolve(code ?? 1));
	});
}

async function stopServer(proc: ChildProcess): Promise<void> {
	if (proc.exitCode !== null || proc.pid === undefined) return;

	if (process.platform === "win32") {
		await runCommand("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
		return;
	}

	proc.kill("SIGTERM");
	await new Promise<void>((resolve) => proc.once("close", () => resolve()));
}

// ── Main ────────────────────────────────────────────────────────────────────

let server: ChildProcess | null = null;
let exitCode = 1;

try {
	console.log("Building peculiar-sheets for e2e…");
	await runCommand(PNPM_EXECUTABLE, ["build:lib"]);
	if (productionBundle) {
		console.log("Building production e2e consumer…");
		await runCommand(PNPM_EXECUTABLE, ["--filter", "@peculiarnewbie/e2e", "build"]);
	}

	console.log(`Starting e2e ${productionBundle ? "production preview" : "dev server"}…`);
	server = startServer();

	await waitForServer(BASE_URL);
	console.log(`Dev server ready at ${BASE_URL}\n`);

	exitCode = await runTests();
} catch (err) {
	console.error(err);
} finally {
	if (server) await stopServer(server);
}

process.exit(exitCode);
