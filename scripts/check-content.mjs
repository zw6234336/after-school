// 检查内容库（content/units/*/unit.json）：npm run check:content
// 用和页面一样的 data.js 在三档难度下加载每个单元，再检查来源、署名、标准年级、生词和 id。

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveUnits, normalizeHomework, LEVELS } from '../src/data.js';
import { parseStandard } from '../src/standards.js';

const UNITS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'units');
const GRADES = ['K', '1', '2', '3', '4', '5'];
const GENRES = ['literature', 'informational'];

const errors = [];
const units = {};

for (const dir of readdirSync(UNITS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const file = join(UNITS_DIR, dir.name, 'unit.json');
  if (!existsSync(file)) {
    errors.push(`${dir.name}：缺少 unit.json`);
    continue;
  }
  try {
    const unit = JSON.parse(readFileSync(file, 'utf8'));
    if (unit.id !== dir.name) errors.push(`${dir.name}：id "${unit.id}" 和目录名不一致`);
    units[unit.id] = unit;
  } catch (err) {
    errors.push(`${dir.name}/unit.json 不是合法的 JSON：${err.message}`);
  }
}

const taskIds = new Map();

for (const unit of Object.values(units)) {
  const at = (msg) => errors.push(`${unit.id}：${msg}`);
  if (!GRADES.includes(String(unit.grade))) at(`grade 应该是 ${GRADES.join(' / ')}，现在是 "${unit.grade}"`);
  if (!unit.title) at('缺少 title');
  if (!unit.license) at('缺少 license（这个单元发布用的授权）');
  if (!Array.isArray(unit.lessons) || unit.lessons.length === 0) {
    at('缺少 lessons');
    continue;
  }
  if (unit.source) {
    for (const key of ['work', 'author', 'url', 'license']) if (!unit.source[key]) at(`source 缺少 ${key}`);
  }

  const lessonIds = new Set();
  for (const lesson of unit.lessons) {
    const where = `${unit.id} / ${lesson.id}`;
    if (!lesson.id) at('有一课缺少 id');
    if (lessonIds.has(lesson.id)) at(`课的 id "${lesson.id}" 重复`);
    lessonIds.add(lesson.id);
    if (!GENRES.includes(lesson.genre)) errors.push(`${where}：genre 只能是 ${GENRES.join(' / ')}`);
    if (unit.source && (!lesson.from || !lesson.changes)) errors.push(`${where}：改编内容要写 from（改编自哪一部分）和 changes（改了什么）`);
    if (!Array.isArray(lesson.tasks) || lesson.tasks.length === 0) {
      errors.push(`${where}：没有 tasks`);
      continue;
    }

    for (const task of lesson.tasks) {
      if (!task.id) errors.push(`${where}：有任务没写 id（内容库里的任务必须写 id，进度按它保存）`);
      else if (taskIds.has(task.id)) errors.push(`${where}：任务 id "${task.id}" 和 ${taskIds.get(task.id)} 重复`);
      else taskIds.set(task.id, where);

      checkGrade(task.standard, task.level, unit.grade, `${where} / ${task.id}`);
      for (const q of task.questions || []) checkGrade(q.standard, q.level ?? task.level, unit.grade, `${where} / ${task.id}「${q.q}」`);

      const p = task.passage;
      if (p?.text) {
        const tokens = p.text.toLowerCase().split(/[^a-z'’-]+/).filter(Boolean);
        for (const v of p.vocab || []) {
          const w = String(v.word).toLowerCase();
          if (!tokens.some((t) => t === w || (t.startsWith(w) && t.length - w.length <= 3))) {
            errors.push(`${where} / ${task.id}：生词 "${v.word}" 在文章里没有出现`);
          }
        }
      }
    }
  }
  for (const w of unit.wordWall || []) {
    if (w.lesson && !lessonIds.has(w.lesson)) at(`词墙里 "${w.word}" 指向的课 "${w.lesson}" 不存在`);
  }

  // 和页面一样加载：三档难度都要能正常展开
  for (const { id: level } of LEVELS) {
    try {
      const raw = resolveUnits({ subjects: [{ id: 'check', unit: unit.id }] }, units);
      normalizeHomework(raw, { level, today: '2026-01-01' });
    } catch (err) {
      at(`在“${level}”难度下加载出错：${err.message}`);
    }
  }
}

/** 标准年级要和单元一致；挑战难度可以用高一个年级的标准 */
function checkGrade(code, level, grade, where) {
  if (!code) return;
  const std = parseStandard(code);
  if (!std) return; // 格式错误由 data.js 报出
  const diff = GRADES.indexOf(std.grade) - GRADES.indexOf(String(grade));
  const hardOnly = level === 'hard' || (Array.isArray(level) && level.length === 1 && level[0] === 'hard');
  if (diff === 0 || (diff === 1 && hardOnly)) return;
  errors.push(
    diff === 1
      ? `${where}：${std.code} 是高一个年级的标准，只能放在 "level": "hard" 里`
      : `${where}：${std.code} 和单元的年级 ${grade} 不一致`,
  );
}

// ---------- 汇总 ----------

for (const unit of Object.values(units)) {
  const counts = { literature: 0, informational: 0 };
  console.log(`\n📦 ${unit.id} · ${unit.title}${unit.titleZh ? `（${unit.titleZh}）` : ''} · Grade ${unit.grade} · ${unit.license}`);
  if (unit.source) console.log(`   改编自：${unit.source.work}（${unit.source.license}）`);
  for (const lesson of unit.lessons || []) {
    counts[lesson.genre] = (counts[lesson.genre] || 0) + 1;
    const passage = (lesson.tasks || []).find((t) => t.passage)?.passage;
    const words = passage ? passage.text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length : 0;
    const perLevel = LEVELS.map(({ id }) => {
      try {
        const hw = normalizeHomework(resolveUnits({ subjects: [{ id: 'check', unit: unit.id, lessons: [lesson.id] }] }, units), { level: id, today: '2026-01-01' });
        const tasks = hw.subjects.flatMap((s) => s.tasks);
        return `${LEVELS.find((l) => l.id === id).icon} ${tasks.length} 项 ${tasks.reduce((n, t) => n + (t.questions?.length ?? 0), 0)} 题`;
      } catch {
        return `${id} ✗`;
      }
    });
    console.log(`   ${lesson.genre === 'literature' ? '📚' : '🔬'} ${lesson.id.padEnd(16)} ${String(words).padStart(3)} 词 · ${perLevel.join(' · ')}`);
  }
  console.log(`   文学 ${counts.literature} 课 · 说明文 ${counts.informational} 课`);
}

if (errors.length) {
  console.error(`\n❌ ${errors.length} 个问题：`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
console.log(`\n✅ ${Object.keys(units).length} 个单元，${taskIds.size} 项任务，检查通过`);
