// Icons and emojis come from the public Iconify API (200k+ open-source
// icons, CORS-enabled, no key). The local server proxies it so the editor
// loads icons same-origin — cross-origin images would taint the render
// canvas and break export.

export const ICONIFY_API = "https://api.iconify.design";

export const ICON_ID_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;

/** Icon sets to search for each style Claude or the panel can ask for. */
export const ICON_STYLE_PREFIXES: Record<string, string | undefined> = {
	any: undefined,
	emoji: "fluent-emoji-flat,noto,twemoji",
	color: "fluent-emoji-flat,flat-color-icons,logos,noto,twemoji",
	outline: "lucide,tabler,ph,mdi",
	solid: "mdi,ph,tabler,material-symbols",
	logos: "logos,simple-icons,skill-icons",
	flags: "circle-flags,flag",
};

/** Sticker id "icons:<prefix>:<name>[~<hex colour>]" → proxied SVG URL. */
export function iconSvgUrl({ value }: { value: string }): string {
	const [iconId, color] = value.split("~");
	const params = new URLSearchParams({ id: iconId });
	if (color) params.set("color", color);
	return `/api/icons/svg?${params.toString()}`;
}
