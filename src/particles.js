import * as THREE from 'three';

// 一个固定容量的粒子池：烟花、星星爆发、火箭尾焰都用它。
export class Particles {
  constructor(max = 4000) {
    this.max = max;
    this.cursor = 0;
    this.alive = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    const geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.posAttr);
    geometry.setAttribute('color', this.colAttr);

    const material = new THREE.PointsMaterial({
      size: 0.24,
      map: dotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
  }

  emit(origin, { count = 100, colors = ['#ffd166'], speed = 5, dir = null, spread = 1, gravity = -4, life = 1.4, drag = 0.97, intensity = 2.2 } = {}) {
    const palette = colors.map((c) => new THREE.Color(c).multiplyScalar(intensity));
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      let x = r * Math.cos(th), y = u, z = r * Math.sin(th);
      if (dir) {
        x = dir.x + x * spread;
        y = dir.y + y * spread;
        z = dir.z + z * spread;
      }
      const s = speed * (0.45 + Math.random() * 0.55);
      const i3 = i * 3;
      this.vel[i3] = x * s;
      this.vel[i3 + 1] = y * s;
      this.vel[i3 + 2] = z * s;
      this.pos[i3] = origin.x;
      this.pos[i3 + 1] = origin.y;
      this.pos[i3 + 2] = origin.z;
      const c = palette[(Math.random() * palette.length) | 0];
      this.base[i3] = c.r;
      this.base[i3 + 1] = c.g;
      this.base[i3 + 2] = c.b;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.4);
      this.grav[i] = gravity;
      this.drag[i] = drag;
    }
    this.alive = this.max;
  }

  firework(origin, colors) {
    this.emit(origin, { count: 160, colors, speed: 6.5, gravity: -2.5, life: 1.8, drag: 0.955, intensity: 2.6 });
    this.emit(origin, { count: 40, colors: ['#ffffff'], speed: 2.5, gravity: -1.5, life: 1.0, intensity: 3 });
  }

  update(dt) {
    if (this.alive === 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0;
        continue;
      }
      alive++;
      const d = Math.pow(this.drag[i], dt * 60);
      this.vel[i3 + 1] += this.grav[i] * dt;
      this.vel[i3] *= d;
      this.vel[i3 + 1] *= d;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      const f = k * k * (0.75 + 0.25 * Math.sin(this.life[i] * 40 + i));
      this.col[i3] = this.base[i3] * f;
      this.col[i3 + 1] = this.base[i3 + 1] * f;
      this.col[i3 + 2] = this.base[i3 + 2] * f;
    }
    this.alive = alive;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

let cachedDot;
export function dotTexture() {
  if (cachedDot) return cachedDot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  cachedDot = new THREE.CanvasTexture(c);
  return cachedDot;
}
