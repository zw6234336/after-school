// 着陆以后的主界面：Bix 星当前这一层的地面地图。
// 站点就是界面里的“科目”：答题面板、进度、报告照常使用，只是三维画面和镜头换成地面上的站点。
// 对 UI 提供和 HomeworkScene 一样的接口（focus、setInset、celebrate、launch、nudgeRocket、setHomework、isLaunching）
// 和一样的事件（'select'、'rocket'）。

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BixStage, STATION_SPOTS } from './bix.js';
import { makeLabel } from './scene.js';

/** 总览镜头（相对着陆点）：从发射台前上方俯看整个着陆区 */
const OVERVIEW = { pos: [0, 8.6, 13.5], look: [0, 0.3, -0.8] };
const v1 = new THREE.Vector3();

export class BixSurface extends EventTarget {
  /**
   * host：HomeworkScene（借用它的渲染器、粒子和动画循环）
   * stage：开场动画留下来的布景；没有就新建一个，镜头直接放到总览位置
   */
  constructor(host, homework, progress, { stage } = {}) {
    super();
    this.host = host;
    this.progress = progress;
    const fresh = !stage;
    this.stage = stage || new BixStage(host);
    this.stage.enterMap();

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer surface-labels';
    host.container.appendChild(this.labelRenderer.domElement);
    host.labelRenderer.domElement.style.display = 'none';

    this.stations = [];
    this.kiosks = new Map();
    this.focused = null;
    this.inset = { right: 0, bottom: 0 };
    this.offset = { x: 0, y: 0 };
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.goalPos = new THREE.Vector3();
    this.goalLook = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(9, 9);
    this.launching = null;

    this.setHomework(homework);
    this.#computeGoal();
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
    this.host.endCinematic();
    this.stage.dispose();
  }

  // ---------- 每一帧 ----------

  update(dt, t, camera) {
    this.stage.animate(dt, t);
    this.#computeGoal();
    const k = 1 - Math.exp(-dt * (this.focused ? 2.6 : 1.8));
    this.camPos.lerp(this.goalPos, k);
    this.camLook.lerp(this.goalLook, k);
    this.stage.placeCamera(camera, this.camPos, this.camLook);

    // 面板挡住的地方：把画面中心挪到剩下的区域
    const tx = this.focused ? this.inset.right / 2 : 0;
    const ty = this.focused ? this.inset.bottom / 2 : 0;
    this.offset.x += (tx - this.offset.x) * k;
    this.offset.y += (ty - this.offset.y) * k;
    if (Math.abs(this.offset.x) > 0.5 || Math.abs(this.offset.y) > 0.5) {
      const { width: w, height: h } = this.host;
      camera.setViewOffset(w, h, this.offset.x, this.offset.y, w, h);
    }
    // 只渲染 Bix 星上的名牌，太空里的星球名牌不归这里管
    this.labelRenderer.render(this.stage.root, camera);
  }

  #computeGoal() {
    const site = this.stage.site;
    if (this.focused) {
      const { spot } = this.focused;
      this.stage.stationWorld(spot, 0.9, this.goalLook);
      this.goalPos.copy(site.localToWorld(v1.set(spot.x * 0.75, 0, spot.z + 6.4)));
      this.goalPos.y = this.goalLook.y + 3.4;
    } else {
      site.localToWorld(this.goalPos.set(...OVERVIEW.pos));
      site.localToWorld(this.goalLook.set(...OVERVIEW.look));
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
    this.onPointerDown = (e) => (down = { x: e.clientX, y: e.clientY });
    this.onPointerMove = (e) => {
      if (e.pointerType !== 'mouse') return;
      this.#setPointer(e);
      el.style.cursor = this.#pick() ? 'pointer' : '';
    };
    this.onPointerUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
      down = null;
      this.#setPointer(e);
      const hit = this.#pick();
      if (hit === 'ship') this.dispatchEvent(new CustomEvent('rocket'));
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

  /** 点中了哪个站点（返回科目 id），点中飞船返回 'ship' */
  #pick() {
    if (this.launching) return null;
    this.raycaster.setFromCamera(this.pointer, this.host.camera);
    const hits = this.raycaster.intersectObjects([this.stage.ship, ...this.stations.map((s) => s.hit)], true);
    const first = hits[0]?.object;
    if (!first) return null;
    if (first.userData.subjectId) return first.userData.subjectId;
    return 'ship';
  }

  #resize() {
    this.labelRenderer.setSize(this.host.container.clientWidth || 1, this.host.container.clientHeight || 1);
  }
}
