// 闲逛 Bix 星：小宇航员在着陆用的那颗星球上点哪儿走哪儿，Zib 跟在旁边，镜头在人身后上方（第三人称）。
// 星球很小，一直往前走会绕一圈回到着陆区。着陆区在“北极”，四周按经度分成一圈天气地带，
// 每个地带有自己的地面颜色、灯光、布景、飘着的东西和发现物。
// 坐标都相对星球中心（BixStage.root，没有旋转和缩放），着陆点在 +y 方向；
// 经度 0 在着陆点的 -z 方向（地图上发射台后面），往 +x 方向增大。

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIX_RADIUS as R, STATION_SPOTS, EXTRA_SPOTS, DOOR_SPOT, TOWER_SPOT } from './bix.js';
import { dotTexture } from './particles.js';
import { sound } from './audio.js';

const DEG = Math.PI / 180;
/** 着陆区：离北极这么多度以内，五个站点都在里面 */
export const HOME_COLAT = 26;
const WALK_SPEED = 2.2;
/** 走到这么近，发现物开始发光、招手 */
const NEAR = 4.2;
/** 这么近才显示发现物头上的小气泡 */
const BUBBLE_RANGE = 12;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 小宇航员在地图上站的地方（相对着陆点） */
const ASTRO_HOME = { x: -0.3, z: 2.9 };

/** 每个地带的样子：天空和灯光的颜色、飘着的东西、布景（没写的地带用默认值） */
const LOOKS = {
  wind: { sky: '#0b1a3c', light: '#eef4ff', fx: 'wind', decor: ['grass', 'grass', 'grass', 'rock'] },
  sun: { sky: '#26160b', light: '#ffe2a2', fx: 'motes', decor: ['mound', 'mound', 'rock'] },
  rain: { sky: '#061a1c', light: '#c8efe6', fx: 'uprain', decor: ['tree', 'tree', 'bush'] },
  snow: { sky: '#0c1832', light: '#e4edff', fx: 'upsnow', decor: ['drift', 'drift', 'crystal'] },
  leaves: { sky: '#210f0b', light: '#ffd3a3', fx: 'leaves', decor: ['tree', 'tree', 'pile'] },
};
const DEFAULT_LOOK = { sky: '#0a0f24', light: '#ffffff', fx: null, decor: ['rock'] };
const HOME_LOOK = { sky: '#050816', light: '#cfe8ff' };

const Y = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const v5 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();
const c1 = new THREE.Color();

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mod360 = (x) => ((x % 360) + 360) % 360;
const smooth = (a, b, x) => {
  if (b <= a) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hexRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** 纬度、经度（度）→ 星球表面的方向（单位向量） */
export function dirAt(lat, lon, out = new THREE.Vector3()) {
  const c = (90 - lat) * DEG;
  const l = lon * DEG;
  return out.set(Math.sin(c) * Math.sin(l), Math.cos(c), -Math.sin(c) * Math.cos(l)).normalize();
}
const lonOf = (d) => mod360(Math.atan2(d.x, -d.z) / DEG);
const colatOf = (d) => Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)) / DEG;
/** 着陆区里的点（相对着陆点的 x、z）→ 方向 */
const siteDir = (x, z, out = new THREE.Vector3()) => out.set(x, Math.sqrt(Math.max(0, R * R - x * x - z * z)), z).normalize();
/** 离着陆区有多“近”：1 是在着陆区里，0 是已经进了天气地带 */
const homeness = (colat) => 1 - smooth(HOME_COLAT - 4, HOME_COLAT + 4, colat);

/** v 在 p 处的切线方向（去掉沿 p 的分量）；v 和 p 平行时随便给一个切线方向 */
function tangentOf(p, v, out) {
  out.copy(v).addScaledVector(p, -v.dot(p));
  if (out.lengthSq() < 1e-8) out.crossVectors(p, Math.abs(p.y) < 0.9 ? Y : v3.set(1, 0, 0));
  return out.normalize();
}

/** 把人立在球面上：脚底在 p 方向的地面上，身体垂直地面，脸朝 fwd（切线方向） */
function stand(obj, p, fwd, h = 0) {
  obj.position.copy(p).multiplyScalar(R + h);
  const right = v1.crossVectors(p, fwd).normalize();
  const f = v2.crossVectors(right, p);
  m1.makeBasis(right, p, f);
  obj.quaternion.setFromRotationMatrix(m1);
}

/** 把布景放在球面上：竖直立着，绕自己的竖轴转 yaw */
function plant(obj, p, yaw = 0, h = 0) {
  obj.position.copy(p).multiplyScalar(R + h);
  obj.quaternion.setFromUnitVectors(Y, p);
  obj.rotateY(yaw);
}

/** 天气地带：按经度排好，算某个经度上相邻的两个地带和混合比例 */
class ZoneMap {
  constructor(zones) {
    this.list = [...zones]
      .sort((a, b) => a.lon - b.lon)
      .map((z) => {
        // 地带的样子：内置的几个地带有默认样子，章节数据里的 look 可以覆盖（新的层不用改代码）
        const look = { ...DEFAULT_LOOK, ...(LOOKS[z.id] || {}), ...(z.look || {}) };
        return { ...z, look, rgb: hexRgb(z.color), sky: new THREE.Color(look.sky), light: new THREE.Color(look.light) };
      });
    this.byId = new Map(this.list.map((z) => [z.id, z]));
  }

  /** 经度 lon 两边的地带 a、b，以及 b 占的比例；band 越小边界越清楚 */
  mix(lon, band = 0.1) {
    const L = this.list;
    if (L.length === 1) return { a: L[0], b: L[0], t: 0 };
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      const b = L[(i + 1) % L.length];
      const span = mod360(b.lon - a.lon) || 360;
      const off = mod360(lon - a.lon);
      if (off <= span) return { a, b, t: smooth(0.5 - band, 0.5 + band, off / span) };
    }
    return { a: L[0], b: L[0], t: 0 };
  }

  /** 某个方向上最主要的地带；在着陆区里返回 null */
  at(dir) {
    if (homeness(colatOf(dir)) > 0.5) return null;
    const { a, b, t } = this.mix(lonOf(dir), 0);
    return t < 0.5 ? a : b;
  }

  /** 地带的经度范围：左右各到和相邻地带的中线 */
  range(zone) {
    const L = this.list;
    if (L.length === 1) return [0, 360];
    const i = L.indexOf(zone);
    const prev = L[(i - 1 + L.length) % L.length];
    const next = L[(i + 1) % L.length];
    return [zone.lon - (mod360(zone.lon - prev.lon) || 360) / 2, zone.lon + (mod360(next.lon - zone.lon) || 360) / 2];
  }
}

/** 星球表面的贴图（经纬度展开）：北极是着陆区的颜色（每一层不一样），往外慢慢变成各个地带的颜色 */
function groundTexture(zones, home = '#4a8fc8') {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  const data = img.data;
  const base = hexRgb(home);
  // 贴图的横坐标只和经度有关：先算好每一列的地带颜色（SphereGeometry 的 u=0 在 -x，经度 = 270° - u·360°）
  const cols = new Float32Array(W * 3);
  for (let x = 0; x < W; x++) {
    const { a, b, t } = zones.mix(mod360(270 - ((x + 0.5) / W) * 360), 0.06);
    for (let k = 0; k < 3; k++) cols[x * 3 + k] = a.rgb[k] + (b.rgb[k] - a.rgb[k]) * t;
  }
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y++) {
    const home = homeness(((y + 0.5) / H) * 180);
    const band = Math.sin(y * 0.045 + 7) * 0.5 + Math.sin(y * 0.13 + 21) * 0.3 + Math.sin(y * 0.33 + 49) * 0.2;
    for (let x = 0; x < W; x++) {
      const blot = Math.sin(x * 0.037 + Math.sin(y * 0.051) * 2.2) * Math.sin(y * 0.047 + Math.sin(x * 0.023) * 1.7);
      const zs = 1 + blot * 0.1 + (rand() - 0.5) * 0.07;
      const hs = 1 + band * 0.16 + (rand() - 0.5) * 0.05;
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        const z = cols[x * 3 + k] * zs;
        data[i + k] = Math.min(255, Math.max(0, z + (base[k] * hs - z) * home));
      }
      data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- 模型 ----------

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
const glow = (color, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
const ball = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
const dome = (r, w = 20) => new THREE.SphereGeometry(r, w, 10, 0, Math.PI * 2, 0, Math.PI / 2);

/** 地上的一团影子；opacity 由闲逛模式控制 */
function blobShadow(r, opacity = 0.3) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 24),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.025;
  m.renderOrder = 1;
  return m;
}

/** 小宇航员：白色宇航服、橙色手套和靴子、蓝色面罩，头盔上有一根亮晶晶的天线 */
function buildAstronaut() {
  const suit = std('#e4e8f5', { roughness: 0.6 });
  const trim = std('#ff8a3d', { roughness: 0.5 });
  const dark = std('#2b3150', { roughness: 0.6 });
  const visor = new THREE.MeshStandardMaterial({ color: '#16224d', roughness: 0.08, metalness: 0.5, emissive: '#2a6fd6', emissiveIntensity: 0.45 });

  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);

  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.42, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.18, 4, 10), suit);
    leg.position.y = -0.17;
    const boot = new THREE.Mesh(ball(0.1), trim);
    boot.scale.set(1, 0.6, 1.35);
    boot.position.set(0, -0.36, 0.03);
    hip.add(leg, boot);
    inner.add(hip);
    return hip;
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.24, 6, 16), suit);
  body.position.y = 0.66;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.06, 20), trim);
  belt.position.y = 0.5;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.04), dark);
  panel.position.set(0, 0.72, 0.215);
  inner.add(body, belt, panel);
  ['#ffd166', '#4cc9f0', '#80ed99'].forEach((c, i) => {
    const led = new THREE.Mesh(ball(0.016, 8, 6), glow(c, 2));
    led.position.set(-0.045 + i * 0.045, 0.72, 0.24);
    inner.add(led);
  });
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.18), std('#d9deef', { roughness: 0.6 }));
  pack.position.set(0, 0.7, -0.24);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), trim);
  tank.position.set(0, 0.72, -0.34);
  inner.add(pack, tank);

  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 0.8, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.2, 4, 10), suit);
    arm.position.y = -0.17;
    const glove = new THREE.Mesh(ball(0.08), trim);
    glove.position.y = -0.33;
    shoulder.add(arm, glove);
    shoulder.rotation.z = side * 0.12;
    inner.add(shoulder);
    return shoulder;
  });

  const head = new THREE.Group();
  head.position.y = 1.12;
  inner.add(head);
  head.add(new THREE.Mesh(ball(0.3, 28, 20), suit));
  // 面罩：头盔前面的一块球面（+z 是脸）
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.305, 28, 16, Math.PI / 2 - 0.95, 1.9, 0.95, 1.15), visor);
  head.add(glass);
  const shine = new THREE.Mesh(ball(0.035, 8, 6), glow('#ffffff', 1.4));
  shine.position.set(0.1, 0.07, 0.29);
  head.add(shine);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), dark);
  antenna.position.set(0.12, 0.36, -0.02);
  antenna.rotation.z = -0.25;
  const bulb = new THREE.Mesh(ball(0.045, 10, 8), glow('#ffd166', 2.4));
  bulb.position.set(0.15, 0.47, -0.02);
  head.add(antenna, bulb);

  const shadow = blobShadow(0.42);
  // 晴之丘的两个太阳：第二道影子
  const shadow2 = blobShadow(0.36, 0);
  shadow2.position.set(0.5, 0.024, -0.25);
  group.add(shadow, shadow2);

  // 点击用：比身体大一圈的隐形胶囊
  const hit = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.7, 4, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.75;
  group.add(hit);
  return { group, inner, legs, arms, head, shadow2, hit, phase: 0, walk: 0, hop: 0 };
}

/**
 * 衣柜里的衣服穿在小宇航员身上的样子（id 和章节 wardrobe.items 一致）：红色毛线连指手套、黄色雨靴、
 * 背包侧面挂的一瓶防晒霜（镜头在身后，挂前面看不见）。还有一层热得发红的光，冒汗的时候亮。
 * 返回 { gear: id → 网格列表, heat }
 */
function buildGear(a) {
  const knit = std('#e63946', { roughness: 0.95 });
  const cuffMat = std('#ffffff', { roughness: 0.9 });
  const mittens = a.arms.map((shoulder, i) => {
    const side = i === 0 ? -1 : 1;
    const m = new THREE.Group();
    m.position.y = -0.33;
    const hand = new THREE.Mesh(ball(0.095, 14, 10), knit);
    hand.scale.set(1, 1.15, 0.85);
    const thumb = new THREE.Mesh(ball(0.042, 10, 8), knit);
    thumb.position.set(-side * 0.075, 0.015, 0.03);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.028, 8, 20), cuffMat);
    cuff.position.y = 0.075;
    cuff.rotation.x = Math.PI / 2;
    m.add(hand, thumb, cuff);
    shoulder.add(m);
    return m;
  });

  const rubber = std('#ffd60a', { roughness: 0.25, metalness: 0.05 });
  const boots = a.legs.map((hip) => {
    const b = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.112, 0.24, 14), rubber);
    shaft.position.y = -0.25;
    const foot = new THREE.Mesh(ball(0.115, 14, 10), rubber);
    foot.scale.set(1, 0.6, 1.4);
    foot.position.set(0, -0.365, 0.035);
    b.add(shaft, foot);
    hip.add(b);
    return b;
  });

  const bottle = new THREE.Group();
  bottle.position.set(0.21, 0.62, -0.27);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.15, 12), std('#ffffff', { roughness: 0.4 }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.045, 10), std('#ff8a3d', { roughness: 0.5 }));
  cap.position.y = 0.095;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.051, 0.05, 12), std('#ffd166', { roughness: 0.5 }));
  bottle.add(body, cap, label);
  a.inner.add(bottle);

  const heat = new THREE.Mesh(ball(0.36, 20, 14), new THREE.MeshBasicMaterial({ color: '#ff5a36', transparent: true, opacity: 0, depthWrite: false }));
  a.head.add(heat);

  const gear = { mittens, 'rain-boots': boots, sunscreen: [bottle] };
  for (const parts of Object.values(gear)) for (const p of parts) p.visible = false;
  return { gear, heat };
}

// ---------- 发现物 ----------
// 每个发现物在自己的小坐标系里搭（y 朝上，原点在地面上），返回：
//   group 整体；hits 点击用的网格；bubbleAt 头上小气泡的位置；reach 走到离中心多远停下；
//   update(dt, t, near) 每一帧调用，near 是 0..1，越近越大。

const DISCOVERY_BUILDERS = {
  /** 风车花：一小片花，花瓣像风车一样一直转，人走近转得更快 */
  'pinwheel-flowers'(ctx) {
    const group = new THREE.Group();
    const stem = std('#3f7d4f');
    const petals = ['#ff7eb6', '#ffd166', '#7cc8ff', '#b388ff', '#80ed99'].map((c) => std(c, { side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.2, roughness: 0.5 }));
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.26, 0.02);
    shape.lineTo(0.06, 0.17);
    shape.closePath();
    const petalGeo = new THREE.ShapeGeometry(shape);
    const spinners = [];
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4 + ctx.rand();
      const d = i === 0 ? 0 : 0.35 + ctx.rand() * 0.65;
      const h = 0.75 + ctx.rand() * 0.55;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, h, 6), stem);
      s.position.set(x, h / 2, z);
      group.add(s);
      const head = new THREE.Group();
      head.position.set(x, h, z);
      head.rotation.y = ctx.rand() * Math.PI * 2;
      head.scale.setScalar(1.45);
      group.add(head);
      const spin = new THREE.Group();
      head.add(spin);
      for (let k = 0; k < 4; k++) {
        const p = new THREE.Mesh(petalGeo, petals[(i + (k % 2)) % petals.length]);
        p.rotation.z = (k * Math.PI) / 2;
        spin.add(p);
      }
      spin.add(new THREE.Mesh(ball(0.035, 8, 6), glow('#fff3b0', 1.4)));
      spinners.push({ spin, speed: 2.5 + ctx.rand() * 2 });
    }
    const hit = ctx.hit(new THREE.CylinderGeometry(1.2, 1.2, 1.8, 10), 0.9);
    group.add(hit);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 1.9, 0),
      reach: 1.5,
      update(dt, t, near) {
        for (const s of spinners) s.spin.rotation.z -= dt * s.speed * (1 + near * 2.5);
      },
    };
  },

  /** 会跟着你走的小云：收进图鉴以后，闲逛时一直飘在小宇航员头顶 */
  'follow-cloud'() {
    const group = new THREE.Group();
    const mover = new THREE.Group();
    mover.position.y = 2.1;
    mover.scale.setScalar(0.8);
    group.add(mover);
    const body = new THREE.Group();
    mover.add(body);
    const puff = std('#ffffff', { roughness: 1, emissive: '#dbe8ff', emissiveIntensity: 0.4 });
    for (const [x, y, z, r] of [[0, 0, 0, 0.42], [0.42, -0.06, 0.04, 0.3], [-0.4, -0.07, 0, 0.3], [0.12, 0.2, -0.08, 0.3], [-0.16, 0.14, 0.12, 0.26]]) {
      const m = new THREE.Mesh(ball(r), puff);
      m.position.set(x, y, z);
      m.scale.y = 0.82;
      body.add(m);
    }
    const eye = std('#141626', { roughness: 0.3 });
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(ball(0.045, 10, 8), eye);
      e.position.set(side * 0.12, 0.04, 0.38);
      body.add(e);
    }
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    mover.add(hit);
    return {
      group,
      mover,
      home: mover.position.clone(),
      hits: [hit],
      bubbleParent: mover,
      bubbleAt: new THREE.Vector3(0, 0.7, 0),
      reach: 1.3,
      follows: true,
      update(dt, t, near) {
        body.position.y = Math.sin(t * 1.6) * 0.12;
        body.rotation.y = Math.sin(t * 0.7) * 0.3;
        body.scale.setScalar(1 + near * 0.06 * Math.sin(t * 6));
      },
    };
  },

  /** 两个太阳：低低地挂在小山丘上空，绕着彼此慢慢转 */
  'two-suns'(ctx) {
    const group = new THREE.Group();
    const mound = new THREE.Mesh(dome(1.25), std('#f6cf72', { roughness: 0.9 }));
    mound.scale.y = 0.35;
    group.add(mound);
    const suns = [['#ffd166', 0.32, 1.9], ['#ff9f43', 0.25, 1.8]].map(([c, r, k]) => {
      const s = new THREE.Group();
      s.add(new THREE.Mesh(ball(r, 24, 16), glow(c, k)));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: new THREE.Color(c).multiplyScalar(0.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(r * 3.6);
      s.add(halo);
      group.add(s);
      return s;
    });
    const sky = ctx.hit(new THREE.SphereGeometry(1.4, 10, 8), 2.7);
    const hill = ctx.hit(new THREE.CylinderGeometry(1.2, 1.2, 0.8, 10), 0.4);
    group.add(sky, hill);
    return {
      group,
      hits: [sky, hill],
      bubbleAt: new THREE.Vector3(0, 1.5, 0),
      reach: 1.6,
      update(dt, t, near) {
        const a = t * 0.45;
        suns[0].position.set(Math.cos(a) * 1.0, 2.7 + Math.sin(t * 0.9) * 0.15, Math.sin(a) * 1.0);
        suns[1].position.set(-Math.cos(a) * 1.0, 2.55 + Math.sin(t * 0.9 + 2) * 0.15, -Math.sin(a) * 1.0);
        const s = 1 + near * 0.18 * (0.5 + 0.5 * Math.sin(t * 5));
        suns[0].scale.setScalar(s);
        suns[1].scale.setScalar(s);
      },
    };
  },

  /** 冒泡的温泉：泡泡一个接一个冒出来，人在旁边时泡泡“噗”地变成小星星 */
  'hot-spring'(ctx) {
    const group = new THREE.Group();
    const water = std('#62d6e8', { roughness: 0.1, metalness: 0.2, emissive: '#22a6c4', emissiveIntensity: 0.5 });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32), water);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.04;
    group.add(pool);
    const rockMat = std('#b98a5a', { roughness: 0.9, flatShading: true });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + ctx.rand() * 0.2;
      const r = new THREE.Mesh(rockGeo, rockMat);
      const s = 0.14 + ctx.rand() * 0.08;
      r.scale.set(s, s * 0.8, s);
      r.position.set(Math.cos(a) * 0.95, s * 0.4, Math.sin(a) * 0.95);
      r.rotation.set(ctx.rand(), ctx.rand() * 3, ctx.rand());
      group.add(r);
    }
    const bubbleMat = std('#e9fbff', { roughness: 0.1, emissive: '#9ff3ff', emissiveIntensity: 0.7, transparent: true, opacity: 0.75 });
    const bubbleGeo = ball(1, 12, 8);
    const bubbles = Array.from({ length: 9 }, (_, i) => {
      const m = new THREE.Mesh(bubbleGeo, bubbleMat);
      group.add(m);
      return { m, age: (i / 9) * 1.6, life: 1.6, x: 0, z: 0, size: 0.06 };
    });
    const steamMat = new THREE.SpriteMaterial({ map: dotTexture(), color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false });
    const steam = Array.from({ length: 6 }, (_, i) => {
      const s = new THREE.Sprite(steamMat.clone());
      group.add(s);
      return { s, age: (i / 6) * 3, x: (ctx.rand() - 0.5) * 0.8, z: (ctx.rand() - 0.5) * 0.8 };
    });
    const hit = ctx.hit(new THREE.CylinderGeometry(1.15, 1.15, 0.9, 10), 0.45);
    group.add(hit);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 1.35, 0),
      reach: 1.55,
      update(dt, t, near) {
        for (const b of bubbles) {
          b.age += dt * (1 + near);
          if (b.age >= b.life) {
            if (near > 0.3) ctx.pop(group, new THREE.Vector3(b.x, 0.04 + b.size * 2, b.z));
            const a = ctx.rand() * Math.PI * 2;
            const r = Math.sqrt(ctx.rand()) * 0.6;
            b.x = Math.cos(a) * r;
            b.z = Math.sin(a) * r;
            b.size = 0.05 + ctx.rand() * 0.06;
            b.age = 0;
          }
          const k = b.age / b.life;
          b.m.position.set(b.x, 0.04 + k * 0.3, b.z);
          b.m.scale.setScalar(b.size * (0.4 + k));
        }
        for (const s of steam) {
          s.age = (s.age + dt) % 3;
          const k = s.age / 3;
          s.s.position.set(s.x, 0.1 + k * 1.6, s.z);
          s.s.scale.setScalar(0.3 + k * 0.9);
          s.s.material.opacity = 0.25 * Math.sin(k * Math.PI);
        }
      },
    };
  },

  /** 往上下的雨：雨滴从水洼里往天上飞 */
  'up-rain'(ctx) {
    const group = new THREE.Group();
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32), std('#4fb3c8', { roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.8 }));
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.y = 0.025;
    group.add(puddle);
    const n = 110;
    const drops = Array.from({ length: n }, () => {
      const a = ctx.rand() * Math.PI * 2;
      const r = Math.sqrt(ctx.rand()) * 1.4;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: ctx.rand() * 4.2, v: 3 + ctx.rand() * 2 };
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color('#a9e3ff').multiplyScalar(1.3), transparent: true, opacity: 0.75, depthWrite: false }));
    lines.frustumCulled = false;
    group.add(lines);
    const hit = ctx.hit(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 10), 1.3);
    group.add(hit);
    const write = () => {
      const a = geo.attributes.position.array;
      drops.forEach((d, i) => a.set([d.x, d.y, d.z, d.x, d.y + 0.28, d.z], i * 6));
      geo.attributes.position.needsUpdate = true;
    };
    write();
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 2.1, 0),
      reach: 1.7,
      update(dt, t, near) {
        for (const d of drops) {
          d.y += d.v * dt * (1 + near * 0.4);
          if (d.y > 4.2) d.y = 0;
        }
        write();
      },
    };
  },

  /** 水母雷云：半透明的云飘在空中，触须一闪一闪是小闪电 */
  'jelly-storm'(ctx) {
    const group = new THREE.Group();
    const jelly = new THREE.Group();
    jelly.position.y = 2.6;
    group.add(jelly);
    const bell = new THREE.Mesh(
      dome(0.85, 28),
      std('#a99bff', { roughness: 0.3, emissive: '#6a5cff', emissiveIntensity: 0.55, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }),
    );
    jelly.add(bell);
    const core = new THREE.Mesh(ball(0.26), glow('#d7ceff', 1.3));
    core.position.y = 0.18;
    jelly.add(core);
    const eye = std('#141626', { roughness: 0.3 });
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(ball(0.055, 10, 8), eye);
      e.position.set(side * 0.22, 0.28, 0.77);
      jelly.add(e);
    }
    const tentMat = std('#d4ccff', { roughness: 0.4, emissive: '#ffe066', emissiveIntensity: 0.15 });
    const tentacles = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
      const pts = Array.from({ length: 6 }, (_, k) => new THREE.Vector3(Math.sin(k * 1.3 + i) * 0.08, -k * 0.28, Math.cos(k * 1.1 + i) * 0.08));
      pivot.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.03, 5), tentMat));
      jelly.add(pivot);
      return pivot;
    });
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 6), 3));
    const bolt = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({ color: new THREE.Color('#fff3b0').multiplyScalar(3) }));
    bolt.frustumCulled = false;
    bolt.visible = false;
    jelly.add(bolt);
    let nextFlash = 1;
    let flash = 0;
    const hit = ctx.hit(new THREE.SphereGeometry(1.25, 10, 8), 2.3);
    group.add(hit);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 0.9, 0),
      reach: 1.4,
      update(dt, t, near) {
        jelly.position.y = 2.6 + Math.sin(t * 1.2) * 0.15;
        const pulse = Math.sin(t * 2.4);
        bell.scale.set(1 + pulse * 0.05, 1 - pulse * 0.07, 1 + pulse * 0.05);
        tentacles.forEach((p, i) => {
          p.rotation.x = Math.sin(t * 2 + i) * 0.16;
          p.rotation.z = Math.cos(t * 1.7 + i * 1.3) * 0.16;
        });
        nextFlash -= dt * (1 + near * 2);
        if (nextFlash <= 0) {
          nextFlash = 0.8 + ctx.rand() * 1.8;
          flash = 1;
          const a = boltGeo.attributes.position.array;
          let x = (ctx.rand() - 0.5) * 0.6;
          let z = (ctx.rand() - 0.5) * 0.6;
          let y = -0.1;
          for (let i = 0; i < 8; i++) {
            const nx = x + (ctx.rand() - 0.5) * 0.35;
            const nz = z + (ctx.rand() - 0.5) * 0.35;
            const ny = y - 0.22;
            a.set([x, y, z, nx, ny, nz], i * 6);
            x = nx;
            y = ny;
            z = nz;
          }
          boltGeo.attributes.position.needsUpdate = true;
        }
        flash = Math.max(0, flash - dt * 6);
        bolt.visible = !REDUCED_MOTION && flash > 0.4;
        tentMat.emissiveIntensity = 0.15 + flash * 2.6;
      },
    };
  },

  /** 往上飘的雪：雪花从地上往天上飘，旁边有发蓝光的冰晶 */
  'up-snow'(ctx) {
    const group = new THREE.Group();
    const drift = new THREE.Mesh(dome(1.05), std('#f4f8ff', { roughness: 0.95 }));
    drift.scale.y = 0.28;
    group.add(drift);
    const ice = std('#bfefff', { emissive: '#4cc9f0', emissiveIntensity: 0.9, roughness: 0.2, flatShading: true });
    const iceGeo = new THREE.OctahedronGeometry(1, 0);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3;
      const c = new THREE.Mesh(iceGeo, ice);
      const s = 0.12 + ctx.rand() * 0.1;
      c.scale.set(s, s * 2.4, s);
      c.position.set(Math.cos(a) * 0.3 * (i ? 1 : 0), 0.22 + s, Math.sin(a) * 0.3 * (i ? 1 : 0));
      c.rotation.set((ctx.rand() - 0.5) * 0.5, ctx.rand() * 3, (ctx.rand() - 0.5) * 0.5);
      group.add(c);
    }
    const n = 140;
    const flakes = Array.from({ length: n }, () => {
      const a = ctx.rand() * Math.PI * 2;
      const r = Math.sqrt(ctx.rand()) * 1.6;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: ctx.rand() * 4, v: 0.35 + ctx.rand() * 0.4, ph: ctx.rand() * 6 };
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.11, map: dotTexture(), color: new THREE.Color('#ffffff').multiplyScalar(1.2), transparent: true, depthWrite: false }));
    points.frustumCulled = false;
    group.add(points);
    const hit = ctx.hit(new THREE.CylinderGeometry(1.3, 1.3, 1.8, 10), 0.9);
    group.add(hit);
    const write = (t) => {
      const a = geo.attributes.position.array;
      flakes.forEach((f, i) => a.set([f.x + Math.sin(t * 1.3 + f.ph) * 0.12, f.y, f.z + Math.cos(t * 1.1 + f.ph) * 0.12], i * 3));
      geo.attributes.position.needsUpdate = true;
    };
    write(0);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 1.6, 0),
      reach: 1.6,
      update(dt, t, near) {
        for (const f of flakes) {
          f.y += f.v * dt * (1 + near * 0.5);
          if (f.y > 4.2) f.y = 0;
        }
        write(t);
      },
    };
  },

  /** 会跳舞的落叶：一堆落叶，人走近就跳起来转圈，走开又落回去 */
  'dancing-leaves'(ctx) {
    const group = new THREE.Group();
    const mats = ['#ff9f43', '#e8573f', '#ffcf5c', '#c8452c'].map((c) => std(c, { side: THREE.DoubleSide, roughness: 0.6 }));
    const geo = new THREE.PlaneGeometry(0.17, 0.11);
    const leaves = Array.from({ length: 46 }, (_, i) => {
      const a = ctx.rand() * Math.PI * 2;
      const r = Math.sqrt(ctx.rand()) * 0.7;
      const m = new THREE.Mesh(geo, mats[i % mats.length]);
      group.add(m);
      return { m, a, r, y: 0.03 + (0.7 - r) * 0.32 * ctx.rand(), h: ctx.rand(), rx: -Math.PI / 2 + (ctx.rand() - 0.5) * 0.6, rz: ctx.rand() * 6 };
    });
    let jump = 0;
    const hit = ctx.hit(new THREE.CylinderGeometry(0.95, 0.95, 0.9, 10), 0.45);
    group.add(hit);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 1.25, 0),
      reach: 1.5,
      update(dt, t, near) {
        const goal = near > 0.55 ? 1 : 0;
        jump += (goal - jump) * Math.min(1, dt * (goal ? 2.2 : 1.1));
        if (REDUCED_MOTION) jump = 0;
        for (const l of leaves) {
          const spin = l.a + t * (2.2 + l.r) * jump;
          const r = l.r * (1 + jump * 0.9) + jump * 0.25;
          l.m.position.set(Math.cos(spin) * r, l.y + jump * (0.5 + l.h * 1.4 + Math.sin(t * 3 + l.a) * 0.2), Math.sin(spin) * r);
          l.m.rotation.set(l.rx + jump * t * 3, 0, l.rz + jump * t * 2);
        }
      },
    };
  },

  /** 彩虹桥：一道小彩虹从两个水洼之间拱起来，人走近颜色一圈一圈地亮 */
  'rainbow-bridge'(ctx) {
    const group = new THREE.Group();
    const bands = ['#ff5d5d', '#ff9f43', '#ffd166', '#80ed99', '#4cc9f0', '#7c83ff', '#b388ff'].map((c, i) => {
      const mat = std(c, { emissive: c, emissiveIntensity: 0.35, roughness: 0.4 });
      group.add(new THREE.Mesh(new THREE.TorusGeometry(1.35 - i * 0.1, 0.052, 8, 48, Math.PI), mat));
      return mat;
    });
    const water = std('#4fb3c8', { roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.8 });
    for (const side of [-1, 1]) {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24), water);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(side * 1.05, 0.025, 0);
      group.add(puddle);
    }
    const hit = ctx.hit(new THREE.CylinderGeometry(1.4, 1.4, 1.6, 10), 0.8);
    group.add(hit);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 1.9, 0),
      reach: 1.7,
      update(dt, t, near) {
        bands.forEach((m, i) => {
          m.emissiveIntensity = 0.35 + near * (REDUCED_MOTION ? 0.6 : 0.6 + 0.6 * Math.sin(t * 4 - i * 0.7));
        });
      },
    };
  },

  /** 会融化的冰块：一大块冰，人走近就慢慢化开，露出里面的小花；走开又慢慢冻回去 */
  'thaw-ice'(ctx) {
    const group = new THREE.Group();
    const iceGeo = new THREE.DodecahedronGeometry(0.62, 0);
    iceGeo.translate(0, 0.62, 0);
    const iceMat = std('#cfeeff', { roughness: 0.1, emissive: '#4cc9f0', emissiveIntensity: 0.35, transparent: true, opacity: 0.6, flatShading: true, depthWrite: false });
    const ice = new THREE.Mesh(iceGeo, iceMat);
    ice.scale.set(1.1, 1.25, 1.1);
    ice.rotation.y = ctx.rand() * 3;
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 32), std('#8fdcf2', { roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.7 }));
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.y = 0.025;
    const flower = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.6, 6), std('#3f9e5a'));
    stem.position.y = 0.3;
    flower.add(stem);
    const petal = std('#ff8fc8', { emissive: '#ff5fa8', emissiveIntensity: 0.25, roughness: 0.5 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = new THREE.Mesh(ball(0.09, 10, 8), petal);
      p.scale.set(1, 0.5, 1);
      p.position.set(Math.cos(a) * 0.11, 0.62, Math.sin(a) * 0.11);
      flower.add(p);
    }
    const middle = new THREE.Mesh(ball(0.065, 10, 8), glow('#ffd166', 1.3));
    middle.position.y = 0.64;
    flower.add(middle);
    group.add(puddle, flower, ice);
    let melt = 0;
    const hit = ctx.hit(new THREE.CylinderGeometry(1.0, 1.0, 1.6, 10), 0.8);
    group.add(hit);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 1.95, 0),
      reach: 1.5,
      update(dt, t, near) {
        const goal = near > 0.55 ? 1 : 0;
        melt += (goal - melt) * Math.min(1, dt * (goal ? 0.9 : 0.25));
        if (REDUCED_MOTION) melt = goal;
        const k = 1 - melt * 0.82;
        ice.scale.set(1.1 * k, 1.25 * k * k, 1.1 * k);
        iceMat.opacity = 0.6 * (1 - melt * 0.5);
        puddle.scale.setScalar(0.35 + melt * 0.75);
        flower.scale.setScalar(0.75 + melt * 0.55);
        flower.rotation.y = REDUCED_MOTION ? 0 : Math.sin(t * 1.5) * 0.3 * melt;
      },
    };
  },

  /** 放烟花的花：一丛花苞，隔一会儿就有一个飞上天，炸成一朵小烟花；人走近放得更勤 */
  'firework-flowers'(ctx) {
    const group = new THREE.Group();
    const stemMat = std('#4f8f3f');
    const palettes = [['#ff5d5d', '#ffd166'], ['#4cc9f0', '#ffffff'], ['#b388ff', '#ff7eb6'], ['#80ed99', '#ffd166']];
    const buds = Array.from({ length: 7 }, (_, i) => {
      const a = i * 2.4 + ctx.rand();
      const d = i === 0 ? 0 : 0.3 + ctx.rand() * 0.5;
      const h = 0.6 + ctx.rand() * 0.5;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, h, 6), stemMat);
      s.position.set(x, h / 2, z);
      group.add(s);
      const colors = palettes[i % palettes.length];
      const mesh = new THREE.Mesh(ball(0.11, 12, 10), glow(colors[0], 1.2));
      mesh.position.set(x, h + 0.06, z);
      group.add(mesh);
      return { mesh, colors, grow: 1, ph: ctx.rand() * 6 };
    });
    const sparks = Array.from({ length: 3 }, () => {
      const m = new THREE.Mesh(ball(0.07, 10, 8), glow('#ffffff', 2));
      m.visible = false;
      group.add(m);
      return { m, k: -1, bud: null };
    });
    let next = 1.2;
    const hit = ctx.hit(new THREE.CylinderGeometry(1.0, 1.0, 1.4, 10), 0.7);
    group.add(hit);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 1.7, 0),
      reach: 1.4,
      update(dt, t, near) {
        next -= dt * (1 + near * 2.5);
        const spark = sparks.find((s) => s.k < 0);
        const ready = buds.filter((b) => b.grow >= 1);
        if (next <= 0 && spark && ready.length && !REDUCED_MOTION) {
          next = 0.9 + ctx.rand() * 1.6;
          spark.bud = ready[(ctx.rand() * ready.length) | 0];
          spark.bud.grow = 0;
          spark.k = 0;
          spark.m.visible = true;
        }
        for (const b of buds) {
          b.grow = Math.min(1, b.grow + dt * 0.45);
          b.mesh.scale.setScalar((0.2 + 0.8 * b.grow) * (1 + near * 0.12 * Math.sin(t * 5 + b.ph)));
        }
        for (const s of sparks) {
          if (s.k < 0) continue;
          s.k += dt / 0.8;
          const from = s.bud.mesh.position;
          s.m.position.set(from.x, from.y + (1 - (1 - Math.min(1, s.k)) ** 2) * 2.4, from.z);
          if (s.k >= 1) {
            ctx.burst(group, s.m.position.clone(), s.bud.colors);
            s.k = -1;
            s.m.visible = false;
          }
        }
      },
    };
  },

  /** 会长大的南瓜：一片南瓜田，人走近南瓜就一个个鼓起来；走开又慢慢缩回去 */
  'pumpkin-patch'(ctx) {
    const group = new THREE.Group();
    // 南瓜：压扁的球，按经度挤出 8 道棱
    const geo = ball(1, 32, 16);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const k = 1 - 0.09 * Math.abs(Math.sin(Math.atan2(z, x) * 4));
      p.setXYZ(i, x * k, p.getY(i) * 0.72, z * k);
    }
    geo.computeVertexNormals();
    geo.translate(0, 0.66, 0);
    const orange = std('#f28c28', { roughness: 0.55, emissive: '#c4561a', emissiveIntensity: 0.15 });
    const stalk = std('#6b8f3a', { roughness: 0.8 });
    const pumpkins = [[0, 0, 0.42], [0.8, 0.35, 0.26], [-0.68, 0.48, 0.3], [0.2, -0.8, 0.22], [-0.52, -0.58, 0.2]].map(([x, z, s], i) => {
      const pk = new THREE.Group();
      pk.position.set(x, 0, z);
      pk.rotation.y = ctx.rand() * 3;
      const body = new THREE.Mesh(geo, orange);
      pk.add(body);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.28, 6), stalk);
      top.position.set(0, 1.42, 0);
      top.rotation.z = 0.25;
      pk.add(top);
      pk.scale.setScalar(s);
      group.add(pk);
      return { pk, s, i };
    });
    const leaf = std('#4f9e48', { side: THREE.DoubleSide, roughness: 0.7 });
    const leafGeo = new THREE.CircleGeometry(0.2, 7);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + ctx.rand() * 0.4;
      const r = 0.55 + ctx.rand() * 0.6;
      const l = new THREE.Mesh(leafGeo, leaf);
      l.rotation.set(-Math.PI / 2 + (ctx.rand() - 0.5) * 0.5, 0, ctx.rand() * 6);
      l.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
      group.add(l);
    }
    let grow = 0;
    const hit = ctx.hit(new THREE.CylinderGeometry(1.25, 1.25, 1.3, 10), 0.65);
    group.add(hit);
    return {
      group,
      hits: [hit],
      bubbleAt: new THREE.Vector3(0, 1.9, 0),
      reach: 1.6,
      update(dt, t, near) {
        const goal = near > 0.55 ? 1 : 0;
        grow += (goal - grow) * Math.min(1, dt * (goal ? 1.4 : 0.5));
        if (REDUCED_MOTION) grow = goal;
        for (const { pk, s, i } of pumpkins) {
          // 一个接一个鼓起来，鼓的时候轻轻弹一下
          const g = clamp01(grow * 1.6 - i * 0.15);
          const wobble = REDUCED_MOTION ? 0 : Math.sin(t * 6 + i) * 0.05 * g * (1 - g);
          pk.scale.set(s * (1 + g * 0.55 + wobble), s * (1 + g * 0.55 - wobble), s * (1 + g * 0.55 + wobble));
        }
      },
    };
  },
};

/** 章节里有、但还没做专门模型的发现物：一簇发光的水晶，颜色跟着地带 */
function mysteryCrystals(ctx, color) {
  const group = new THREE.Group();
  const mat = std(color, { emissive: color, emissiveIntensity: 0.8, roughness: 0.2, flatShading: true });
  const geo = new THREE.OctahedronGeometry(1, 0);
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(geo, mat);
    const s = 0.14 + ctx.rand() * 0.1;
    c.scale.set(s, s * 2.4, s);
    c.position.set(Math.cos(i * 1.6) * 0.25 * (i ? 1 : 0), s * 1.2, Math.sin(i * 1.6) * 0.25 * (i ? 1 : 0));
    group.add(c);
  }
  const hit = ctx.hit(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 10), 0.6);
  group.add(hit);
  return { group, hits: [hit], bubbleAt: new THREE.Vector3(0, 1.3, 0), reach: 1.2, update() {} };
}

// ---------- 布景 ----------

/** 布景的几何体和颜色；同一种布景在一个地带里用一个 InstancedMesh */
function decorKinds(zone) {
  const zc = new THREE.Color(zone.color);
  const lighter = (k) => zc.clone().lerp(new THREE.Color('#ffffff'), k);
  const darker = (k) => zc.clone().lerp(new THREE.Color('#10131f'), k);
  const blades = () => {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.ConeGeometry(0.05, 0.5 + (i % 2) * 0.15, 4);
      g.translate(0, 0.25, 0);
      g.rotateZ((i - 1.5) * 0.28);
      g.rotateY(i * 1.7);
      parts.push(g);
    }
    return mergeGeometries(parts);
  };
  const lift = (g, y) => g.translate(0, y, 0);
  const canopy = zone.id === 'leaves' ? ['#e8743b', '#f2a541', '#c8452c', '#f6c453'] : ['#2f9e8f', '#3fb59a', '#2a7f86', '#4cc08f'];
  return {
    grass: { parts: [[blades(), std('#ffffff', { roughness: 0.8 })]], colors: [lighter(0.35), lighter(0.15), zc.clone().lerp(new THREE.Color('#80ed99'), 0.3)], scale: [0.8, 1.4] },
    rock: { parts: [[lift(new THREE.DodecahedronGeometry(0.3, 0), 0.1), std('#ffffff', { roughness: 0.9, flatShading: true })]], colors: [darker(0.45), darker(0.6)], scale: [0.5, 1.3] },
    mound: { parts: [[new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1), std('#ffffff', { roughness: 0.95 })]], colors: [lighter(0.12), darker(0.08)], scale: [0.6, 1.5] },
    tree: {
      parts: [
        [lift(new THREE.CylinderGeometry(0.08, 0.12, 0.9, 6), 0.45), std('#ffffff', { roughness: 0.9 }), '#6b4a2e'],
        [lift(new THREE.IcosahedronGeometry(0.55, 0), 1.25), std('#ffffff', { roughness: 0.8, flatShading: true })],
      ],
      colors: canopy.map((c) => new THREE.Color(c)),
      scale: [0.8, 1.35],
      solid: 0.35,
    },
    bush: { parts: [[lift(new THREE.IcosahedronGeometry(0.35, 0), 0.2), std('#ffffff', { roughness: 0.85, flatShading: true })]], colors: canopy.map((c) => new THREE.Color(c)), scale: [0.7, 1.2] },
    drift: { parts: [[new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1), std('#ffffff', { roughness: 0.95 })]], colors: [new THREE.Color('#f4f8ff'), new THREE.Color('#e3ecff')], scale: [0.5, 1.3] },
    crystal: {
      parts: [[lift(new THREE.OctahedronGeometry(0.2, 0).scale(1, 2.3, 1), 0.38), std('#ffffff', { emissive: '#4cc9f0', emissiveIntensity: 0.8, roughness: 0.2, flatShading: true })]],
      colors: [new THREE.Color('#bfefff'), new THREE.Color('#9be7ff')],
      scale: [0.6, 1.4],
    },
    pile: { parts: [[lift(new THREE.ConeGeometry(0.42, 0.22, 7), 0.11), std('#ffffff', { roughness: 0.8, flatShading: true })]], colors: canopy.map((c) => new THREE.Color(c)), scale: [0.7, 1.2] },
  };
}

// ---------- 天气粒子：在小宇航员周围生成，飘的样子跟着所在的地带 ----------

const FX = {
  wind: { line: true, color: '#dfefff', k: 0.75, life: [0.8, 1.4], h: [0.3, 2.4] },
  uprain: { line: true, color: '#9fdcff', k: 0.95, life: [0.9, 1.3], h: [0, 1.5] },
  motes: { line: false, color: '#ffd98a', k: 1.25, life: [3, 5], h: [0.2, 2.6] },
  upsnow: { line: false, color: '#ffffff', k: 1, life: [4, 6], h: [0, 1.2] },
  leaves: { line: false, colors: ['#ff9f43', '#ffcf5c', '#e8573f'], k: 0.9, life: [4.5, 6.5], h: [3, 4.4] },
};

class Weather {
  constructor(root, zones) {
    this.zones = zones;
    this.group = new THREE.Group();
    this.group.visible = false;
    root.add(this.group);
    const make = (n, line) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * (line ? 6 : 3)), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * (line ? 6 : 3)), 3));
      const common = { vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
      const obj = line
        ? new THREE.LineSegments(geo, new THREE.LineBasicMaterial(common))
        : new THREE.Points(geo, new THREE.PointsMaterial({ ...common, size: 0.13, map: dotTexture() }));
      obj.frustumCulled = false;
      this.group.add(obj);
      return { obj, line, list: Array.from({ length: n }, () => ({ p: new THREE.Vector3(), kind: null, age: 1, life: 0, c: new THREE.Color(), ph: Math.random() * 6 })) };
    };
    this.pools = [make(170, false), make(90, true)];
    this.wind = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.sway = new THREE.Vector3();
  }

  #spawn(s, line, center, fwd, right) {
    s.age = 0;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 8.5;
    const p = s.p.copy(center).addScaledVector(fwd, Math.cos(a) * r + 2.2).addScaledVector(right, Math.sin(a) * r).normalize();
    const zone = homeness(colatOf(p)) > Math.random() ? null : this.#pick(p);
    const fx = zone && FX[zone.look.fx];
    if (!fx || fx.line !== line) {
      s.kind = null;
      s.life = 0.3;
      return;
    }
    s.kind = fx;
    s.life = fx.life[0] + Math.random() * (fx.life[1] - fx.life[0]);
    p.multiplyScalar(R + fx.h[0] + Math.random() * (fx.h[1] - fx.h[0]));
    s.c.set(fx.colors ? fx.colors[(Math.random() * fx.colors.length) | 0] : fx.color).multiplyScalar(fx.k);
  }

  #pick(p) {
    const { a, b, t } = this.zones.mix(lonOf(p), 0.2);
    return Math.random() < t ? b : a;
  }

  update(dt, t, astroPos, fwd, right) {
    for (const pool of this.pools) {
      const pos = pool.obj.geometry.attributes.position.array;
      const col = pool.obj.geometry.attributes.color.array;
      for (let i = 0; i < pool.list.length; i++) {
        const s = pool.list[i];
        s.age += REDUCED_MOTION ? 0 : dt;
        if (s.age >= s.life || s.p.distanceTo(astroPos) > 10) this.#spawn(s, pool.line, astroPos, fwd, right);
        const k = s.kind;
        const up = this.up.copy(s.p).normalize();
        let e = 0;
        if (k) {
          e = REDUCED_MOTION ? 0.7 : Math.sin(Math.PI * clamp01(s.age / s.life));
          e *= 1 - smooth(7, 9.5, s.p.distanceTo(astroPos));
          if (!REDUCED_MOTION) this.#move(s, up, dt, t);
        }
        const r = s.c.r * e;
        const g = s.c.g * e;
        const b = s.c.b * e;
        // 直接写进数组：每一帧几百个粒子，不再每个都新建一个临时数组
        if (pool.line) {
          const len = k === FX.wind ? 0.7 : 0.32;
          const dir = k === FX.wind ? this.#windAt(up) : up;
          const j = i * 6;
          pos[j] = s.p.x;
          pos[j + 1] = s.p.y;
          pos[j + 2] = s.p.z;
          pos[j + 3] = s.p.x - dir.x * len;
          pos[j + 4] = s.p.y - dir.y * len;
          pos[j + 5] = s.p.z - dir.z * len;
          col[j] = r;
          col[j + 1] = g;
          col[j + 2] = b;
          col[j + 3] = col[j + 4] = col[j + 5] = 0;
        } else {
          const j = i * 3;
          pos[j] = s.p.x;
          pos[j + 1] = s.p.y;
          pos[j + 2] = s.p.z;
          col[j] = r;
          col[j + 1] = g;
          col[j + 2] = b;
        }
      }
      pool.obj.geometry.attributes.position.needsUpdate = true;
      pool.obj.geometry.attributes.color.needsUpdate = true;
    }
  }

  /** 风往东吹（绕着星球的竖轴） */
  #windAt(up) {
    this.wind.crossVectors(Y, up);
    if (this.wind.lengthSq() < 0.01) this.wind.set(1, 0, 0);
    return this.wind.normalize();
  }

  #move(s, up, dt, t) {
    const k = s.kind;
    if (k === FX.wind) s.p.addScaledVector(this.#windAt(up), dt * 6);
    else if (k === FX.uprain) s.p.addScaledVector(up, dt * 5);
    else {
      const sway = this.sway.copy(this.#windAt(up)).multiplyScalar(Math.sin(t * 1.4 + s.ph) * (k === FX.leaves ? 0.7 : 0.25));
      s.p.addScaledVector(sway, dt).addScaledVector(up, dt * (k === FX.motes ? 0.25 : k === FX.upsnow ? 0.6 : -0.65));
      // 落叶落到地上就换一片
      if (k === FX.leaves && s.p.length() < R + 0.05) s.age = s.life;
    }
  }
}

// ---------- 闲逛模式 ----------

/**
 * 事件：'discover' { id }（走到发现物跟前）、'zone' { zone }（进了另一个地带，着陆区是 null）、'walk'（开始往新的地方走）
 */
export class BixExplore extends EventTarget {
  /** stage：BixStage；host：HomeworkScene；chapter：章节（要有 explore）；found：已经收进图鉴的发现物 id */
  constructor(stage, host, chapter, found = []) {
    super();
    this.stage = stage;
    this.host = host;
    this.root = stage.root;
    this.zones = new ZoneMap(chapter.explore.zones);
    this.found = new Set(found);
    this.out = false;
    this.time = 0;
    let seed = 20261020;
    this.rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.hitMat = new THREE.MeshBasicMaterial({ visible: false });

    stage.setGroundTexture(groundTexture(this.zones, chapter.surface?.ground));

    // 着陆区里不能穿过去的东西：飞船、站点、通往下一层的门和旁边的气象塔
    this.obstacles = [{ dir: siteDir(0, 0), r: 0.75 }];
    for (const s of [...Object.values(STATION_SPOTS), ...EXTRA_SPOTS]) this.obstacles.push({ dir: siteDir(s.x, s.z), r: 0.85 });
    // 门和气象塔挨得很近，中间的缝走不过去：当成一个包住两样的大障碍物，绕着走，不会卡在缝里
    const gap = Math.hypot(DOOR_SPOT.x - TOWER_SPOT.x, DOOR_SPOT.z - TOWER_SPOT.z);
    this.obstacles.push({ dir: siteDir((DOOR_SPOT.x + TOWER_SPOT.x) / 2, (DOOR_SPOT.z + TOWER_SPOT.z) / 2), r: gap / 2 + 1.25 });

    this.#buildDiscoveries(chapter.explore.discoveries || []);
    this.#buildDecor();
    this.weather = new Weather(this.root, this.zones);

    // 跟着人走的灯：从人的身后右上方照过来，颜色跟着地带变
    this.sun = new THREE.DirectionalLight('#ffffff', 0);
    this.sunTarget = new THREE.Object3D();
    this.ambient = new THREE.AmbientLight('#ffffff', 0);
    this.root.add(this.sun, this.sunTarget, this.ambient);
    this.sun.target = this.sunTarget;
    this.bg0 = host.scene.background.clone();
    // 太空场景的灯是从固定方向照的，走到星球背面会很暗：闲逛时调暗，主要靠跟着人走的灯
    this.hostLights = [host.hemiLight, host.sunLight].filter(Boolean).map((light) => ({ light, base: light.intensity }));
    this.outness = 0;
    this.skyColor = new THREE.Color();
    this.lightColor = new THREE.Color();
    this.sunWeight = 0;

    // 小宇航员和 Zib
    this.astro = buildAstronaut();
    const { gear, heat } = buildGear(this.astro);
    this.gear = gear;
    this.heat = heat;
    this.feel = null;
    this.feelT = 0;
    this.root.add(this.astro.group);
    this.astro.hit.userData.astronaut = true;
    stage.zib.group.add(blobShadow(0.42));
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.camFwd = new THREE.Vector3();
    this.zibPos = new THREE.Vector3();
    this.zibFwd = new THREE.Vector3();
    this.target = null;
    this.speed = 0;
    this.zone = null;
    this.talk = 0;
    this.framing = null;
    // 每一帧算好的：人在哪儿（相对球心）、镜头在哪儿（相对球心）、天气粒子用的左右方向
    this.astroAt = new THREE.Vector3();
    this.camAt = new THREE.Vector3();
    this.side = new THREE.Vector3();
    this.#placeHome();

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.32, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166').multiplyScalar(2), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.marker.visible = false;
    this.root.add(this.marker);
    this.markerT = 1;
  }

  // ---------- 对外接口 ----------

  /** 从地图出发：Zib 离开着陆点跟上来，小宇航员转身朝着天气地带 */
  enter() {
    this.out = true;
    this.stage.freeZib(true);
    this.zibPos.copy(this.stage.zib.group.position).normalize();
    tangentOf(this.zibPos, v1.copy(this.pos).sub(this.zibPos), this.zibFwd);
    tangentOf(this.pos, v1.set(0, 0, -1), this.fwd);
    this.camFwd.copy(this.fwd);
    this.astro.group.visible = true;
    this.weather.group.visible = true;
    this.zone = undefined;
  }

  /** 回着陆点：人和 Zib 闪一下不见了，镜头飞回地图以后再出现在发射台旁边 */
  leave() {
    if (!this.out) return;
    this.out = false;
    this.target = null;
    this.speed = 0;
    this.zibStage = null;
    this.framing = null;
    const burst = (obj) => this.host.particles.emit(obj.getWorldPosition(v1).addScaledVector(this.pos, 0.8), { count: 50, colors: ['#ffd166', '#7cc8ff', '#ffffff'], speed: 2.2, gravity: 0, life: 0.9 });
    burst(this.astro.group);
    burst(this.stage.zib.group);
    this.astro.group.visible = false;
    this.stage.zib.target = 0;
    this.stage.talking = false;
    this.weather.group.visible = false;
    for (const d of this.discoveries) if (d.part.follows) this.#dock(d);
    this.zone = null;
  }

  /** 镜头回到地图：人站回发射台旁边，Zib 回到原来的地方 */
  arriveHome() {
    this.#placeHome();
    this.astro.group.visible = true;
    this.astro.hop = 1;
    this.stage.freeZib(false);
    this.stage.zib.target = 1;
    this.stage.zib.hop = 1;
  }

  setFound(id) {
    this.found.add(id);
    const d = this.discoveries.find((x) => x.id === id);
    if (d) d.bubble.element.firstChild.textContent = d.data.emoji;
  }

  /** 身上穿着哪些衣服（Set，衣柜里东西的 id）；没有模型的 id 不管 */
  setOutfit(ids) {
    for (const [id, parts] of Object.entries(this.gear)) for (const p of parts) p.visible = ids.has(id);
  }

  /** 穿得不对时的样子：'cold' 发抖、呼白气，'wet' 脚下溅水，'hot' 冒汗、头盔发红；null 是穿对了或者这里穿什么都行 */
  setFeel(kind) {
    this.feel = kind || null;
    this.feelT = 0;
  }

  /** 拖动屏幕：镜头绕着人转（弧度） */
  orbit(angle) {
    if (!this.out) return;
    q1.setFromAxisAngle(this.pos, -angle);
    this.camFwd.applyQuaternion(q1);
  }

  /** 点了屏幕：点中发现物就走过去看，点中地面就走到那里；返回点中了什么 */
  click(raycaster) {
    const what = this.#pickAt(raycaster);
    if (!what || !this.out) return what && what.type;
    if (what.type === 'discovery') this.goTo(what.d);
    else if (what.type === 'ground') this.walkTo(what.dir);
    return what.type;
  }

  /** 鼠标移上去的时候：点中的是什么（用来改鼠标样式） */
  hover(raycaster) {
    return this.#pickAt(raycaster)?.type || null;
  }

  walkTo(dir, onArrive = null, stop = 0) {
    this.target = { dir: dir.clone().normalize(), onArrive, stop, best: Infinity, stuck: 0, detour: null, detours: 0, side: 0 };
    this.zibStage = null;
    this.framing = null;
    this.#mark(this.target.dir);
    this.dispatchEvent(new CustomEvent('walk'));
  }

  /** 走到发现物跟前：到了以后转身看它，Zib 跑过来说话 */
  goTo(d) {
    if (d.following) {
      this.#discover(d);
      return;
    }
    this.walkTo(d.dir, () => this.#discover(d), d.part.reach ?? 1.4);
  }

  /**
   * 第三人称镜头的目标（世界坐标）：人身后上方，看着人前面一点的地面。
   * 看发现物的时候，镜头转到侧后方，看着人和发现物中间，三个都拍进来
   */
  cameraGoal(aspect, pos, look, up) {
    const s = THREE.MathUtils.clamp(1.15 / aspect, 1, 1.7);
    const base = v1.copy(this.pos).multiplyScalar(R);
    if (this.framing) {
      // 竖屏左右很窄：再退远一些，三个都装得下
      const f = THREE.MathUtils.clamp(1.15 / aspect, 1, 2.2);
      look.copy(base).lerp(this.framing.at, 0.5).addScaledVector(this.pos, this.framing.y);
      pos.copy(look).addScaledVector(this.pos, 2.6 + f * 0.9).addScaledVector(this.camFwd, -5.4 * f);
    } else {
      pos.copy(base).addScaledVector(this.pos, 3.2 + s * 0.8).addScaledVector(this.camFwd, -4.6 * s);
      look.copy(base).addScaledVector(this.pos, 0.4).addScaledVector(this.camFwd, 2.2);
    }
    up.copy(this.pos);
    pos.add(this.root.position);
    look.add(this.root.position);
  }

  /** 每一帧：走路、Zib、发现物、天气、灯光 */
  update(dt, t, camera) {
    this.time += dt;
    if (this.out) {
      this.#walk(dt);
      this.#updateZib(dt);
      this.#followCamera(dt);
      this.#checkZone();
    }
    this.astroAt.copy(this.pos).multiplyScalar(R);
    this.camAt.copy(camera.position).sub(this.root.position);
    this.#animateAstro(dt, t);
    if (this.out) this.#updateFeel(dt);
    this.#updateDiscoveries(dt, t);
    this.#updateLights(dt);
    if (this.out) this.weather.update(dt, t, this.astroAt, this.camFwd, this.side.crossVectors(this.camFwd, this.pos));
    if (this.markerT < 1) {
      this.markerT = Math.min(1, this.markerT + dt * 1.4);
      this.marker.scale.setScalar(1 + this.markerT * 1.2);
      this.marker.material.opacity = 1 - this.markerT;
      this.marker.visible = this.markerT < 1;
    }
    if (this.talk > 0) {
      this.talk -= dt;
      if (this.talk <= 0) this.stage.talking = false;
    }
  }

  /** 摆好相机以后：发现物头上的小气泡只在附近、而且没被星球挡住时显示；着陆区的雨在地带里淡掉 */
  afterCamera(camera) {
    this.camAt.copy(camera.position).sub(this.root.position);
    this.astroAt.copy(this.pos).multiplyScalar(R);
    for (const d of this.discoveries) {
      const p = d.bubble.getWorldPosition(v3).sub(this.root.position);
      d.bubble.visible = this.out && p.distanceTo(this.astroAt) < BUBBLE_RANGE && !occluded(this.camAt, p);
    }
    const rain = this.stage.rain;
    rain.material.opacity = 0.45 * (this.out ? homeness(colatOf(this.pos)) : 1);
    if (rain.material.opacity < 0.02) rain.visible = false;
  }

  dispose() {
    this.host.scene.background.copy(this.bg0);
    for (const { light, base } of this.hostLights) light.intensity = base;
    this.stage.rain.material.opacity = 0.45;
    // 模型挂在 BixStage.root 上，跟着布景一起释放
  }

  // ---------- 搭建 ----------

  #buildDiscoveries(list) {
    const ctx = {
      rand: this.rand,
      hit: (geo, y) => {
        const m = new THREE.Mesh(geo, this.hitMat);
        m.position.y = y;
        return m;
      },
      pop: (group, local) => {
        if (Math.random() > 0.5) return;
        this.host.particles.emit(group.localToWorld(local), { count: 10, colors: ['#ffd166', '#ffffff', '#7cc8ff'], speed: 1.3, gravity: 0, life: 0.8 });
      },
      /** 一朵小烟花：没有重力（星球上的“下”不是世界坐标的 -y），靠阻力停下来 */
      burst: (group, local, colors) => {
        this.host.particles.emit(group.localToWorld(local), { count: 36, colors, speed: 2.6, gravity: 0, life: 1.1, drag: 0.93 });
      },
    };
    this.discoveries = list.map((data) => {
      const zone = this.zones.byId.get(data.zone);
      // model：借用一个已有的模型（比如新的一层的发现物借用风车花）；都没有就是一簇水晶
      const build = DISCOVERY_BUILDERS[data.model || data.id];
      const part = build ? build(ctx) : mysteryCrystals(ctx, zone?.color || '#b388ff');
      const dir = dirAt(data.at[0], data.at[1]);
      plant(part.group, dir, this.rand() * Math.PI * 2);
      this.root.add(part.group);
      for (const h of part.hits) h.userData.discovery = data.id;

      // 走近时地上亮起一圈光
      const ring = new THREE.Mesh(
        new THREE.RingGeometry((part.reach ?? 1.4) - 0.1, (part.reach ?? 1.4) + 0.05, 48),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166').multiplyScalar(2), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      part.group.add(ring);

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'find-bubble';
      el.innerHTML = '<span></span>';
      el.firstChild.textContent = this.found.has(data.id) ? data.emoji : '❔';
      el.setAttribute('aria-label', `去看看${this.found.has(data.id) ? data.zh : '这是什么'}`);
      const bubble = new CSS2DObject(el);
      bubble.position.copy(part.bubbleAt);
      (part.bubbleParent || part.group).add(bubble);
      bubble.visible = false;
      const d = { id: data.id, data, part, dir, ring, bubble, near: 0, chimed: false, following: false };
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.out) this.goTo(d);
      });
      return d;
    });
    this.hitList = this.discoveries.flatMap((d) => d.part.hits);
  }

  #buildDecor() {
    const avoid = this.discoveries.map((d) => d.dir);
    // 着陆区边上的障碍物（飞船、站点、门和气象塔）旁边不种树，不然中间会留下走不过去的窄缝
    const site = [...this.obstacles];
    const placed = [];
    for (const zone of this.zones.list) {
      const kinds = decorKinds(zone);
      const [lo, hi] = this.zones.range(zone);
      const items = new Map();
      for (let n = 0; n < 60; n++) {
        const lon = lo + 3 + this.rand() * (hi - lo - 6);
        // 在球面上均匀撒：cos(余纬) 均匀分布
        const top = Math.cos((HOME_COLAT + 6) * DEG);
        const bottom = Math.cos(172 * DEG);
        const colat = Math.acos(top + this.rand() * (bottom - top)) / DEG;
        const dir = dirAt(90 - colat, lon);
        if (avoid.some((a) => a.distanceTo(dir) * R < 2.6) || placed.some((p) => p.distanceTo(dir) * R < 1.5)) continue;
        if (site.some((o) => o.dir.distanceTo(dir) * R < o.r + 1.6)) continue;
        placed.push(dir);
        const kind = zone.look.decor[(this.rand() * zone.look.decor.length) | 0];
        if (!kinds[kind]) continue;
        if (!items.has(kind)) items.set(kind, []);
        const k = kinds[kind];
        const s = k.scale[0] + this.rand() * (k.scale[1] - k.scale[0]);
        items.get(kind).push({ dir, s, yaw: this.rand() * Math.PI * 2, color: k.colors[(this.rand() * k.colors.length) | 0] });
        if (k.solid) this.obstacles.push({ dir, r: k.solid * s });
      }
      const obj = new THREE.Object3D();
      for (const [kind, list] of items) {
        for (const [geo, mat, fixed] of kinds[kind].parts) {
          const mesh = new THREE.InstancedMesh(geo, mat, list.length);
          list.forEach((it, i) => {
            plant(obj, it.dir, it.yaw, -0.02 * it.s);
            obj.scale.setScalar(it.s);
            obj.updateMatrix();
            mesh.setMatrixAt(i, obj.matrix);
            mesh.setColorAt(i, fixed ? c1.set(fixed) : it.color);
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          this.root.add(mesh);
        }
      }
    }
  }

  #placeHome() {
    siteDir(ASTRO_HOME.x, ASTRO_HOME.z, this.pos);
    tangentOf(this.pos, v1.set(0, 0, 1), this.fwd);
    this.camFwd.copy(this.fwd);
    stand(this.astro.group, this.pos, this.fwd);
  }

  // ---------- 每一帧 ----------

  #walk(dt) {
    const tg = this.target;
    if (!tg) {
      this.speed = 0;
      stand(this.astro.group, this.pos, this.fwd);
      return;
    }
    const p = this.pos;
    const ang = p.angleTo(tg.dir);
    const stop = tg.stop / R;
    if (ang <= stop + 1e-4 || REDUCED_MOTION) {
      if (REDUCED_MOTION && ang > stop) this.#rotateAlong(p, tg.dir, ang - stop);
      return this.#arrive();
    }
    // 朝着目标走；前面有飞船、站点、大树挡着，就往旁边绕。正在绕路时沿着挡路的东西的边走
    const toward = tangentOf(p, v1.copy(tg.dir).sub(p), v2);
    const move = tg.detour ? this.#around(p, tg) : this.#steer(p, toward);
    this.speed = Math.min(WALK_SPEED, this.speed + dt * 6);
    const align = this.fwd.dot(move);
    const step = Math.min(ang - stop, (this.speed * clamp01(0.3 + align) * dt) / R);
    p.addScaledVector(move, step).normalize();
    this.#pushOut(p);
    this.#turn(this.fwd, p, move, dt * 9);
    const left = p.angleTo(tg.dir);
    if (tg.detour) {
      // 绕完这一段：从现在的位置重新算有没有走近
      if ((tg.detour.t -= dt) <= 0) {
        tg.detour = null;
        tg.best = left;
        tg.stuck = 0;
      }
    } else if (left < tg.best - 0.0005) {
      tg.best = left;
      tg.stuck = 0;
    } else if ((tg.stuck += dt) > 0.6) {
      // 半天走不近：两个挨着的东西中间常常会卡住，沿着最近的那个绕一段（先往目标那边绕，不行再换一边）；
      // 绕了几次还不行，或者点在了飞船里面这种走不到的地方，就停下来
      if (tg.detours < 4 && !this.#unreachable(tg.dir)) {
        tg.detours += 1;
        tg.side = tg.side ? -tg.side : 0;
        tg.detour = { t: 1.3, o: this.#nearest(p) };
        tg.toward = toward.clone();
        tg.stuck = 0;
      } else {
        this.target = null;
      }
    }
    stand(this.astro.group, p, this.fwd);
  }

  /** 离得最近的障碍物（按到边的距离） */
  #nearest(p) {
    let near = null;
    let best = Infinity;
    for (const o of this.obstacles) {
      const d = p.distanceTo(o.dir) * R - o.r;
      if (d < best) {
        best = d;
        near = o;
      }
    }
    return near;
  }

  /** 绕路：沿着开始绕路时最近的那个障碍物的边走（tg.side 是往哪边绕，第一次选离目标近的那边）。中途不换障碍物，不然会原地来回晃 */
  #around(p, tg) {
    const near = tg.detour.o;
    if (!near) return tg.toward;
    const toObstacle = tangentOf(p, v3.copy(near.dir).sub(p), v4);
    const along = v5.crossVectors(p, toObstacle).normalize();
    if (!tg.side) tg.side = along.dot(tg.toward) >= 0 ? 1 : -1;
    return along.multiplyScalar(tg.side);
  }

  /** 目标在障碍物里面（或者紧贴着）：走不到 */
  #unreachable(dir) {
    return this.obstacles.some((o) => dir.distanceTo(o.dir) * R < o.r + 0.3);
  }

  #arrive() {
    const tg = this.target;
    this.target = null;
    this.speed = 0;
    stand(this.astro.group, this.pos, this.fwd);
    tg.onArrive?.();
  }

  #rotateAlong(p, toward, angle) {
    const axis = v1.crossVectors(p, toward);
    if (axis.lengthSq() < 1e-10) return;
    q1.setFromAxisAngle(axis.normalize(), angle);
    p.applyQuaternion(q1).normalize();
    tangentOf(p, this.fwd.applyQuaternion(q1), this.fwd);
  }

  /** 走路方向 move（p 处的切线方向）遇到前面的障碍物时往旁边拐；改的是 move，返回 move */
  #steer(p, move) {
    const add = v3.set(0, 0, 0);
    for (const o of this.obstacles) {
      const rel = v4.copy(o.dir).sub(p).multiplyScalar(R);
      rel.addScaledVector(p, -rel.dot(p));
      const dist = rel.length();
      const look = o.r + 2.2;
      const ahead = rel.dot(move);
      if (dist > look || ahead <= 0) continue;
      const lateral = rel.addScaledVector(move, -ahead);
      const side = lateral.length();
      const clear = o.r + 0.5;
      if (side >= clear) continue;
      // 障碍物在正前方时往右绕；否则往离它远的那一边绕
      const away = side > 1e-3 ? lateral.multiplyScalar(-1 / side) : v5.crossVectors(move, p).normalize();
      add.addScaledVector(away, ((clear - side) / clear) * (1 - dist / look) * 3);
    }
    if (add.lengthSq() > 0) tangentOf(p, move.add(add), move);
    return move;
  }

  /** 站得离飞船、站点、大树太近：沿地面推开一点 */
  #pushOut(p) {
    for (const o of this.obstacles) {
      const d = p.distanceTo(o.dir) * R;
      const min = o.r + 0.3;
      if (d >= min || d < 1e-5) continue;
      const away = tangentOf(p, v3.copy(p).sub(o.dir), new THREE.Vector3());
      p.addScaledVector(away, (min - d) / R).normalize();
    }
  }

  /** 把 fwd 在 p 处的切平面里转向 dir，最多转 maxAngle */
  #turn(fwd, p, dir, maxAngle) {
    tangentOf(p, fwd, fwd);
    const angle = fwd.angleTo(dir);
    if (angle < 1e-4) return;
    const sign = Math.sign(v4.crossVectors(fwd, dir).dot(p)) || 1;
    q1.setFromAxisAngle(p, sign * Math.min(angle, maxAngle));
    fwd.applyQuaternion(q1);
    tangentOf(p, fwd, fwd);
  }

  #updateZib(dt) {
    const z = this.stage.zib;
    const zp = this.zibPos;
    // 从人身后看过去的右手边（fwd × up）
    const right = v1.crossVectors(this.fwd, this.pos);
    let goal;
    let face;
    if (this.zibStage) {
      goal = this.zibStage.dir;
      face = tangentOf(zp, v2.copy(this.pos).sub(zp), new THREE.Vector3());
    } else {
      goal = v2.copy(this.pos).multiplyScalar(R).addScaledVector(this.fwd, 0.1).addScaledVector(right, 1.15).normalize();
      face = this.fwd;
    }
    const dist = zp.angleTo(goal) * R;
    if (dist > 0.08) {
      const speed = REDUCED_MOTION ? dist / Math.max(dt, 1e-3) : Math.min(4, dist * 2.6 + 0.4);
      const axis = v3.crossVectors(zp, goal);
      if (axis.lengthSq() > 1e-10) {
        axis.normalize();
        const move = new THREE.Vector3().crossVectors(axis, zp).normalize();
        q1.setFromAxisAngle(axis, Math.min(dist, speed * dt) / R);
        zp.applyQuaternion(q1).normalize();
        this.zibFwd.applyQuaternion(q1);
        this.#pushOut(zp);
        this.#turn(this.zibFwd, zp, move, dt * 8);
      }
      z.walking = dist > 0.25;
    } else {
      z.walking = false;
      this.#turn(this.zibFwd, zp, tangentOf(zp, face, v3), dt * 5);
      if (this.zibStage && !this.zibStage.arrived) {
        this.zibStage.arrived = true;
        z.hop = 1;
        z.wave = 1.6;
      }
    }
    stand(z.group, zp, this.zibFwd);
  }

  /** 走路的时候镜头慢慢转到人身后；不走的时候不动，可以拖动屏幕转着看 */
  #followCamera(dt) {
    tangentOf(this.pos, this.camFwd, this.camFwd);
    if (this.target) this.#turn(this.camFwd, this.pos, this.fwd, dt * 1.6 * (0.3 + this.speed / WALK_SPEED));
  }

  #checkZone() {
    const zone = this.zones.at(this.pos);
    if (zone === this.zone) return;
    this.zone = zone;
    this.dispatchEvent(new CustomEvent('zone', { detail: { zone } }));
  }

  #animateAstro(dt, t) {
    const a = this.astro;
    const moving = this.out && this.target ? this.speed / WALK_SPEED : 0;
    a.walk += (moving - a.walk) * Math.min(1, dt * 8);
    a.phase += dt * 10 * a.walk;
    const swing = Math.sin(a.phase) * 0.75 * a.walk;
    a.legs[0].rotation.x = swing;
    a.legs[1].rotation.x = -swing;
    a.arms[0].rotation.x = -swing * 0.8;
    a.arms[1].rotation.x = swing * 0.8;
    a.hop = Math.max(0, a.hop - dt * 1.6);
    const idle = REDUCED_MOTION ? 0 : Math.sin(t * 2.2) * 0.012;
    a.inner.position.y = Math.abs(Math.sin(a.phase)) * 0.06 * a.walk + idle + Math.sin(a.hop * Math.PI) * 0.35;
    a.head.rotation.y = this.out ? 0 : Math.sin(t * 0.6) * 0.25;
    // 冷得发抖；热得头盔外面一层红光
    const feel = this.out ? this.feel : null;
    a.inner.position.x = feel === 'cold' && !REDUCED_MOTION ? Math.sin(t * 45) * 0.012 : 0;
    const heat = feel === 'hot' ? 0.24 + (REDUCED_MOTION ? 0 : Math.sin(t * 3) * 0.06) : 0;
    this.heat.material.opacity += (heat - this.heat.material.opacity) * Math.min(1, dt * 3);
  }

  /** 穿得不对的时候，身边冒出来的东西：白气、水花、汗珠 */
  #updateFeel(dt) {
    if (!this.feel || REDUCED_MOTION) return;
    this.feelT -= dt;
    if (this.feelT > 0) return;
    const a = this.astro;
    const emit = (at, opts) => this.host.particles.emit(at, { gravity: 0, ...opts });
    if (this.feel === 'cold') {
      this.feelT = 1.1;
      emit(a.head.localToWorld(v4.set(0, -0.06, 0.42)), { count: 8, colors: ['#ffffff', '#dff3ff'], speed: 0.35, life: 1.1, drag: 0.94, intensity: 1.2 });
    } else if (this.feel === 'wet') {
      // 走路的时候溅得多
      this.feelT = a.walk > 0.3 ? 0.3 : 1.0;
      for (const leg of a.legs) emit(leg.localToWorld(v4.set(0, -0.38, 0.05)), { count: 5, colors: ['#9fdcff', '#4fb3c8'], speed: 1.1, life: 0.45, drag: 0.9 });
    } else if (this.feel === 'hot') {
      this.feelT = 0.6;
      emit(a.head.localToWorld(v4.set((Math.random() - 0.5) * 0.3, 0.26, 0.1)), { count: 2, colors: ['#bfeaff'], speed: 0.5, life: 0.8, intensity: 1.4 });
    }
  }

  #updateDiscoveries(dt, t) {
    for (const d of this.discoveries) {
      const center = d.part.group.position;
      const dist = this.out ? this.astroAt.distanceTo(center) : Infinity;
      // 离镜头和人都远的发现物不更新动画
      if (Math.min(dist, this.camAt.distanceTo(center)) > 22 && !d.following) continue;
      const near = 1 - smooth(1.6, NEAR, dist);
      d.near += (near - d.near) * Math.min(1, dt * 4);
      const found = this.found.has(d.id);
      if (dist < NEAR && !d.chimed) {
        d.chimed = true;
        if (!found) sound.sparkle();
      } else if (dist > NEAR + 1.5) {
        d.chimed = false;
      }
      d.ring.material.opacity = d.following ? 0 : d.near * (found ? 0.25 : 0.75) * (0.65 + 0.35 * Math.sin(t * 4));
      d.bubble.element.classList.toggle('near', d.near > 0.3);
      d.part.update(dt, t, d.near);
      if (d.part.follows) this.#follow(d, found, dt);
    }
  }

  /** 小云：收进图鉴以后跟着人飘 */
  #follow(d, found, dt) {
    const mover = d.part.mover;
    if (!(found && this.out)) {
      if (d.following) this.#dock(d);
      return;
    }
    if (!d.following) {
      d.following = true;
      this.root.attach(mover);
    }
    const left = v3.crossVectors(this.pos, this.fwd);
    const goal = v2.copy(this.pos).multiplyScalar(R + 2.7).addScaledVector(left, 1.0).addScaledVector(this.fwd, 0.4);
    mover.position.lerp(goal, REDUCED_MOTION ? 1 : Math.min(1, dt * 1.8));
    q1.setFromUnitVectors(Y, v3.copy(mover.position).normalize());
    mover.quaternion.slerp(q1, Math.min(1, dt * 3));
  }

  /** 小云回到自己的地方 */
  #dock(d) {
    const mover = d.part.mover;
    d.part.group.add(mover);
    mover.position.copy(d.part.home);
    mover.quaternion.identity();
    d.following = false;
  }

  #updateLights(dt) {
    const k = Math.min(1, dt * 2);
    const home = this.out ? homeness(colatOf(this.pos)) : 1;
    let sunW = 0;
    this.skyColor.set(HOME_LOOK.sky);
    this.lightColor.set(HOME_LOOK.light);
    if (this.out) {
      const { a, b, t } = this.zones.mix(lonOf(this.pos), 0.3);
      this.skyColor.lerp(c1.copy(a.sky).lerp(b.sky, t), 1 - home);
      this.lightColor.lerp(c1.copy(a.light).lerp(b.light, t), 1 - home);
      sunW = (1 - home) * ((a.id === 'sun' ? 1 - t : 0) + (b.id === 'sun' ? t : 0));
      const at = v1.copy(this.pos).multiplyScalar(R);
      const right = v2.crossVectors(this.pos, this.camFwd);
      this.sun.position.copy(at).addScaledVector(this.pos, 9).addScaledVector(this.camFwd, -3).addScaledVector(right, 4);
      this.sunTarget.position.copy(at);
    }
    this.host.scene.background.lerp(this.out ? this.skyColor : this.bg0, k);
    this.sun.color.lerp(this.lightColor, k);
    this.ambient.color.lerp(this.lightColor, k);
    this.outness += ((this.out ? 1 : 0) - this.outness) * k;
    for (const { light, base } of this.hostLights) light.intensity = base * (1 - 0.7 * this.outness);
    this.sun.intensity += ((this.out ? 1.9 : 0) - this.sun.intensity) * k;
    this.ambient.intensity += ((this.out ? 0.55 : 0) - this.ambient.intensity) * k;
    this.sunWeight += (sunW - this.sunWeight) * k;
    this.astro.shadow2.material.opacity = 0.22 * this.sunWeight;
  }

  // ---------- 点击 ----------

  #pickAt(raycaster) {
    const ground = rayPlanet(raycaster.ray, this.root.position);
    if (this.out) {
      const hits = raycaster.intersectObjects(this.hitList, false);
      for (const h of hits) {
        if (ground && h.distance > ground.distance + 0.5) break;
        const d = this.discoveries.find((x) => x.id === h.object.userData.discovery);
        if (d) return { type: 'discovery', d };
      }
      return ground ? { type: 'ground', dir: ground.dir } : null;
    }
    // 在地图上：只能点小宇航员（出发去逛逛）
    const hit = raycaster.intersectObject(this.astro.hit, false)[0];
    return hit && (!ground || hit.distance < ground.distance + 0.5) ? { type: 'astronaut' } : null;
  }

  #mark(dir) {
    plant(this.marker, dir, 0, 0.05);
    this.marker.rotateX(-Math.PI / 2);
    this.markerT = REDUCED_MOTION ? 1 : 0;
    this.marker.visible = !REDUCED_MOTION;
  }

  #discover(d) {
    // 转身看着发现物，Zib 跑到发现物另一边，朝着小宇航员说话
    const toward = tangentOf(this.pos, v1.copy(d.dir).sub(this.pos), new THREE.Vector3());
    this.fwd.copy(toward);
    stand(this.astro.group, this.pos, this.fwd);
    this.astro.hop = 1;
    const right = v2.crossVectors(toward, this.pos);
    const side = d.dir.clone().multiplyScalar(R).addScaledVector(right, 1.3).addScaledVector(toward, -0.4).normalize();
    this.zibStage = { dir: side, arrived: false };
    // 镜头转到人的左后方：人在左边近处，发现物在中间，Zib 在右边
    q1.setFromAxisAngle(this.pos, 0.75);
    this.camFwd.copy(toward).applyQuaternion(q1);
    this.framing = { at: (d.following ? d.part.mover : d.part.group).position.clone(), y: Math.min(1.6, (d.part.bubbleAt?.y ?? 1.2) * 0.55) };
    this.stage.talking = true;
    this.talk = 2.6;
    this.dispatchEvent(new CustomEvent('discover', { detail: { id: d.id } }));
  }
}

/** 射线和星球（球心 center，半径 R）的第一个交点：距离和表面方向（相对球心） */
function rayPlanet(ray, center) {
  const oc = v3.copy(ray.origin).sub(center);
  const b = oc.dot(ray.direction);
  const c = oc.lengthSq() - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  const dir = oc.addScaledVector(ray.direction, t).normalize().clone();
  return { distance: t, dir };
}

/** 从 cam 看 p（都相对球心）：中间被星球挡住了没有 */
function occluded(cam, p) {
  const d = v5.copy(p).sub(cam);
  const t = clamp01(-cam.dot(d) / d.lengthSq());
  if (t >= 0.97) return false;
  const x = cam.x + d.x * t;
  const y = cam.y + d.y * t;
  const z = cam.z + d.z * t;
  return x * x + y * y + z * z < (R * 0.995) ** 2;
}
