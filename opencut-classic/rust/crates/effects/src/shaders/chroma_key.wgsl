struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// p0: key colour rgb (0..1), similarity (0..1)
// p1: smoothness (0..1), spill (0..1)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
    p0: vec4f,
    p1: vec4f,
    p2: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn to_chroma(rgb: vec3f) -> vec2f {
    // YCbCr chroma plane, so the key ignores brightness differences
    // (shadows and highlights on the backdrop).
    let cb = -0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b;
    let cr = 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;
    return vec2f(cb, cr);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);
    let key = uniforms.p0.rgb;
    let similarity = max(uniforms.p0.w, 0.001);
    let smoothness = max(uniforms.p1.x, 0.001);
    let spill = uniforms.p1.y;

    let distance = length(to_chroma(source.rgb) - to_chroma(key));
    let threshold = similarity * 0.4;
    let alpha = smoothstep(threshold, threshold + smoothness * 0.25, distance);

    // Spill suppression: pixels whose chroma is still close to the key
    // (green fringes, reflections) get desaturated in proportion.
    let closeness = 1.0 - smoothstep(threshold, threshold + 0.3, distance);
    let desaturated = vec3f(dot(source.rgb, vec3f(0.2126, 0.7152, 0.0722)));
    let rgb = mix(source.rgb, desaturated, clamp(closeness * spill, 0.0, 1.0));

    return vec4f(rgb, source.a * alpha);
}
