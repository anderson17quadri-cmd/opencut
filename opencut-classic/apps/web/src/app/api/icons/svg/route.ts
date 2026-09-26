import { type NextRequest, NextResponse } from "next/server";
import { ICON_ID_PATTERN, ICONIFY_API } from "@/agent/icons";

export const dynamic = "force-dynamic";

const cache = new Map<string, string>();
const MAX_CACHED = 500;

// Serves one icon as SVG, same-origin (see agent/icons.ts). Rendered at a
// fixed 512px height so it stays sharp when scaled up on the canvas.
export async function GET(request: NextRequest) {
	const id = (request.nextUrl.searchParams.get("id") ?? "").toLowerCase();
	if (!ICON_ID_PATTERN.test(id)) {
		return NextResponse.json({ error: "Invalid icon id" }, { status: 400 });
	}
	const color = request.nextUrl.searchParams.get("color") ?? "";
	if (color && !/^[0-9a-f]{3,8}$/i.test(color)) {
		return NextResponse.json({ error: "Invalid color" }, { status: 400 });
	}

	const key = `${id}~${color}`;
	let svg = cache.get(key);
	if (!svg) {
		const [prefix, name] = id.split(":");
		const url = new URL(`${ICONIFY_API}/${prefix}/${name}.svg`);
		url.searchParams.set("height", "512");
		if (color) url.searchParams.set("color", `#${color}`);
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			if (!response.ok) {
				return NextResponse.json({ error: "Icon not found" }, { status: 404 });
			}
			svg = await response.text();
		} catch {
			return NextResponse.json({ error: "Icon unavailable (offline?)" }, { status: 502 });
		}
		if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
		cache.set(key, svg);
	}

	return new NextResponse(svg, {
		headers: {
			"content-type": "image/svg+xml",
			"cache-control": "public, max-age=604800, immutable",
		},
	});
}
