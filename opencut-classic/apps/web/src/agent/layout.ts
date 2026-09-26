import type { TimelineElement } from "@/timeline";
import { getElementBounds, type ElementBounds } from "@/preview/element-bounds";
import { editor } from "./helpers";

// Where things sit on screen, in terms Claude can reason about: centre as a
// percentage of the canvas, size as a percentage of the canvas width/height,
// and anchors like "top-right". The editor stores a pixel offset from the
// canvas centre plus a scale relative to a "contain" fit, so everything here
// goes through the same bounds code the preview's selection handles use.

export const ANCHORS = [
	"center",
	"top",
	"bottom",
	"left",
	"right",
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
] as const;
export type Anchor = (typeof ANCHORS)[number];

function canvasSize() {
	return editor().project.getActive().settings.canvasSize;
}

export function baseBounds(element: TimelineElement): ElementBounds | null {
	const mediaAsset =
		"mediaId" in element
			? (editor()
					.media.getAssets()
					.find((asset) => asset.id === element.mediaId) ?? null)
			: null;
	// Base geometry: ignore keyframes so layout edits act on the resting pose.
	return getElementBounds({
		element: { ...element, animations: undefined },
		canvasSize: canvasSize(),
		mediaAsset,
		localTime: 0,
	});
}

const round = (value: number) => Math.round(value * 10) / 10;

export function describeLayout(element: TimelineElement) {
	const bounds = baseBounds(element);
	if (!bounds) return undefined;
	const { width, height } = canvasSize();
	return {
		centerXPercent: round((bounds.cx / width) * 100),
		centerYPercent: round((bounds.cy / height) * 100),
		widthPercent: round((bounds.width / width) * 100),
		heightPercent: round((bounds.height / height) * 100),
		rotation: round(bounds.rotation),
	};
}

function numberParam(element: TimelineElement, key: string, fallback: number) {
	const value = element.params[key];
	return typeof value === "number" ? value : fallback;
}

/**
 * Returns the element with its scale changed so it spans `widthPercent` of
 * the canvas width and/or `heightPercent` of its height (aspect ratio is
 * kept unless both are given), or to an absolute `scale`.
 */
export function resizeElement({
	element,
	widthPercent,
	heightPercent,
	scale,
}: {
	element: TimelineElement;
	widthPercent?: number;
	heightPercent?: number;
	scale?: number;
}): TimelineElement {
	const scaleX = numberParam(element, "transform.scaleX", 1);
	const scaleY = numberParam(element, "transform.scaleY", 1);
	let factorX = 1;
	let factorY = 1;

	if (widthPercent !== undefined || heightPercent !== undefined) {
		const bounds = baseBounds(element);
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return element;
		const { width, height } = canvasSize();
		const toWidth =
			widthPercent !== undefined
				? ((widthPercent / 100) * width) / bounds.width
				: undefined;
		const toHeight =
			heightPercent !== undefined
				? ((heightPercent / 100) * height) / bounds.height
				: undefined;
		// Both given: stretch each axis (shapes, bars). One given: keep aspect.
		factorX = toWidth ?? toHeight ?? 1;
		factorY = toHeight ?? toWidth ?? 1;
	} else if (scale !== undefined) {
		// `scale` is absolute: 1 = the element's natural fit.
		factorX = scale / Math.max(scaleX, 1e-6);
		factorY = scale / Math.max(scaleY, 1e-6);
	} else {
		return element;
	}

	return {
		...element,
		params: {
			...element.params,
			"transform.scaleX": scaleX * factorX,
			"transform.scaleY": scaleY * factorY,
		},
	} as TimelineElement;
}

/**
 * Returns the element moved so its box sits at `anchor` (with `margin`
 * percent of the shorter canvas side as padding), or so its centre is at
 * (`x`, `y`) percent of the canvas.
 */
export function positionElement({
	element,
	anchor,
	margin = 5,
	x,
	y,
}: {
	element: TimelineElement;
	anchor?: Anchor;
	margin?: number;
	x?: number;
	y?: number;
}): TimelineElement {
	if (anchor === undefined && x === undefined && y === undefined) return element;
	const bounds = baseBounds(element);
	if (!bounds) return element;
	const { width, height } = canvasSize();
	const pad = (Math.min(width, height) * margin) / 100;

	let targetX = bounds.cx;
	let targetY = bounds.cy;
	if (anchor) {
		targetX = anchor.includes("left")
			? pad + bounds.width / 2
			: anchor.includes("right")
				? width - pad - bounds.width / 2
				: width / 2;
		targetY = anchor.startsWith("top")
			? pad + bounds.height / 2
			: anchor.startsWith("bottom")
				? height - pad - bounds.height / 2
				: height / 2;
	}
	if (x !== undefined) targetX = (x / 100) * width;
	if (y !== undefined) targetY = (y / 100) * height;

	return {
		...element,
		params: {
			...element.params,
			"transform.positionX":
				numberParam(element, "transform.positionX", 0) + (targetX - bounds.cx),
			"transform.positionY":
				numberParam(element, "transform.positionY", 0) + (targetY - bounds.cy),
		},
	} as TimelineElement;
}

/** Canvas-centre offset in pixels for a centre given in canvas percent. */
export function percentToOffset({
	xPercent,
	yPercent,
}: {
	xPercent?: number;
	yPercent?: number;
}) {
	const { width, height } = canvasSize();
	return {
		x: xPercent === undefined ? undefined : (xPercent / 100 - 0.5) * width,
		y: yPercent === undefined ? undefined : (yPercent / 100 - 0.5) * height,
	};
}

export function getCanvasSize() {
	return canvasSize();
}
