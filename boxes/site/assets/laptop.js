// Laptop 3D na stronie głównej: własny model narysowany w three.js (aluminiowa obudowa, cienka klapa ze szklanym
// frontem, klawiatura z osobnych klawiszy z opisami, gładzik, pendrive wsuwany z boku).
// Na ekranie są obrazy z assets/screens/ (jedyne miejsce strony, gdzie właściciel dopuszcza zrzuty ekranu).
// Ładowany dopiero, gdy użytkownik zbliża się do sekcji (assets/site.js).
// API: const api = await createLaptop(canvas, { reduce }); api.set(o, scena) — o: 0 = zamknięty … 1 = otwarty.
import * as THREE from "./vendor/three.module.min.js";

// kolejność scenek = kolejność zakładek w index.html
export const SCREENS = ["windows", "setup", "pulpit", "apps", "panko", "cocktail", "dzialanie"];

// wymiary modelu (jednostki umowne, 1 ≈ 10 cm)
const W = 3.2, D = 2.14, BASE_H = 0.085, R = 0.12;
const LID_T = 0.042, LID_H = 2.11;
const SW = 3.1, SH = SW / 1.6, SCREEN_Y = LID_H - 0.055 - SH / 2;
const PIVOT_Y = BASE_H + 0.005 + LID_T / 2, PIVOT_Z = 0.03;
const OPEN_EXTRA = 0.24; // klapa odchyla się o tyle radianów za pionem
const STICK = 0.5; // ile pendrive wystaje z boku

const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Zaokrąglona płyta w × h o grubości d (z od 0 do d), z łagodnie ściętymi krawędziami. */
function slab(w, h, d, r, bevel, seg = 24) {
  const g = new THREE.ExtrudeGeometry(rrShape(w - 2 * bevel, h - 2 * bevel, Math.max(0.002, r - bevel)), {
    depth: d - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: seg,
  });
  g.translate(0, 0, bevel);
  return g;
}

/** Płaski kształt leżący na blacie (płaszczyzna XZ), środek w (x, z). */
function flat(shape, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 20), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
  return m;
}

function studioEnv(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x050506);
  const box = (w, h, k, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); sc.add(m);
  };
  box(14, 8, 4.2, [0, 10, 1]);    // duży softbox nad sceną
  box(2.5, 10, 3, [-10, 3, 2]);   // paski po bokach rysują krawędzie
  box(2.5, 10, 3, [10, 3, 2]);
  box(14, 2.5, 1.2, [0, 1.5, 12]); // słabe wypełnienie z przodu
  box(10, 4, 2.2, [0, 5, -11]);   // kontra z tyłu
  const tex = pm.fromScene(sc, 0.025).texture;
  pm.dispose();
  return tex;
}

function loadImage(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

/** Logo Shrimp jako maska (biały kształt na czarnym), do wypolerowanego znaku na klapie. */
async function logoMask() {
  try {
    const txt = await (await fetch("/assets/logo.svg")).text();
    const sym = txt.match(/<symbol[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/);
    if (!sym) return null;
    const [, vb, inner] = sym;
    const [, , vw, vh] = vb.split(/\s+/).map(Number);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${vw * 4}" height="${vh * 4}">${inner.replace(/currentColor/g, "#fff")}</svg>`;
    const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    if (!img) return null;
    const c = document.createElement("canvas");
    c.width = 512; c.height = Math.round((512 * vh) / vw);
    const x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    return { tex: t, aspect: vw / vh };
  } catch { return null; }
}

// ----- klawiatura: układ jak w laptopach 14", szerokości w jednostkach klawisza -----
const U = 0.19, GAP = 0.022, KEY_H = 0.013, FN_D = 0.11, KB_W = 14.5 * U;
const one = (s) => s.split(" ").map((l) => [l, 1]);
const ROWS = [
  [["esc", 14.5 / 14], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 14.5 / 14]), ["", 14.5 / 14]],
  [...one("` 1 2 3 4 5 6 7 8 9 0 - ="), ["delete", 1.5]],
  [["tab", 1.5], ...one("Q W E R T Y U I O P [ ]"), ["\\", 1]],
  [["caps", 1.75], ...one("A S D F G H J K L ; '"), ["enter", 1.75]],
  [["shift", 2.25], ...one("Z X C V B N M , . /"), ["shift", 2.25]],
  [["fn", 1], ["ctrl", 1], ["alt", 1], ["super", 1.25], ["", 5], ["super", 1.25], ["alt", 1]],
];

function keyLayout() {
  const keys = [];
  let z = 0;
  ROWS.forEach((row, r) => {
    const d = r === 0 ? FN_D : U;
    let x = -KB_W / 2;
    for (const [label, w] of row) { keys.push({ x: x + (w * U) / 2, z: z + d / 2, w: w * U - GAP, d: d - GAP, label, small: r === 0 || label.length > 1 }); x += w * U; }
    if (r === 5) { // strzałki: lewo, góra/dół, prawo (połówki)
      const h = U / 2;
      [["←", 0, 1], ["↑", 1, 0], ["↓", 1, 1], ["→", 2, 1]].forEach(([label, col, low]) =>
        keys.push({ x: x + col * U + U / 2, z: z + (low ? h * 1.5 : h * 0.5), w: U - GAP, d: h - GAP / 2, label, arrow: true }));
    }
    z += d;
  });
  return { keys, depth: z };
}

function legends(keys, wellW, wellD) {
  const c = document.createElement("canvas");
  c.width = 2048; c.height = Math.round((2048 * wellD) / wellW);
  const x = c.getContext("2d"), k = c.width / wellW;
  x.fillStyle = "rgba(255,255,255,.78)"; x.textAlign = "center"; x.textBaseline = "middle";
  for (const key of keys) {
    const px = (key.x + wellW / 2) * k, py = (key.z + (wellD - key.depthAll) / 2) * k;
    if (key.arrow) {
      const s = 0.02 * k, a = { "←": Math.PI, "→": 0, "↑": -Math.PI / 2, "↓": Math.PI / 2 }[key.label];
      x.save(); x.translate(px, py); x.rotate(a); x.beginPath(); x.moveTo(s, 0); x.lineTo(-s * 0.7, -s); x.lineTo(-s * 0.7, s); x.closePath(); x.fill(); x.restore();
      continue;
    }
    if (!key.label) continue;
    x.font = `${key.small ? 500 : 500} ${(key.small ? 0.036 : 0.062) * k}px "Inter", system-ui, sans-serif`;
    x.fillText(key.label, px, py + 0.003 * k);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 16;
  return t;
}

function floorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(512, 512, 0, 512, 512, 512);
  g.addColorStop(0, "rgba(255,255,255,.085)"); g.addColorStop(0.3, "rgba(255,255,255,.04)"); g.addColorStop(0.56, "rgba(255,255,255,0)");
  x.save(); x.translate(0, 512 * 0.3); x.scale(1, 0.7); x.fillStyle = g; x.fillRect(0, 0, 1024, 1024); x.restore();
  // miękki cień pod obudową (płaszczyzna ma 8 × 8 jednostek)
  const k = 1024 / 8;
  x.shadowColor = "rgba(0,0,0,1)"; x.shadowBlur = 0.22 * k;
  x.fillStyle = "rgba(0,0,0,.92)";
  for (let i = 0; i < 2; i++) { x.beginPath(); x.roundRect(512 - (W / 2 - 0.04) * k, 512 - (D / 2 - 0.04) * k, (W - 0.08) * k, (D - 0.08) * k, R * k); x.fill(); }
  return new THREE.CanvasTexture(c);
}

export async function createLaptop(canvas, { reduce = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer);
  const cam = new THREE.PerspectiveCamera(22, 1.6, 0.1, 80);
  const sun = new THREE.DirectionalLight(0xffffff, 0.5);
  sun.position.set(1.5, 6, 4); scene.add(sun);

  // ----- materiały -----
  const alu = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 1, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0.6, roughness: 0.5 });
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0, roughness: 0.62 });
  const wellMat = new THREE.MeshStandardMaterial({ color: 0x040405, metalness: 0, roughness: 0.9 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0xcbced2, metalness: 1, roughness: 0.27 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x020203, metalness: 0, roughness: 0.18 });

  const laptop = new THREE.Group();
  laptop.position.z = -D / 2; // środek podstawy w początku układu
  scene.add(laptop);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false, toneMapped: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.004, D / 2);
  laptop.add(floor);

  // ----- podstawa -----
  const baseGeo = slab(W, D, BASE_H, R, 0.012, 32);
  baseGeo.rotateX(-Math.PI / 2);
  const base = new THREE.Mesh(baseGeo, alu);
  base.position.z = D / 2;
  laptop.add(base);
  const deck = BASE_H;

  // klawiatura
  const { keys, depth: kbD } = keyLayout();
  const wellW = KB_W + 0.05, wellD = kbD + 0.05, kbZ = 0.2; // kbZ: tylna krawędź pierwszego rzędu
  keys.forEach((k) => { k.depthAll = kbD; });
  laptop.add(flat(rrShape(wellW, wellD, 0.035), wellMat, 0, deck + 0.0005, kbZ + kbD / 2));
  const groups = new Map();
  for (const k of keys) { const id = `${k.w.toFixed(4)}x${k.d.toFixed(4)}`; (groups.get(id) || groups.set(id, []).get(id)).push(k); }
  const m4 = new THREE.Matrix4();
  for (const list of groups.values()) {
    const g = slab(list[0].w, list[0].d, KEY_H, 0.022, 0.004, 6);
    g.rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(g, keyMat, list.length);
    list.forEach((k, i) => inst.setMatrixAt(i, m4.makeTranslation(k.x, deck + 0.0006, kbZ + k.z)));
    laptop.add(inst);
  }
  const legendMat = new THREE.MeshBasicMaterial({ map: legends(keys, wellW, wellD), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.85 });
  const legend = new THREE.Mesh(new THREE.PlaneGeometry(wellW, wellD), legendMat);
  legend.rotation.x = -Math.PI / 2; legend.position.set(0, deck + KEY_H + 0.0012, kbZ + kbD / 2);
  laptop.add(legend);

  // gładzik: cienka szczelina i szklana płyta w kolorze obudowy
  const padTop = kbZ + kbD + 0.085, padD = D - 0.075 - padTop, padW = 1.36, padZ = padTop + padD / 2;
  laptop.add(flat(rrShape(padW, padD, 0.05), dark, 0, deck + 0.0004, padZ));
  laptop.add(flat(rrShape(padW - 0.012, padD - 0.012, 0.045), padMat, 0, deck + 0.0008, padZ));

  // zawias
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, W * 0.78, 24).rotateZ(Math.PI / 2), dark);
  bar.position.set(0, PIVOT_Y - 0.006, PIVOT_Z);
  laptop.add(bar);

  // ----- klapa -----
  const hinge = new THREE.Group();
  hinge.position.set(0, PIVOT_Y, PIVOT_Z);
  laptop.add(hinge);
  const lidGeo = slab(W, LID_H, LID_T, R, 0.01, 32);
  lidGeo.translate(0, LID_H / 2, -LID_T / 2); // ekran patrzy w +z, plecy w −z
  hinge.add(new THREE.Mesh(lidGeo, alu));
  const face = LID_T / 2;
  const front = new THREE.Mesh(new THREE.ShapeGeometry(rrShape(W - 0.028, LID_H - 0.028, R - 0.014), 24), glass);
  front.position.set(0, LID_H / 2, face + 0.0006);
  hinge.add(front);

  // ekran: dwie warstwy do płynnego przejścia między obrazami, zaokrąglone rogi
  const scrGeo = new THREE.ShapeGeometry(rrShape(SW, SH, 0.04), 16);
  { const p = scrGeo.attributes.position, uv = scrGeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / SW + 0.5, p.getY(i) / SH + 0.5); }
  const matA = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const matB = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, transparent: true, opacity: 0 });
  const scrA = new THREE.Mesh(scrGeo, matA), scrB = new THREE.Mesh(scrGeo, matB);
  scrA.position.set(0, SCREEN_Y, face + 0.0012); scrB.position.set(0, SCREEN_Y, face + 0.0016);
  hinge.add(scrA, scrB);
  // odbicie światła w szkle nad ekranem i ramką
  const sheen = new THREE.Mesh(front.geometry, new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: 0.12, envMapIntensity: 0.22, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sheen.position.set(0, LID_H / 2, face + 0.0022);
  hinge.add(sheen);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.011, 20), new THREE.MeshBasicMaterial({ color: 0x0c0d10 }));
  lens.position.set(0, LID_H - 0.028, face + 0.0026);
  hinge.add(lens);

  const logo = await logoMask();
  if (logo) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4f5f6, metalness: 1, roughness: 0.1, alphaMap: logo.tex, transparent: true });
    const h = 0.4;
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(h * logo.aspect, h), mat);
    mark.position.set(0, LID_H / 2, -face - 0.0015);
    mark.rotation.set(0, Math.PI, Math.PI); // czytelne z przodu przy zamkniętej klapie
    hinge.add(mark);
  }

  // ----- pendrive (wsuwa się w lewy bok podstawy) -----
  const stick = new THREE.Group();
  const stickMats = [
    new THREE.MeshStandardMaterial({ color: 0xe9eaec, metalness: 1, roughness: 0.22, transparent: true }),
    new THREE.MeshStandardMaterial({ color: 0x8d9096, metalness: 1, roughness: 0.35, transparent: true }),
    new THREE.MeshBasicMaterial({ color: 0x3584e4, transparent: true, toneMapped: false }),
  ];
  {
    const body = slab(STICK - 0.08, 0.2, 0.06, 0.03, 0.008, 8); body.rotateX(-Math.PI / 2);
    const b = new THREE.Mesh(body, stickMats[0]); b.position.set(-(STICK - 0.08) / 2 - 0.08, -0.03, 0); stick.add(b);
    const plug = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.034, 0.125), stickMats[1]); plug.position.set(-0.005, 0, 0); stick.add(plug);
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), stickMats[2]); led.rotation.x = -Math.PI / 2; led.position.set(-STICK + 0.07, 0.0306, 0); stick.add(led);
  }
  const stickZ = 0.62;
  stick.visible = false;
  laptop.add(stick);

  // ----- obrazy na ekranie -----
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const loader = new THREE.TextureLoader();
  const tex = SCREENS.map(() => null);
  const loadTex = (i) => new Promise((res) => loader.load(`/assets/screens/${SCREENS[i]}.jpg`, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; tex[i] = t; res(t);
  }, undefined, () => res(null)));

  // ----- stan i animacja -----
  let o = 0, tO = 0, plug = 0, tPlug = 0, want = 0, shown = -1, next = -1, fade = 0;
  let aspect = 1.6, raf = 0, last = 0;
  const FIT = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const dirClosed = new THREE.Vector3(0, 0.84, 0.54).normalize(), dirOpen = new THREE.Vector3(0, 0.3, 0.954).normalize();
  const tgtClosed = new THREE.Vector3(0, 0.04, 0.02), tgtOpen = new THREE.Vector3(0, 0.86, -0.22);
  const dir = new THREE.Vector3(), tgt = new THREE.Vector3();

  function pose() {
    const e = smooth(clamp01(o));
    hinge.rotation.x = Math.PI / 2 - e * (Math.PI / 2 + OPEN_EXTRA);
    const lit = smooth(clamp01((o - 0.25) / 0.5));
    matA.color.setScalar(shown < 0 ? 0 : lit); matB.color.setScalar(lit);
    matB.opacity = fade;
    floor.material.opacity = e;
    const s = smooth(clamp01(plug));
    stick.visible = s > 0.002;
    stick.position.set(-W / 2 - (1 - s) * 1.1, BASE_H / 2 + (1 - s) * 0.12, stickZ);
    stick.rotation.z = (1 - s) * -0.25;
    for (const m of stickMats) m.opacity = clamp01(s * 2.5);
    stickMats[2].color.setHex(s > 0.97 ? 0x62a0ea : 0x1a2a40);
    dir.lerpVectors(dirClosed, dirOpen, e).normalize();
    tgt.lerpVectors(tgtClosed, tgtOpen, e);
    const needW = W * (aspect < 1 ? 1.07 : 1.14) + s * (STICK * 2 - 0.1), needH = 2.25 + e * 0.75;
    cam.position.copy(tgt).addScaledVector(dir, Math.max(needW / (FIT * aspect), needH / FIT));
    cam.lookAt(tgt);
  }

  function startFade() {
    if (want === shown || !tex[want]) return;
    if (next >= 0) { matA.map = tex[next]; matA.needsUpdate = true; shown = next; } // przerwane przejście: domknij
    if (shown < 0) { matA.map = tex[want]; matA.needsUpdate = true; shown = want; next = -1; fade = 0; return; }
    if (want === shown) { next = -1; fade = 0; return; }
    next = want; matB.map = tex[next]; matB.needsUpdate = true; fade = 0;
  }

  function frame(t) {
    raf = 0;
    const dt = Math.min(0.12, (t - last) / 1000 || 0.016); last = t;
    const k = reduce ? 1 : 1 - Math.exp(-dt * 9);
    o += (tO - o) * k; if (Math.abs(tO - o) < 0.0005) o = tO;
    plug += (tPlug - plug) * (reduce ? 1 : 1 - Math.exp(-dt * 4.5)); if (Math.abs(tPlug - plug) < 0.001) plug = tPlug;
    if (next >= 0) {
      fade = reduce ? 1 : Math.min(1, fade + dt / 0.45);
      if (fade >= 1) { matA.map = tex[next]; matA.needsUpdate = true; shown = next; next = -1; fade = 0; startFade(); }
    }
    pose();
    renderer.render(scene, cam);
    if (o !== tO || plug !== tPlug || next >= 0) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function resize() {
    const host = canvas.parentElement;
    const w = Math.max(2, host.clientWidth), h = Math.max(2, host.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    aspect = w / h; cam.aspect = aspect; cam.updateProjectionMatrix();
    kick();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", kick);

  try { await document.fonts.load('500 32px "Inter"'); legendMat.map = legends(keys, wellW, wellD); legendMat.needsUpdate = true; } catch { /* zostaje font zapasowy */ }
  await loadTex(0);
  startFade();
  resize();
  // pozostałe obrazy doczytują się w tle, po kolei
  (async () => { for (let i = 1; i < SCREENS.length; i++) { await loadTex(i); if (i === want) { startFade(); kick(); } } })();

  return {
    set(nextO, idx) {
      tO = clamp01(nextO);
      want = Math.min(SCREENS.length - 1, Math.max(0, idx | 0));
      tPlug = tO > 0.9 && want <= 1 ? 1 : 0;
      if (next < 0 || want !== next) startFade();
      kick();
    },
  };
}
