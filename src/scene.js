import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Particles, dotTexture } from './particles.js';

const GOLD = new THREE.Color('#ffd166');
const MOON_IDLE = new THREE.Color('#56618f');
const PLANET_RADIUS = 1.3;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FIREWORK_COLORS = [
  ['#ff4d6d', '#ffd166'],
  ['#4cc9f0', '#ffffff'],
  ['#80ed99', '#ffd166'],
  ['#b388ff', '#ff9fd2'],
  ['#ffc23d', '#ff6b35'],
];

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

/**
 * 三维太空场景：每个科目是一颗星球，每项作业是围着星球转的小卫星，
 * 中间的火箭显示总进度，全部完成后发射。
 *
 * 事件：'select' { subjectId, taskId? }、'rocket'
 */
export class HomeworkScene extends EventTarget {
  constructor(container, homework, progress) {
    super();
    this.container = container;
    this.homework = homework;
    this.progress = progress;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050816');
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.particles = new Particles(5000);
    this.scene.add(this.particles.points);

    this.#buildLights();
    this.#buildSky();
    this.#buildRocket();
    this.#buildPlanets();

    // 相机与交互状态
    this.width = 1;
    this.height = 1;
    this.focused = null;
    this.hovered = null;
    this.inset = { right: 0, bottom: 0 };
    this.offset = { x: 0, y: 0 };
    this.orbitSpeed = REDUCED_MOTION ? 0 : 0.03;
    this.camPos = new THREE.Vector3(0, 26, 58);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.goalPos = new THREE.Vector3();
    this.goalLook = new THREE.Vector3();
    this.pointer = new THREE.Vector2(9, 9);
    this.parallax = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.fuelShown = -1;
    this.launchState = null;
    this.nextShootingStar = 3;
    this.time = 0;
    this.cinematic = null;
    this.last = performance.now();

    this.#bindPointer();
    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();

    progress.addEventListener('change', () => this.refresh());
    this.refresh();
    this.renderer.setAnimationLoop(() => this.#tick());
  }

  // ---------- 对外接口 ----------

  focus(subjectId) {
    this.focused = subjectId ? this.planets.find((p) => p.subject.id === subjectId) : null;
  }

  /** 换难度后作业变了：星球和卫星重新生成，并播放出场动画 */
  setHomework(homework) {
    this.homework = homework;
    this.focused = null;
    this.hovered = null;
    for (const planet of this.planets) planet.labelObj.removeFromParent();
    this.scene.remove(this.orbit);
    disposeTree(this.orbit);
    this.#buildPlanets(true);
    this.refresh();
  }

  /** UI 面板挡住的区域（像素），相机会把星球移到剩下的可见区域中间 */
  setInset(inset) {
    this.inset = inset;
  }

  refresh() {
    for (const planet of this.planets) {
      const { subject } = planet;
      const done = subject.tasks.filter((t) => this.progress.isDone(t)).length;
      planet.complete = done === subject.tasks.length;
      planet.label.count.textContent = `${done}/${subject.tasks.length}`;
      planet.label.bar.style.width = `${this.progress.subjectFraction(subject) * 100}%`;
      planet.label.el.classList.toggle('done', planet.complete);
      for (const moon of planet.moons) {
        const f = this.progress.taskFraction(moon.task);
        if (f >= 1 && moon.fraction < 1) moon.pulse = 1;
        moon.fraction = f;
      }
    }
    this.fuel = this.progress.overall();
  }

  celebrate(subjectId, level = 'correct') {
    const planet = this.planets.find((p) => p.subject.id === subjectId);
    if (!planet) return;
    const at = planet.body.getWorldPosition(v1);
    const colors = ['#ffd166', planet.subject.color, '#ffffff'];
    if (level === 'correct') {
      this.particles.emit(at, { count: 90, colors, speed: 4.5, gravity: -1.5, life: 1.3 });
    } else if (level === 'task') {
      this.particles.firework(at, colors);
    } else {
      this.particles.firework(at, colors);
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const p = planet.body.getWorldPosition(new THREE.Vector3());
          p.add(new THREE.Vector3((Math.random() - 0.5) * 5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3));
          this.particles.firework(p, FIREWORK_COLORS[(Math.random() * FIREWORK_COLORS.length) | 0]);
        }, 300 + i * 350);
      }
    }
  }

  nudgeRocket() {
    this.rocketWiggle = 1;
  }

  launch() {
    if (this.launchState) return this.launchState.promise;
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    this.launchState = { t: 0, v: 0, nextFirework: 1.4, resolve, promise };
    return promise;
  }

  get isLaunching() {
    return !!this.launchState;
  }

  /**
   * 开场动画：把相机交给 cinematic（需要有 update(dt, t, camera)），期间不能点星球。
   * 结束后相机从当前位置平滑飞回使命星球。
   */
  startCinematic(cinematic) {
    this.cinematic = cinematic;
    this.focused = null;
    this.hovered = null;
    this.renderer.domElement.style.cursor = '';
  }

  endCinematic() {
    if (!this.cinematic) return;
    this.cinematic = null;
    this.camPos.copy(this.camera.position);
    this.camLook.copy(this.camera.getWorldDirection(v1)).multiplyScalar(12).add(this.camera.position);
    this.parallax.set(0, 0);
  }

  // ---------- 场景搭建 ----------

  #buildLights() {
    this.scene.add(new THREE.HemisphereLight('#b9c6ff', '#2a1b3d', 1.3));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
    sun.position.set(8, 10, 9);
    this.scene.add(sun);
    this.coreLight = new THREE.PointLight('#ffb36b', 25, 0, 2);
    this.coreLight.position.set(0, 1, 0);
    this.scene.add(this.coreLight);
  }

  #buildSky() {
    // 闪烁的星空
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const palette = ['#ffffff', '#cfe3ff', '#fff2c9', '#ffd1ea', '#bde9ff'].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      v1.randomDirection().multiplyScalar(90 + Math.random() * 90);
      v1.toArray(positions, i * 3);
      palette[(Math.random() * palette.length) | 0].toArray(colors, i * 3);
      sizes[i] = Math.random() < 0.04 ? 3.5 + Math.random() * 2 : 0.8 + Math.random() * 1.8;
      phases[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.starUniforms = { uTime: { value: 0 }, uScale: { value: 1 } };
    const stars = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.starUniforms,
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aPhase;
          uniform float uTime;
          uniform float uScale;
          varying vec3 vColor;
          varying float vTwinkle;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            vTwinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aPhase * 2.2) + aPhase * 6.2831);
            vColor = aColor;
            gl_PointSize = aSize * uScale * (0.7 + 0.3 * vTwinkle) * (130.0 / -mv.z);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vTwinkle;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = pow(smoothstep(0.5, 0.0, d), 1.8);
            gl_FragColor = vec4(vColor * a * (0.6 + vTwinkle * 1.2), a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(stars);

    // 星云
    const nebulaTex = dotTexture();
    const nebulae = [
      ['#6a4cff', -70, 25, -110, 120],
      ['#ff4fa3', 80, -10, -120, 110],
      ['#2ec5ff', 10, 50, -140, 150],
      ['#7b2fff', -90, -40, 40, 120],
      ['#ff7a59', 100, 40, 30, 100],
    ];
    for (const [color, x, y, z, s] of nebulae) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: nebulaTex, color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(s);
      this.scene.add(sprite);
    }

    // 流星
    const trail = new THREE.BufferGeometry();
    trail.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    trail.setAttribute('color', new THREE.BufferAttribute(new Float32Array([3, 3, 3, 0, 0, 0]), 3));
    this.shootingStar = new THREE.Line(
      trail,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.shootingStar.frustumCulled = false;
    this.shootingStar.visible = false;
    this.scene.add(this.shootingStar);
  }

  #buildRocket() {
    this.base = new THREE.Group();
    this.base.position.y = -1.7;
    this.scene.add(this.base);

    const metal = new THREE.MeshStandardMaterial({ color: '#2b335c', roughness: 0.45, metalness: 0.7 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.75, 0.3, 48), metal);
    pad.position.y = -0.15;
    this.base.add(pad);

    const track = new THREE.Mesh(
      new THREE.TorusGeometry(2.05, 0.06, 10, 128),
      new THREE.MeshStandardMaterial({ color: '#232a52', roughness: 0.6 }),
    );
    track.rotation.x = -Math.PI / 2;
    this.base.add(track);
    this.fuelRing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(2.2) }));
    this.fuelRing.rotation.x = -Math.PI / 2;
    this.fuelRing.rotation.z = -Math.PI / 2;
    this.fuelRing.position.y = 0.01;
    this.base.add(this.fuelRing);

    const rocket = new THREE.Group();
    this.rocket = rocket;
    this.base.add(rocket);

    const white = new THREE.MeshStandardMaterial({ color: '#f4f6ff', roughness: 0.35, metalness: 0.2 });
    const red = new THREE.MeshStandardMaterial({ color: '#ff4d6d', roughness: 0.4, metalness: 0.15 });
    const lathe = (pts) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 48);
    rocket.add(new THREE.Mesh(lathe([[0, 0.05], [0.36, 0.05], [0.52, 0.4], [0.6, 1.0], [0.58, 1.6], [0.5, 2.05], [0, 2.05]]), white));
    rocket.add(new THREE.Mesh(lathe([[0.5, 2.04], [0.38, 2.4], [0.2, 2.72], [0, 2.86]]), red));

    const band = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.045, 10, 48), red);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.75;
    rocket.add(band);

    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 12, 36), metal);
    frame.position.set(0, 1.45, 0.58);
    rocket.add(frame);
    this.windowMat = new THREE.MeshStandardMaterial({ color: '#7fdcff', emissive: '#4cc9f0', emissiveIntensity: 0.3, roughness: 0.1 });
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), this.windowMat);
    glass.scale.z = 0.4;
    glass.position.set(0, 1.45, 0.56);
    rocket.add(glass);

    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0.95);
    finShape.quadraticCurveTo(0.3, 0.55, 0.55, 0.0);
    finShape.lineTo(0.58, -0.22);
    finShape.lineTo(0.3, -0.05);
    finShape.lineTo(0, 0.1);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.06, bevelEnabled: false });
    finGeo.translate(0, 0, -0.03);
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const fin = new THREE.Mesh(finGeo, red);
      fin.position.set(0.4, 0.05, 0);
      pivot.add(fin);
      rocket.add(pivot);
    }

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 0.22, 24), metal);
    nozzle.position.y = -0.04;
    rocket.add(nozzle);

    // 火焰：外焰橙色、内焰亮黄（数值大于 1，会触发泛光）
    this.flame = new THREE.Group();
    this.flame.position.y = -0.15;
    const flameGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    flameGeo.rotateX(Math.PI);
    flameGeo.translate(0, -0.5, 0);
    const outer = new THREE.Mesh(
      flameGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7b29').multiplyScalar(2.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    outer.scale.set(0.3, 1.5, 0.3);
    const inner = new THREE.Mesh(
      flameGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff3b0').multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    inner.scale.set(0.16, 0.9, 0.16);
    this.flame.add(outer, inner);
    this.flame.scale.setScalar(0.0001);
    rocket.add(this.flame);
    this.flameSize = 0;

    this.rocketHit = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.6, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.rocketHit.position.y = 1.4;
    this.rocketHit.userData.rocket = true;
    rocket.add(this.rocketHit);
  }

  #buildPlanets(animate = false) {
    const subjects = this.homework.subjects;
    const n = subjects.length;
    this.ringRadius = n <= 3 ? 6.2 : 6.2 + (n - 3) * 0.9;
    this.orbit = new THREE.Group();
    this.scene.add(this.orbit);
    this.hitTargets = [this.rocketHit];

    const sphere = new THREE.SphereGeometry(PLANET_RADIUS, 64, 48);
    const glowGeo = new THREE.SphereGeometry(PLANET_RADIUS * 1.28, 48, 32);
    const moonGeo = new THREE.SphereGeometry(0.2, 24, 16);
    const hitGeo = new THREE.SphereGeometry(2.4, 16, 12);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    this.planets = subjects.map((subject, i) => {
      const angle = (i / n) * Math.PI * 2 + Math.PI / 2;
      const color = new THREE.Color(subject.color);
      const group = new THREE.Group();
      group.position.set(Math.cos(angle) * this.ringRadius, 0, Math.sin(angle) * this.ringRadius);
      this.orbit.add(group);

      const body = new THREE.Mesh(
        sphere,
        new THREE.MeshStandardMaterial({ map: planetTexture(color, i), roughness: 0.85, metalness: 0.05, emissive: color, emissiveIntensity: 0.12 }),
      );
      body.rotation.z = 0.3;
      group.add(body);

      const glow = new THREE.Mesh(glowGeo, glowMaterial(color));
      group.add(glow);

      if (i % 2 === 1) group.add(planetRing(color));

      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.userData.subjectId = subject.id;
      group.add(hit);
      this.hitTargets.push(hit);

      const moons = subject.tasks.map((task, ti) => {
        const mesh = new THREE.Mesh(
          moonGeo,
          new THREE.MeshStandardMaterial({ color: MOON_IDLE.clone(), roughness: 0.55, metalness: 0.2, emissive: GOLD, emissiveIntensity: 0 }),
        );
        mesh.position.x = 1.95 + (ti % 3) * 0.32;
        mesh.userData = { subjectId: subject.id, taskId: task.id };
        const pivot = new THREE.Group();
        pivot.add(mesh);
        group.add(pivot);
        this.hitTargets.push(mesh);
        return {
          task,
          mesh,
          pivot,
          tilt: (ti % 2 ? -1 : 1) * (0.25 + ti * 0.12),
          speed: Math.max(0.18, 0.55 - ti * 0.07),
          phase: (ti / subject.tasks.length) * Math.PI * 2,
          fraction: 0,
          shown: 0,
          pulse: 0,
        };
      });

      const label = makeLabel(subject, () => this.dispatchEvent(new CustomEvent('select', { detail: { subjectId: subject.id } })));
      const labelObj = new CSS2DObject(label.el);
      labelObj.position.set(0, -2.15, 0);
      group.add(labelObj);

      // 出场动画：依次从小变大，冒出一圈星星
      const appear = animate ? -0.25 * i : 1;
      if (animate) group.scale.setScalar(0.0001);
      return { subject, group, body, glow, moons, label, labelObj, appear, scale: 1, spin: 0.1 + i * 0.03, bob: i * 1.7, complete: false };
    });
  }

  // ---------- 交互 ----------

  #bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointermove', (e) => {
      this.#setPointer(e);
      if (e.pointerType === 'mouse') {
        const hit = this.#pick();
        this.hovered = hit?.object.userData.subjectId ?? (hit?.object.userData.rocket ? 'rocket' : null);
        el.style.cursor = this.hovered ? 'pointer' : '';
      }
    });
    el.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.pointer.set(9, 9);
    });
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
      down = null;
      this.#setPointer(e);
      const hit = this.#pick();
      if (!hit) return;
      const { subjectId, taskId, rocket } = hit.object.userData;
      if (rocket) this.dispatchEvent(new CustomEvent('rocket'));
      else this.dispatchEvent(new CustomEvent('select', { detail: { subjectId, taskId } }));
    });
  }

  #setPointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  #pick() {
    if (Math.abs(this.pointer.x) > 1 || this.launchState || this.cinematic) return null;
    // 视图偏移会改变投影，射线需要用同一个相机矩阵
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitTargets, false);
    // 卫星优先（小而精确），其次星球，最后火箭
    return hits.find((h) => h.object.userData.taskId) || hits.find((h) => h.object.userData.subjectId) || hits[0] || null;
  }

  #resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.starUniforms.uScale.value = this.renderer.getPixelRatio() * Math.min(1.4, Math.max(0.7, h / 800));
  }

  // ---------- 相机 ----------

  #computeGoal() {
    const aspect = this.width / this.height;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    if (this.focused) {
      const p = this.focused.group.getWorldPosition(v1);
      const fx = Math.max(0.3, (this.width - this.inset.right) / this.width);
      const fy = Math.max(0.3, (this.height - this.inset.bottom) / this.height);
      const need = 3.9;
      const dist = Math.max(6.5, need / (t * aspect * fx), need / (t * fy));
      v2.set(p.x, 0, p.z).normalize().multiplyScalar(Math.cos(0.3)).setY(Math.sin(0.3)).normalize();
      this.goalPos.copy(p).addScaledVector(v2, dist);
      this.goalLook.copy(p);
    } else {
      const halfW = this.ringRadius + 2.9;
      const dist = Math.max(20, (halfW / (t * aspect)) * 1.08);
      const el = aspect < 1 ? 0.9 : 0.62;
      this.goalPos.set(0, Math.sin(el) * dist, Math.cos(el) * dist);
      this.goalLook.set(0, aspect < 1 ? -0.6 : -1.3, aspect < 1 ? 0 : 0.6);
    }
    if (this.launchState) {
      const lift = Math.min(7, Math.max(0, this.rocket.position.y) * 0.4);
      this.goalLook.y += lift;
    }
  }

  #updateViewOffset(k) {
    const tx = this.focused ? this.inset.right / 2 : 0;
    const ty = this.focused ? this.inset.bottom / 2 : 0;
    this.offset.x += (tx - this.offset.x) * k;
    this.offset.y += (ty - this.offset.y) * k;
    if (Math.abs(this.offset.x) < 0.5 && Math.abs(this.offset.y) < 0.5 && tx === 0 && ty === 0) {
      if (this.camera.view?.enabled) this.camera.clearViewOffset();
    } else {
      this.camera.setViewOffset(this.width, this.height, this.offset.x, this.offset.y, this.width, this.height);
    }
  }

  // ---------- 动画 ----------

  #tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const t = this.time;

    // 星球公转：选中某颗星球时慢慢停下
    const targetSpeed = this.focused || this.launchState || REDUCED_MOTION ? 0 : 0.03;
    this.orbitSpeed += (targetSpeed - this.orbitSpeed) * Math.min(1, dt * 2);
    this.orbit.rotation.y += this.orbitSpeed * dt;

    for (const planet of this.planets) {
      const active = planet === this.focused || planet.subject.id === this.hovered;
      planet.scale += ((active ? 1.12 : 1) - planet.scale) * Math.min(1, dt * 6);
      if (planet.appear < 1) {
        const before = planet.appear;
        planet.appear = Math.min(1, planet.appear + dt * 1.4);
        if (before <= 0 && planet.appear > 0) {
          this.particles.emit(planet.group.getWorldPosition(v1), { count: 80, colors: [planet.subject.color, '#ffffff'], speed: 4, gravity: 0, life: 1 });
        }
      }
      planet.group.scale.setScalar(planet.scale * easeOutBack(Math.max(0, planet.appear)));
      planet.labelObj.visible = planet.appear > 0.4;
      planet.group.position.y = Math.sin(t * 0.8 + planet.bob) * 0.18;
      planet.body.rotation.y += dt * planet.spin;
      const glowTarget = planet.complete ? 2.2 : active ? 1.4 : 1.0;
      const u = planet.glow.material.uniforms.uIntensity;
      u.value += (glowTarget - u.value) * Math.min(1, dt * 4);
      planet.body.material.emissiveIntensity = planet.complete ? 0.3 + Math.sin(t * 2) * 0.08 : 0.06;

      for (const moon of planet.moons) {
        moon.pivot.rotation.set(moon.tilt, moon.phase + t * moon.speed, 0);
        moon.shown += (moon.fraction - moon.shown) * Math.min(1, dt * 3);
        const m = moon.mesh.material;
        m.color.copy(MOON_IDLE).lerp(GOLD, moon.shown);
        m.emissiveIntensity = moon.fraction >= 1 ? 1.4 + Math.sin(t * 4 + moon.phase) * 0.3 : moon.shown * 0.35;
        moon.pulse = Math.max(0, moon.pulse - dt * 1.5);
        moon.mesh.scale.setScalar(1 + (moon.fraction >= 1 ? 0.25 : 0) + Math.sin(moon.pulse * Math.PI) * 1.2);
      }
    }

    this.#updateFuel(dt);
    this.#updateRocket(dt, t);
    this.#updateShootingStar(dt);
    this.particles.update(dt);
    this.starUniforms.uTime.value = t;

    if (this.cinematic) {
      if (this.camera.view?.enabled) this.camera.clearViewOffset();
      this.cinematic.update(dt, t, this.camera);
      this.composer.render();
      return;
    }

    // 相机
    this.#computeGoal();
    const k = 1 - Math.exp(-dt * (this.focused ? 2.6 : 1.8));
    this.camPos.lerp(this.goalPos, k);
    this.camLook.lerp(this.goalLook, k);
    const px = this.focused ? 0.25 : 1;
    if (Math.abs(this.pointer.x) <= 1 && !REDUCED_MOTION) {
      this.parallax.x += (this.pointer.x - this.parallax.x) * dt * 2;
      this.parallax.y += (this.pointer.y - this.parallax.y) * dt * 2;
    }
    this.camera.position.copy(this.camPos);
    this.camera.position.x += this.parallax.x * 0.9 * px;
    this.camera.position.y += this.parallax.y * 0.5 * px;
    this.camera.lookAt(this.camLook);
    this.#updateViewOffset(k);

    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  }

  #updateFuel(dt) {
    const target = this.fuel ?? 0;
    if (this.fuelShown < 0) this.fuelShown = target;
    const next = this.fuelShown + (target - this.fuelShown) * Math.min(1, dt * 3);
    if (Math.abs(next - this.fuelShown) > 0.0005 || !this.fuelRing.geometry.attributes.position) {
      this.fuelShown = Math.abs(target - next) < 0.001 ? target : next;
      this.fuelRing.geometry.dispose();
      this.fuelRing.geometry = new THREE.TorusGeometry(2.05, 0.09, 10, 128, Math.max(0.0001, this.fuelShown * Math.PI * 2));
    }
    this.windowMat.emissiveIntensity = 0.3 + this.fuelShown * 2.2;
    this.coreLight.intensity = 18 + this.fuelShown * 30;
  }

  #updateRocket(dt, t) {
    const L = this.launchState;
    const ready = (this.fuel ?? 0) >= 0.999;
    let flameGoal = ready ? 0.45 : 0;

    if (L) {
      L.t += dt;
      const nozzle = this.rocket.localToWorld(v1.set(0, -0.3, 0));
      if (L.t < 1.3) {
        // 点火：抖动、冒烟
        flameGoal = 0.6 + L.t * 0.5;
        this.rocket.position.x = (Math.random() - 0.5) * 0.06;
        if (Math.random() < 0.6) this.particles.emit(nozzle, { count: 6, colors: ['#9aa3c7', '#d6dbf5'], speed: 2.2, dir: v2.set(0, -0.2, 0), spread: 1, gravity: 0.6, life: 1.6, intensity: 0.5 });
      } else if (L.t < 5.2) {
        // 升空
        flameGoal = 1.25;
        this.rocket.position.x = 0;
        L.v += dt * (3 + L.v * 0.8);
        this.rocket.position.y += L.v * dt;
        this.rocket.rotation.z = Math.sin(L.t * 3) * 0.03;
        this.particles.emit(nozzle, { count: 8, colors: ['#ffd166', '#ff7b29', '#ffffff'], speed: 2.5, dir: v2.set(0, -1, 0), spread: 0.35, gravity: -2, life: 0.7, intensity: 2.4 });
      } else if (L.t < 5.4) {
        flameGoal = 0;
        this.rocket.position.y = 22;
        this.rocket.rotation.z = 0;
      } else if (L.t < 8.6) {
        // 缓缓降落回发射台
        const p = (L.t - 5.4) / 3.2;
        const e = 1 - Math.pow(1 - p, 3);
        this.rocket.position.y = 22 * (1 - e);
        flameGoal = 0.35 + (1 - p) * 0.4;
      } else {
        this.rocket.position.y = 0;
        this.launchState = null;
        L.resolve();
      }
      if (L.t >= L.nextFirework && L.t < 7.5) {
        L.nextFirework += 0.28 + Math.random() * 0.25;
        v1.set((Math.random() - 0.5) * 18, 3 + Math.random() * 7, -3 - Math.random() * 6);
        this.particles.firework(v1, FIREWORK_COLORS[(Math.random() * FIREWORK_COLORS.length) | 0]);
      }
    } else {
      this.rocket.position.y = ready ? 0.12 + Math.sin(t * 2.2) * 0.06 : 0;
      this.rocketWiggle = Math.max(0, (this.rocketWiggle || 0) - dt * 1.6);
      this.rocket.rotation.z = Math.sin(t * 30) * 0.08 * this.rocketWiggle;
      if (this.hovered === 'rocket') this.rocket.rotation.y += dt * 1.5;
    }

    this.flameSize += (flameGoal - this.flameSize) * Math.min(1, dt * 6);
    const flicker = 1 + Math.sin(t * 40) * 0.08 + Math.sin(t * 23) * 0.06;
    const s = Math.max(0.0001, this.flameSize);
    this.flame.scale.set(s, s * flicker, s);
  }

  #updateShootingStar(dt) {
    if (REDUCED_MOTION) return;
    const s = this.shootingStar;
    if (!s.visible) {
      this.nextShootingStar -= dt;
      if (this.nextShootingStar > 0) return;
      this.nextShootingStar = 4 + Math.random() * 6;
      s.userData.head = new THREE.Vector3((Math.random() - 0.5) * 120, 30 + Math.random() * 30, -70 - Math.random() * 30);
      s.userData.vel = new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 30), -25 - Math.random() * 15, 0);
      s.userData.life = 1.1;
      s.visible = true;
    }
    const { head, vel } = s.userData;
    s.userData.life -= dt;
    head.addScaledVector(vel, dt);
    const tail = v1.copy(head).addScaledVector(vel, -0.12);
    const pos = s.geometry.attributes.position;
    pos.setXYZ(0, head.x, head.y, head.z);
    pos.setXYZ(1, tail.x, tail.y, tail.z);
    pos.needsUpdate = true;
    s.material.opacity = Math.min(1, s.userData.life * 2);
    if (s.userData.life <= 0) s.visible = false;
  }
}

// ---------- 小工具 ----------

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return x <= 0 ? 0.0001 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function disposeTree(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of materials) {
      m.map?.dispose();
      m.dispose();
    }
  });
}

export function makeLabel(subject, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'planet-label';
  el.style.setProperty('--c', subject.color);
  const icon = document.createElement('span');
  icon.className = 'pl-icon';
  icon.textContent = subject.icon;
  const name = document.createElement('span');
  name.className = 'pl-name';
  name.textContent = subject.name;
  const count = document.createElement('span');
  count.className = 'pl-count';
  const track = document.createElement('span');
  track.className = 'pl-bar';
  const bar = document.createElement('i');
  track.appendChild(bar);
  el.append(icon, name, count, track);
  el.setAttribute('aria-label', `打开${subject.name}的使命任务`);
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return { el, count, bar };
}

export function planetTexture(color, seed) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  const hsl = {};
  color.getHSL(hsl, THREE.SRGBColorSpace);
  const H = hsl.h * 360;
  const S = Math.min(95, hsl.s * 100);
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);

  for (let y = 0; y < 256; y++) {
    const v = Math.sin(y * 0.045 + seed) * 0.5 + Math.sin(y * 0.13 + seed * 3) * 0.3 + Math.sin(y * 0.33 + seed * 7) * 0.2;
    const l = Math.min(80, Math.max(22, hsl.l * 100 + v * 13));
    g.fillStyle = `hsl(${H + v * 10}, ${S}%, ${l}%)`;
    g.fillRect(0, y, 512, 1);
  }
  for (let i = 0; i < 28; i++) {
    const x = rand() * 512;
    const y = 30 + rand() * 196;
    const rad = 5 + rand() * 20;
    const light = Math.min(85, Math.max(18, hsl.l * 100 + (rand() > 0.5 ? 14 : -14)));
    g.fillStyle = `hsla(${H}, ${S * 0.85}%, ${light}%, 0.55)`;
    for (const dx of [-512, 0, 512]) {
      g.beginPath();
      g.ellipse(x + dx, y, rad * 1.7, rad, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function glowMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uIntensity: { value: 1.2 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float f = pow(clamp(-dot(vNormal, vView) * 1.6, 0.0, 1.0), 2.2);
        gl_FragColor = vec4(uColor * f * uIntensity, f);
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

function planetRing(color) {
  const inner = PLANET_RADIUS * 1.45;
  const outer = PLANET_RADIUS * 2.05;
  const geo = new THREE.RingGeometry(inner, outer, 96, 1);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (d - inner) / (outer - inner), 0.5);
  }
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const g = c.getContext('2d');
  const hsl = {};
  color.getHSL(hsl, THREE.SRGBColorSpace);
  for (let x = 0; x < 256; x++) {
    const a = (0.25 + 0.5 * Math.abs(Math.sin(x * 0.09)) * (0.6 + 0.4 * Math.sin(x * 0.31))) * Math.sin((x / 255) * Math.PI);
    g.fillStyle = `hsla(${hsl.h * 360}, 70%, 78%, ${a.toFixed(3)})`;
    g.fillRect(x, 0, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ring = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2 + 0.45;
  ring.rotation.y = 0.2;
  return ring;
}
