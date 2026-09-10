import { createContext, useContext } from "solid-js";
import type { SheetCustomization } from "./types";

const SheetCustomizationContext = createContext<SheetCustomization | null>(null);

export function useSheetCustomization(): SheetCustomization | undefined {
	return useContext(SheetCustomizationContext) ?? undefined;
}

export { SheetCustomizationContext };
