// Code for add_3d_logo: a brand logo (SVG from the icon library) extruded
// into a glossy 3D object with a soft glow behind it, popping in, turning
// and floating — the "logo floating in the hand" of pro tech reels. Runs in
// the motion-graphics sandbox (three.js); the SVG text arrives as api.data.svg.

export type LogoMotion = "turn" | "spin" | "float";

export interface Logo3dSpec {
	/** Centre, fractions of the frame (0.5, 0.5 when following a hand). */
	x: number;
	y: number;
	/** Logo width, fraction of the frame width. */
	width: number;
	motion: LogoMotion;
	/** Glow colour, or null for the logo's own main colour. */
	glow: string | null;
	/** Extrusion depth relative to the logo size. */
	depth: number;
}

export function logo3dCode(spec: Logo3dSpec): string {
	return `
const P = ${JSON.stringify(spec)};
function setup(api) {
	const { THREE, SVGLoader, scene, camera, width, height, data } = api;
	const svg = new SVGLoader().parse(data.svg);
	const group = new THREE.Group();
	const colours = new Map();
	for (const path of svg.paths) {
		const fill = path.userData && path.userData.style && path.userData.style.fill;
		if (!fill || fill === "none") continue;
		// Single-colour icons use currentColor: white metal.
		const colour = new THREE.Color().setStyle(fill === "currentColor" ? "#ffffff" : fill);
		// Black or very dark logos (e.g. OpenAI) vanish on dark footage:
		// they become polished silver instead.
		const hsl = colour.getHSL({});
		if (hsl.l < 0.2) colour.setStyle("#e9ecef");
		const shapes = SVGLoader.createShapes(path);
		for (const shape of shapes) {
			const geometry = new THREE.ExtrudeGeometry(shape, {
				depth: 1, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 4, curveSegments: 16,
			});
			const material = new THREE.MeshStandardMaterial({
				color: colour, metalness: 0.35, roughness: 0.28, emissive: colour, emissiveIntensity: 0.18,
			});
			group.add(new THREE.Mesh(geometry, material));
			colours.set(colour.getHexString(), (colours.get(colour.getHexString()) || 0) + shape.getPoints().length);
		}
	}
	if (group.children.length === 0) throw new Error("This icon has no filled shapes to turn into 3D; pick a colour logo (logos:*).");
	// SVG y points down: flip, then centre and scale to the requested size.
	group.scale.y = -1;
	const box = new THREE.Box3().setFromObject(group);
	const size = box.getSize(new THREE.Vector3());
	const centre = box.getCenter(new THREE.Vector3());
	const holder = new THREE.Group();
	group.position.sub(centre);
	holder.add(group);
	const logoSize = Math.max(size.x, size.y) || 1;
	// Extrusion depth relative to the logo.
	group.scale.z = (logoSize * P.depth) / 1.6;
	const viewH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
	const viewW = viewH * (width / height);
	const s = (P.width * viewW) / logoSize;
	holder.scale.setScalar(s);
	holder.position.set((P.x - 0.5) * viewW, (0.5 - P.y) * viewH, 0);
	scene.add(holder);

	const main = [...colours.entries()].sort((a, b) => b[1] - a[1])[0];
	const glowColour = new THREE.Color(P.glow || (main ? "#" + main[0] : "#ffffff"));
	// Soft glow behind the logo.
	const glowCanvas = document.createElement("canvas");
	glowCanvas.width = glowCanvas.height = 256;
	const g = glowCanvas.getContext("2d");
	const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
	const c = glowColour;
	grad.addColorStop(0, "rgba(" + (c.r * 255 | 0) + "," + (c.g * 255 | 0) + "," + (c.b * 255 | 0) + ",0.55)");
	grad.addColorStop(0.45, "rgba(" + (c.r * 255 | 0) + "," + (c.g * 255 | 0) + "," + (c.b * 255 | 0) + ",0.18)");
	grad.addColorStop(1, "rgba(0,0,0,0)");
	g.fillStyle = grad;
	g.fillRect(0, 0, 256, 256);
	const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
	glow.scale.setScalar(P.width * viewW * 2.3);
	glow.position.copy(holder.position).add(new THREE.Vector3(0, 0, -2));
	scene.add(glow);

	scene.add(new THREE.AmbientLight(0xffffff, 0.9));
	const key = new THREE.DirectionalLight(0xffffff, 2.2);
	key.position.set(-4, 6, 10);
	scene.add(key);
	const rim = new THREE.PointLight(glowColour, 60, 0, 1.6);
	rim.position.set(holder.position.x + 3, holder.position.y + 2, 4);
	scene.add(rim);
	api.state = { holder, glow, baseY: holder.position.y, baseScale: s, glowScale: glow.scale.x };
}
function render(api) {
	const { t, duration, ease, clamp, state } = api;
	const { holder, glow, baseY, baseScale, glowScale } = state;
	const appear = ease.back(clamp(t / 0.45));
	const leave = 1 - ease.in(clamp((t - (duration - 0.3)) / 0.3));
	const k = Math.max(0.0001, appear * leave);
	holder.scale.setScalar(baseScale * k);
	glow.scale.setScalar(glowScale * k * (1 + 0.06 * Math.sin(t * 3)));
	glow.material.opacity = k;
	if (P.motion === "spin") holder.rotation.y = t * 2.2;
	else if (P.motion === "float") holder.rotation.y = Math.sin(t * 1.3) * 0.45;
	else holder.rotation.y = Math.sin(t * 1.4) * 0.7 + t * 0.6;
	holder.rotation.x = Math.sin(t * 0.9) * 0.12;
	holder.position.y = baseY + Math.sin(t * 2) * 0.08;
}
`;
}
