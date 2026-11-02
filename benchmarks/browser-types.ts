export interface PageLike {
	goto(url: string): Promise<unknown>;
	evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
	evaluate<T, A>(fn: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
	sendCDP<T = unknown>(method: string, params?: object): Promise<T>;
	waitForTimeout(ms: number): Promise<void>;
	mainFrameId(): string;
	getSessionForFrame(frameId: string): {
		send<T = unknown>(method: string, params?: object): Promise<T>;
		on<T = unknown>(event: string, handler: (params: T) => void): void;
		off<T = unknown>(event: string, handler: (params: T) => void): void;
	};
}
