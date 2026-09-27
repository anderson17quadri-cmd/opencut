import { fetchPublicJson } from "./downloads";
import catalog from "./noto-emoji.json";

// Google's Noto Animated Emoji (CC BY 4.0): ~600 emojis animated by
// Google's designers as Lottie files (🔥 burning, 😂 laughing, 🤯 blowing
// up…), played with the same Lottie renderer as add_animation. The list
// below (codepoints, names, categories) comes from the project's catalogue;
// skin-tone variants are left out.

const ANIMATION_URL = (codepoint: string) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/lottie.json`;
const MAX_BYTES = 4 * 1024 * 1024;

export const EMOJI_LICENSE = "CC BY 4.0 (Noto Animated Emoji, Google)";
export const EMOJI_SOURCE = "https://googlefonts.github.io/noto-emoji-animation/";

type Entry = { codepoint: string; names: string; category: string };

const ENTRIES: Entry[] = (catalog as { categories: string[]; emoji: Array<[string, string, number]> }).emoji.map(
	([codepoint, names, category]) => ({
		codepoint,
		names,
		category: (catalog as { categories: string[] }).categories[category] ?? "",
	}),
);

function toCharacter(codepoint: string) {
	return String.fromCodePoint(...codepoint.split("_").map((part) => Number.parseInt(part, 16)));
}

function codepointOf(text: string) {
	return [...text].map((char) => (char.codePointAt(0) ?? 0).toString(16)).join("_");
}

/** The catalogue entry for an emoji character ("🔥") or name ("fire"). */
export function findEmoji(input: string): Entry | null {
	const value = input.trim();
	if (!value) return null;
	if (/^\p{Extended_Pictographic}|^\p{Regional_Indicator}|^[#*0-9]️?⃣/u.test(value)) {
		const exact = codepointOf(value);
		const withoutSelectors = exact.replace(/_fe0f/g, "");
		return (
			ENTRIES.find((e) => e.codepoint === exact) ??
			ENTRIES.find((e) => e.codepoint.replace(/_fe0f/g, "") === withoutSelectors) ??
			null
		);
	}
	const name = value.toLowerCase().replace(/^:|:$/g, "").replace(/[\s_]+/g, "-");
	return (
		ENTRIES.find((e) => e.names.split(" ").includes(name)) ??
		ENTRIES.find((e) => e.names.split(" ").some((n) => n.startsWith(name))) ??
		ENTRIES.find((e) => e.names.includes(name)) ??
		null
	);
}

/** Emojis whose names match any of the words (English). */
export function searchEmoji({ query, limit = 20 }: { query: string; limit?: number }) {
	const words = query
		.toLowerCase()
		.split(/[\s,]+/)
		.map((w) => w.replace(/[^a-z0-9-]/g, ""))
		.filter(Boolean);
	const direct = findEmoji(query);
	const scored = ENTRIES.map((entry, index) => {
		let score = 0;
		for (const word of words) {
			for (const name of entry.names.split(" ")) {
				if (name === word) score += 3;
				else if (name.split("-").includes(word)) score += 2;
				else if (name.includes(word)) score += 1;
			}
			if (entry.category.toLowerCase().includes(word)) score += 0.5;
		}
		if (direct && entry.codepoint === direct.codepoint) score += 10;
		// The catalogue is ordered by popularity: earlier wins ties.
		return { entry, score: score - index / 10_000 };
	})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.min(Math.max(Math.round(limit), 1), 50));
	return {
		results: scored.map(({ entry }) => ({
			emoji: toCharacter(entry.codepoint),
			name: entry.names.split(" ")[0],
			otherNames: entry.names.split(" ").slice(1),
			category: entry.category,
		})),
		note: "Animated by Google (Noto Animated Emoji). Pass the emoji (or its name) to add_animated_emoji.",
	};
}

/** Downloads the Lottie animation of an emoji. */
export async function fetchEmojiAnimation(input: string) {
	const entry = findEmoji(input);
	if (!entry) {
		throw new Error(`No animated version of "${input}" was found. Try search_emoji with an English word (e.g. fire, laugh, heart).`);
	}
	const animation = (await fetchPublicJson(ANIMATION_URL(entry.codepoint), MAX_BYTES)) as Record<string, unknown>;
	if (!animation || typeof animation !== "object" || !Array.isArray(animation.layers)) {
		throw new Error("The emoji animation could not be downloaded.");
	}
	return {
		animation,
		emoji: toCharacter(entry.codepoint),
		name: entry.names.split(" ")[0],
		url: ANIMATION_URL(entry.codepoint),
	};
}
