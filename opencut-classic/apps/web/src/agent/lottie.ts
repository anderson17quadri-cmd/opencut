import { fetchPreview, fetchPublicJson } from "./downloads";

// LottieFiles' public catalogue: free animations made by designers
// (animated icons, arrows, confetti, emojis, lower thirds, transitions…).
// The search API is public and needs no account.

const LOTTIEFILES_GRAPHQL = "https://graphql.lottiefiles.com/2022-08";
const MAX_ANIMATION_BYTES = 8 * 1024 * 1024;

export interface AnimationItem {
	name: string;
	/** Pass this to add_animation. */
	url: string;
	sourcePage?: string;
	creator?: string;
	license: string;
	preview?: { data: string; mimeType: string };
}

type SearchReply = {
	data?: {
		searchPublicAnimations?: {
			edges?: Array<{
				node?: {
					name?: string;
					jsonUrl?: string;
					imageUrl?: string;
					url?: string;
					createdBy?: { firstName?: string; lastName?: string } | null;
				};
			}>;
		};
	};
	errors?: Array<{ message?: string }>;
};

export const LOTTIE_LICENSE = "Lottie Simple License (livre, uso comercial ok, crédito opcional)";

/** Recently seen results, so a download can be credited. */
const seen = new Map<string, AnimationItem>();

export function animationSeen(url: string) {
	return seen.get(url);
}

export async function searchAnimations({
	query,
	limit = 8,
	previews = true,
}: {
	query: string;
	limit?: number;
	previews?: boolean;
}): Promise<{ results: AnimationItem[]; note: string }> {
	if (!query.trim()) throw new Error('"query" is required');
	const first = Math.min(Math.max(Math.round(limit), 1), 20);
	const response = await fetch(LOTTIEFILES_GRAPHQL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			query: `query Search($query: String!, $first: Int) { searchPublicAnimations(query: $query, first: $first) { edges { node { name jsonUrl imageUrl url createdBy { firstName lastName } } } } }`,
			variables: { query, first },
		}),
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok) throw new Error(`Animation search failed (${response.status}).`);
	const reply = (await response.json()) as SearchReply;
	if (reply.errors?.length) throw new Error(`Animation search failed: ${reply.errors[0].message ?? "unknown error"}`);

	const nodes = (reply.data?.searchPublicAnimations?.edges ?? [])
		.map((edge) => edge.node)
		.filter((node): node is NonNullable<typeof node> => Boolean(node?.jsonUrl));
	const results = await Promise.all(
		nodes.map(async (node, index) => {
			const creator = [node.createdBy?.firstName, node.createdBy?.lastName].filter(Boolean).join(" ").trim();
			const item: AnimationItem = {
				name: node.name ?? "animation",
				url: node.jsonUrl as string,
				sourcePage: node.url,
				...(creator ? { creator } : {}),
				license: LOTTIE_LICENSE,
			};
			seen.set(item.url, item);
			if (previews && node.imageUrl && index < 8) {
				const preview = await fetchPreview(node.imageUrl);
				if (preview) item.preview = preview;
			}
			return item;
		}),
	);
	return {
		results,
		note: "Animations made by designers on LottieFiles. Look at the previews (first frame) and pass the url of the one you want to add_animation.",
	};
}

/** Downloads a Lottie JSON animation. */
export async function fetchAnimation(url: string): Promise<Record<string, unknown>> {
	const animation = (await fetchPublicJson(url, MAX_ANIMATION_BYTES)) as Record<string, unknown>;
	if (!animation || typeof animation !== "object" || !Array.isArray(animation.layers) || !animation.w) {
		throw new Error("That link is not a Lottie animation (.json). Use the url from search_animations.");
	}
	return animation;
}
