import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { settle } from "@/agent/broker";
import { isFromEditorWindow } from "@/agent/request-guards";

export const dynamic = "force-dynamic";

const replySchema = z.object({
	id: z.string(),
	ok: z.boolean(),
	result: z.unknown().optional(),
	error: z.string().optional(),
});

export async function POST(request: NextRequest) {
	if (!isFromEditorWindow(request)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const parsed = replySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid reply" }, { status: 400 });
	}

	const delivered = settle(parsed.data);
	return NextResponse.json({ delivered }, { status: delivered ? 200 : 404 });
}
