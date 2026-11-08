// Procedural, rigged armored suit rebuilt from reference/suit.jpg.
//
// Units are meters, +Y up, the character faces +Z, feet on y = 0, total height 1.85 m.
// Every feature placed on the front of the body is given in FRONT-VIEW coordinates measured
// off the reference image (x = (px - 368) * K, y = (1400 - py) * K, K = 0.001326 m/px)
// and projected onto the body surface with Body.front().
//
// The skeleton uses Mixamo-style bone names so standard humanoid animations retarget.
// Left-side parts are built once and mirrored to the right.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- skeleton (bind = A-pose)
export const BONE_DEFS = [
  ["Hips", null, [0, 0.98, 0]],
  ["Spine", "Hips", [0, 1.08, 0]],
  ["Spine1", "Spine", [0, 1.2, 0]],
  ["Spine2", "Spine1", [0, 1.32, 0]],
  ["Neck", "Spine2", [0, 1.495, -0.005]],
  ["Head", "Neck", [0, 1.57, 0]],
  ["LeftShoulder", "Spine2", [0.045, 1.45, -0.01]],
  ["LeftArm", "LeftShoulder", [0.205, 1.455, -0.01]],
  ["LeftForeArm", "LeftArm", [0.3, 1.235, -0.015]],
  ["LeftHand", "LeftForeArm", [0.355, 1.02, 0]],
  ["LeftUpLeg", "Hips", [0.092, 0.94, 0]],
  ["LeftLeg", "LeftUpLeg", [0.1, 0.555, 0.005]],
  ["LeftFoot", "LeftLeg", [0.1, 0.1, -0.02]],
  ["LeftToeBase", "LeftFoot", [0.1, 0.025, 0.1]],
];
for (const [n, p, [x, y, z]] of BONE_DEFS.slice()) {
  if (n.startsWith("Left")) BONE_DEFS.push([n.replace("Left", "Right"), p && p.replace("Left", "Right"), [-x, y, z]]);
}
export const BONE_INDEX = Object.fromEntries(BONE_DEFS.map((b, i) => [b[0], i]));
const B = BONE_INDEX;
const MIRROR_BONE = BONE_DEFS.map(([n]) =>
  B[n.startsWith("Left") ? n.replace("Left", "Right") : n.startsWith("Right") ? n.replace("Right", "Left") : n]);

// ---------------------------------------------------------------- loft body
// A body is a superellipse cross-section swept along a straight axis a -> b. Sections give
// half-widths w (along r) and d (along f, which is +Z for every body here) at axial t in [0,1].
class Body {
  constructor(a, b, sections, { n = 2.4, hint = V(0, 0, 1), weights = null } = {}) {
    this.a = a.clone(); this.b = b.clone(); this.len = a.distanceTo(b);
    this.u = b.clone().sub(a).normalize();
    const r = new THREE.Vector3().crossVectors(this.u, hint);
    if (r.lengthSq() < 1e-6) r.crossVectors(this.u, V(0, 1, 0));
    this.r = r.normalize();
    this.f = new THREE.Vector3().crossVectors(this.r, this.u).normalize();
    this.s = sections.map((s) => ({ n, ox: 0, oz: 0, ...s }));
    this.weights = weights;
  }
  prof(t) {
    const s = this.s; t = clamp(t, 0, 1);
    let i = 0; while (i < s.length - 2 && t > s[i + 1].t) i++;
    const p0 = s[Math.max(0, i - 1)], p1 = s[i], p2 = s[i + 1], p3 = s[Math.min(s.length - 1, i + 2)];
    const k = (t - p1.t) / Math.max(1e-6, p2.t - p1.t);
    const cr = (key) => {
      const a = p0[key], b = p1[key], c = p2[key], d = p3[key];
      const v = 0.5 * (2 * b + (-a + c) * k + (2 * a - 5 * b + 4 * c - d) * k * k + (-a + 3 * b - 3 * c + d) * k * k * k);
      return clamp(v, Math.min(b, c) - 0.25 * Math.abs(c - b), Math.max(b, c) + 0.25 * Math.abs(c - b));
    };
    return { w: Math.max(1e-4, cr("w")), d: Math.max(1e-4, cr("d")), n: cr("n"), ox: cr("ox"), oz: cr("oz") };
  }
  point(t, th, lift = 0, out = new THREE.Vector3()) {
    const p = this.prof(t), c = Math.cos(th), s = Math.sin(th), e = 2 / p.n;
    const x = (p.w + lift) * Math.sign(c) * Math.pow(Math.abs(c), e);
    const z = (p.d + lift) * Math.sign(s) * Math.pow(Math.abs(s), e);
    return out.copy(this.a).addScaledVector(this.u, t * this.len)
      .addScaledVector(this.r, x + p.ox).addScaledVector(this.f, z + p.oz);
  }
  // front-view (x, y) -> [t, th] on the +Z half of the body
  front(x, y) {
    const P = V(x, y, 0);
    const t = clamp(P.clone().sub(this.a).dot(this.u) / this.len, 0, 1);
    const p = this.prof(t);
    const C = this.a.clone().addScaledVector(this.u, t * this.len);
    const lx = (P.sub(C).dot(this.r) - p.ox) / p.w;
    const c = Math.sign(lx) * Math.pow(Math.min(1, Math.abs(lx)), p.n / 2);
    return [t, Math.acos(clamp(c, -0.999, 0.999))];
  }
  tOf(p) { return p.clone().sub(this.a).dot(this.u) / this.len; }
}

// ---------------------------------------------------------------- mesh helpers
// grid over (u, v) in [0,1]^2; orientation fixed so the middle quad faces `outward(u, v)`
function grid(fn, nu, nv, { closeV = false, outward = null } = {}) {
  const cols = closeV ? nv : nv + 1, pos = [], uv = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j < cols; j++) {
    const p = fn(i / nu, j / nv); pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv);
  }
  const idx = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * cols + j, b = i * cols + ((j + 1) % cols), c = (i + 1) * cols + ((j + 1) % cols), d = (i + 1) * cols + j;
    idx.push(a, b, d, b, c, d);
  }
  if (outward) {
    const i = Math.floor(nu / 2), j = Math.floor(nv / 2);
    const g = (k) => V(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]);
    const a = g(i * cols + j), b = g(i * cols + ((j + 1) % cols)), d = g((i + 1) * cols + j);
    const n = b.clone().sub(a).cross(d.clone().sub(a));
    if (n.dot(outward((i + 0.5) / nu, (j + 0.5) / nv)) < 0) {
      for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// closed tube over the whole body
function tube(body, nu = 24, nv = 28, lift = 0) {
  return grid((a, b) => body.point(a, b * 2 * Math.PI, lift), nu, nv, {
    closeV: true,
    outward: (a, b) => body.point(a, b * 2 * Math.PI, lift + 0.01).sub(body.point(a, b * 2 * Math.PI, lift)),
  });
}

// a solid shell patch on a body. map(a, b) -> [t, th]; closeB wraps b around.
function slab(body, map, { lift = 0.002, thick = 0.004, na = 12, nb = 8, closeB = false } = {}) {
  const P = (a, b, l) => { const [t, th] = map(a, b); return body.point(t, th, l); };
  const lo = lift, hi = lift + thick, parts = [];
  const radial = (a, b) => P(a, b, hi).sub(P(a, b, lo));
  parts.push(grid((a, b) => P(a, b, hi), na, nb, { closeV: closeB, outward: radial }));
  parts.push(grid((a, b) => P(a, b, lo), na, nb, { closeV: closeB, outward: (a, b) => radial(a, b).negate() }));
  const e = 0.08;
  const wall = (fn, n, out) => parts.push(grid((s, l) => fn(s, lerp(lo, hi, l)), n, 1, { outward: (s) => out(s) }));
  wall((s, l) => P(0, s, l), nb, (s) => P(0, s, lo).sub(P(e, s, lo)));
  wall((s, l) => P(1, s, l), nb, (s) => P(1, s, lo).sub(P(1 - e, s, lo)));
  if (!closeB) {
    wall((s, l) => P(s, 0, l), na, (s) => P(s, 0, lo).sub(P(s, e, lo)));
    wall((s, l) => P(s, 1, l), na, (s) => P(s, 1, lo).sub(P(s, 1 - e, lo)));
  }
  return mergeGeometries(parts);
}

// patch maps -----------------------------------------------------------
// rectangle-ish region in front-view coords: x in [x0(y), x1(y)], y in [y0, y1]
const frontRegion = (body, y0, y1, xr) => (a, b) => {
  const y = lerp(y0, y1, a); const [x0, x1] = xr(y);
  return body.front(lerp(x0, x1, b), y);
};
// region whose vertical span depends on x: x in [x0, x1], y in yr(x)
const frontColumns = (body, x0, x1, yr) => (a, b) => {
  const x = lerp(x0, x1, b); const [y0, y1] = yr(x);
  return body.front(x, lerp(y0, y1, a));
};
// a straight stroke in front-view coords from p0 to p1 with width w
const frontStroke = (body, p0, p1, w) => {
  const d = V(p1[0] - p0[0], p1[1] - p0[1]), n = V(-d.y, d.x).normalize();
  return (a, b) => body.front(p0[0] + d.x * a + n.x * (b - 0.5) * w, p0[1] + d.y * a + n.y * (b - 0.5) * w);
};
// polar region around (cx, cy): radius r(a), angle span
const frontPolar = (body, cx, cy, r0, r1, ang0, ang1) => (a, b) => {
  const r = lerp(r0, r1, a), g = lerp(ang0, ang1, b);
  return body.front(cx + r * Math.cos(g), cy + r * Math.sin(g));
};
// band around the body in t, all the way round
const ring = (t0, t1) => (a, b) => [lerp(t0, t1, a), b * 2 * Math.PI];
// strip along t at angle th(t)
const along = (t0, t1, th0, th1, halfTh) => (a, b) => [lerp(t0, t1, a), lerp(th0, th1, a) + (b - 0.5) * 2 * halfTh];

// ---------------------------------------------------------------- skin weights
// controls: [[t, boneIndex], ...] piecewise-linear blend along body axis
const alongBones = (body, controls) => (p) => {
  const t = body.tOf(p);
  if (t <= controls[0][0]) return [[controls[0][1], 1]];
  for (let i = 0; i < controls.length - 1; i++) {
    const [t0, b0] = controls[i], [t1, b1] = controls[i + 1];
    if (t <= t1) { const k = smooth(t0, t1, t); return b0 === b1 ? [[b0, 1]] : [[b0, 1 - k], [b1, k]]; }
  }
  return [[controls[controls.length - 1][1], 1]];
};
const rigid = (bone) => () => [[bone, 1]];

function applySkin(geo, wfn) {
  const pos = geo.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    const w = wfn(p).filter((e) => e[1] > 1e-4).slice(0, 4);
    const tot = w.reduce((s, e) => s + e[1], 0) || 1;
    w.forEach(([b, v], k) => { si[i * 4 + k] = b; sw[i * 4 + k] = v / tot; });
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

function mirror(geo) {
  const g = geo.clone();
  const pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i)); nor.setX(i, -nor.getX(i));
    for (let k = 0; k < 4; k++) si.setComponent(i, k, MIRROR_BONE[si.getComponent(i, k)]);
  }
  const idx = g.index.array;
  for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  return g;
}

// ---------------------------------------------------------------- the build
export function buildSuit() {
  const parts = { suit: [], armor: [], glow: [], visor: [] };
  let side = "center";
  const add = (mat, geo, w) => { applySkin(geo, w); parts[mat].push({ geo, side }); };

  // ---------------- torso (Hips -> Spine -> Spine1 -> Spine2), y 0.84 .. 1.53
  const ty = (y) => (y - 0.84) / 0.69;
  const torso = new Body(V(0, 0.84, 0), V(0, 1.53, 0), [
    { t: ty(0.84), w: 0.03, d: 0.03 },
    { t: ty(0.87), w: 0.12, d: 0.09, oz: -0.005 },
    { t: ty(0.95), w: 0.15, d: 0.108 },
    { t: ty(1.02), w: 0.142, d: 0.104 },
    { t: ty(1.09), w: 0.122, d: 0.1 },
    { t: ty(1.17), w: 0.128, d: 0.106, oz: 0.004 },
    { t: ty(1.25), w: 0.15, d: 0.12, oz: 0.01 },
    { t: ty(1.33), w: 0.168, d: 0.13, oz: 0.014 },
    { t: ty(1.41), w: 0.176, d: 0.124, oz: 0.008 },
    { t: ty(1.465), w: 0.158, d: 0.108 },
    { t: ty(1.505), w: 0.095, d: 0.078 },
    { t: ty(1.53), w: 0.06, d: 0.06 },
  ], { n: 2.45 });
  const spineW = alongBones(torso, [[ty(0.98), B.Hips], [ty(1.1), B.Spine], [ty(1.22), B.Spine1], [ty(1.33), B.Spine2]]);
  torso.weights = (p) => {
    const base = spineW(p);
    const s = smooth(0.12, 0.18, Math.abs(p.x)) * smooth(1.36, 1.45, p.y) * 0.6;
    if (s <= 0) return base;
    return [...base.map(([b, w]) => [b, w * (1 - s)]), [p.x > 0 ? B.LeftShoulder : B.RightShoulder, s]];
  };
  add("suit", tube(torso, 40, 36), torso.weights);

  // chest plate
  add("armor", slab(torso, frontColumns(torso, -0.155, 0.155, (x) => [1.288 + 0.035 * Math.pow(Math.abs(x) / 0.155, 1.6), 1.468 + 0.02 * Math.abs(x) / 0.155]),
    { lift: 0.002, thick: 0.01, na: 14, nb: 24 }), torso.weights);
  // abs panels (3 rows x 2 columns) and the lower V plate
  for (const [y0, y1, xo] of [[1.212, 1.262, 0.072], [1.153, 1.2, 0.066], [1.098, 1.142, 0.06]]) {
    for (const s of [-1, 1]) {
      const xa = s * 0.009, xb = s * xo;
      add("suit", slab(torso, frontColumns(torso, Math.min(xa, xb), Math.max(xa, xb), () => [y0 + 0.012 * (1 - Math.abs(xb) / 0.08), y1]),
        { lift: 0.002, thick: 0.007, na: 6, nb: 8 }), torso.weights);
    }
  }
  add("suit", slab(torso, frontRegion(torso, 0.925, 1.075, (y) => { const h = 0.12 * Math.pow(clamp((y - 0.92) / 0.155, 0, 1), 0.9); return [-h, h]; }),
    { lift: 0.002, thick: 0.007, na: 10, nb: 12 }), torso.weights);
  // side/waist plates
  for (const s of [-1, 1]) {
    const xr = (y) => { const a = 0.085 + 0.02 * (y - 1.03) / 0.13, b = 0.135 + 0.025 * (y - 1.03) / 0.13; return s > 0 ? [a, b] : [-b, -a]; };
    add("suit", slab(torso, frontRegion(torso, 1.03, 1.16, xr), { lift: 0.002, thick: 0.006, na: 8, nb: 6 }), torso.weights);
  }

  // emblem: glowing shield rim, dark inner shield, glowing sunburst
  const EY = 1.415, shieldHW = (y, k) => {
    const top = EY + 0.055 * k, bot = EY - 0.055 * k;
    if (y > EY + 0.005 * k) return 0.065 * k * (1 - 0.25 * smooth(top - 0.012 * k, top, y));
    return 0.065 * k * Math.pow(clamp((y - bot) / (EY + 0.005 * k - bot), 0, 1), 0.85);
  };
  const shield = (k) => frontRegion(torso, EY - 0.055 * k, EY + 0.055 * k, (y) => [-shieldHW(y, k), shieldHW(y, k)]);
  add("glow", slab(torso, shield(1), { lift: 0.012, thick: 0.004, na: 16, nb: 12 }), torso.weights);
  add("armor", slab(torso, shield(0.8), { lift: 0.016, thick: 0.004, na: 16, nb: 12 }), torso.weights);
  add("glow", slab(torso, frontPolar(torso, 0, EY + 0.004, 0, 0.011, 0, 2 * Math.PI), { lift: 0.02, thick: 0.003, na: 3, nb: 16 }), torso.weights);
  for (let k = 0; k < 12; k++) {
    const g = (k / 12) * 2 * Math.PI + Math.PI / 2, L = k % 2 ? 0.024 : 0.033, cx = 0, cy = EY + 0.004;
    const map = (a, b) => {
      const r = lerp(0.009, L, a), w = 0.0045 * (1 - 0.85 * a);
      return torso.front(cx + r * Math.cos(g) - (b - 0.5) * 2 * w * Math.sin(g), cy + r * Math.sin(g) + (b - 0.5) * 2 * w * Math.cos(g));
    };
    add("glow", slab(torso, map, { lift: 0.02, thick: 0.003, na: 4, nb: 2 }), torso.weights);
  }
  // chest strips (diagonal collar strips and lateral chest strips), both sides
  for (const s of [-1, 1]) {
    add("glow", slab(torso, frontStroke(torso, [s * 0.088, 1.452], [s * 0.15, 1.485], 0.008), { lift: 0.012, thick: 0.003, na: 8, nb: 2 }), torso.weights);
    add("glow", slab(torso, frontStroke(torso, [s * 0.147, 1.418], [s * 0.136, 1.3], 0.009), { lift: 0.012, thick: 0.003, na: 10, nb: 2 }), torso.weights);
  }

  // ---------------- neck + helmet
  const neck = new Body(V(0, 1.44, -0.01), V(0, 1.585, 0), [{ t: 0, w: 0.058, d: 0.06 }, { t: 1, w: 0.052, d: 0.056 }], { n: 2.2 });
  add("suit", tube(neck, 8, 20), alongBones(neck, [[0.25, B.Spine2], [0.5, B.Neck], [0.8, B.Neck], [1, B.Head]]));
  const hy = (y) => (y - 1.5) / 0.36;
  const helmet = new Body(V(0, 1.5, 0), V(0, 1.86, 0), [
    { t: hy(1.5), w: 0.05, d: 0.055 },
    { t: hy(1.545), w: 0.07, d: 0.08, oz: 0.012 },
    { t: hy(1.585), w: 0.087, d: 0.103, oz: 0.013 },
    { t: hy(1.635), w: 0.095, d: 0.112, oz: 0.01 },
    { t: hy(1.70), w: 0.098, d: 0.115, oz: 0.004 },
    { t: hy(1.765), w: 0.093, d: 0.11 },
    { t: hy(1.815), w: 0.075, d: 0.093 },
    { t: hy(1.847), w: 0.043, d: 0.056 },
    { t: hy(1.86), w: 0.004, d: 0.004 },
  ], { n: 2.3 });
  const headW = alongBones(helmet, [[hy(1.5), B.Neck], [hy(1.56), B.Head]]);
  add("armor", tube(helmet, 30, 36), headW);
  // visor: chevron, bright
  const VX = 0.069;
  add("visor", slab(helmet, frontColumns(helmet, -VX, VX, (x) => {
    const k = Math.abs(x) / VX; return [lerp(1.604, 1.637, k), lerp(1.656, 1.684, k)];
  }), { lift: 0.001, thick: 0.004, na: 8, nb: 24 }), headW);
  // dark brow over the visor + crest + cheek plates
  add("armor", slab(helmet, frontColumns(helmet, -0.085, 0.085, (x) => {
    const k = Math.abs(x) / 0.085; return [lerp(1.664, 1.692, k), lerp(1.676, 1.702, k)];
  }), { lift: 0.004, thick: 0.004, na: 2, nb: 24 }), headW);
  add("armor", slab(helmet, frontColumns(helmet, -0.011, 0.011, () => [1.69, 1.85]), { lift: 0.002, thick: 0.005, na: 16, nb: 2 }), headW);

  // ---------------- left limbs (mirrored afterwards)
  side = "left";
  const J = Object.fromEntries(BONE_DEFS.map(([n, , p]) => [n, V(...p)]));

  // shoulder pad (pauldron), half on the clavicle, half on the arm
  const pad = new Body(V(0.14, 1.52, -0.008), V(0.31, 1.34, -0.008), [
    { t: 0, w: 0.03, d: 0.04 }, { t: 0.16, w: 0.064, d: 0.08 }, { t: 0.5, w: 0.074, d: 0.086 },
    { t: 0.85, w: 0.07, d: 0.08 }, { t: 1, w: 0.058, d: 0.07 },
  ], { n: 2.3 });
  const padW = () => [[B.LeftShoulder, 0.45], [B.LeftArm, 0.55]];
  add("armor", slab(pad, (a, b) => [a, lerp(0.38, 1.62, b) * Math.PI], { lift: 0, thick: 0.01, na: 14, nb: 22 }), padW);
  add("glow", slab(pad, along(0.2, 0.86, 0.62 * Math.PI, 0.6 * Math.PI, 0.05), { lift: 0.012, thick: 0.003, na: 10, nb: 2 }), padW);
  add("glow", slab(pad, along(0.2, 0.8, 1.38 * Math.PI, 1.4 * Math.PI, 0.05), { lift: 0.012, thick: 0.003, na: 10, nb: 2 }), padW);

  // upper arm, elbow, forearm, gauntlet bands
  const upper = new Body(J.LeftArm, J.LeftForeArm, [
    { t: 0, w: 0.058, d: 0.062 }, { t: 0.32, w: 0.064, d: 0.066 }, { t: 0.75, w: 0.052, d: 0.054 }, { t: 1, w: 0.046, d: 0.048 },
  ], { n: 2.1 });
  upper.weights = alongBones(upper, [[-0.05, B.LeftShoulder], [0.18, B.LeftArm], [0.86, B.LeftArm], [1.05, B.LeftForeArm]]);
  add("suit", tube(upper, 16, 24), upper.weights);
  add("glow", slab(upper, along(0.28, 0.78, 0.74 * Math.PI, 0.74 * Math.PI, 0.075), { lift: 0.002, thick: 0.003, na: 10, nb: 2 }), upper.weights);
  const elbow = new Body(J.LeftForeArm.clone().add(V(-0.012, 0.045)), J.LeftForeArm.clone().add(V(0.012, -0.045)),
    [{ t: 0, w: 0.012, d: 0.012 }, { t: 0.5, w: 0.047, d: 0.049 }, { t: 1, w: 0.012, d: 0.012 }], { n: 2 });
  add("suit", tube(elbow, 8, 16), () => [[B.LeftArm, 0.5], [B.LeftForeArm, 0.5]]);
  const fore = new Body(J.LeftForeArm, J.LeftHand, [
    { t: 0, w: 0.047, d: 0.05 }, { t: 0.3, w: 0.053, d: 0.055 }, { t: 1, w: 0.037, d: 0.04 },
  ], { n: 2.1 });
  fore.weights = alongBones(fore, [[-0.05, B.LeftArm], [0.12, B.LeftForeArm], [0.9, B.LeftForeArm], [1.04, B.LeftHand]]);
  add("suit", tube(fore, 16, 24), fore.weights);
  for (const [t0, t1] of [[0.13, 0.38], [0.64, 0.9]]) {
    const foreR = rigid(B.LeftForeArm);
    add("armor", slab(fore, ring(t0, t1), { lift: 0.004, thick: 0.012, na: 4, nb: 28, closeB: true }), foreR);
    const e = 0.03;
    add("glow", slab(fore, ring(t0, t0 + e), { lift: 0.016, thick: 0.003, na: 1, nb: 28, closeB: true }), foreR);
    add("glow", slab(fore, ring(t1 - e, t1), { lift: 0.016, thick: 0.003, na: 1, nb: 28, closeB: true }), foreR);
    for (let k = 0; k < 6; k++) {
      const th = (k / 6) * 2 * Math.PI + 0.25;
      add("glow", slab(fore, along(t0, t1, th, th, 0.06), { lift: 0.016, thick: 0.003, na: 3, nb: 1 }), foreR);
    }
  }

  // glove: palm + four curled fingers + thumb, all on LeftHand
  const handR = rigid(B.LeftHand);
  const hu = J.LeftHand.clone().sub(J.LeftForeArm).normalize();
  const wristBall = new Body(J.LeftHand.clone().addScaledVector(hu, -0.035), J.LeftHand.clone().addScaledVector(hu, 0.03),
    [{ t: 0, w: 0.03, d: 0.034 }, { t: 0.5, w: 0.034, d: 0.04 }, { t: 1, w: 0.025, d: 0.035 }], { n: 2 });
  add("suit", tube(wristBall, 8, 16), () => [[B.LeftForeArm, 0.5], [B.LeftHand, 0.5]]);
  const palm = new Body(J.LeftHand, J.LeftHand.clone().addScaledVector(hu, 0.095), [
    { t: 0, w: 0.024, d: 0.036 }, { t: 0.5, w: 0.025, d: 0.044 }, { t: 0.9, w: 0.021, d: 0.045 }, { t: 1, w: 0.017, d: 0.042 },
  ], { n: 2.6 });
  add("suit", tube(palm, 10, 20), handR);
  const hr = palm.r.clone(), hf = palm.f.clone();   // hr points to the palm side (toward the thigh)
  const finger = (base, dir0, lengths, curls, rad) => {
    let p = base.clone(), dir = dir0.clone().normalize(), ang = 0;
    lengths.forEach((L, i) => {
      ang = curls[i];
      const d2 = dir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(hr, Math.sin(ang)).normalize();
      const q = p.clone().addScaledVector(d2, L);
      const r0 = rad * (1 - 0.1 * i), r1 = rad * (1 - 0.1 * (i + 1));
      const seg = new Body(p.clone().addScaledVector(d2, -0.004), q.clone().addScaledVector(d2, 0.004), [
        { t: 0, w: r0 * 0.8, d: r0 * 0.8 }, { t: 0.15, w: r0, d: r0 }, { t: 0.85, w: r1, d: r1 }, { t: 1, w: r1 * 0.7, d: r1 * 0.7 },
      ], { n: 2 });
      add("suit", tube(seg, 4, 10), handR);
      p = q; dir = d2;
    });
  };
  const knuckle = J.LeftHand.clone().addScaledVector(hu, 0.09);
  [[0.03, 0.082], [0.011, 0.092], [-0.009, 0.088], [-0.028, 0.072]].forEach(([z, L], i) => {
    finger(knuckle.clone().addScaledVector(hf, z), hu, [L * 0.42, L * 0.32, L * 0.26], [0.18 + 0.04 * i, 0.5 + 0.05 * i, 0.82 + 0.05 * i], 0.0105);
  });
  finger(J.LeftHand.clone().addScaledVector(hu, 0.03).addScaledVector(hf, 0.036).addScaledVector(hr, 0.01),
    hu.clone().addScaledVector(hf, 0.8), [0.04, 0.035], [0.35, 0.6], 0.011);

  // thigh, knee pad, shin, boot
  const thigh = new Body(V(0.092, 0.975, 0), J.LeftLeg, [
    { t: 0, w: 0.084, d: 0.092 }, { t: 0.28, w: 0.086, d: 0.094, oz: 0.004 }, { t: 0.7, w: 0.067, d: 0.074, oz: 0.004 }, { t: 1, w: 0.054, d: 0.06 },
  ], { n: 2.2 });
  thigh.weights = alongBones(thigh, [[0.02, B.Hips], [0.16, B.LeftUpLeg], [0.86, B.LeftUpLeg], [1.06, B.LeftLeg]]);
  add("suit", tube(thigh, 20, 28), thigh.weights);
  add("glow", slab(thigh, frontStroke(thigh, [0.119, 0.93], [0.124, 0.71], 0.009), { lift: 0.002, thick: 0.003, na: 12, nb: 2 }), thigh.weights);

  const shin = new Body(J.LeftLeg, J.LeftFoot, [
    { t: 0, w: 0.053, d: 0.058 }, { t: 0.22, w: 0.058, d: 0.066, oz: -0.012 }, { t: 0.55, w: 0.047, d: 0.052, oz: -0.004 },
    { t: 0.85, w: 0.038, d: 0.042 }, { t: 1, w: 0.036, d: 0.04 },
  ], { n: 2.2 });
  shin.weights = alongBones(shin, [[-0.06, B.LeftUpLeg], [0.08, B.LeftLeg], [0.92, B.LeftLeg], [1.06, B.LeftFoot]]);
  add("suit", tube(shin, 20, 28), shin.weights);
  add("glow", slab(shin, frontStroke(shin, [0.138, 0.47], [0.134, 0.31], 0.008), { lift: 0.002, thick: 0.003, na: 10, nb: 2 }), shin.weights);
  add("glow", slab(shin, frontStroke(shin, [0.132, 0.275], [0.128, 0.21], 0.007), { lift: 0.002, thick: 0.003, na: 6, nb: 2 }), shin.weights);

  const knee = new Body(V(0.1, 0.83, 0.004), V(0.1, 0.5, 0.004), [
    { t: 0, w: 0.068, d: 0.074 }, { t: 0.4, w: 0.062, d: 0.072 }, { t: 0.75, w: 0.064, d: 0.074 }, { t: 1, w: 0.06, d: 0.068 },
  ], { n: 2.2 });
  const kneeW = () => [[B.LeftUpLeg, 0.5], [B.LeftLeg, 0.5]];
  const kneeHalf = (t, k) => k * (t < 0.12 ? lerp(0.55, 0.98, Math.sqrt(t / 0.12)) : t < 0.6 ? lerp(0.98, 1.05, (t - 0.12) / 0.48) : lerp(1.05, 0.16, Math.pow((t - 0.6) / 0.4, 1.1)));
  const kneeMap = (k, t0, t1) => (a, b) => { const t = lerp(t0, t1, a); const h = kneeHalf(t, k); return [t, Math.PI / 2 + (b - 0.5) * 2 * h]; };
  add("glow", slab(knee, kneeMap(1, 0, 1), { lift: 0.004, thick: 0.009, na: 18, nb: 14 }), kneeW);
  add("armor", slab(knee, kneeMap(0.86, 0.035, 0.965), { lift: 0.006, thick: 0.01, na: 18, nb: 14 }), kneeW);
  for (const tc of [0.56, 0.7, 0.82]) {   // inner chevron outlines (thin V strokes)
    for (const sgn of [-1, 1]) {
      add("glow", slab(knee, (a, b) => {
        const h = kneeHalf(tc, 0.62) * (1 - a);
        return [tc - 0.07 * (1 - a) + (b - 0.5) * 0.018, Math.PI / 2 + sgn * h];
      }, { lift: 0.016, thick: 0.002, na: 6, nb: 1 }), kneeW);
    }
  }
  add("armor", slab(shin, ring(0.82, 0.98), { lift: 0.004, thick: 0.01, na: 4, nb: 28, closeB: true }), rigid(B.LeftLeg));

  // boot: foot shell + sole + glowing sole rim + toe cap
  const heel = V(0.1, 0.062, -0.078), toe = V(0.106, 0.046, 0.175);
  const cy = (t) => lerp(heel.y, toe.y, t);
  const footSec = (dw, dd, ozFn) => [
    { t: 0, w: 0.012 + dw, d: 0.014 + dd }, { t: 0.05, w: 0.04 + dw, d: 0.046 + dd }, { t: 0.15, w: 0.048 + dw, d: 0.054 + dd },
    { t: 0.45, w: 0.052 + dw, d: 0.049 + dd }, { t: 0.75, w: 0.05 + dw, d: 0.036 + dd }, { t: 0.93, w: 0.039 + dw, d: 0.026 + dd },
    { t: 1, w: 0.014 + dw, d: 0.012 + dd },
  ].map((s) => ({ ...s, oz: ozFn ? ozFn(s.t) : 0 }));
  const foot = new Body(heel, toe, footSec(0, 0, (t) => (t > 0.4 ? -0.004 * (t - 0.4) / 0.6 : 0)), { hint: V(0, 1, 0), n: 2.8 });
  foot.weights = alongBones(foot, [[0.58, B.LeftFoot], [0.74, B.LeftToeBase]]);
  add("armor", tube(foot, 22, 28), foot.weights);
  const sole = new Body(heel, toe, footSec(0.006, -0.036, (t) => 0.011 - cy(t)).map((s) => ({ ...s, d: Math.max(0.006, s.d * 0.3) })), { hint: V(0, 1, 0), n: 3.2 });
  add("armor", tube(sole, 22, 28), foot.weights);
  const rim = new Body(heel, toe, footSec(0.008, 0, (t) => 0.021 - cy(t)).map((s) => ({ ...s, d: 0.0035 })), { hint: V(0, 1, 0), n: 3.2 });
  add("glow", tube(rim, 22, 28), foot.weights);
  add("armor", slab(foot, (a, b) => [lerp(0.55, 0.97, a), Math.PI / 2 + (b - 0.5) * 1.6], { lift: 0.002, thick: 0.006, na: 10, nb: 10 }), foot.weights);

  // ---------------- mirror the left side, merge per material
  const out = {};
  for (const [mat, list] of Object.entries(parts)) {
    const geos = [];
    for (const { geo, side: s } of list) { geos.push(geo); if (s === "left") geos.push(mirror(geo)); }
    out[mat] = mergeGeometries(geos);
    out[mat].computeBoundingSphere();
  }

  // ---------------- skeleton + skinned meshes
  const bones = BONE_DEFS.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; });
  BONE_DEFS.forEach(([, parent, p], i) => {
    if (!parent) { bones[i].position.set(...p); return; }
    const pp = BONE_DEFS[B[parent]][2];
    bones[i].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    bones[B[parent]].add(bones[i]);
  });
  const root = new THREE.Group(); root.name = "ArmoredSuit";
  const armature = new THREE.Group(); armature.name = "Armature";
  armature.add(bones[0]); root.add(armature);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const materials = makeMaterials();
  for (const [mat, geo] of Object.entries(out)) {
    const m = new THREE.SkinnedMesh(geo, materials[mat]);
    m.name = "Suit_" + mat; m.castShadow = m.receiveShadow = true;
    root.add(m); m.bind(skeleton);
  }
  return { root, skeleton, bones, materials };
}

export function makeMaterials() {
  return {
    suit: Object.assign(new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.62, metalness: 0.2 }), { name: "suit" }),
    armor: Object.assign(new THREE.MeshStandardMaterial({ color: 0x1f2024, roughness: 0.4, metalness: 0.4 }), { name: "armor" }),
    glow: Object.assign(new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff6a10, emissiveIntensity: 1.6, roughness: 0.4 }), { name: "glow" }),
    visor: Object.assign(new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff8a20, emissiveIntensity: 2.0, roughness: 0.15 }), { name: "visor" }),
  };
}
