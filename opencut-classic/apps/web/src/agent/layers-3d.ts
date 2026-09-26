// Built-in three.js scene for explode_layers: the frame turns sideways and
// splits into glass panes spread in depth (presenter in front, optional
// graphics in the middle, the background behind), each with a numbered
// label, then folds back into the flat frame. Runs in the motion-graphics
// sandbox; every frame receives api.frames.{orig, fill, person}.

export interface LayersConfig {
	/** Labels front to back, e.g. ["Apresentador", "Logos 3D", "Fundo"]. */
	labels: string[];
	/** Small grey text under each label (same order), or "". */
	sublabels: string[];
	hasMiddle: boolean;
	/** Names of api.images to lay out on the middle pane. */
	middleImages: string[];
	background: string;
	accent: string;
	/** Seconds to open and to close. */
	openSeconds: number;
	closeSeconds: number;
	/** Turn angle in degrees. */
	angle: number;
	font: string;
}

export function layersCode(config: LayersConfig): string {
	return `
const C = ${JSON.stringify(config)};
let S = null;

function makeCanvas(w, h) {
	const c = document.createElement("canvas");
	c.width = w; c.height = h;
	return c;
}

function labelCanvas(index, text, sub) {
	const scale = 2;
	const c = makeCanvas(560 * scale, 120 * scale);
	const g = c.getContext("2d");
	g.scale(scale, scale);
	g.font = "800 44px \\"" + C.font + "\\", sans-serif";
	const textW = g.measureText(text).width;
	g.font = "600 22px \\"" + C.font + "\\", sans-serif";
	const subW = sub ? g.measureText(sub).width : 0;
	const w = Math.min(556, 96 + Math.max(textW, subW) + 28);
	g.fillStyle = "rgba(12,12,18,0.78)";
	g.beginPath(); g.roundRect(2, 2, w, 116, 22); g.fill();
	g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = 2; g.stroke();
	g.fillStyle = C.accent;
	g.beginPath(); g.roundRect(18, 30, 60, 60, 14); g.fill();
	g.fillStyle = "#fff";
	g.font = "800 30px \\"" + C.font + "\\", sans-serif";
	g.textAlign = "center"; g.textBaseline = "middle";
	g.fillText(String(index + 1).padStart(2, "0"), 48, 61);
	g.textAlign = "left";
	g.font = "800 44px \\"" + C.font + "\\", sans-serif";
	g.fillText(text, 96, sub ? 50 : 61);
	if (sub) {
		g.font = "600 22px \\"" + C.font + "\\", sans-serif";
		g.fillStyle = "rgba(255,255,255,0.6)";
		g.fillText(sub, 97, 88);
	}
	return { canvas: c, aspect: (w + 4) / 120, width: w + 4 };
}

function setup(api) {
	const { THREE, scene, camera, width, height, images } = api;
	const aspect = width / height;
	camera.fov = 35;
	camera.aspect = aspect;
	camera.near = 0.05;
	camera.far = 100;
	camera.updateProjectionMatrix();
	const planeH = 2, planeW = 2 * aspect;
	const camZ = 1 / Math.tan(THREE.MathUtils.degToRad(17.5));
	scene.background = new THREE.Color(C.background);

	const texFrom = (canvas) => {
		const t = new THREE.CanvasTexture(canvas);
		t.colorSpace = THREE.SRGBColorSpace;
		t.minFilter = THREE.LinearFilter;
		t.generateMipmaps = false;
		return t;
	};
	const layer = () => {
		const canvas = makeCanvas(width, height);
		return { canvas, ctx: canvas.getContext("2d"), tex: texFrom(canvas) };
	};
	const orig = layer(), fill = layer(), person = layer();

	const plane = (tex, order) => {
		const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
		mesh.renderOrder = order;
		return mesh;
	};

	// Frosted glass sheet with a bright edge, drawn behind a layer's content.
	const glassTex = (() => {
		const c = makeCanvas(512, 512 / aspect > 16 ? Math.round(512 / aspect) : 16);
		const g = c.getContext("2d");
		const grad = g.createLinearGradient(0, 0, c.width, c.height);
		grad.addColorStop(0, "rgba(255,255,255,0.20)");
		grad.addColorStop(0.45, "rgba(255,255,255,0.05)");
		grad.addColorStop(1, "rgba(255,255,255,0.12)");
		g.fillStyle = grad;
		g.fillRect(0, 0, c.width, c.height);
		return texFrom(c);
	})();
	const glass = (order) => {
		const group = new THREE.Group();
		const sheet = new THREE.Mesh(
			new THREE.PlaneGeometry(planeW * 1.02, planeH * 1.02),
			new THREE.MeshBasicMaterial({ map: glassTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
		);
		sheet.renderOrder = order;
		const edges = new THREE.LineSegments(
			new THREE.EdgesGeometry(new THREE.PlaneGeometry(planeW * 1.02, planeH * 1.02)),
			new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false }),
		);
		edges.renderOrder = order + 0.5;
		group.add(sheet, edges);
		return { group, sheet, edges };
	};

	const root = new THREE.Group();
	scene.add(root);
	const panes = [];
	const addPane = (contentMeshes, order) => {
		const pane = new THREE.Group();
		const g = glass(order);
		pane.add(g.group);
		for (const mesh of contentMeshes) pane.add(mesh);
		root.add(pane);
		panes.push({ pane, glass: g, contents: contentMeshes });
		return pane;
	};

	// Back: the background (original frame, then the person-free fill).
	const origMesh = plane(orig.tex, 1);
	const fillMesh = plane(fill.tex, 2);
	fillMesh.material.opacity = 0;
	const backPane = addPane([origMesh, fillMesh], 0);

	// Middle: graphics on their own glass.
	let middlePane = null, middleMesh = null;
	if (C.hasMiddle) {
		const mid = makeCanvas(width, height);
		const g = mid.getContext("2d");
		const items = C.middleImages.map((name) => images[name]).filter(Boolean);
		const size = Math.min(width * 0.26, (width * 0.8) / Math.max(1, items.length));
		const total = items.length * size + (items.length - 1) * size * 0.25;
		let x = (width - total) / 2;
		for (const img of items) {
			const s = size / Math.max(img.width, img.height);
			const w = img.width * s, h = img.height * s;
			g.shadowColor = C.accent; g.shadowBlur = size * 0.25;
			g.drawImage(img, x + (size - w) / 2, height * 0.42 - h / 2, w, h);
			x += size * 1.25;
		}
		middleMesh = plane(texFrom(mid), 11);
		middleMesh.material.opacity = 0;
		middlePane = addPane([middleMesh], 10);
	}

	// Front: the presenter.
	const personMesh = plane(person.tex, 21);
	const frontPane = addPane([personMesh], 20);

	// Labels, front to back, pinned to each pane's top-left corner.
	const ordered = [frontPane, ...(middlePane ? [middlePane] : []), backPane];
	const labels = ordered.map((pane, i) => {
		const info = labelCanvas(i, C.labels[i] || "", C.sublabels[i] || "");
		const h = planeH * 0.1;
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(h * info.aspect, h),
			new THREE.MeshBasicMaterial({ map: texFrom(info.canvas), transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
		);
		mesh.renderOrder = 40 + i;
		// Spread along the panes' top edges (front left, back right), where
		// each pane is visible, just above the pane.
		const w = h * info.aspect;
		const last = ordered.length - 1;
		const x = i === 0 ? -planeW / 2 + w / 2 : i === last ? planeW / 2 - w / 2 : 0;
		mesh.position.set(x, planeH / 2 + h * 0.75, 0.01);
		pane.add(mesh);
		return mesh;
	});

	S = { THREE, camera, camZ, root, panes, backPane, middlePane, frontPane, orig, fill, person, origMesh, fillMesh, middleMesh, labels, planeW };
}

function paint(layer, bitmap) {
	if (!bitmap) return;
	layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
	layer.ctx.drawImage(bitmap, 0, 0, layer.canvas.width, layer.canvas.height);
	layer.tex.needsUpdate = true;
	if (bitmap.close) bitmap.close();
}

function render(api) {
	const { t, duration, frames, ease, clamp } = api;
	paint(S.orig, frames.orig);
	paint(S.fill, frames.fill);
	paint(S.person, frames.person);

	const open = ease.inOut(clamp(t / C.openSeconds));
	const close = ease.inOut(clamp((duration - t) / C.closeSeconds));
	const p = Math.min(open, close);
	const hold = clamp((t - C.openSeconds) / Math.max(0.01, duration - C.openSeconds - C.closeSeconds));

	// Depth: presenter forward, background back; a slow drift while open.
	// Sized so all panes stay in frame on a 9:16 canvas at the full angle.
	const gap = 0.8;
	const count = S.panes.length;
	const zOf = (i) => (count === 3 ? [-gap, 0, gap][i] : [-gap * 0.8, gap * 0.8][i]);
	S.panes.forEach((entry, i) => {
		entry.pane.position.z = p * zOf(i);
		entry.pane.position.x = p * zOf(i) * 0.35;
		entry.glass.sheet.material.opacity = p * 0.9;
		entry.glass.edges.material.opacity = p * 0.55;
	});
	const angle = THREE_DEG(C.angle) * p * (1 + 0.12 * hold);
	S.root.rotation.y = -angle;
	S.root.rotation.x = p * 0.04;
	S.camera.position.set(p * 0.1, p * 0.08, S.camZ * (1 + 0.55 * p));
	S.camera.lookAt(0, 0, 0);

	// Background: swap the original for the person-free fill as it opens.
	S.fillMesh.material.opacity = clamp(p * 5);
	if (S.middleMesh) S.middleMesh.material.opacity = clamp(p * 2.5);

	// Labels appear one by one while open.
	S.labels.forEach((mesh, i) => {
		const inT = C.openSeconds + 0.15 + i * 0.35;
		const a = clamp((t - inT) / 0.3) * clamp((duration - C.closeSeconds - t) / 0.25);
		mesh.material.opacity = a;
		const s = 0.85 + 0.15 * ease.back(clamp((t - inT) / 0.35));
		mesh.scale.set(s, s, 1);
	});
}

function THREE_DEG(d) { return (d * Math.PI) / 180; }
`;
}
