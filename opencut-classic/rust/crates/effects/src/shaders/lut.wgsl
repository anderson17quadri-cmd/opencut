struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// p0: lut id (unused here), strength (0..1), lut size
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
@group(2) @binding(0) var lut_texture: texture_3d<f32>;
@group(2) @binding(1) var lut_sampler: sampler;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSample(input_texture, input_sampler, input.tex_coord);
    let strength = clamp(uniforms.p0.y, 0.0, 1.0);
    let size = max(uniforms.p0.z, 2.0);
    // Same convention as the colour-grade shader: colour graded, alpha kept.
    let coord = clamp(source.rgb, vec3f(0.0), vec3f(1.0)) * ((size - 1.0) / size) + vec3f(0.5 / size);
    let graded = textureSampleLevel(lut_texture, lut_sampler, coord, 0.0).rgb;
    return vec4f(mix(source.rgb, graded, strength), source.a);
}
