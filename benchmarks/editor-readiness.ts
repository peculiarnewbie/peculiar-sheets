/** Runs in the page. Follow open shadow roots and require focus inside the grid. */
export function editorReady(requireSelection: boolean): boolean {
	let active = document.activeElement;
	while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
	if (!(active instanceof HTMLElement)) return false;
	let ancestor: Node | null = active;
	let insideGrid = false;
	while (ancestor) {
		if (ancestor instanceof HTMLElement && ancestor.id === "benchmark-root") insideGrid = true;
		ancestor = ancestor.parentNode ?? (ancestor instanceof ShadowRoot ? ancestor.host : null);
	}
	if (!insideGrid) return false;
	if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
		if (active.disabled || active.readOnly || active.selectionStart === null) return false;
		return (
			!requireSelection ||
			(active.selectionStart === 0 && active.selectionEnd === active.value.length)
		);
	}
	if (!active.isContentEditable) return false;
	if (!requireSelection) return true;
	const selection = active.ownerDocument.getSelection();
	if (!selection || selection.rangeCount !== 1) return false;
	const range = selection.getRangeAt(0);
	if (!active.contains(range.commonAncestorContainer)) return false;
	const contents = active.ownerDocument.createRange();
	contents.selectNodeContents(active);
	return range.toString() === contents.toString();
}

/** A saved model value alone does not mean Enter's asynchronous UI work finished. */
export function editorsClosed(): boolean {
	const root = document.querySelector("#benchmark-root");
	if (!root) return false;
	const roots: Array<Element | ShadowRoot> = [root];
	for (const root of roots) {
		for (const element of root.querySelectorAll<HTMLElement>("*")) {
			if (element.shadowRoot) roots.push(element.shadowRoot);
			if (
				!(
					element instanceof HTMLInputElement ||
					element instanceof HTMLTextAreaElement ||
					element.isContentEditable
				)
			)
				continue;
			if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
			const rect = element.getBoundingClientRect();
			if (
				rect.width > 0 &&
				rect.height > 0 &&
				rect.bottom > 0 &&
				rect.right > 0 &&
				rect.top < innerHeight &&
				rect.left < innerWidth
			)
				return false;
		}
	}
	return true;
}
