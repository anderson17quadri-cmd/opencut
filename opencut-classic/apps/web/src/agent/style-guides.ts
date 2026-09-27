// Director's guides Claude follows for a named editing style
// (get_style_guide). They live in the app so they improve with updates.

export const STYLE_GUIDES: Record<string, { title: string; guide: string }> = {
	cinematico: {
		title: "Estilo cinematográfico (tech reel elegante)",
		guide: `CINEMATIC STYLE — elegant tech reel (like pro creators' "AI vs AI" videos). Less is more: every element must earn its place.

NEVER in this style:
- Random stock photos. Only show a picture when the speaker is literally presenting that thing AND the picture adds information. A passing example ("tipo… a Torre Eiffel") gets nothing.
- Emojis, confetti, cartoon stickers, bouncy "pop" titles, stamp titles, big uppercase captions over the chest, more than one graphic on screen at a time.
- Background removal/replacement.

1. UNDERSTAND (before touching anything): get_state; view_frames at 6 times; transcribe words=true. Write a 5-line plan: hook sentence, 2-3 key moments, brand/product names mentioned, the call to action. Tell the user the plan in 3 lines.
2. SOUND: clean_voice if there is background noise; polish_voice on the voice clip. remove_silences (minDuration 0.4, padding 0.1); remove_fillers; cut_range false starts and repeated takes (keep the last take). Transcribe again.
3. FRAMING: set_project 9:16. If the person looks small or there is a lot of empty wall/desk, scale the talking-head clip up (set_clip_properties heightPercent 115-135) and position it so the eyes sit about 35-40% from the top and nothing important is cut. Check with view_frames.
4. COLOUR: apply_look look "noturno" (bright/white rooms) or "cinema" (already moody rooms), strength 85-100, vignette 30-40. Check with view_frames: skin natural, wall no longer glaring.
5. CAMERA: 3-5 punch_zoom per 30 s, mostly style "smooth" or "push", scale 1.08-1.15, only on real emphasis. No zoom on consecutive sentences.
6. CAPTIONS: generate_captions preset "cinematic" (small, low, sentence case, spoken word in a warm accent). First read the transcript for misheard names (Claude is often heard as "cloud"/"cult"/"clube", GPT as "gepeto") and pass them in replacements. Nothing else near the captions.
7. HOOK (first 2 s): add_title preset "slide_up" (or "highlight" with the key word in accentWords), size 4.5-5.5, position "top", Montserrat, white + accent #ff7a45, sound "none" or a soft whoosh.
8. SIGNATURE MOMENTS (1-2 per video, where the script supports it):
   - Brands/products mentioned (Claude, ChatGPT, Gemini, Apple…): add_3d_logo (search_icons for the colour logo, e.g. logos:claude-icon, logos:openai-icon) with videoClipId + hand when a hand is open and visible, otherwise anchor beside the head (widthPercent 18-24). Several brands compared: one per hand.
   - Talking about layers/how it's made: explode_layers once.
   - Behind the presenter: cutout_person + add_title behindPerson only if the script literally says it.
9. MUSIC & SOUND DESIGN: search_free_media music (ambient/electronic/cinematic, calm), under the whole video, duck_music. Soft whoosh on logo/title entrances only (add_sound_effect whoosh, volumeDb -12). No pops.
10. END: last 2-3 s add_title preset "slide_up" with the call to action (e.g. 'Comenta "EDITOR"'), accent on the key word.
11. FINISH: master_audio. Review like a director: view_frames at every element and 4 random times; fix anything covering the face, overlapping captions, or text too close to the edges; then export_video. Tell the user the decisions in a few lines.`,
	},
};

export function styleGuide(style: string) {
	const key = style.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
	const found = STYLE_GUIDES[key] ?? (key.startsWith("cinem") ? STYLE_GUIDES.cinematico : undefined);
	if (!found) {
		return {
			error: `Unknown style "${style}".`,
			styles: Object.entries(STYLE_GUIDES).map(([name, { title }]) => ({ name, title })),
		};
	}
	return { style: found.title, guide: found.guide };
}
