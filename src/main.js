import './style.css';
import { fetchHomework, normalizeHomework, resolveUnits, defaultLevel, LEVELS } from './data.js';
import { UNITS, STORY } from './content.js';
import { OpeningPlayer } from './opening.js';
import { Progress } from './progress.js';
import { HomeworkScene } from './scene.js';
import { stationize } from './stations.js';
import { landedChapter, setLanded, resetStory } from './story.js';
import { BixSurface } from './surface.js';
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
    const params = new URLSearchParams(location.search);
    // 回到航行期：?story=reset
    if (params.get('story') === 'reset') resetStory();

    const raw = resolveUnits(await fetchHomework(), UNITS);
    let homework = initialHomework(raw);
    // 已经着陆：主界面是那一层的地面地图，作业按站点分组；还在航行：太空里的科目星球
    let landed = landedChapter(STORY);
    const forView = (hw) => (landed ? stationize(hw, landed.surface?.stations) : hw);
    const progress = new Progress(forView(homework));
    const scene = new HomeworkScene(document.getElementById('stage'), homework, progress);
    let view = landed ? new BixSurface(scene, forView(homework), progress) : scene;

    /** 开场动画播完：记下已着陆，在开场留下的布景上显示地面地图 */
    const land = (chapter, stage) => {
      setLanded(chapter);
      landed = chapter;
      const hw = forView(homework);
      progress.setHomework(hw);
      view = new BixSurface(scene, hw, progress, { stage });
      ui.setView(view, hw);
    };

    const ui = new UI({
      homework: forView(homework),
      progress,
      scene: view,
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
          homework = normalizeHomework(raw, { level });
          saveLevel(level);
          const hw = forView(homework);
          progress.setHomework(hw);
          scene.setHomework(homework);
          if (view !== scene) view.setHomework(hw);
          ui.setHomework(hw);
        },
      },
    });
    requestAnimationFrame(() => loading.classList.add('hidden'));

    // 开场动画：?opening=ch01-weather-station（或 ?opening=layer-1），播完就着陆
    const openingId = params.get('opening');
    if (openingId) {
      const chapter = STORY[openingId] || Object.values(STORY).find((c) => `layer-${c.layer}` === openingId);
      if (!chapter?.opening) {
        console.warn(`找不到开场动画 "${openingId}"，可用：${Object.keys(STORY).join('、')}`);
      } else {
        // 已经在地面地图上：先拆掉，开场会重新搭布景
        if (view !== scene) {
          ui.closePanel();
          view.dispose();
        }
        const { stage } = await new OpeningPlayer(scene, { keepStage: true }).play(chapter);
        land(chapter, stage);
      }
    }
  } catch (err) {
    console.error(err);
    loading.classList.add('error');
    loading.innerHTML = `<div class="loading-rocket">🛸</div><p>出了点小问题：</p><pre></pre>`;
    loading.querySelector('pre').textContent = err.message;
  }
}

start();
