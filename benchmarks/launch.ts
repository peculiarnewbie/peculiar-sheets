import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Result, TaggedError } from "better-result";
import { homogeneousCpuSet, parseCpuList } from "./cpu-affinity";

class BenchmarkLaunchError extends TaggedError("BenchmarkLaunchError")<{
	message: string;
	cause: unknown;
}> {}
const setup = Result.try({
	try: () => {
		const requested = process.env.BENCHMARK_CPUSET ?? "auto";
		if (process.platform !== "linux") {
			if (!["auto", "all"].includes(requested))
				throw new Error("Explicit CPU affinity requires Linux/taskset");
			return { affinity: "unrestricted", pin: false };
		}
		const status = readFileSync("/proc/self/status", "utf8");
		const match = /^Cpus_allowed_list:\s*(.+)$/m.exec(status);
		if (!match?.[1]) throw new Error("Cannot determine allowed CPUs");
		const allowed = parseCpuList(match[1]);
		let selected = allowed;
		if (requested === "auto") {
			const capacities = new Map<number, number>();
			for (const cpu of allowed) {
				const capacity = Result.try(() =>
					Number(readFileSync(`/sys/devices/system/cpu/cpu${cpu}/cpu_capacity`, "utf8")),
				);
				if (Result.isOk(capacity)) capacities.set(cpu, capacity.value);
			}
			selected = homogeneousCpuSet(allowed, capacities);
		} else if (requested !== "all") {
			selected = parseCpuList(requested);
			if (selected.some((cpu) => !allowed.includes(cpu)))
				throw new Error("Requested CPUs are outside the process affinity");
		}
		return { affinity: selected.join(","), pin: selected.join(",") !== allowed.join(",") };
	},
	catch: (cause) =>
		new BenchmarkLaunchError({ message: "Could not prepare benchmark CPU affinity", cause }),
});
if (Result.isError(setup)) {
	console.error(setup.error);
	process.exitCode = 1;
} else {
	const { affinity, pin } = setup.value;
	console.log(`Benchmark CPU affinity: ${affinity}`);
	const args = [
		process.execPath,
		...process.execArgv,
		fileURLToPath(new URL("./run.ts", import.meta.url)),
		...process.argv.slice(2),
	];
	const launch = await Result.tryPromise({
		try: () =>
			new Promise<number>((resolve, reject) => {
				const command = pin ? "taskset" : args.shift();
				if (!command) throw new Error("Missing benchmark executable");
				const child = spawn(command, pin ? ["-c", affinity, ...args] : args, {
					stdio: "inherit",
					env: { ...process.env, BENCHMARK_EFFECTIVE_CPUSET: affinity },
				});
				const interrupt = () => child.kill("SIGINT");
				const terminate = () => child.kill("SIGTERM");
				process.on("SIGINT", interrupt);
				process.on("SIGTERM", terminate);
				child.once("error", reject);
				child.once("exit", (code, signal) => {
					process.off("SIGINT", interrupt);
					process.off("SIGTERM", terminate);
					resolve(code ?? (signal === "SIGINT" ? 130 : 1));
				});
			}),
		catch: (cause) =>
			new BenchmarkLaunchError({ message: "Could not launch the benchmark", cause }),
	});
	if (Result.isError(launch)) {
		console.error(launch.error);
		process.exitCode = 1;
	} else process.exitCode = launch.value;
}
