// Animation clips for the suit, written as pure timeline functions pose(t) -> per-bone Euler
// offsets from the bind (A-)pose, then sampled into keyframe tracks. Disney principles at
// ~50%: anticipation before big moves, fast actions, overshoot + damped settle, overlapping
// action (head/arms lag the chest), arcs (two-axis rotations), slow in/out everywhere.
//
// Axes (bind rotations are identity, so local axes = world axes):
//   +rx on a hanging limb swings it backward; -rx forward.  Spine +rx leans forward.
//   Left arm  +rz raises it outward, -rz lowers it toward the body (mirrored on the right).

import * as THREE from "three";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const k01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const easeInOut = (x) => x * x * (3 - 2 * x);
const easeOut3 = (x) => 1 - Math.pow(1 - x, 3);
const TAU = Math.PI * 2;

// mirror a left-side pose onto the right: rz and ry flip sign
function sym(pose, name, rx, ry, rz, phaseRight) {
  pose["Left" + name] = [rx, ry, rz];
  pose["Right" + name] = phaseRight || [rx, -ry, -rz];
}

// ------------------------------------------------------------------ Idle (4 s loop)
export function idlePose(t) {
  const T = 4, b = Math.sin((TAU * t) / T), w = Math.sin((TAU * t) / T + 0.6), lag = Math.sin((TAU * t) / T - 0.5);
  const p = {}, hipsX = 0.011 * w, hipsRz = -0.018 * w;
  p.Hips = [0.0, 0.03 * Math.sin((TAU * t) / T + 1.2), hipsRz];
  p.HipsPos = [hipsX, -0.004 + 0.003 * b, 0];
  p.Spine = [0.004 * b, 0, 0.012 * w];
  p.Spine1 = [-0.012 * b, 0, 0.006 * w];
  p.Spine2 = [-0.014 * b, 0.01 * lag, 0.004 * w];
  p.Neck = [0.012 * b, -0.012 * lag, -0.008 * w];
  p.Head = [0.006 * lag, 0.03 * Math.sin((TAU * t) / T - 1.0), -0.008 * lag];
  sym(p, "Shoulder", 0, 0, 0.012 * b);
  // arms hang slightly relaxed from the A-pose, swaying a little behind the breath
  p.LeftArm = [0.02 * lag, 0, -0.09 - 0.012 * lag];
  p.RightArm = [0.02 * lag, 0, 0.09 + 0.012 * lag];
  sym(p, "ForeArm", -0.14 - 0.02 * b, 0, 0);
  sym(p, "Hand", 0.03 * lag, 0, 0);
  // keep the feet planted while the hips sway: leg angle cancels hip roll + offset
  const legL = 0.84, cancel = -hipsRz - Math.asin(clamp(hipsX / legL, -1, 1));
  p.LeftUpLeg = [0, 0, cancel]; p.RightUpLeg = [0, 0, cancel];
  p.LeftLeg = [0.02, 0, 0]; p.RightLeg = [0.02, 0, 0];
  p.LeftFoot = [-0.02, 0, -(cancel + hipsRz)]; p.RightFoot = [-0.02, 0, -(cancel + hipsRz)];
  return p;
}

// ------------------------------------------------------------------ Walk (1.1 s loop, in place)
export function walkPose(t) {
  const T = 1.1, ph = (TAU * t) / T, p = {};
  const leg = (phase) => {
    const thigh = -0.42 * Math.sin(phase);
    const swing = Math.max(0, Math.cos(phase));                 // swing phase: leg travelling forward
    const knee = 0.08 + 0.72 * Math.pow(swing, 1.6) + 0.1 * Math.max(0, Math.sin(phase - 1.9));
    const foot = -0.6 * (thigh + knee) + 0.25 * Math.max(0, Math.sin(phase + 2.4));   // flat-ish, toe-off
    return { thigh, knee, foot };
  };
  const L = leg(ph), R = leg(ph + Math.PI);
  p.LeftUpLeg = [L.thigh, 0, 0]; p.LeftLeg = [L.knee, 0, 0]; p.LeftFoot = [L.foot, 0, 0];
  p.RightUpLeg = [R.thigh, 0, 0]; p.RightLeg = [R.knee, 0, 0]; p.RightFoot = [R.foot, 0, 0];
  p.Hips = [0.04, 0.09 * Math.sin(ph), 0.035 * Math.cos(ph)];
  p.HipsPos = [0.012 * Math.cos(ph), -0.025 + 0.022 * Math.cos(2 * ph - 0.4), 0];
  p.Spine = [0.02, -0.04 * Math.sin(ph), -0.02 * Math.cos(ph)];
  p.Spine1 = [0.01, -0.04 * Math.sin(ph - 0.2), -0.012 * Math.cos(ph)];
  p.Spine2 = [-0.01 + 0.012 * Math.cos(2 * ph), -0.05 * Math.sin(ph - 0.3), 0];
  p.Neck = [0.0, 0.03 * Math.sin(ph - 0.4), 0.012 * Math.cos(ph)];
  p.Head = [-0.03 + 0.01 * Math.cos(2 * ph - 0.6), 0.02 * Math.sin(ph - 0.6), 0.008 * Math.cos(ph)];
  // arms counter-swing (left arm back when left leg forward), forearm lags and bends forward
  const armL = 0.38 * Math.sin(ph - 0.25), armR = 0.38 * Math.sin(ph + Math.PI - 0.25);
  p.LeftArm = [armL, 0.04, -0.27]; p.RightArm = [armR, -0.04, 0.27];
  p.LeftForeArm = [-0.25 - 0.25 * Math.max(0, -Math.sin(ph - 0.5)), 0, 0];
  p.RightForeArm = [-0.25 - 0.25 * Math.max(0, -Math.sin(ph + Math.PI - 0.5)), 0, 0];
  sym(p, "Shoulder", 0, 0, 0.01 * Math.cos(2 * ph));
  sym(p, "Hand", 0.06 * Math.sin(ph - 0.7), 0, 0);
  return p;
}

// ------------------------------------------------------------------ Power-up (2.6 s, one shot)
// 0–480 ms anticipation: crouch, curl inward, arms draw in.
// 480–700 ms action: fast extension, chest opens, arms flare out and back.
// 700 ms+ overshoot then damped settle back to the idle stance; head/arms lag ~100 ms.
export const POWER_LEN = 2.6;
export function powerAmount(ms) {
  // 0 = gathered (anticipation), 1 = full extension; damped settle back to 0.25 (proud stance)
  if (ms < 480) return -easeInOut(k01(ms, 0, 480));
  if (ms < 700) return -1 + 2.08 * easeOut3(k01(ms, 480, 700));            // overshoots to 1.08
  const u = ms - 700, rest = 0.25 * (1 - easeInOut(k01(ms, 1500, 2600)));
  return rest + (1.08 - rest) * Math.exp(-u / 260) * Math.cos((TAU * u) / 1100);
}
export function powerPose(t) {
  const ms = t * 1000, base = idlePose(0), p = JSON.parse(JSON.stringify(base));
  const a = powerAmount(ms), h = powerAmount(ms - 90), r = powerAmount(ms - 120);   // head/arms lag
  const crouch = Math.min(0, a), open = Math.max(0, a);
  p.HipsPos[1] += 0.04 * crouch + 0.012 * open;
  p.Hips[0] += -0.05 * crouch;
  p.Spine1[0] += -0.07 * crouch - 0.05 * open;
  p.Spine2[0] += -0.07 * crouch - 0.08 * open;
  p.Neck[0] += -0.12 * Math.min(0, h) - 0.07 * Math.max(0, h);
  p.Head[0] += -0.06 * Math.min(0, h) - 0.06 * Math.max(0, h);
  const ra = Math.min(0, r), ro = Math.max(0, r);
  p.LeftArm = [base.LeftArm[0] - 0.22 * ra + 0.14 * ro, 0, base.LeftArm[2] + 0.1 * ra + 0.2 * ro];
  p.RightArm = [base.RightArm[0] - 0.22 * ra + 0.14 * ro, 0, base.RightArm[2] - 0.1 * ra - 0.2 * ro];
  p.LeftForeArm[0] += 0.55 * ra + 0.08 * ro; p.RightForeArm[0] += 0.55 * ra + 0.08 * ro;
  p.LeftHand[0] += -0.2 * ra; p.RightHand[0] += -0.2 * ra;
  sym(p, "Shoulder", 0, 0, -0.06 * ra + 0.05 * ro);
  // knees take the crouch so the feet stay down: thigh forward, shin back, foot compensates
  const kb = -crouch * 0.32;
  for (const s of ["Left", "Right"]) {
    p[s + "UpLeg"][0] += -kb; p[s + "Leg"][0] += 2 * kb; p[s + "Foot"][0] += -kb;
  }
  return p;
}

// glow timeline for the viewer: lights dim during the gather, ripple out from the emblem
// on the release, visor flashes briefly; all ≈50% (no blinding flash)
export function powerGlow(ms) {
  if (ms < 0 || ms > POWER_LEN * 1000) return { level: 1, ripple: -1, flash: 0 };
  const dim = 1 - 0.85 * easeInOut(k01(ms, 0, 420));
  const up = easeOut3(k01(ms, 480, 1250));
  return {
    level: ms < 480 ? dim : 0.15 + 0.85 * up + 0.35 * Math.exp(-Math.max(0, ms - 700) / 300) * (ms > 480 ? 1 : 0),
    ripple: ms < 480 ? -1 : 1.3 * easeOut3(k01(ms, 480, 1350)),
    flash: Math.max(0, Math.sin(Math.PI * k01(ms, 480, 760))) * 0.6,
  };
}

// ------------------------------------------------------------------ sampling
function sample(name, dur, poseFn, bones, fps = 30, loop = true) {
  const n = Math.round(dur * fps) + 1, times = new Float32Array(n);
  const q = {}, hips = new Float32Array(n * 3), e = new THREE.Euler(), qq = new THREE.Quaternion();
  const hipsBind = bones.find((b) => b.name === "Hips").position.clone();
  for (const b of bones) q[b.name] = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = loop && i === n - 1 ? 0 : (i / (n - 1)) * dur;   // exact loop closure
    times[i] = (i / (n - 1)) * dur;
    const p = poseFn(t);
    for (const b of bones) {
      const r = p[b.name] || [0, 0, 0];
      qq.setFromEuler(e.set(r[0], r[1], r[2], "XYZ"));
      q[b.name].set([qq.x, qq.y, qq.z, qq.w], i * 4);
    }
    const hp = p.HipsPos || [0, 0, 0];
    hips.set([hipsBind.x + hp[0], hipsBind.y + hp[1], hipsBind.z + hp[2]], i * 3);
  }
  const tracks = bones.map((b) => new THREE.QuaternionKeyframeTrack(b.name + ".quaternion", times, q[b.name]));
  tracks.push(new THREE.VectorKeyframeTrack("Hips.position", times, hips));
  return new THREE.AnimationClip(name, dur, tracks);
}

export function makeClips(bones) {
  return [
    sample("Idle", 4, idlePose, bones),
    sample("Walk", 1.1, walkPose, bones),
    sample("PowerUp", POWER_LEN, powerPose, bones, 30, false),
  ];
}
