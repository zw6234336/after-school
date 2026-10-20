// Bix 星着陆区：开场动画用的三维布景（星球、使命号、发射台、气象站、告示牌、Zib、雨）。
// 和使命星球放在同一个场景里，离中间的太阳系远一些，播放时镜头飞过来拍，播完拆掉。

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { planetTexture, glowMaterial, disposeTree } from './scene.js';

const R = 14; // Bix 星半径；着陆点在星球正上方
export const BIX_RADIUS = R;
const WORLD = new THREE.Vector3(70, 6, -60);
const UP = new THREE.Vector3(0, 1, 0);
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const c1 = new THREE.Color();

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

/** Zib 在着陆区里待着的地方（相对着陆点） */
const ZIB_HOME = { x: 1.4, z: 1.0, yaw: -0.25 };

/** 地面高度：着陆点附近的星球表面（球面） */
const ground = (x, z) => Math.sqrt(Math.max(0, R * R - x * x - z * z)) - R;

/**
 * 着陆后地面地图上的站点位置（相对着陆点）。labelY 是站点名牌的高度。
 * 拼读站就是开场里的告示牌（符号墙），研究站就是气象站。
 */
export const STATION_SPOTS = {
  RF: { x: -2.6, z: -0.8, labelY: 2.5 },
  RI: { x: 3.3, z: -1.9, labelY: 3.2 },
  RL: { x: -3.4, z: 2.6, labelY: 1.9 },
  L: { x: 3.3, z: 2.7, labelY: 2.0 },
  WSL: { x: 2.3, z: -4.5, labelY: 4.9 },
};
/**
 * 通往下一层的门（发射台左后方，从总览镜头看不会被飞船和拼读站挡住）；开门以后左边升起这一层的设计（气象塔）
 */
export const DOOR_SPOT = { x: -2.0, z: -5.0, labelY: 2.9 };
export const TOWER_SPOT = { x: -4.1, z: -5.6 };
/** 开门时 Zib 跑去站的地方：气象塔前面一点，在开门镜头的左边，不挡门 */
const ZIB_AT_TOWER = { x: -4.0, z: -4.2 };
/** 开门的两个镜头（相对着陆点）：先站在门前看门打开，再往后上方退一点看气象塔升起来。都在拼读站和飞船后面，不会被挡住 */
export const DOOR_SHOTS = {
  door: { pos: [-1.1, 1.3, -1.5], look: [-2.0, 0.4, -5.0] },
  tower: { pos: [-0.7, 2.6, -1.2], look: [-3.4, 0.2, -5.4] },
};
/** 气象塔四个圆环的颜色：冬、春、夏、秋 */
const SEASON_COLORS = ['#9fd3ff', '#ff8fc8', '#ffd166', '#f08a3c'];
/** 数学、语文等科目的站点，按顺序摆在地图两边 */
export const EXTRA_SPOTS = [
  { x: -5.8, z: 0.6, labelY: 1.9 },
  { x: 5.9, z: 0.5, labelY: 1.9 },
  { x: -5.2, z: -3.6, labelY: 1.9 },
  { x: 5.4, z: -3.9, labelY: 1.9 },
];

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
    this.#buildStations();
    this.#buildDoor();
    this.#buildTower();
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

  // ---------- 地面地图用 ----------

  /** 开场结束或直接进入地图：飞船停在发射台上，Zib 站在旁边 */
  enterMap() {
    this.mapMode = true;
    this.move = null;
    for (const a of this.anims) a.resolve();
    this.anims = [];
    this.ship.position.set(0, 0.12, 0);
    this.ship.rotation.set(0, 0, 0);
    this.flameGoal = 0;
    this.zib.target = 1;
    this.zib.shiver = 0;
    this.talking = false;
  }

  /** 第 n 个其他科目站点：在地图边上搭一个小亭子 */
  addKiosk(n, color) {
    const spot = EXTRA_SPOTS[n];
    if (!spot) return null;
    const kiosk = new THREE.Group();
    place(kiosk, spot.x, spot.z);
    const c = new THREE.Color(color);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.7, 20), new THREE.MeshStandardMaterial({ color: '#e3e9f7', roughness: 0.5 }));
    base.position.y = 0.35;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.55, 20), new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, emissive: c, emissiveIntensity: 0.15 }));
    roof.position.y = 0.98;
    kiosk.add(base, roof);
    this.site.add(kiosk);
    return spot;
  }

  /** 站点在世界坐标里的位置（名牌和粒子用） */
  stationWorld(spot, y = 0, target = new THREE.Vector3()) {
    return this.site.localToWorld(target.set(spot.x, ground(spot.x, spot.z) + y, spot.z));
  }

  /** 站点完成后，地面上亮一圈金色光环 */
  setStationDone(spot, done) {
    let ring = this.doneRings.get(spot);
    if (!ring && done) {
      ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166').multiplyScalar(2), transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      place(ring, spot.x, spot.z);
      ring.rotateX(-Math.PI / 2);
      ring.position.y += 0.03;
      this.site.add(ring);
      this.doneRings.set(spot, ring);
    }
    if (ring) ring.visible = done;
  }

  /** 让 Zib 走到某个站点门口（站点靠镜头的一侧） */
  zibGo(spot) {
    const toward = new THREE.Vector2(-spot.x, 3 - spot.z).normalize();
    this.zib.goal = { x: spot.x + toward.x * 1.15, z: spot.z + toward.y * 1.15 };
  }

  /** 点了飞船：晃一晃 */
  wiggle() {
    this.shipWiggle = 1;
  }

  /** 全部任务完成：广播站的信号塔向地球发信号 */
  signal() {
    const top = this.stationWorld(STATION_SPOTS.WSL, 3.5, new THREE.Vector3());
    const rings = [0, 1, 2].map(() => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.05, 8, 48),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#80ed99').multiplyScalar(2.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      this.host.scene.add(ring);
      return ring;
    });
    let nextFirework = 0.4;
    return this.#anim(3.4, (k) => {
      const T = k * 3.4;
      this.beaconBoost = 1;
      rings.forEach((ring, i) => {
        const p = clamp01((T - i * 0.45) / 1.6);
        ring.visible = p > 0 && p < 1;
        ring.position.copy(top).y += p * 4;
        ring.scale.setScalar(0.4 + p * 4);
        ring.material.opacity = 1 - p;
      });
      if (T >= nextFirework && T < 3) {
        nextFirework += 0.45;
        const at = top.clone().add(v1.set((Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 2));
        this.host.particles.firework(at, [['#80ed99', '#ffd166'], ['#7cc8ff', '#ffffff'], ['#ff7eb6', '#ffd166']][Math.floor(Math.random() * 3)]);
      }
      if (k >= 1) {
        this.beaconBoost = 0;
        rings.forEach((ring) => {
          ring.removeFromParent();
          ring.geometry.dispose();
          ring.material.dispose();
        });
      }
    });
  }

  /**
   * 门的样子跟着进度变：两盏锁灯（红是锁着，绿是开了）；开门动画播过的话，门开着、气象塔立着。
   * 锁刚打开时灯上冒一串小星星
   */
  setDoor({ decode, comprehend, opened }) {
    const d = this.door;
    [decode, comprehend].forEach((open, i) => {
      const lamp = d.lamps[i];
      if (open && lamp.open === false) this.host.particles.emit(lamp.mesh.getWorldPosition(new THREE.Vector3()), { count: 30, colors: ['#4ade80', '#ffffff'], speed: 1.6, gravity: 0, life: 0.9 });
      lamp.open = !!open;
      lamp.mesh.material.color.set(open ? '#4ade80' : '#ff4d6d').multiplyScalar(1.8);
    });
    if (opened && !this.doorOpening) {
      this.#swingDoor(1);
      this.tower.group.visible = true;
      this.tower.group.position.y = 0;
    }
  }

  /** 两把锁都开了，开门第一步：门向里打开，门后亮起来；返回 Promise */
  async swingOpen() {
    this.doorOpening = true;
    this.zib.goal = { ...ZIB_AT_TOWER };
    await this.#anim(1.8, (k) => this.#swingDoor(easeInOut(k)));
    this.host.particles.firework(this.door.group.localToWorld(new THREE.Vector3(0, 2.4, 0.3)), ['#ffd166', '#b388ff']);
  }

  /** 开门第二步：气象塔从地下升起来，顶上放四朵季节颜色的烟花；返回 Promise */
  async raiseTower() {
    const t = this.tower;
    t.group.visible = true;
    const base = this.site.localToWorld(new THREE.Vector3(TOWER_SPOT.x, ground(TOWER_SPOT.x, TOWER_SPOT.z) + 0.1, TOWER_SPOT.z));
    let dust = 0;
    await this.#anim(2.8, (k, dt = 0) => {
      t.group.position.y = -t.height * (1 - easeOut(k));
      dust -= dt;
      if (dust <= 0 && k < 1) {
        dust = 0.18;
        this.host.particles.emit(base, { count: 14, colors: ['#c9b48a', '#ffffff'], speed: 1.4, gravity: -0.6, life: 0.9 });
      }
    });
    this.zibReact('nod');
    const top = t.orb.getWorldPosition(new THREE.Vector3());
    SEASON_COLORS.forEach((c, i) => setTimeout(() => this.host.particles.firework(top.clone().add(v1.set((i - 1.5) * 0.9, 1 + (i % 2) * 0.6, 0)), [c, '#ffffff']), i * 260));
    await wait(this.reduced ? 0 : 1200);
    // Zib 跑回原来的地方：站在塔前面的话，从地图上看会被拼读站挡住
    this.zib.goal = { x: ZIB_HOME.x, z: ZIB_HOME.z };
    this.doorOpening = false;
  }

  /** 开场动画每一帧调用：更新动画，并按镜头预设摆好相机 */
  update(dt, t, camera) {
    this.animate(dt, t);
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
    this.placeCamera(camera, this.camPos, this.lookPos);
  }

  /** 只更新动画（飞船、Zib、站点、雨），不动相机；地面地图也用它 */
  animate(dt, t) {
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
  }

  /** 摆相机：竖屏时画面变窄，镜头往后退一些；再按相机位置决定光晕和雨显不显示 */
  placeCamera(camera, pos, look) {
    camera.position.copy(this.framePose(pos, look, camera.aspect));
    camera.lookAt(look);
    this.updateVisibility(camera.position);
  }

  /** 竖屏时镜头沿着视线往后退（改的是 pos，返回 pos） */
  framePose(pos, look, aspect) {
    const back = Math.max(1, Math.min(2.2, 1.25 / aspect));
    return pos.sub(look).multiplyScalar(back).add(look);
  }

  updateVisibility(cameraPos) {
    // 镜头进到大气层里面时，大气光晕会糊满整个画面，先藏起来
    this.glow.visible = cameraPos.distanceTo(this.root.position) > R * 1.45;
    // 雨只在着陆点附近看得见，从太空里看会变成一团白点
    this.rain.visible = cameraPos.distanceTo(this.siteWorld) < 26;
  }

  /** 换一张星球表面的贴图（闲逛的天气地带），旧的贴图释放掉 */
  setGroundTexture(texture) {
    const m = this.planet.material;
    m.map?.dispose();
    m.map = texture;
    m.needsUpdate = true;
  }

  /**
   * 闲逛时 Zib 离开着陆区：挂到星球上，由闲逛模式摆位置和朝向；
   * 回来时挂回着陆点，站回原来的地方
   */
  freeZib(on) {
    const z = this.zib;
    z.goal = null;
    z.walking = false;
    if (on) {
      this.root.attach(z.group);
    } else {
      this.site.attach(z.group);
      z.group.position.set(ZIB_HOME.x, ground(ZIB_HOME.x, ZIB_HOME.z), ZIB_HOME.z);
      z.group.rotation.set(0, ZIB_HOME.yaw, 0);
    }
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
      new THREE.SphereGeometry(R, 128, 96),
      new THREE.MeshStandardMaterial({ map: planetTexture(color, 7), roughness: 0.9, metalness: 0.02, emissive: color, emissiveIntensity: 0.05 }),
    );
    this.root.add(planet);
    this.planet = planet;
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

  #buildStations() {
    this.doneRings = new Map();
    this.beaconBoost = 0;
    const dark = new THREE.MeshStandardMaterial({ color: '#2b3150', roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: '#e3e9f7', roughness: 0.45, metalness: 0.1 });

    // 拼读站：给告示牌搭一个雨棚，变成“雨棚下的符号墙”
    const awningMat = new THREE.MeshStandardMaterial({ color: '#ffb84d', roughness: 0.5 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 8), dark);
      post.position.set(side * 0.95, 1.0, 0.25);
      this.sign.group.add(post);
    }
    const awning = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.07, 0.8), awningMat);
    awning.position.set(0, 2.02, 0.15);
    awning.rotation.x = 0.18;
    this.sign.group.add(awning);

    // 故事屋：粉色圆顶小屋，屋顶一本打开的书，门口有蚱蜢雕像
    const rl = STATION_SPOTS.RL;
    const house = new THREE.Group();
    place(house, rl.x, rl.z);
    house.rotation.y = 0.5;
    this.site.add(house);
    const pink = new THREE.MeshStandardMaterial({ color: '#e9a9c6', roughness: 0.7 });
    house.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), pink));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.48, 0.1), new THREE.MeshStandardMaterial({ color: '#7a3b5e', roughness: 0.6 }));
    door.position.set(0, 0.24, 0.76);
    house.add(door);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166').multiplyScalar(1.6) }));
    win.position.set(0.42, 0.45, 0.6);
    win.rotation.y = 0.6;
    house.add(win);
    const pageMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 });
    const coverMat = new THREE.MeshStandardMaterial({ color: '#ff7eb6', roughness: 0.4 });
    for (const side of [-1, 1]) {
      const page = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.46), pageMat);
      page.position.set(side * 0.17, 0.92, 0);
      page.rotation.z = side * -0.35;
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.02, 0.48), coverMat);
      cover.position.set(side * 0.17, 0.9, 0);
      cover.rotation.z = side * -0.35;
      house.add(page, cover);
    }
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.25, 12), white);
    pedestal.position.set(0.9, 0.12, 0.5);
    const bug = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 4, 8), new THREE.MeshStandardMaterial({ color: '#6fcf6a', roughness: 0.5 }));
    bug.rotation.z = Math.PI / 2.4;
    bug.position.set(0.9, 0.38, 0.5);
    house.add(pedestal, bug);

    // 词语站：条纹遮阳棚的小摊，挂着彩色词卡
    const l = STATION_SPOTS.L;
    const stall = new THREE.Group();
    place(stall, l.x, l.z);
    stall.rotation.y = -0.5;
    this.site.add(stall);
    const wood = new THREE.MeshStandardMaterial({ color: '#8a6a3e', roughness: 0.8 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.6), wood);
    table.position.y = 0.25;
    stall.add(table);
    for (const [px, pz] of [[-0.6, -0.25], [0.6, -0.25], [-0.6, 0.25], [0.6, 0.25]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.35, 8), wood);
      post.position.set(px, 0.67, pz);
      stall.add(post);
    }
    const stripes = document.createElement('canvas');
    stripes.width = 128;
    stripes.height = 8;
    const sg = stripes.getContext('2d');
    for (let i = 0; i < 8; i++) {
      sg.fillStyle = i % 2 ? '#d9cdf5' : '#8e63e0';
      sg.fillRect(i * 16, 0, 16, 8);
    }
    const stripeTex = new THREE.CanvasTexture(stripes);
    stripeTex.colorSpace = THREE.SRGBColorSpace;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.85), new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.85 }));
    roof.position.y = 1.38;
    stall.add(roof);
    ['#ffd166', '#80ed99', '#7cc8ff', '#ff7eb6', '#b388ff'].forEach((color, i) => {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide }));
      card.position.set(-0.5 + i * 0.25, 1.12, 0.43);
      card.rotation.z = (i % 2 ? 1 : -1) * 0.08;
      stall.add(card);
    });

    // 广播站：信号塔、碟形天线、塔顶的绿灯
    const w = STATION_SPOTS.WSL;
    const tower = new THREE.Group();
    place(tower, w.x, w.z);
    this.site.add(tower);
    const metal = new THREE.MeshStandardMaterial({ color: '#7d86a8', roughness: 0.4, metalness: 0.6 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 3.4, 10), metal);
    mast.position.y = 1.7;
    tower.add(mast);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), metal);
      strut.position.set(Math.cos(a) * 0.35, 0.8, Math.sin(a) * 0.35);
      strut.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      tower.add(strut);
    }
    const hut = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.6), white);
    hut.position.set(0.55, 0.25, 0.3);
    tower.add(hut);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.8), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, side: THREE.DoubleSide }));
    dish.position.set(0, 2.6, 0.12);
    dish.rotation.x = -1.1;
    tower.add(dish);
    this.towerBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: '#80ed99' }));
    this.towerBeacon.position.y = 3.48;
    tower.add(this.towerBeacon);
  }

  /** 通往下一层的门：石头门框、两扇向里开的门（关着时中间拼成一个金色徽记）、门楣上两盏锁灯、门后的光 */
  #buildDoor() {
    const g = new THREE.Group();
    place(g, DOOR_SPOT.x, DOOR_SPOT.z);
    // 正面朝着总览镜头
    g.rotateY(Math.atan2(-DOOR_SPOT.x, 13.5 - DOOR_SPOT.z));
    this.site.add(g);
    const stone = new THREE.MeshStandardMaterial({ color: '#7b86b0', roughness: 0.8, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: '#2f3760', roughness: 0.55, metalness: 0.3 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 1.1), stone);
    base.position.y = 0.02;
    g.add(base);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.0, 0.42), stone);
      pillar.position.set(side * 0.88, 1.0, 0);
      g.add(pillar);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.36, 0.5), stone);
    lintel.position.y = 2.15;
    g.add(lintel);

    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const cg = c.getContext('2d');
    const grad = cg.createRadialGradient(64, 64, 4, 64, 64, 70);
    grad.addColorStop(0, '#fff6dc');
    grad.addColorStop(0.45, '#ffc46e');
    grad.addColorStop(1, '#8f6bff');
    cg.fillStyle = grad;
    cg.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(1.44, 1.96),
      new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#ffffff').multiplyScalar(1.5), transparent: true, opacity: 0, depthWrite: false }),
    );
    portal.position.set(0, 1.0, -0.08);
    g.add(portal);

    const emblem = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd166').multiplyScalar(1.4), side: THREE.DoubleSide });
    const leaves = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.x = side * 0.72;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.96, 0.1), dark);
      leaf.position.set(-side * 0.36, 1.0, 0);
      const half = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24, side < 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI), emblem);
      half.position.set(-side * 0.72, 1.15, 0.056);
      pivot.add(leaf, half);
      g.add(pivot);
      return { pivot, side };
    });

    // 左边的灯是解码锁，右边是理解锁
    const lamps = [-1, 1].map((side) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4d6d').multiplyScalar(1.8) }));
      mesh.position.set(side * 0.5, 2.15, 0.27);
      g.add(mesh);
      return { mesh, open: null };
    });

    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 1.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.2;
    hit.userData.door = true;
    g.add(hit);
    this.door = { group: g, leaves, lamps, portal, hit, k: 0 };
  }

  /** 门开到几成：0 关着，1 全开 */
  #swingDoor(k) {
    const d = this.door;
    d.k = k;
    for (const { pivot, side } of d.leaves) pivot.rotation.y = -side * k * 1.75;
    d.portal.material.opacity = k;
  }

  /** Bix 气象塔：四个斜着转的圆环是四个季节，顶上的球按冬、春、夏、秋换颜色；开门以后从地下升起来 */
  #buildTower() {
    const holder = new THREE.Group();
    place(holder, TOWER_SPOT.x, TOWER_SPOT.z);
    // 缩小一点：开门的镜头离得近，整座塔要拍得下
    holder.scale.setScalar(0.82);
    this.site.add(holder);
    const g = new THREE.Group();
    g.visible = false;
    holder.add(g);
    const white = new THREE.MeshStandardMaterial({ color: '#e3e9f7', roughness: 0.35, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2b3150', roughness: 0.6 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.4, 8), new THREE.MeshStandardMaterial({ color: '#7b86b0', roughness: 0.8, flatShading: true }));
    base.position.y = 0.2;
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.2, 3.7, 12), white);
    spire.position.y = 2.2;
    g.add(base, spire);
    const rings = SEASON_COLORS.map((color, i) => {
      const spin = new THREE.Group();
      spin.position.y = 1.15 + i * 0.72;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66 - i * 0.08, 0.05, 8, 40), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.4 }));
      ring.rotation.x = Math.PI / 2 + (i % 2 ? 0.35 : -0.35);
      spin.add(ring);
      g.add(spin);
      return spin;
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshBasicMaterial({ color: SEASON_COLORS[0] }));
    orb.position.y = 4.3;
    const cups = new THREE.Group();
    cups.position.y = 4.85;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
    pole.position.y = -0.15;
    cups.add(pole);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.025), dark);
      arm.position.set(Math.cos(a) * 0.21, 0, Math.sin(a) * 0.21);
      arm.rotation.y = -a;
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI), white);
      cup.position.set(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
      cup.rotation.y = -a;
      cups.add(arm, cup);
    }
    g.add(orb, cups);
    this.tower = { group: g, rings, orb, cups, height: 5.1 };
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
      const spots = [...Object.values(STATION_SPOTS), ...EXTRA_SPOTS, DOOR_SPOT, TOWER_SPOT, { x: 1.4, z: 1.0 }];
      if (Math.hypot(x, z) < 2 || spots.some((s) => Math.hypot(x - s.x, z - s.z) < 1.5)) continue;
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
    // 使命号（MISSION-1）：不锈钢船身、一侧黑色隔热瓦、前后两对襟翼（借鉴星舰的外形，不照搬）
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
    place(group, ZIB_HOME.x, ZIB_HOME.z);
    group.rotation.y = ZIB_HOME.yaw;
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
    if (this.mapMode) {
      this.shipWiggle = Math.max(0, (this.shipWiggle || 0) - dt * 1.6);
      this.ship.rotation.z = Math.sin(t * 30) * 0.06 * this.shipWiggle;
    }
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
    // 走向目标站点：顺着地面走，走的时候脚步快一点，到了转身朝着镜头（闲逛时由闲逛模式设 walking）
    let walking = !!z.walking;
    if (z.goal) {
      const p = z.group.position;
      const dx = z.goal.x - p.x;
      const dz = z.goal.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.03) {
        walking = true;
        const step = this.reduced ? dist : Math.min(dist, dt * 2.6);
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        p.y = ground(p.x, p.z);
        z.group.rotation.set(0, Math.atan2(dx, dz), 0);
      } else {
        const face = Math.atan2(-p.x, 6 - p.z);
        z.group.rotation.set(0, z.group.rotation.y + (face - z.group.rotation.y) * Math.min(1, dt * 6), 0);
      }
    }
    const idle = this.reduced ? 0 : Math.abs(Math.sin(t * (walking ? 9 : 2.6))) * (walking ? 0.1 : 0.04);
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
    this.towerBeacon.visible = this.beaconBoost > 0 || Math.sin(t * 2.5) > -0.3;
    this.towerBeacon.scale.setScalar(this.beaconBoost > 0 ? 1.8 + Math.sin(t * 20) * 0.4 : 1);
    for (const ring of this.doneRings.values()) ring.material.opacity = 0.6 + Math.sin(t * 3) * 0.3;
    this.padLights.forEach((m, i) => (m.visible = Math.sin(t * 3 - i * 0.8) > -0.2));
    // 门：锁着的灯轻轻跳，开着的门后面的光一明一暗
    const d = this.door;
    for (const lamp of d.lamps) lamp.mesh.scale.setScalar(lamp.open ? 1 : 1 + Math.sin(t * 3) * 0.1);
    if (d.k > 0) d.portal.material.opacity = d.k * (0.85 + Math.sin(t * 2.2) * 0.15);
    // 气象塔：圆环转，顶上的球按冬、春、夏、秋一圈一圈换颜色，风速计一直转
    const tw = this.tower;
    if (tw.group.visible) {
      tw.rings.forEach((r, i) => (r.rotation.y += dt * (0.5 + i * 0.2) * (i % 2 ? -1 : 1)));
      const season = (t * 0.25) % 4;
      const i = Math.floor(season);
      tw.orb.material.color.set(SEASON_COLORS[i]).lerp(c1.set(SEASON_COLORS[(i + 1) % 4]), easeInOut(season - i)).multiplyScalar(1.6);
      tw.cups.rotation.y += dt * 4;
    }
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
