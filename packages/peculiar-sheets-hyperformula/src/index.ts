import { HyperFormula } from "hyperformula";
import type { ConfigParams } from "hyperformula";
import {
	createWorkbookCoordinator,
	type FormulaEngineConfig,
	type WorkbookCoordinator,
	type WorkbookCoordinatorOptions,
} from "peculiar-sheets";

export type { ConfigParams };
export { HyperFormula };

export type CreateGplHyperFormulaOptions = Partial<ConfigParams> & {
	/**
	 * HyperFormula license key. Defaults to the GPL evaluation key.
	 * Commercial keys remain the caller's responsibility.
	 */
	licenseKey?: string;
};

/**
 * Build an empty HyperFormula engine for use with peculiar-sheets formula APIs.
 *
 * This package is GPL-3.0-only because it depends on HyperFormula. It is not
 * part of the formula-free peculiar-sheets core distribution boundary.
 */
export function createGplHyperFormula(
	options: CreateGplHyperFormulaOptions = {},
): HyperFormula {
	const { licenseKey = "gpl-v3", ...rest } = options;
	return HyperFormula.buildEmpty({
		...rest,
		licenseKey,
	});
}

export function createHyperFormulaWorkbookCoordinator(
	options: Omit<WorkbookCoordinatorOptions, "engine"> & {
		engine?: HyperFormula;
	} = {},
): { engine: HyperFormula; coordinator: WorkbookCoordinator } {
	const engine = options.engine ?? createGplHyperFormula();
	const coordinator = createWorkbookCoordinator({
		...options,
		engine,
	});
	return { engine, coordinator };
}

export function toFormulaEngineConfig(
	engine: HyperFormula,
	options: {
		sheetId?: FormulaEngineConfig["sheetId"];
		sheetName?: string;
		onEngineContentChanged?: FormulaEngineConfig["onEngineContentChanged"];
	} = {},
): FormulaEngineConfig {
	const config: FormulaEngineConfig = {
		instance: engine,
	};
	if (options.sheetId !== undefined) {
		config.sheetId = options.sheetId;
	}
	if (options.sheetName !== undefined) {
		config.sheetName = options.sheetName;
	}
	if (options.onEngineContentChanged !== undefined) {
		config.onEngineContentChanged = options.onEngineContentChanged;
	}
	return config;
}
