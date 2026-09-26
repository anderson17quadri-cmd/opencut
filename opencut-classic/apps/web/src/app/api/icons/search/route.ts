import { type NextRequest, NextResponse } from "next/server";
import { ICON_STYLE_PREFIXES, ICONIFY_API } from "@/agent/icons";
import { isFromEditorWindow } from "@/agent/request-guards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
	if (!isFromEditorWindow(request)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
	if (!query) return NextResponse.json({ icons: [] });
	const limit = Math.min(
		Math.max(Number(request.nextUrl.searchParams.get("limit")) || 32, 1),
		96,
	);
	const style = request.nextUrl.searchParams.get("style") ?? "any";
	const prefixes = ICON_STYLE_PREFIXES[style];

	const url = new URL(`${ICONIFY_API}/search`);
	url.searchParams.set("query", query.slice(0, 100));
	// Iconify's minimum page size is 32.
	url.searchParams.set("limit", String(Math.max(limit, 32)));
	if (prefixes) url.searchParams.set("prefixes", prefixes);

	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) throw new Error(String(response.status));
		const data = (await response.json()) as { icons?: string[] };
		return NextResponse.json({ icons: (data.icons ?? []).slice(0, limit) });
	} catch {
		return NextResponse.json(
			{ error: "Icon search is unavailable (offline?)" },
			{ status: 502 },
		);
	}
}
