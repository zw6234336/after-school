import './style.css';
import { fetchHomework, normalizeHomework, resolveUnits, defaultLevel, LEVELS } from './data.js';
import { UNITS } from './content.js';
import { Progress } from './progress.js';
import { HomeworkScene } from './scene.js';
import { UI } from './ui.js';

const LEVEL_KEY = 'after-school:level';

function savedLevel() {
  try {
    return localStorage.getItem(LEVEL_KEY);
  } catch {
    return null;
  }
}

function saveLevel(level) {
  try {
    localStorage.setItem(LEVEL_KEY, level);
  } catch {
    // 忽略
  }
}

/** 先用孩子上次选的难度；家长锁定了难度，或者那个难度下没有作业时，用文件里的默认难度 */
function initialHomework(raw) {
  const fallback = defaultLevel(raw);
  const saved = savedLevel();
  if (!raw.lockDifficulty && saved !== fallback && LEVELS.some((l) => l.id === saved)) {
    try {
      return normalizeHomework(raw, { level: saved });
    } catch {
      // 用默认难度
    }
  }
  return normalizeHomework(raw, { level: fallback });
}

async function start() {
  const loading = document.getElementById('loading');
  try {
    const raw = resolveUnits(await fetchHomework(), UNITS);
    const homework = initialHomework(raw);
    const progress = new Progress(homework);
    const scene = new HomeworkScene(document.getElementById('stage'), homework, progress);
    const ui = new UI({
      homework,
      progress,
      scene,
      levels: {
        /** 某个难度下有多少作业和题目，用来在选择界面上显示 */
        summary(level) {
          try {
            const hw = normalizeHomework(raw, { level });
            const tasks = hw.subjects.flatMap((s) => s.tasks);
            return { tasks: tasks.length, questions: tasks.reduce((n, t) => n + (t.questions?.length ?? 0), 0) };
          } catch {
            return null;
          }
        },
        apply(level) {
          const hw = normalizeHomework(raw, { level });
          saveLevel(level);
          progress.setHomework(hw);
          scene.setHomework(hw);
          ui.setHomework(hw);
        },
      },
    });
    requestAnimationFrame(() => loading.classList.add('hidden'));
  } catch (err) {
    console.error(err);
    loading.classList.add('error');
    loading.innerHTML = `<div class="loading-rocket">🛸</div><p>出了点小问题：</p><pre></pre>`;
    loading.querySelector('pre').textContent = err.message;
  }
}

start();
