// Bix 星着陆区：开场动画用的三维布景（星球、作业号、发射台、气象站、告示牌、Zib、雨）。
// 和作业星球放在同一个场景里，离中间的太阳系远一些，播放时镜头飞过来拍，播完拆掉。

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { planetTexture, glowMaterial, disposeTree } from './scene.js';

const R = 14; // Bix 星半径；着陆点在星球正上方
const WORLD = new THREE.Vector3(70, 6, -60);
const UP = new THREE.Vector3(0, 1, 0);
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

/** 外星符号：每个字母对应一个符号，词的长度不变，只用来表示“还没破译” */
const GLYPHS = '◇◆○●◐◑△▽▲▼□■◈◉◎⊕⊗⊙✦✧☉☽★☆⬡⬢';
export const alienWord = (word) => [...word.toLowerCase()].map((c) => (/[a-z]/.test(c) ? GLYPHS[c.charCodeAt(0) - 97] : c)).join('');

/**
 * 镜头预设，坐标相对着陆点（x 向右、y 向上、z 朝镜头）。
 * pos / look 写多个点时沿曲线移动；cut 表示直接切过去，不从当前位置飞过来；track 表示镜头一直看着飞船。
 */
const CAMERAS = {
  approach: { cut: true, pos: [[-44, 20, 44], [-33, 15, 33], [-24, 11, 25]], look: [[0, -9, 0], [0, -4, 0]] },
  descent: { cut: true, pos: [[-10, 5, 13], [-5.5, 2.4, 9.5]], track: 'ship' },
  zib: { pos: [[0.4, 1.5, 6]], look: [[0.9, 1.15, 0.9]], ms: 1800 },
  rain: { pos: [[-2.6, 3.1, 8.2]], look: [[0.6, 1.5, 0]], ms: 2000 },
  sign: { pos: [[-1.5, 1.6, 3.4]], look: [[-2.6, 1.45, -0.7]], ms: 1700 },
  // 标题卡在画面中间，镜头往下看一点，让飞船和气象站留在卡片上方
  station: { pos: [[1, 5.5, 14], [0, 9, 22]], look: [[0.4, -3.2, 0]] },
};

/** 地面高度：着陆点附近的星球表面（球面） */
const ground = (x, z) => Math.sqrt(Math.max(0, R * R - x * x - z * z)) - R;

export class BixStage {
  constructor(host) {
    this.host = host;
    this.reduced = REDUCED_MOTION;
    this.root = new THREE.Group();
    this.root.position.copy(WORLD);
    host.scene.add(this.root);
    this.site = new THREE.Group();
    this.site.position.set(0, R, 0);
    this.root.add(this.site);

    const pmrem = new THREE.PMREMGenerator(host.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.#buildPlanet();
    this.#buildPad();
    this.#buildStation();
    this.#buildSign();
    this.#buildRocks();
    this.#buildShip();
    this.#buildZib();
    this.#buildRain();

    this.siteWorld = this.site.getWorldPosition(new THREE.Vector3());
    this.camPos = new THREE.Vector3();
    this.lookPos = new THREE.Vector3();
    this.move = null;
    this.anims = [];
    this.time = 0;
  }

  // ---------- 对外接口 ----------

  /** 换镜头：从当前位置平滑飞到预设位置（预设写了 cut 就直接切过去） */
  cameraTo(name, ms = 1800) {
    const preset = CAMERAS[name];
    if (!preset) {
      console.warn(`未知的镜头 "${name}"`);
      return;
    }
    const toWorld = (p) => this.site.localToWorld(new THREE.Vector3(...p));
    const pos = preset.pos.map(toWorld);
    const look = (preset.look || []).map(toWorld);
    const cut = preset.cut || this.reduced || !this.started;
    if (cut) {
      this.camPos.copy(pos[0]);
      if (look.length) this.lookPos.copy(look[0]);
      else this.lookPos.copy(this.ship.getWorldPosition(v1));
    } else {
      pos.unshift(this.camPos.clone());
      if (look.length) look.unshift(this.lookPos.clone());
    }
    const dur = this.reduced ? 0 : (preset.ms ?? ms) / 1000;
    this.move = { pos: path(pos), look: look.length ? path(look) : null, track: preset.track, t: 0, dur };
    this.started = true;
  }

  /** 播放一个动作，动作结束时 resolve */
  action(name) {
    switch (name) {
      case 'approach':
        return this.#anim(5, (k) => this.#approach(k));
      case 'land':
        return this.#anim(7, (k, dt) => this.#land(k, dt));
      case 'zib-appear':
        this.zib.target = 1;
        this.zib.hop = 1;
        return wait(this.reduced ? 0 : 900);
      case 'zib-wave':
        this.zib.target = 1;
        this.zib.wave = 2.2;
        return wait(400);
      case 'zib-shiver':
        this.zib.target = 1;
        this.zib.shiver = 3.5;
        return wait(300);
      case 'sign':
        this.sign.pop = 1;
        return wait(600);
      default:
        if (name) console.warn(`未知的动作 "${name}"`);
        return Promise.resolve();
    }
  }

  /** Zib 的反应：nod 点头（答对）、tilt 歪头（答错）、talk 说话 */
  zibReact(kind) {
    if (kind === 'nod') {
      this.zib.nod = 1;
      this.host.particles.emit(this.zib.group.getWorldPosition(v1).add(v2.set(0, 1.6, 0)), {
        count: 40, colors: ['#ffd166', '#80ed99', '#ffffff'], speed: 2.6, gravity: -1.2, life: 1,
      });
    } else if (kind === 'tilt') {
      this.zib.tilt = 1;
    }
  }

  set talking(on) {
    this.zib.talking = on;
  }

  /** 场景每一帧调用：更新动画并摆好相机 */
  update(dt, t, camera) {
    this.time += dt;
    for (const a of [...this.anims]) {
      a.t += dt;
      const k = a.dur > 0 ? clamp01(a.t / a.dur) : 1;
      a.fn(k, dt);
      if (k >= 1) {
        this.anims.splice(this.anims.indexOf(a), 1);
        a.resolve();
      }
    }
    this.#updateShip(dt, t);
    this.#updateZib(dt, t);
    this.#updateProps(dt, t);
    this.#updateRain(dt);

    const m = this.move;
    if (m) {
      m.t += dt;
      const k = m.dur > 0 ? easeInOut(clamp01(m.t / m.dur)) : 1;
      this.camPos.copy(m.pos(k));
      if (m.track === 'ship') {
        this.ship.getWorldPosition(v1).y += 1.2;
        this.lookPos.lerp(v1, 1 - Math.exp(-dt * 5));
      } else if (m.look) {
        this.lookPos.copy(m.look(k));
      }
    }
    // 竖屏时画面变窄，镜头往后退一些，让飞船和 Zib 都在画面里
    const back = Math.max(1, Math.min(2.2, 1.25 / camera.aspect));
    camera.position.copy(this.camPos).sub(this.lookPos).multiplyScalar(back).add(this.lookPos);
    camera.lookAt(this.lookPos);
    // 镜头进到大气层里面时，大气光晕会糊满整个画面，先藏起来
    this.glow.visible = camera.position.distanceTo(this.root.position) > R * 1.45;
    // 雨只在着陆点附近看得见，从太空里看会变成一团白点
    this.rain.visible = camera.position.distanceTo(this.siteWorld) < 26;
  }

  dispose() {
    this.root.removeFromParent();
    disposeTree(this.root);
    this.env.dispose();
  }

  // ---------- 搭建 ----------

  #buildPlanet() {
    const color = new THREE.Color('#4a8fc8');
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(R, 96, 64),
      new THREE.MeshStandardMaterial({ map: planetTexture(color, 7), roughness: 0.9, metalness: 0.02, emissive: color, emissiveIntensity: 0.05 }),
    );
    this.root.add(planet);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(R * 1.22, 64, 32), glowMaterial(new THREE.Color('#7cc8ff')));
    this.root.add(this.glow);

    const light = new THREE.PointLight('#cfe8ff', 22, 30, 1.6);
    light.position.set(2, 9, 9);
    this.site.add(light);
  }

  #buildPad() {
    const metal = new THREE.MeshStandardMaterial({ color: '#39406a', roughness: 0.5, metalness: 0.6 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.14, 40), metal);
    pad.position.y = 0.05;
    this.site.add(pad);
    const mark = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166').multiplyScalar(1.6) }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.y = 0.125;
    this.site.add(mark);
    this.padLights = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: '#7cc8ff' }));
      m.position.set(Math.cos(a) * 1.42, 0.14, Math.sin(a) * 1.42);
      this.site.add(m);
      this.padLights.push(m);
    }
  }

  #buildStation() {
    const station = new THREE.Group();
    place(station, 3.3, -1.9);
    this.site.add(station);
    const white = new THREE.MeshStandardMaterial({ color: '#e3e9f7', roughness: 0.45, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2b3150', roughness: 0.6 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), white);
    station.add(dome);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.1), dark);
    door.position.set(-0.25, 0.25, 0.76);
    door.rotation.y = -0.3;
    station.add(door);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.4, 10), dark);
    pole.position.y = 1.9;
    station.add(pole);

    // 风向标
    this.vane = new THREE.Group();
    this.vane.position.y = 3.1;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.05), dark);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 12), new THREE.MeshStandardMaterial({ color: '#ff6b8b', roughness: 0.4 }));
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.6;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.02), dark);
    fin.position.x = -0.5;
    this.vane.add(shaft, tip, fin);
    station.add(this.vane);

    // 风速计：三个小杯子一直转
    this.cups = new THREE.Group();
    this.cups.position.y = 2.65;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.025), dark);
      arm.position.set(Math.cos(a) * 0.21, 0, Math.sin(a) * 0.21);
      arm.rotation.y = -a;
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI), white);
      cup.position.set(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
      cup.rotation.y = -a;
      this.cups.add(arm, cup);
    }
    station.add(this.cups);

    // 顶上一闪一闪的灯
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff4d6d' }));
    this.beacon.position.y = 3.2;
    station.add(this.beacon);

    // 雨量筒
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 16), new THREE.MeshStandardMaterial({ color: '#9ad1ff', roughness: 0.1, transparent: true, opacity: 0.7 }));
    gauge.position.set(1.05, 0.3, 0.35);
    station.add(gauge);
  }

  #buildSign() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 200;
    this.signCanvas = c;
    this.signTexture = new THREE.CanvasTexture(c);
    this.signTexture.colorSpace = THREE.SRGBColorSpace;
    this.setSign('weather');

    const sign = new THREE.Group();
    place(sign, -2.6, -0.8);
    sign.rotation.y = 0.35;
    this.site.add(sign);
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5a2e', roughness: 0.8 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 10), wood);
    post.position.y = 0.65;
    sign.add(post);
    this.board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.62, 0.07), [wood, wood, wood, wood, new THREE.MeshBasicMaterial({ map: this.signTexture }), wood]);
    this.board.position.y = 1.45;
    sign.add(this.board);
    this.sign = { group: sign, pop: 0 };
  }

  /** 告示牌上写一个还没破译的词 */
  setSign(word) {
    const g = this.signCanvas.getContext('2d');
    g.fillStyle = '#3b2a12';
    g.fillRect(0, 0, 512, 200);
    g.strokeStyle = '#c9963f';
    g.lineWidth = 14;
    g.strokeRect(7, 7, 498, 186);
    g.fillStyle = '#ffe08a';
    g.font = '96px "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(alienWord(word), 256, 104, 470);
    this.signTexture.needsUpdate = true;
  }

  #buildRocks() {
    const mat = new THREE.MeshStandardMaterial({ color: '#3d5a80', roughness: 0.85, flatShading: true });
    const crystal = new THREE.MeshStandardMaterial({ color: '#9be7ff', emissive: '#4cc9f0', emissiveIntensity: 0.6, roughness: 0.2, flatShading: true });
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const crystalGeo = new THREE.OctahedronGeometry(1, 0);
    let seed = 11;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const d = 2.4 + rand() * 8;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.hypot(x - 3.3, z + 1.9) < 1.4 || Math.hypot(x + 2.6, z + 0.8) < 0.8 || Math.hypot(x - 1.4, z - 1.0) < 0.9) continue;
      const isCrystal = i % 5 === 0;
      const rock = new THREE.Mesh(isCrystal ? crystalGeo : geo, isCrystal ? crystal : mat);
      const s = isCrystal ? 0.18 + rand() * 0.2 : 0.12 + rand() * 0.35;
      rock.scale.set(s, s * (isCrystal ? 1.8 : 0.7), s);
      rock.rotation.set(rand(), rand() * 3, rand());
      place(rock, x, z);
      rock.position.y += s * 0.3;
      this.site.add(rock);
    }
    // 雨后的水洼
    const puddle = new THREE.MeshStandardMaterial({ color: '#6fa8dc', roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.75 });
    for (const [x, z, s] of [[-1.2, 2.2, 0.55], [2.2, 1.6, 0.4], [-3.4, 1.4, 0.7]]) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(s, 24), puddle);
      place(p, x, z);
      p.rotateX(-Math.PI / 2);
      p.position.y += 0.02;
      p.scale.y = 0.7;
      this.site.add(p);
    }
  }

  #buildShip() {
    // 作业号：不锈钢船身、一侧黑色隔热瓦、前后两对襟翼（借鉴星舰的外形，不照搬）
    const steel = new THREE.MeshStandardMaterial({ color: '#a7aebd', roughness: 0.45, metalness: 0.75, envMap: this.env, envMapIntensity: 0.3 });
    const tile = new THREE.MeshStandardMaterial({ color: '#1d2033', roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
    const flapMat = new THREE.MeshStandardMaterial({ color: '#5b6178', roughness: 0.4, metalness: 0.7, envMap: this.env });

    const ship = new THREE.Group();
    this.ship = ship;
    this.site.add(ship);
    const lathe = (pts) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 40);
    ship.add(new THREE.Mesh(lathe([[0, 0], [0.45, 0], [0.45, 2.5], [0.42, 2.76], [0.34, 2.98], [0.2, 3.12], [0, 3.2]]), steel));
    // 隔热瓦在 +x 一侧：翻身下降时朝下
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.458, 0.458, 2.45, 24, 1, true, 0, Math.PI), tile);
    shield.position.y = 1.25;
    ship.add(shield);
    for (const side of [-1, 1]) {
      const fwd = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.42), flapMat);
      fwd.position.set(0, 2.62, side * 0.64);
      const aft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.6), flapMat);
      aft.position.set(0, 0.62, side * 0.74);
      ship.add(fwd, aft);
    }
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: '#7fdcff', emissive: '#4cc9f0', emissiveIntensity: 1.6, roughness: 0.1 }));
    win.scale.x = 0.4;
    win.position.set(-0.43, 2.55, 0);
    ship.add(win);
    const nozzleMat = new THREE.MeshStandardMaterial({ color: '#2b2f45', roughness: 0.5, metalness: 0.6 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.16, 16), nozzleMat);
      n.position.set(Math.cos(a) * 0.18, -0.06, Math.sin(a) * 0.18);
      ship.add(n);
    }

    const flameGeo = new THREE.ConeGeometry(1, 1, 20, 1, true);
    flameGeo.rotateX(Math.PI);
    flameGeo.translate(0, -0.5, 0);
    this.flame = new THREE.Group();
    this.flame.position.y = -0.14;
    const outer = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7b29').multiplyScalar(2.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    outer.scale.set(0.3, 1.6, 0.3);
    const inner = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff3b0').multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    inner.scale.set(0.15, 0.95, 0.15);
    this.flame.add(outer, inner);
    ship.add(this.flame);
    this.flameSize = 0;
    this.flameGoal = 0;

    // 一开始停在着陆点上空、镜头外
    ship.position.set(-27, 12, 25);
  }

  #buildZib() {
    const skin = new THREE.MeshStandardMaterial({ color: '#7ee081', roughness: 0.55 });
    const skinLight = new THREE.MeshStandardMaterial({ color: '#9cf0a0', roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: '#141626', roughness: 0.3 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166').multiplyScalar(2.5) });

    const group = new THREE.Group();
    place(group, 1.4, 1.0);
    group.rotation.y = -0.25;
    this.site.add(group);
    const inner = new THREE.Group();
    group.add(inner);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.32, 8, 16), skin);
    body.position.y = 0.55;
    inner.add(body);
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), skin);
      foot.scale.set(1, 0.5, 1.4);
      foot.position.set(side * 0.14, 0.06, 0.05);
      inner.add(foot);
    }

    const head = new THREE.Group();
    head.position.y = 1.12;
    inner.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), skinLight);
    skull.scale.set(1.1, 0.95, 1);
    head.add(skull);
    const eyes = new THREE.Group();
    head.add(eyes);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), white);
      eye.position.set(side * 0.16, 0.06, 0.34);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10), black);
      pupil.position.set(side * 0.16, 0.06, 0.45);
      eyes.add(eye, pupil);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.4, 8), skin);
      stalk.position.set(side * 0.16, 0.5, 0);
      stalk.rotation.z = -side * 0.35;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), glow);
      bulb.position.set(side * 0.24, 0.7, 0);
      head.add(stalk, bulb);
    }
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), black);
    mouth.scale.set(1.3, 0.35, 0.5);
    mouth.position.set(0, -0.16, 0.38);
    head.add(mouth);

    const arms = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.3, 0.78, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 6, 10), skin);
      arm.position.y = -0.2;
      pivot.add(arm);
      pivot.rotation.z = side * 0.35;
      inner.add(pivot);
      return pivot;
    });

    group.scale.setScalar(0.0001);
    this.zib = {
      group, inner, head, eyes, mouth, arms,
      target: 0, shown: 0, hop: 0, wave: 0, shiver: 0, nod: 0, tilt: 0, talking: false, nextBlink: 2,
    };
  }

  #buildRain() {
    const count = 700;
    const pos = new Float32Array(count * 6);
    this.drops = [];
    for (let i = 0; i < count; i++) {
      this.drops.push({ x: (Math.random() - 0.5) * 22, y: Math.random() * 12, z: -9 + Math.random() * 22, v: 9 + Math.random() * 4 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#a9d6ff', transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.site.add(this.rain);
  }

  // ---------- 动画 ----------

  #anim(seconds, fn) {
    return new Promise((resolve) => this.anims.push({ t: 0, dur: this.reduced ? 0 : seconds, fn, resolve }));
  }

  /** 从太空飞向着陆点上空，船头朝前 */
  #approach(k) {
    const from = v1.set(-27, 12, 25);
    const to = v2.set(-8, 7, 3);
    const e = easeInOut(k);
    const p = from.clone().lerp(to, e);
    const dir = to.clone().sub(from).normalize();
    this.ship.position.copy(p);
    this.ship.quaternion.setFromUnitVectors(UP, dir);
    this.flameGoal = 0.5;
  }

  /** 翻身下降：先横着（隔热瓦朝下）落下来，再翻成竖直，点火减速，落在发射台上 */
  #land(k) {
    const T = k * 7;
    const ship = this.ship;
    if (T < 3.2) {
      const e = easeOut(T / 3.2);
      ship.position.set(-7 + 5.6 * e, 8 - 4.6 * e, 0);
      ship.rotation.set(Math.sin(T * 3) * 0.05, 0, -Math.PI / 2);
      this.flameGoal = 0;
    } else if (T < 4.4) {
      const e = easeInOut((T - 3.2) / 1.2);
      ship.position.set(-1.4 + 1.4 * e, 3.4 - 1 * e, 0);
      ship.rotation.set(0, 0, (-Math.PI / 2) * (1 - e));
      this.flameGoal = 0.9 * e;
    } else if (T < 6.6) {
      const e = easeOut((T - 4.4) / 2.2);
      ship.position.set(0, 2.4 - 2.28 * e, 0);
      ship.rotation.set(0, 0, 0);
      this.flameGoal = 1 - 0.5 * e;
      if (ship.position.y < 1.4 && Math.random() < 0.7) {
        const at = this.site.localToWorld(v1.set((Math.random() - 0.5) * 1.6, 0.2, (Math.random() - 0.5) * 1.6));
        this.host.particles.emit(at, { count: 5, colors: ['#9aa3c7', '#d6dbf5'], speed: 2.4, dir: v2.set(0, 0.3, 0), spread: 1, gravity: 0.4, life: 1.4, intensity: 0.5 });
      }
    } else {
      ship.position.set(0, 0.12, 0);
      this.flameGoal = 0;
    }
  }

  #updateShip(dt, t) {
    this.flameSize += (this.flameGoal - this.flameSize) * Math.min(1, dt * 6);
    const flicker = 1 + Math.sin(t * 40) * 0.08 + Math.sin(t * 23) * 0.06;
    const s = Math.max(0.0001, this.flameSize);
    this.flame.scale.set(s, s * flicker, s);
  }

  #updateZib(dt, t) {
    const z = this.zib;
    z.shown += (z.target - z.shown) * Math.min(1, dt * (this.reduced ? 60 : 5));
    z.group.scale.setScalar(Math.max(0.0001, z.target > 0 ? easeOutBack(clamp01(z.shown)) : z.shown));
    z.hop = Math.max(0, z.hop - dt * 1.4);
    const idle = this.reduced ? 0 : Math.abs(Math.sin(t * 2.6)) * 0.04;
    z.inner.position.y = Math.sin(z.hop * Math.PI) * 0.5 + idle;

    // 眨眼
    z.nextBlink -= dt;
    if (z.nextBlink < 0) z.nextBlink = 2.5 + Math.random() * 2.5;
    z.eyes.scale.y = z.nextBlink < 0.12 ? 0.15 : 1;

    // 挥手 / 发抖 / 点头 / 歪头
    const [left, right] = z.arms;
    z.wave = Math.max(0, z.wave - dt);
    z.shiver = Math.max(0, z.shiver - dt);
    if (z.wave > 0) {
      right.rotation.z = 2.4 + Math.sin(t * 12) * 0.45;
      left.rotation.z = -0.35;
    } else if (z.shiver > 0) {
      right.rotation.z = 1.1;
      left.rotation.z = -1.1;
      right.rotation.x = left.rotation.x = -0.9;
    } else {
      right.rotation.z = 0.35 + Math.sin(t * 1.7) * 0.05;
      left.rotation.z = -0.35 - Math.sin(t * 1.7) * 0.05;
      right.rotation.x = left.rotation.x = 0;
    }
    z.inner.position.x = z.shiver > 0 && !this.reduced ? Math.sin(t * 70) * 0.02 : 0;
    z.nod = Math.max(0, z.nod - dt * 1.3);
    z.tilt = Math.max(0, z.tilt - dt * 1.1);
    z.head.rotation.x = Math.sin((1 - z.nod) * Math.PI * 2) * 0.32 * (z.nod > 0 ? 1 : 0);
    z.head.rotation.z = Math.sin(z.tilt * Math.PI) * 0.35;
    z.mouth.scale.y = z.talking ? 0.35 + Math.abs(Math.sin(t * 14)) * 0.9 : 0.35;
  }

  #updateProps(dt, t) {
    this.vane.rotation.y = Math.sin(t * 0.5) * 0.7 + Math.sin(t * 1.3) * 0.15;
    this.cups.rotation.y += dt * 5;
    this.beacon.visible = Math.sin(t * 4) > 0;
    this.padLights.forEach((m, i) => (m.visible = Math.sin(t * 3 - i * 0.8) > -0.2));
    const s = this.sign;
    s.pop = Math.max(0, s.pop - dt * 1.6);
    s.group.scale.setScalar(1 + Math.sin(s.pop * Math.PI) * 0.25);
    this.board.material[4].color.setScalar(1 + Math.sin(s.pop * Math.PI) * 1.5);
  }

  #updateRain(dt) {
    const pos = this.rain.geometry.attributes.position;
    const a = pos.array;
    this.drops.forEach((d, i) => {
      d.y -= d.v * dt;
      d.x += 0.8 * dt;
      if (d.y < ground(d.x, d.z) || d.x > 11) {
        d.y = 9 + Math.random() * 4;
        d.x = (Math.random() - 0.5) * 22;
      }
      a.set([d.x, d.y, d.z, d.x - 0.03, d.y + 0.32, d.z], i * 6);
    });
    pos.needsUpdate = true;
  }
}

// ---------- 小工具 ----------

/** 把物体放到着陆点附近的地面上，并顺着球面倾斜 */
function place(obj, x, z) {
  obj.position.set(x, ground(x, z), z);
  const normal = new THREE.Vector3(x, ground(x, z) + R, z).normalize();
  obj.quaternion.setFromUnitVectors(UP, normal);
}

/** 一串点 → 时间 0..1 上的位置：一个点不动，两个点直线，更多点用平滑曲线 */
function path(points) {
  if (points.length === 1) return () => points[0].clone();
  if (points.length === 2) return (k) => points[0].clone().lerp(points[1], k);
  const curve = new THREE.CatmullRomCurve3(points);
  return (k) => curve.getPoint(k);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
