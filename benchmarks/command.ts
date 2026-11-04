// Windows package-manager installations may expose either .cmd shims or .exe
// launchers. Let cmd.exe resolve them; direct spawn of a .cmd fails with EINVAL.
// Callers supply only fixed, repository-owned build commands and arguments.
export function buildCommandOptions(platform: NodeJS.Platform = process.platform) {
	return { shell: platform === "win32" };
}
