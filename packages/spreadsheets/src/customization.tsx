import { createContext, useContext } from "solid-js";
import type { SheetCustomization } from "./types";

const SheetCustomizationContext = createContext<SheetCustomization>();

export function useSheetCustomization(): SheetCustomization | undefined {
	return useContext(SheetCustomizationContext);
}

export { SheetCustomizationContext };
