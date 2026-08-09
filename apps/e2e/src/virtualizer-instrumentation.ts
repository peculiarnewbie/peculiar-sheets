import * as TanStackVirtual from "../../../packages/spreadsheets/node_modules/@tanstack/solid-virtual/dist/esm/index.js";

export * from "../../../packages/spreadsheets/node_modules/@tanstack/solid-virtual/dist/esm/index.js";

function trackVirtualizer<T extends VirtualizerDiagnostic>(virtualizer: T): T {
	window.__VIRTUALIZERS__ ??= [];
	window.__VIRTUALIZERS__.push(virtualizer);
	return virtualizer;
}

interface VirtualizerConstructor {
	new (options: unknown): VirtualizerDiagnostic;
}

const TanStackVirtualizer = (TanStackVirtual as unknown as {
	Virtualizer: VirtualizerConstructor;
}).Virtualizer;

export class Virtualizer extends TanStackVirtualizer {
	constructor(options: unknown) {
		super(options);
		trackVirtualizer(this);
	}
}
