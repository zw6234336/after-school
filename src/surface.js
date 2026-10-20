// 着陆以后的主界面：Bix 星当前这一层的地面地图。
// 站点就是界面里的“科目”：答题面板、进度、报告照常使用，只是三维画面和镜头换成地面上的站点。
// 对 UI 提供和 HomeworkScene 一样的接口（focus、setInset、celebrate、launch、nudgeRocket、setHomework、isLaunching）
// 和一样的事件（'select'、'rocket'）。
// 章节里写了 explore 的话，还可以离开着陆区闲逛（startExplore / goHome），
// 事件：'explore' { on }、'discover' { id }、'zone' { zone }、'walk'。
// 章节里写了 door 的话，地图上还有一扇通往下一层的门（setDoor / openDoor），点它发 'door' 事件。

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BixStage, STATION_SPOTS, BIX_RADIUS, DOOR_SPOT, DOOR_SHOTS } from './bix.js';
import { BixExplore } from './explore.js';
import { makeLabel } from './scene.js';
import { foundDiscoveries } from './story.js';

/** 总览镜头（相对着陆点）：从发射台前上方俯看整个着陆区 */
const OVERVIEW = { pos: [0, 8.6, 13.5], look: [0, 0.3, -0.8] };
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 闲逛时视野大一点，弯弯的地平线和身边的东西都能看到；竖屏左右窄，再大一点 */
const FOV = { map: 40, explore: 52, exploreTall: 60 };
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q0 = new THREE.Quaternion();
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class BixSurface extends EventTarget {
  /**
   * host：HomeworkScene（借用它的渲染器、粒子和动画循环）
   * stage：开场动画留下来的布景；没有就新建一个，镜头直接放到总览位置
   */
  constructor(host, homework, progress, { stage, chapter } = {}) {
    super();
    this.host = host;
    this.progress = progress;
    this.chapter = chapter || null;
    const fresh = !stage;
    this.stage = stage || new BixStage(host);
    this.stage.setTheme(chapter?.surface);
    this.stage.enterMap();

    this.explore = chapter?.explore?.zones?.length ? new BixExplore(this.stage, host, chapter, foundDiscoveries(chapter.id)) : null;
    this.exploring = false;
    this.flight = null;
    if (this.explore) {
      for (const type of ['discover', 'zone', 'walk']) {
        this.explore.addEventListener(type, (e) => this.dispatchEvent(new CustomEvent(type, { detail: e.detail })));
      }
    }

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer surface-labels';
    host.container.appendChild(this.labelRenderer.domElement);
    host.labelRenderer.domElement.style.display = 'none';

    this.stations = [];
    this.kiosks = new Map();
    this.focused = null;
    this.inset = { right: 0, bottom: 0 };
    this.offset = { x: 0, y: 0 };
    // 相机的实际位置（已经按竖屏退后过）；up 在闲逛时跟着脚下的地面转
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.goalPos = new THREE.Vector3();
    this.goalLook = new THREE.Vector3();
    this.goalUp = new THREE.Vector3(0, 1, 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(9, 9);
    this.launching = null;

    this.setHomework(homework);
    if (chapter?.door) this.#buildDoorLabel(chapter.door);
    this.#computeGoal(host.camera.aspect);
    if (fresh) {
      this.camPos.copy(this.goalPos);
      this.camLook.copy(this.goalLook);
    } else {
      this.camPos.copy(host.camera.position);
      this.camLook.copy(this.stage.lookPos);
    }

    this.onProgress = () => this.refresh();
    progress.addEventListener('change', this.onProgress);
    this.#bindPointer();
    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(host.container);
    this.#resize();
    host.startCinematic(this);
  }

  // ---------- 和 HomeworkScene 一样的接口 ----------

  /** 作业变了（换难度）：重新摆站点名牌 */
  setHomework(homework) {
    this.homework = homework;
    for (const st of this.stations) {
      st.labelObj.removeFromParent();
      st.hit.removeFromParent();
      st.hit.geometry.dispose();
    }
    this.stations = [];
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const subject of homework.stations) {
      let spot = subject.key ? STATION_SPOTS[subject.key] : this.kiosks.get(subject.id);
      if (!spot) {
        spot = this.stage.addKiosk(this.kiosks.size, subject.color);
        if (!spot) continue;
        this.kiosks.set(subject.id, spot);
      }
      const label = makeLabel(subject, () => this.#select(subject.id));
      label.el.classList.add('station-label');
      label.el.classList.toggle('empty', subject.tasks.length === 0);
      const labelObj = new CSS2DObject(label.el);
      labelObj.position.copy(this.stage.site.worldToLocal(this.stage.stationWorld(spot, spot.labelY, v1)));
      this.stage.site.add(labelObj);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 3.4, 12), hitMat);
      hit.position.copy(this.stage.site.worldToLocal(this.stage.stationWorld(spot, 1.7, v1)));
      hit.userData.subjectId = subject.id;
      this.stage.site.add(hit);
      labelObj.visible = !this.exploring;
      this.stations.push({ subject, spot, label, labelObj, hit });
    }
    if (this.focused && !this.stations.some((s) => s === this.focused)) this.focused = null;
    this.refresh();
  }

  refresh() {
    for (const st of this.stations) {
      const { tasks } = st.subject;
      if (tasks.length === 0) {
        st.label.count.textContent = '—';
        st.label.bar.style.width = '0%';
        continue;
      }
      const done = tasks.filter((t) => this.progress.isDone(t)).length;
      const complete = done === tasks.length;
      st.label.count.textContent = `${done}/${tasks.length}`;
      st.label.bar.style.width = `${this.progress.subjectFraction(st.subject) * 100}%`;
      st.label.el.classList.toggle('done', complete);
      this.stage.setStationDone(st.spot, complete);
    }
  }

  focus(subjectId) {
    this.focused = subjectId ? this.stations.find((s) => s.subject.id === subjectId) || null : null;
    if (this.focused) this.stage.zibGo(this.focused.spot);
  }

  setInset(inset) {
    this.inset = inset;
  }

  celebrate(subjectId, level = 'correct') {
    const st = this.stations.find((s) => s.subject.id === subjectId);
    if (!st) return;
    const at = this.stage.stationWorld(st.spot, st.spot.labelY * 0.7, new THREE.Vector3());
    const colors = ['#ffd166', st.subject.color, '#ffffff'];
    if (level === 'correct') this.host.particles.emit(at, { count: 70, colors, speed: 3.5, gravity: -1.5, life: 1.2 });
    else this.host.particles.firework(at.add(v1.set(0, 1, 0)), colors);
    if (level !== 'correct') this.stage.zibReact('nod');
  }

  /** 全部完成：信号塔向地球发信号（代替火箭发射） */
  launch() {
    if (this.launching) return this.launching;
    if (this.exploring) this.goHome();
    this.focused = null;
    this.stage.zibGo(STATION_SPOTS.WSL);
    this.launching = this.stage.signal().then(() => {
      this.launching = null;
    });
    return this.launching;
  }

  get isLaunching() {
    return !!this.launching;
  }

  nudgeRocket() {
    this.stage.wiggle();
  }

  // ---------- 通往下一层的门 ----------

  /** 门的名牌和锁灯跟着进度变（DoorHud 每次刷新 HUD 时调用） */
  setDoor(status) {
    if (!this.doorLabel) return;
    const { label } = this.doorLabel;
    const read = status.lessons.length - status.left.length;
    label.count.textContent = status.opened ? '已打开' : status.ready ? `${status.decode ? '🔓' : '🔒'}${status.comprehend ? '🔓' : '🔒'}` : `${read}/${status.lessons.length} 课`;
    label.bar.style.width = `${status.ready ? 100 : (read / status.lessons.length) * 100}%`;
    label.el.classList.toggle('done', status.opened);
    label.el.classList.toggle('ready', status.ready && !status.opened);
    this.stage.setTowerColors(status.door.unlock?.colors);
    this.stage.setDoor(status);
  }

  /** 开门：镜头先拍门打开，再退一点拍气象塔升起来，名牌先收起来；返回 Promise */
  async openDoor() {
    if (this.exploring) this.goHome();
    const labels = this.labelRenderer.domElement.style;
    labels.visibility = 'hidden';
    this.focused = { shot: DOOR_SHOTS.door };
    await wait(REDUCED_MOTION ? 0 : 1200);
    await this.stage.swingOpen();
    this.focused = { shot: DOOR_SHOTS.tower };
    await wait(REDUCED_MOTION ? 0 : 900);
    await this.stage.raiseTower();
    this.focused = null;
    labels.visibility = '';
  }

  #buildDoorLabel(door) {
    // 最后一层的门通往星核（K 年级的终点），其他的门通往下一层
    const name = door.to.layer ? `第 ${door.to.layer} 层` : door.to.name;
    const label = makeLabel({ icon: door.to.layer ? '🚪' : door.to.icon || '💎', name, color: '#b388ff' }, () => this.dispatchEvent(new CustomEvent('door')));
    label.el.classList.add('station-label', 'door-label');
    label.el.setAttribute('aria-label', `通往${name}的门`);
    const labelObj = new CSS2DObject(label.el);
    labelObj.position.copy(this.stage.site.worldToLocal(this.stage.stationWorld(DOOR_SPOT, DOOR_SPOT.labelY, v1)));
    this.stage.site.add(labelObj);
    this.doorLabel = { label, labelObj };
  }

  // ---------- 闲逛 ----------

  get canExplore() {
    return !!this.explore;
  }

  /** 去逛逛：镜头从地图降到小宇航员身后，站点名牌先收起来 */
  startExplore() {
    if (!this.explore || this.exploring || this.launching) return;
    this.#endFlight();
    this.focused = null;
    this.exploring = true;
    this.explore.enter();
    for (const st of this.stations) st.labelObj.visible = false;
    if (this.doorLabel) this.doorLabel.labelObj.visible = false;
    this.#fly();
    this.dispatchEvent(new CustomEvent('explore', { detail: { on: true } }));
  }

  /** 回着陆点：人闪一下回到发射台，镜头沿着星球飞回地图 */
  goHome() {
    if (!this.exploring) return;
    this.#endFlight();
    this.exploring = false;
    this.explore.leave();
    this.#fly(() => {
      this.explore.arriveHome();
      for (const st of this.stations) st.labelObj.visible = true;
      if (this.doorLabel) this.doorLabel.labelObj.visible = true;
    });
    this.dispatchEvent(new CustomEvent('explore', { detail: { on: false } }));
  }

  /** 衣柜：小宇航员身上穿的衣服（Set） */
  setOutfit(ids) {
    this.explore?.setOutfit(ids);
  }

  /** 穿得不对时小宇航员的样子（'cold' / 'wet' / 'hot' / null） */
  setFeel(kind) {
    this.explore?.setFeel(kind);
  }

  /** 穿对了：Zib 点点头，冒一串小星星 */
  cheer() {
    this.stage.zibReact('nod');
  }

  /** 收进图鉴以后：三维里的气泡换成发现物的图标，小云开始跟着人 */
  markFound(id) {
    this.explore?.setFound(id);
  }

  /** 发现卡片挡住的地方（像素，{ right, bottom }），闲逛时画面挪到剩下的区域中间 */
  setCardInset(inset) {
    this.cardInset = inset;
  }

  get zone() {
    return this.explore?.zone || null;
  }

  /** 拆掉地面地图（重新播放开场之前用）；布景一起拆掉，太空里的星球名牌恢复显示 */
  dispose() {
    const el = this.host.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.style.cursor = '';
    this.progress.removeEventListener('change', this.onProgress);
    this.resizeObserver.disconnect();
    this.labelRenderer.domElement.remove();
    this.host.labelRenderer.domElement.style.display = '';
    this.explore?.dispose();
    const camera = this.host.camera;
    camera.up.set(0, 1, 0);
    camera.fov = FOV.map;
    camera.updateProjectionMatrix();
    this.host.endCinematic();
    this.stage.dispose();
  }

  // ---------- 每一帧 ----------

  update(dt, t, camera) {
    this.stage.animate(dt, t);
    this.explore?.update(dt, t, camera);
    this.#computeGoal(camera.aspect);
    const k = 1 - Math.exp(-dt * (this.exploring ? 3.2 : this.focused ? 2.6 : 1.8));
    if (this.flight) {
      this.#updateFlight(dt);
    } else {
      this.camPos.lerp(this.goalPos, k);
      this.camLook.lerp(this.goalLook, k);
      this.camUp.lerp(this.goalUp, k).normalize();
    }
    camera.position.copy(this.camPos);
    camera.up.copy(this.camUp);
    camera.lookAt(this.camLook);
    this.stage.updateVisibility(camera.position);
    this.explore?.afterCamera(camera);
    const fov = this.exploring ? (camera.aspect < 0.75 ? FOV.exploreTall : FOV.explore) : FOV.map;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * (REDUCED_MOTION ? 1 : Math.min(1, dt * 2.5));
      camera.updateProjectionMatrix();
    }

    // 面板挡住的地方：把画面中心挪到剩下的区域；闲逛时发现卡片也一样
    const inset = this.focused ? this.inset : this.exploring && this.cardInset ? this.cardInset : null;
    const tx = inset ? inset.right / 2 : 0;
    const ty = inset ? inset.bottom / 2 : 0;
    this.offset.x += (tx - this.offset.x) * k;
    this.offset.y += (ty - this.offset.y) * k;
    if (Math.abs(this.offset.x) > 0.5 || Math.abs(this.offset.y) > 0.5) {
      const { width: w, height: h } = this.host;
      camera.setViewOffset(w, h, this.offset.x, this.offset.y, w, h);
    }
    // 只渲染 Bix 星上的名牌，太空里的星球名牌不归这里管
    this.labelRenderer.render(this.stage.root, camera);
  }

  #computeGoal(aspect) {
    if (this.exploring) {
      this.explore.cameraGoal(aspect, this.goalPos, this.goalLook, this.goalUp);
      return;
    }
    const site = this.stage.site;
    this.goalUp.set(0, 1, 0);
    if (this.focused?.shot) {
      // 开门的镜头：直接给出相机和看的点（相对着陆点）
      site.localToWorld(this.goalPos.set(...this.focused.shot.pos));
      site.localToWorld(this.goalLook.set(...this.focused.shot.look));
    } else if (this.focused) {
      const { spot } = this.focused;
      this.stage.stationWorld(spot, 0.9, this.goalLook);
      this.goalPos.copy(site.localToWorld(v1.set(spot.x * 0.75, 0, spot.z + 6.4)));
      this.goalPos.y = this.goalLook.y + 3.4;
    } else {
      site.localToWorld(this.goalPos.set(...OVERVIEW.pos));
      site.localToWorld(this.goalLook.set(...OVERVIEW.look));
    }
    this.stage.framePose(this.goalPos, this.goalLook, aspect);
  }

  /**
   * 镜头在地图和闲逛之间飞：位置按星球中心插值（方向走球面上的弧线，高度在中间抬高），
   * 这样从星球背面飞回来也不会穿过星球。目标在飞的过程中也会更新（人还在动）
   */
  #fly(onDone = null) {
    const center = this.stage.root.position;
    this.#computeGoal(this.host.camera.aspect);
    const angle = v1.copy(this.camPos).sub(center).angleTo(v2.copy(this.goalPos).sub(center));
    this.flight = {
      t: 0,
      dur: REDUCED_MOTION ? 0 : 1.4 + angle * 0.7,
      lift: angle * BIX_RADIUS * 0.6,
      pos: this.camPos.clone(),
      look: this.camLook.clone(),
      up: this.camUp.clone(),
      onDone,
    };
  }

  /** 上一次飞行还没飞完就要换方向：先把它收尾（比如人回到发射台） */
  #endFlight() {
    const f = this.flight;
    this.flight = null;
    f?.onDone?.();
  }

  #updateFlight(dt) {
    const f = this.flight;
    f.t += dt;
    const k = f.dur > 0 ? easeInOut(Math.min(1, f.t / f.dur)) : 1;
    const center = this.stage.root.position;
    arc(f.pos, this.goalPos, k, center, f.lift, this.camPos);
    arc(f.look, this.goalLook, k, center, f.lift * 0.35, this.camLook);
    // up：从起点转到终点，再去掉沿视线的分量；快和视线平行时保留上一帧的
    q1.setFromUnitVectors(f.up, this.goalUp);
    const up = v1.copy(f.up).applyQuaternion(q0.identity().slerp(q1, k));
    const view = v2.copy(this.camLook).sub(this.camPos).normalize();
    up.addScaledVector(view, -up.dot(view));
    if (up.lengthSq() > 0.04) this.camUp.copy(up.normalize());
    if (k >= 1) {
      this.flight = null;
      f.onDone?.();
    }
  }

  // ---------- 点击 ----------

  #select(subjectId) {
    const st = this.stations.find((s) => s.subject.id === subjectId);
    // 今天没有任务的站点：Zib 走过去看一眼，不打开面板
    if (!st?.subject.tasks.length) {
      if (st) this.stage.zibGo(st.spot);
      return;
    }
    this.dispatchEvent(new CustomEvent('select', { detail: { subjectId } }));
  }

  #bindPointer() {
    const el = this.host.renderer.domElement;
    let down = null;
    this.onPointerDown = (e) => (down = { x: e.clientX, y: e.clientY, lastX: e.clientX, drag: false });
    this.onPointerMove = (e) => {
      // 闲逛时按住拖动：镜头绕着人转
      if (down && this.exploring && !this.flight) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) down.drag = true;
        if (down.drag) this.explore.orbit((e.clientX - down.lastX) * 0.008);
        down.lastX = e.clientX;
      }
      if (e.pointerType !== 'mouse') return;
      this.#setPointer(e);
      el.style.cursor = this.#pick(true) ? 'pointer' : '';
    };
    this.onPointerUp = (e) => {
      const click = down && !down.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 10;
      down = null;
      if (!click) return;
      this.#setPointer(e);
      if (this.flight) return;
      if (this.exploring) {
        this.raycaster.setFromCamera(this.pointer, this.host.camera);
        this.explore.click(this.raycaster);
        return;
      }
      const hit = this.#pick();
      if (hit === 'ship') this.dispatchEvent(new CustomEvent('rocket'));
      else if (hit === 'door') this.dispatchEvent(new CustomEvent('door'));
      else if (hit === 'astronaut') this.startExplore();
      else if (hit) this.#select(hit);
    };
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
  }

  #setPointer(e) {
    const rect = this.host.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /**
   * 点中了哪个站点（返回科目 id），点中飞船返回 'ship'，点中门返回 'door'，点中小宇航员返回 'astronaut'。
   * 闲逛时（hover 为 true 才会问）返回点中的发现物或地面，只用来改鼠标样式
   */
  #pick(hover = false) {
    if (this.launching || this.flight) return null;
    this.raycaster.setFromCamera(this.pointer, this.host.camera);
    if (this.exploring) return hover && this.explore.hover(this.raycaster) === 'discovery' ? 'discovery' : null;
    if (this.explore?.hover(this.raycaster) === 'astronaut') return 'astronaut';
    const targets = [this.stage.ship, ...this.stations.map((s) => s.hit)];
    if (this.doorLabel) targets.push(this.stage.door.hit);
    const first = this.raycaster.intersectObjects(targets, true)[0]?.object;
    if (!first) return null;
    if (first.userData.subjectId) return first.userData.subjectId;
    if (first.userData.door) return 'door';
    return 'ship';
  }

  #resize() {
    this.labelRenderer.setSize(this.host.container.clientWidth || 1, this.host.container.clientHeight || 1);
  }
}

/** a、b 之间的弧线（相对 center）：方向沿球面转过去，距离线性变化，中间再抬高 lift */
function arc(a, b, k, center, lift, out) {
  const da = v1.copy(a).sub(center);
  const db = v2.copy(b).sub(center);
  const ra = da.length();
  const rb = db.length();
  da.divideScalar(ra || 1);
  db.divideScalar(rb || 1);
  q1.setFromUnitVectors(da, db);
  const dir = da.applyQuaternion(q0.identity().slerp(q1, k));
  return out.copy(center).addScaledVector(dir, ra + (rb - ra) * k + lift * Math.sin(Math.PI * k));
}
