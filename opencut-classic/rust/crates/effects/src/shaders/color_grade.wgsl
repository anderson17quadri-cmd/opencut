struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// p0: brightness, contrast, saturation, exposure  (-1..1, exposure in stops)
// p1: temperature, tint, hue_shift (radians), vignette (0..1)
// p2: grayscale (0..1), sepia (0..1), sharpen (0..1), fade (0..1)
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

const LUMA = vec3f(0.2126, 0.7152, 0.0722);

fn rotate_hue(color: vec3f, angle: f32) -> vec3f {
    // Rodrigues rotation around the grey axis.
    let k = vec3f(0.57735);
    let cos_a = cos(angle);
    return color * cos_a + cross(k, color) * sin(angle) + k * dot(k, color) * (1.0 - cos_a);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let uv = input.tex_coord;
    let source = textureSample(input_texture, input_sampler, uv);
    var rgb = source.rgb;

    let sharpen = uniforms.p2.z;
    if (sharpen > 0.0) {
        let texel = vec2f(1.0) / uniforms.resolution;
        let neighbors =
            textureSample(input_texture, input_sampler, uv + vec2f(texel.x, 0.0)).rgb +
            textureSample(input_texture, input_sampler, uv - vec2f(texel.x, 0.0)).rgb +
            textureSample(input_texture, input_sampler, uv + vec2f(0.0, texel.y)).rgb +
            textureSample(input_texture, input_sampler, uv - vec2f(0.0, texel.y)).rgb;
        rgb = rgb + (rgb * 4.0 - neighbors) * sharpen * 1.5;
    }

    // Exposure (stops), then brightness offset.
    rgb = rgb * exp2(uniforms.p0.w);
    rgb = rgb + vec3f(uniforms.p0.x * 0.5);

    // Contrast around mid grey.
    let contrast = uniforms.p0.y;
    let contrast_factor = select(1.0 + contrast, 1.0 / (1.0 - contrast * 0.95), contrast > 0.0);
    rgb = (rgb - vec3f(0.5)) * contrast_factor + vec3f(0.5);

    // White balance: temperature pushes red/blue, tint pushes green/magenta.
    let temperature = uniforms.p1.x;
    let tint = uniforms.p1.y;
    rgb = rgb + vec3f(temperature * 0.12, -tint * 0.12, -temperature * 0.12);

    let hue_shift = uniforms.p1.z;
    if (hue_shift != 0.0) {
        rgb = rotate_hue(rgb, hue_shift);
    }

    // Saturation (then grayscale, which is just saturation towards 0).
    let luma = dot(rgb, LUMA);
    rgb = mix(vec3f(luma), rgb, 1.0 + uniforms.p0.z);
    rgb = mix(rgb, vec3f(dot(rgb, LUMA)), uniforms.p2.x);

    let sepia_amount = uniforms.p2.y;
    if (sepia_amount > 0.0) {
        let sepia = vec3f(
            dot(rgb, vec3f(0.393, 0.769, 0.189)),
            dot(rgb, vec3f(0.349, 0.686, 0.168)),
            dot(rgb, vec3f(0.272, 0.534, 0.131)),
        );
        rgb = mix(rgb, sepia, sepia_amount);
    }

    // Faded / matte look: lift blacks, lower whites.
    let fade = uniforms.p2.w;
    rgb = mix(rgb, rgb * 0.8 + vec3f(0.12), fade);

    let vignette = uniforms.p1.w;
    if (vignette > 0.0) {
        let aspect = uniforms.resolution.x / max(uniforms.resolution.y, 1.0);
        let centered = (uv - vec2f(0.5)) * vec2f(aspect, 1.0);
        let dist = length(centered) / length(vec2f(aspect, 1.0) * 0.5);
        let falloff = smoothstep(0.35, 1.05, dist);
        rgb = rgb * (1.0 - falloff * vignette);
    }

    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), source.a);
}
