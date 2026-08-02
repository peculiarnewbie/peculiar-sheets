export interface ReconciliationDiagnostics {
	counts: Record<string, number>;
	durations: Record<string, number>;
}

interface ReconciliationDiagnosticsGlobal {
	__PECULIAR_SHEETS_RECONCILIATION__?: ReconciliationDiagnostics;
}

function diagnostics(): ReconciliationDiagnostics | undefined {
	return (globalThis as ReconciliationDiagnosticsGlobal).__PECULIAR_SHEETS_RECONCILIATION__;
}

export function incrementReconciliationCount(name: string, amount = 1): void {
	const target = diagnostics();
	if (!target) return;
	target.counts[name] = (target.counts[name] ?? 0) + amount;
}

export function measureReconciliation<T>(name: string, operation: () => T): T {
	const target = diagnostics();
	if (!target) return operation();
	const start = performance.now();
	try {
		return operation();
	} finally {
		target.durations[name] = (target.durations[name] ?? 0) + performance.now() - start;
	}
}
