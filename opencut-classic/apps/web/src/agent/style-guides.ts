// Director's guides Claude follows for a named editing style
// (get_style_guide). They live in the app so they improve with updates.

export const STYLE_GUIDES: Record<string, { title: string; guide: string }> = {
	automatico: {
		title: "Plano adaptado ao vídeo (diagnóstico + receita por tipo)",
		guide: `ADAPTIVE EDIT — watch first, diagnose, plan, then edit. Every video is different: never apply one recipe blindly.

A. FIRST VIEWING (nothing is changed yet)
1. get_state; view_frames at 8 evenly spaced times (width 480); transcribe words=true; if it is long or has cuts, detect_scenes.
2. DIAGNOSIS — write it down:
   - TYPE (pick one): talking_head_explainer (one person to camera teaching/opinion, tech, business) | comparison (X vs Y, "qual o melhor") | tutorial (screen recording or hands doing steps) | vlog (moving camera, places, daily life, food, travel) | review (a product shown in hand/unboxing) | podcast_interview (two+ people, long talk) | sales_ad (offer, product, call to buy) | story (a personal story with a turning point) | montage (music-driven clips with little or no speech).
   - SHOT: framing (close/medium/wide), tripod or handheld, light (bright/dim/daylight/mixed), background (clean wall, busy room, outdoors), sound (clean/noisy/echo), resolution, orientation.
   - CONTENT: hook sentence (first 3 s), the 2-5 key moments with their times, every brand/product/number/list mentioned, false starts and repeated takes, the call to action, total length and the best final length (Reels: 20-60 s).
   - AUDIENCE & TONE: serious/premium, energetic/fun, educational, emotional.
3. PLAN — a beat sheet with times: for each beat "time → what is said → what the viewer sees (zoom / layout / title / logo / picture / nothing)". Rules: something changes every 2-4 s; one element at a time besides captions; effects illustrate what is being said at that moment (the script narrates the effects); leave "nothing" beats so the strong ones stand out. Pick look, caption preset, title preset, music mood from the recipe below.
4. Tell the user the diagnosis (type + 2 lines) and the beat sheet in at most 10 lines, then edit. If the user gave instructions, they win over the recipe.

B. RECIPES BY TYPE (then the shared craft in C)
- talking_head_explainer: follow get_style_guide "cinematico" (look by light, captions "cinematic", editorial hook, set_layout frame_right/split + editorial title in freeArea on the explanations, 3D logos on brands, punch_zoom push on emphasis).
- comparison: editorial hook "X vs Y" (kicker "QUAL O MELHOR?"); for each contender a set_layout split with the contender's name as label and its 3D logo or a create_motion_graphic card (name + 2-3 points) in freeArea; a final verdict card (editorial title, accent on the winner); captions "cinematic".
- tutorial: keep every step, cut only silences/fillers (padding 0.15); number the steps with add_title "editorial" (kicker "PASSO 1"…), punch_zoom "smooth" onto the area being clicked/shown (screen recordings: zoom 1.3-1.6 on the relevant region), captions "box" or "minimal"; look "limpo" or none on screen recordings; no 3D logos unless a product is named.
- vlog: story order, cut dead moments hard (remove_silences minDuration 0.3), look "filme" 60-75 (never "noturno"), captions "minimal" or "cinematic", transitions only at place/time changes (add_transition_effect soft: CrossZoom/fade), music drives the pace (find_beats and cut on them when there is no speech), location/time titles with "slide_up" small; zooms rare.
- review: hook with the product's name + verdict teaser; 3D logo of the brand once; when the product is shown in hand use punch_zoom "smooth" to the hand; pros/cons as set_layout split + create_motion_graphic checklist; price/specs as editorial titles; look "limpo" (true colours matter for products).
- podcast_interview: pick the 3-6 strongest 20-60 s moments (clear question→answer→punchline) and make each a clip; auto_reframe to 9:16 following the speaker; captions "hormozi" or "box" (big, readable) with accent on the key word; editorial title with the topic at the start of each clip; no layouts or logos; look "cinema" 70.
- sales_ad: problem → solution → proof → offer → CTA in under 40 s; stamp/editorial titles for the pain and the price; captions "hormozi"; punch_zoom "cut" on each claim; sound effects on reveals; CTA title last 3 s with accent; energetic music.
- story: slow it down: fewer cuts in emotional moments, captions "cinematic", look "cinema" or "filme", a single editorial title at the turning point, music that swells at the turn; no emojis, no stamps.
- montage: find_beats and cut on the beat of the music, add_transition_effect on strong beats only, look by mood, short title at start and end, no captions.
- Energetic/fun tone on any type: allow captions "hormozi"/"karaoke", pop titles and 1-3 animated emojis on punchlines (get the viral recipe in the instructions). Premium/serious tone: never.

C. SHARED CRAFT (every type)
- Sound first: clean_voice if noisy; polish_voice on speech; remove_silences; remove_fillers; cut false starts and repeated takes (keep the last take); transcribe again after cutting.
- Format: set_project 9:16, fps 30. Never scale selfies/close-ups up; only small tripod subjects (110-120%).
- Colour: apply_look by the light you saw (bright wall tripod → noturno 80-90; dim → cinema; daylight/people/food → filme or limpo); vignette 15-35; check skin looks natural.
- Captions: read the transcript; fix misheard names and nonsense words (replacements); nothing else near the captions.
- Pictures only of things literally presented; never of passing examples.
- Music: search_free_media music matching the tone, duck_music under speech.
- Finish: master_audio (-14 LUFS); review like a director with view_frames at every element and 4 random times (face never covered, text inside safe margins, one element at a time); export_video (quality very_high). Tell the user the decisions in a few lines.`,
	},

	cinematico: {
		title: "Estilo cinematográfico (tech reel elegante)",
		guide: `CINEMATIC STYLE — elegant tech reel (like pro creators' "AI vs AI" videos). Less is more: every element must earn its place.

NEVER in this style:
- Random stock photos. Only show a picture when the speaker is literally presenting that thing AND the picture adds information. A passing example ("tipo… a Torre Eiffel") gets nothing.
- Emojis, confetti, cartoon stickers, bouncy "pop" titles, stamp titles, big uppercase captions over the chest, more than one graphic on screen at a time.
- Background removal/replacement.

1. UNDERSTAND (before touching anything): get_state; view_frames at 6 times; transcribe words=true. Write a 5-line plan: hook sentence, 2-3 key moments, brand/product names mentioned, the call to action. Tell the user the plan in 3 lines.
2. SOUND: clean_voice if there is background noise; polish_voice on the voice clip. remove_silences (minDuration 0.4, padding 0.1); remove_fillers; cut_range false starts and repeated takes (keep the last take). Transcribe again.
3. FORMAT & FRAMING: set_project aspectRatio "9:16" and fps 30 (phones record ~60 fps; 30 fps exports sharper at the same size and is what Instagram plays). Scaling footage up blurs it: never scale selfies, vlogs or close-ups. Only when a tripod shot leaves the person small with lots of empty wall/desk, scale the clip up (set_clip_properties heightPercent 110-120, never more) so the eyes sit about 35-40% from the top, with nothing cut. Check with view_frames.
4. COLOUR — pick the look from what you see in view_frames:
   - talking head in a room with a bright/white wall, filmed on a tripod: "noturno" (strength 80-90);
   - talking head in a room that is already dim/moody: "cinema" (85-95);
   - vlogs, daylight, kitchen, outdoors, people, food, lifestyle: "filme" (warm, 60-80) or "limpo" (bright, 70-90) — never "noturno" here, it turns daylight grey and dull;
   - vignette 20-35 (15 for "limpo").
   Check with view_frames: skin natural and healthy, not grey; if it looks duller than the original, lower strength or switch look.
5. CAMERA: 3-5 punch_zoom per 30 s, mostly style "smooth" or "push", scale 1.08-1.15, only on real emphasis. No zoom on consecutive sentences.
6. CAPTIONS: generate_captions preset "cinematic" (small, low, sentence case, spoken word in a warm accent). First read the transcript word by word: fix misheard words that make no sense in context (names: Claude heard as "cloud"/"cult"/"clube", GPT as "gepeto"; also any odd word — "carros" for "quilos", etc.) with replacements; if a whole phrase is wrong, cut the caption clip there and use add_captions for that part. Nothing else near the captions.
7. HOOK (first 2 s): add_title preset "editorial" — kicker (the topic in 2-4 words, e.g. "DESAFIO DE EDIÇÃO") + the promise as a condensed headline of 2-3 short lines ("\\n"), accent on the key word (#ff7a45 or the brand colour), position "top", size 4.5-5.5. The first sentence gets a punch_zoom push.
8. SIGNATURE MOMENTS — what makes the reference reels look premium is that THE SCRIPT NARRATES THE EFFECTS: each striking effect appears exactly when the speaker talks about it. Read the transcript and, for each moment the speaker explains, compares or presents something, pick ONE (2-4 per 30-60 s, never two at once, never on consecutive sentences):
   - Explaining / listing / comparing: set_layout (frame_right or split, 3-5 s, label with the subject) and, in the freeArea it returns, the explainer: add_title preset "editorial" (kicker + 1-3 word headline), or create_motion_graphic (a clean card, bars, a checklist, a before/after), same start and duration, starting ~0.3 s after the layout. The presenter keeps talking inside the card.
   - Brands/products mentioned (Claude, ChatGPT, Gemini, Apple…): add_3d_logo (search_icons for the colour logo, e.g. logos:claude-icon, logos:openai-icon) with videoClipId + hand when a hand is open and visible, otherwise anchor beside the head (widthPercent 18-24). Two brands compared: one per hand, or set_layout split with an editorial title "X vs Y".
   - Talking about layers/how it's made: explode_layers once.
   - Behind the presenter: cutout_person + add_title behindPerson only if the script literally says it.
   Rhythm: something must change every 2-4 s (a zoom, a layout, a title, a logo, a cut), but with ONE element on screen at a time besides captions. Palette: dark footage + one warm accent (#ff7a45) or the brand colour; white text; no more than 2 colours.
9. MUSIC & SOUND DESIGN: search_free_media music (ambient/electronic/cinematic, calm), under the whole video, duck_music. Soft whoosh on logo/title entrances only (add_sound_effect whoosh, volumeDb -12). No pops.
10. END: last 2-3 s add_title preset "editorial" (kicker "COMENTA", headline the keyword) or "slide_up" with the call to action (e.g. 'Comenta "EDITOR"'), accent on the key word.
11. FINISH: master_audio. Export with export_video quality "very_high" (the default). Review like a director: view_frames at every element and 4 random times; fix anything covering the face, overlapping captions, or text too close to the edges; then export_video. Tell the user the decisions in a few lines.`,
	},
};

export function styleGuide(style: string) {
	const key = style.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
	const found =
		STYLE_GUIDES[key] ??
		(key.startsWith("cinem")
			? STYLE_GUIDES.cinematico
			: ["", "auto", "plano", "adaptativo", "adaptado", "padrao"].includes(key)
				? STYLE_GUIDES.automatico
				: undefined);
	if (!found) {
		return {
			error: `Unknown style "${style}".`,
			styles: Object.entries(STYLE_GUIDES).map(([name, { title }]) => ({ name, title })),
		};
	}
	return { style: found.title, guide: found.guide };
}
