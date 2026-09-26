import { iconSvgUrl } from "@/agent/icons";
import { buildStickerId, parseStickerId } from "../sticker-id";
import type {
	StickerBrowseResult,
	StickerItem,
	StickerProvider,
	StickerSearchResult,
} from "../types";

// Icons and emojis from Iconify, served through /api/icons (see
// agent/icons.ts). Sticker ids: "icons:<prefix>:<name>[~<hex colour>]".

const ICONS_PROVIDER_ID = "icons";

const FEATURED_EMOJIS = [
	"fire", "red-heart", "star", "sparkles", "party-popper", "thumbs-up",
	"clapping-hands", "hundred-points", "face-with-tears-of-joy",
	"smiling-face-with-heart-eyes", "smiling-face-with-sunglasses", "exploding-head",
	"rocket", "light-bulb", "check-mark-button", "cross-mark", "warning",
	"eyes", "backhand-index-pointing-down", "backhand-index-pointing-right",
	"money-bag", "trophy", "camera", "musical-notes",
].map((name) => `fluent-emoji-flat:${name}`);

const FEATURED_ICONS = [
	"mdi:arrow-right-bold", "mdi:arrow-down-bold", "mdi:play-circle",
	"mdi:heart", "mdi:star", "mdi:check-circle", "mdi:close-circle",
	"mdi:bell-ring", "mdi:map-marker", "mdi:instagram", "mdi:youtube",
	"logos:tiktok-icon", "logos:whatsapp-icon", "mdi:thumb-up",
	"mdi:share-variant", "mdi:cursor-default-click",
];

function toStickerItem({ iconId }: { iconId: string }): StickerItem {
	const [prefix, name] = iconId.split(":");
	return {
		id: buildStickerId({ providerId: ICONS_PROVIDER_ID, providerValue: iconId }),
		provider: ICONS_PROVIDER_ID,
		name: name?.replaceAll("-", " ") ?? iconId,
		previewUrl: iconSvgUrl({ value: iconId }),
		metadata: { set: prefix },
	};
}

export const iconsProvider: StickerProvider = {
	id: ICONS_PROVIDER_ID,
	async search({ query, options }): Promise<StickerSearchResult> {
		const limit = options?.limit ?? 48;
		try {
			const response = await fetch(
				`/api/icons/search?q=${encodeURIComponent(query)}&limit=${limit}`,
			);
			if (!response.ok) throw new Error(String(response.status));
			const { icons } = (await response.json()) as { icons: string[] };
			return {
				items: icons.map((iconId) => toStickerItem({ iconId })),
				total: icons.length,
				hasMore: false,
			};
		} catch {
			return { items: [], total: 0, hasMore: false };
		}
	},
	async browse(): Promise<StickerBrowseResult> {
		return {
			sections: [
				{
					id: "emojis",
					title: "Emojis",
					items: FEATURED_EMOJIS.map((iconId) => toStickerItem({ iconId })),
					layout: "grid",
				},
				{
					id: "icons",
					title: "Ícones",
					items: FEATURED_ICONS.map((iconId) => toStickerItem({ iconId })),
					layout: "grid",
				},
			],
		};
	},
	resolveUrl({ stickerId }): string {
		const { providerValue } = parseStickerId({ stickerId });
		return iconSvgUrl({ value: providerValue });
	},
};
