// Loudness as the platforms measure it (ITU-R BS.1770-4 / EBU R128):
// K-weighted mean square over 400 ms blocks, gated at -70 LUFS and at
// 10 LU below the ungated level. Instagram, TikTok and YouTube play back
// around -14 LUFS.

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** The two K-weighting stages for a sample rate (libebur128's formulas). */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
	let f0 = 1681.974450955533;
	const gain = 3.999843853973347;
	let q = 0.7071752369554196;
	let k = Math.tan((Math.PI * f0) / sampleRate);
	const vh = 10 ** (gain / 20);
	const vb = vh ** 0.4996667741545416;
	let a0 = 1 + k / q + k * k;
	const shelf = {
		b0: (vh + (vb * k) / q + k * k) / a0,
		b1: (2 * (k * k - vh)) / a0,
		b2: (vh - (vb * k) / q + k * k) / a0,
		a1: (2 * (k * k - 1)) / a0,
		a2: (1 - k / q + k * k) / a0,
	};
	f0 = 38.13547087602444;
	q = 0.5003270373238773;
	k = Math.tan((Math.PI * f0) / sampleRate);
	a0 = 1 + k / q + k * k;
	const highpass = { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
	return [shelf, highpass];
}

function filter(input: Float32Array, { b0, b1, b2, a1, a2 }: Biquad): Float32Array {
	const out = new Float32Array(input.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < input.length; i++) {
		const x = input[i];
		const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
		out[i] = y;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = y;
	}
	return out;
}

/** Integrated loudness in LUFS (-Infinity for silence) and sample peak in dBFS. */
export function measureLoudness(channels: Float32Array[], sampleRate: number): { lufs: number; peakDb: number } {
	const [shelf, highpass] = kWeighting(sampleRate);
	const weighted = channels.slice(0, 2).map((data) => filter(filter(data, shelf), highpass));
	const block = Math.round(sampleRate * 0.4);
	const step = Math.round(sampleRate * 0.1);
	const length = weighted[0]?.length ?? 0;
	const powers: number[] = [];
	for (let start = 0; start + block <= length; start += step) {
		let power = 0;
		for (const data of weighted) {
			let sum = 0;
			for (let i = start; i < start + block; i++) sum += data[i] * data[i];
			power += sum / block;
		}
		powers.push(power);
	}
	const toLufs = (power: number) => -0.691 + 10 * Math.log10(power);
	const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
	const absolute = powers.filter((p) => toLufs(p) > -70);
	let lufs = Number.NEGATIVE_INFINITY;
	if (absolute.length) {
		const gate = toLufs(mean(absolute)) - 10;
		const gated = absolute.filter((p) => toLufs(p) > gate);
		if (gated.length) lufs = toLufs(mean(gated));
	}
	let peak = 0;
	for (const data of channels) for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
	return { lufs, peakDb: 20 * Math.log10(peak || 1e-9) };
}
