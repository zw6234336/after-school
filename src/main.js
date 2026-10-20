import './style.css';
import { fetchHomework, normalizeHomework, resolveUnits, defaultLevel, localDate, LEVELS } from './data.js';
import { UNITS, STORY } from './content.js';
import { OpeningPlayer } from './opening.js';
import { Progress } from './progress.js';
import { HomeworkScene } from './scene.js';
import { stationize } from './stations.js';
import { landedChapter, nextChapter, setLanded, landedOn, resetStory, voyage, addFuelDay, learnLesson, learnedLessons } from './story.js';
import { dailyLessons, planStatus } from './plan.js';
import { newlyDecoded } from './explore-hud.js';
import { newItems } from './wardrobe.js';
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

/**
 * 翻译机词库：读完一课（这一课带文章的任务做完了），就把这一课记下来，以后每天都算学过。
 * 返回这次新读完的课（单元 id → 课的 id 列表）
 */
function syncLearned(progress) {
  const fresh = {};
  for (const unit of new Set(Object.values(STORY).map((c) => UNITS[c.unit]).filter(Boolean))) {
    for (const lesson of unit.lessons) {
      const reads = lesson.tasks.filter((t) => t.passage);
      const ids = new Set((reads.length ? reads : lesson.tasks).map((t) => t.id));
      const read = progress.allTasks.some((t) => ids.has(t.id) && progress.isDone(t));
      if (read && learnLesson(unit.id, lesson.id)) (fresh[unit.id] ||= []).push(lesson.id);
    }
  }
  return fresh;
}

async function start() {
  const loading = document.getElementById('loading');
  try {
    const params = new URLSearchParams(location.search);
    // 回到航行期：?story=reset
    if (params.get('story') === 'reset') resetStory();

    const source = await fetchHomework();
    const today = source.date || localDate();
    // 每天一课（"lessons": "daily"）：单元所在的章节着陆以后才排课，见 plan.js
    const planContext = (unit, subject) => {
      const chapter = Object.values(STORY).find((c) => c.unit === unit.id);
      return { today, landedOn: chapter ? landedOn(chapter.id) : undefined, learned: learnedLessons(unit.id), perDay: Number(subject?.perDay) || 1 };
    };
    const resolve = () => resolveUnits(source, UNITS, { daily: (unit, subject) => dailyLessons(unit, planContext(unit, subject)) });
    let raw = resolve();
    let homework = initialHomework(raw);
    // 已经着陆：主界面是那一层的地面地图，作业按站点分组；还在航行：太空里的科目星球
    let landed = landedChapter(STORY);
    const forView = (hw) => (landed ? stationize(hw, landed.surface?.stations) : hw);
    const progress = new Progress(forView(homework));
    const scene = new HomeworkScene(document.getElementById('stage'), homework, progress);
    let view = landed ? new BixSurface(scene, forView(homework), progress, { chapter: landed }) : scene;

    // 航行期：今天的使命任务全部完成，就给飞船加一天燃料（加满就能降落）
    const fuelUp = () => {
      if (!landed && progress.remainingTasks() === 0) addFuelDay(homework.date);
    };
    progress.addEventListener('change', fuelUp);
    fuelUp();
    syncLearned(progress);
    // 读完一课：着陆以后，提示孩子图鉴里有名字被破译了、衣柜里多了衣服
    progress.addEventListener('change', () => {
      const fresh = syncLearned(progress)[landed?.unit] || [];
      const names = landed ? newlyDecoded(landed, fresh) : [];
      const items = landed ? newItems(landed, fresh) : [];
      const news = [names.length && `🔓 翻译机破译了 ${names.length} 个新名字`, items.length && `🎒 衣柜里多了 ${items.map((i) => `${i.emoji} ${i.word}`).join('、')}`].filter(Boolean);
      if (news.length) setTimeout(() => ui.toast(`${news.join('，')}，去闲逛看看吧！`), 2800);
    });

    /** 开场动画播完：记下已着陆，在开场留下的布景上显示地面地图 */
    const land = (chapter, stage) => {
      setLanded(chapter, homework.date);
      landed = chapter;
      const hw = forView(homework);
      progress.setHomework(hw);
      view = new BixSurface(scene, hw, progress, { stage, chapter });
      ui.setView(view, hw);
    };

    /** 降落：播放这一章的开场，播完着陆。正在播的时候再调用，返回同一个 Promise */
    let landing = null;
    const playOpening = (chapter) => {
      if (landing) return landing;
      ui.closePanel();
      // 已经在地面地图上：先拆掉，开场会重新搭布景
      if (view !== scene) view.dispose();
      landing = new OpeningPlayer(scene, { keepStage: true })
        .play(chapter)
        .then(({ stage }) => land(chapter, stage))
        .finally(() => (landing = null));
      return landing;
    };

    /** 回到航行期：着陆和燃料清空，主界面换回太空里的科目星球；每天一课的单元航行期不排课，今天的作业重新算一遍 */
    const backToVoyage = () => {
      resetStory();
      if (view !== scene) {
        view.dispose();
        view = scene;
        landed = null;
        raw = resolve();
        homework = normalizeHomework(raw, { level: homework.level });
        progress.setHomework(homework);
        scene.setHomework(homework);
        ui.setView(scene, homework);
      }
      // 今天的任务已经全部完成的话，算航行的第 1 天
      fuelUp();
    };

    const ui = new UI({
      homework: forView(homework),
      progress,
      scene: view,
      story: {
        /** 航行进度和要降落的章节；已经着陆（或者没有能降落的章节）返回 null */
        voyage: () => {
          const chapter = !landed && nextChapter(STORY);
          return chapter ? { ...voyage(), chapter } : null;
        },
        /** 已经着陆的章节；还在航行期返回 null */
        landed: () => landed,
        /** 降落 Bix 星：播放下一章的开场，播完换成地面地图 */
        land: () => {
          const chapter = nextChapter(STORY);
          return chapter && playOpening(chapter);
        },
        reset: backToVoyage,
        /** 每天一课的进度（家长报告用）；作业文件里没有写 "lessons": "daily" 的单元返回 null */
        plan: () => {
          const subject = source.subjects?.find((s) => s?.lessons === 'daily' && UNITS[s.unit]);
          if (!subject) return null;
          const unit = UNITS[subject.unit];
          return { unit, ...planStatus(unit, planContext(unit, subject)) };
        },
      },
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

    // 开发用：?explore 着陆以后直接去逛逛
    if (params.has('explore') && view !== scene) view.startExplore?.();

    // 开发用：?opening=ch01-weather-station（或 ?opening=layer-1）直接播开场，播完就着陆
    const openingId = params.get('opening');
    if (openingId) {
      const chapter = STORY[openingId] || Object.values(STORY).find((c) => `layer-${c.layer}` === openingId);
      if (!chapter?.opening) {
        console.warn(`找不到开场动画 "${openingId}"，可用：${Object.keys(STORY).join('、')}`);
      } else {
        await playOpening(chapter);
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
