// Short sound effects synthesized on the spot (no download, no licence):
// the "pop" and "whoosh" that editors put under pictures and titles
// appearing on screen.

export type SoundEffect = "pop" | "whoosh" | "swoosh_down" | "click" | "impact" | "riser" | "ding";

export const SOUND_EFFECTS: SoundEffect[] = ["pop", "whoosh", "swoosh_down", "click", "impact", "riser", "ding"];

const SAMPLE_RATE = 48_000;

/** Seconds of the effect before the visual moment it accompanies. */
export const SOUND_LEAD: Record<SoundEffect, number> = {
	pop: 0.02,
	whoosh: 0.25,
	swoosh_down: 0.15,
	click: 0,
	impact: 0.01,
	// A riser builds up and ends right on the moment.
	riser: 1.5,
	ding: 0,
};

const LENGTH: Record<SoundEffect, number> = {
	pop: 0.25,
	whoosh: 0.7,
	swoosh_down: 0.7,
	click: 0.08,
	impact: 1.2,
	riser: 1.55,
	ding: 1.4,
};

function noiseBuffer(ctx: OfflineAudioContext, seconds: number) {
	const buffer = ctx.createBuffer(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
	const data = buffer.getChannelData(0);
	// Deterministic noise, so the same effect always sounds the same.
	let seed = 12345;
	for (let i = 0; i < data.length; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		data[i] = (seed / 0x7fffffff) * 2 - 1;
	}
	return buffer;
}

async function render(effect: SoundEffect): Promise<AudioBuffer> {
	const seconds = LENGTH[effect];
	const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
	const out = ctx.createGain();
	out.connect(ctx.destination);

	if (effect === "pop") {
		// A quick pitch drop with a soft click on top.
		const osc = ctx.createOscillator();
		osc.type = "sine";
		osc.frequency.setValueAtTime(950, 0);
		osc.frequency.exponentialRampToValueAtTime(260, 0.09);
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, 0);
		env.gain.exponentialRampToValueAtTime(0.9, 0.006);
		env.gain.exponentialRampToValueAtTime(0.0001, 0.2);
		osc.connect(env).connect(out);
		osc.start(0);
		osc.stop(seconds);
		const click = ctx.createBufferSource();
		click.buffer = noiseBuffer(ctx, 0.02);
		const clickEnv = ctx.createGain();
		clickEnv.gain.setValueAtTime(0.25, 0);
		clickEnv.gain.exponentialRampToValueAtTime(0.0001, 0.015);
		const hp = ctx.createBiquadFilter();
		hp.type = "highpass";
		hp.frequency.value = 2500;
		click.connect(hp).connect(clickEnv).connect(out);
		click.start(0);
	} else if (effect === "click") {
		// UI click: a very short filtered tick.
		const click = ctx.createBufferSource();
		click.buffer = noiseBuffer(ctx, 0.03);
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 3200;
		bp.Q.value = 2;
		const env = ctx.createGain();
		env.gain.setValueAtTime(1, 0);
		env.gain.exponentialRampToValueAtTime(0.0001, 0.025);
		click.connect(bp).connect(env).connect(out);
		click.start(0);
		const tone = ctx.createOscillator();
		tone.frequency.value = 1800;
		const toneEnv = ctx.createGain();
		toneEnv.gain.setValueAtTime(0.25, 0);
		toneEnv.gain.exponentialRampToValueAtTime(0.0001, 0.04);
		tone.connect(toneEnv).connect(out);
		tone.start(0);
		tone.stop(seconds);
	} else if (effect === "impact") {
		// Cinematic hit: sub drop plus a noise burst.
		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(120, 0);
		sub.frequency.exponentialRampToValueAtTime(38, 0.6);
		const subEnv = ctx.createGain();
		subEnv.gain.setValueAtTime(0.0001, 0);
		subEnv.gain.exponentialRampToValueAtTime(1, 0.01);
		subEnv.gain.exponentialRampToValueAtTime(0.0001, seconds);
		sub.connect(subEnv).connect(out);
		sub.start(0);
		sub.stop(seconds);
		const burst = ctx.createBufferSource();
		burst.buffer = noiseBuffer(ctx, 0.5);
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.setValueAtTime(4000, 0);
		lp.frequency.exponentialRampToValueAtTime(300, 0.4);
		const burstEnv = ctx.createGain();
		burstEnv.gain.setValueAtTime(0.6, 0);
		burstEnv.gain.exponentialRampToValueAtTime(0.0001, 0.45);
		burst.connect(lp).connect(burstEnv).connect(out);
		burst.start(0);
	} else if (effect === "riser") {
		// Tension build: rising noise and tone, cut at the end.
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuffer(ctx, seconds);
		const hp = ctx.createBiquadFilter();
		hp.type = "bandpass";
		hp.Q.value = 3;
		hp.frequency.setValueAtTime(300, 0);
		hp.frequency.exponentialRampToValueAtTime(6000, seconds - 0.05);
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, 0);
		env.gain.exponentialRampToValueAtTime(0.7, seconds - 0.06);
		env.gain.linearRampToValueAtTime(0, seconds - 0.01);
		noise.connect(hp).connect(env).connect(out);
		noise.start(0);
		const tone = ctx.createOscillator();
		tone.type = "sawtooth";
		tone.frequency.setValueAtTime(110, 0);
		tone.frequency.exponentialRampToValueAtTime(880, seconds - 0.05);
		const toneLp = ctx.createBiquadFilter();
		toneLp.type = "lowpass";
		toneLp.frequency.value = 2000;
		const toneEnv = ctx.createGain();
		toneEnv.gain.setValueAtTime(0.0001, 0);
		toneEnv.gain.exponentialRampToValueAtTime(0.18, seconds - 0.06);
		toneEnv.gain.linearRampToValueAtTime(0, seconds - 0.01);
		tone.connect(toneLp).connect(toneEnv).connect(out);
		tone.start(0);
		tone.stop(seconds);
	} else if (effect === "ding") {
		// Bright notification bell (two partials).
		for (const [freq, level] of [[1318.5, 0.5], [2637, 0.18], [3955, 0.08]] as const) {
			const osc = ctx.createOscillator();
			osc.frequency.value = freq;
			const env = ctx.createGain();
			env.gain.setValueAtTime(0.0001, 0);
			env.gain.exponentialRampToValueAtTime(level, 0.005);
			env.gain.exponentialRampToValueAtTime(0.0001, seconds);
			osc.connect(env).connect(out);
			osc.start(0);
			osc.stop(seconds);
		}
	} else {
		// Filtered noise sweeping up (whoosh) or down (swoosh_down).
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuffer(ctx, seconds);
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.Q.value = 1.2;
		const [from, peak, to] = effect === "whoosh" ? [350, 2800, 900] : [2600, 900, 250];
		band.frequency.setValueAtTime(from, 0);
		band.frequency.exponentialRampToValueAtTime(peak, seconds * 0.4);
		band.frequency.exponentialRampToValueAtTime(to, seconds);
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, 0);
		env.gain.exponentialRampToValueAtTime(0.8, seconds * 0.38);
		env.gain.exponentialRampToValueAtTime(0.0001, seconds);
		const pan = ctx.createStereoPanner();
		pan.pan.setValueAtTime(-0.5, 0);
		pan.pan.linearRampToValueAtTime(0.5, seconds);
		noise.connect(band).connect(env).connect(pan).connect(out);
		noise.start(0);
	}
	return ctx.startRendering();
}

function toWav(buffer: AudioBuffer): ArrayBuffer {
	const channels = buffer.numberOfChannels;
	const frames = buffer.length;
	const bytes = new ArrayBuffer(44 + frames * channels * 2);
	const view = new DataView(bytes);
	const text = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + frames * channels * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, buffer.sampleRate, true);
	view.setUint32(28, buffer.sampleRate * channels * 2, true);
	view.setUint16(32, channels * 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, frames * channels * 2, true);
	const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
	let offset = 44;
	for (let i = 0; i < frames; i++) {
		for (let c = 0; c < channels; c++) {
			const sample = Math.max(-1, Math.min(1, data[c][i]));
			view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			offset += 2;
		}
	}
	return bytes;
}

export function soundEffectFileName(effect: SoundEffect) {
	return `efeito ${effect}.wav`;
}

export async function soundEffectFile(effect: SoundEffect): Promise<File> {
	const wav = toWav(await render(effect));
	return new File([wav], soundEffectFileName(effect), { type: "audio/wav" });
}
