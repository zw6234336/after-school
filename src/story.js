// 故事进度（星际破译）：航行期每天的燃料，以及孩子是否已经降落在某一章的星球表面。保存在浏览器 localStorage。

const KEY = 'after-school:story';

/** 航行期要加几天燃料才能降落 Bix 星：每天完成全部使命任务加一天（故事设计里的“一周燃料”） */
export const VOYAGE_DAYS = 5;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') return saved;
  } catch {
    // 没有存档或存档损坏
  }
  return {};
}

function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 隐私模式等情况下无法保存，本次页面内仍可正常使用
  }
}

/** 已经着陆的最深一章（主界面显示它那一层的地面地图）；还在航行期返回 null */
export function landedChapter(story) {
  return Object.values(story).sort((a, b) => b.layer - a.layer).find((c) => isLanded(c)) || null;
}

/** 下一章要降落的地方：还没着陆、有开场动画的最浅一章 */
export function nextChapter(story) {
  return Object.values(story).sort((a, b) => a.layer - b.layer).find((c) => c.opening && !isLanded(c)) || null;
}

export function isLanded(chapter) {
  return !!chapter && !!load().landed?.[chapter.id];
}

export function setLanded(chapter) {
  const state = load();
  state.landed = { ...state.landed, [chapter.id]: true };
  save(state);
}

/** 航行进度：加了几天燃料、一共要几天、是不是可以降落了 */
export function voyage() {
  const { fuelDays } = load();
  const days = Array.isArray(fuelDays) ? fuelDays.length : 0;
  return { days: Math.min(days, VOYAGE_DAYS), target: VOYAGE_DAYS, ready: days >= VOYAGE_DAYS };
}

/** 某一天的使命任务全部完成：给飞船加一天燃料（同一天只算一次） */
export function addFuelDay(date) {
  const state = load();
  const days = Array.isArray(state.fuelDays) ? state.fuelDays : [];
  if (days.includes(date)) return;
  state.fuelDays = [...days, date].sort();
  save(state);
}

/** 回到航行期：着陆、燃料和发现图鉴都清空（家长报告里的“回到航行期”，开发时用 ?story=reset）。读过哪些课来自做题记录，保留 */
export function resetStory() {
  const { learned } = load();
  save(learned ? { learned } : {});
}

// ---------- 翻译机词库：读过的课 ----------

/** 某个单元里读过的课（课的 id） */
export function learnedLessons(unitId) {
  const list = load().learned?.[unitId];
  return new Set(Array.isArray(list) ? list : []);
}

/** 读完一课：这一课的词翻译机就认识了（只记一次） */
export function learnLesson(unitId, lessonId) {
  const state = load();
  const list = Array.isArray(state.learned?.[unitId]) ? state.learned[unitId] : [];
  if (list.includes(lessonId)) return false;
  state.learned = { ...state.learned, [unitId]: [...list, lessonId] };
  save(state);
  return true;
}

// ---------- 闲逛：发现图鉴和每天的记录 ----------

/** 这一章已经收进图鉴的发现物（id 列表，按找到的顺序） */
export function foundDiscoveries(chapterId) {
  const list = load().found?.[chapterId];
  return Array.isArray(list) ? list : [];
}

/** 收进图鉴；同时记在当天的闲逛记录里，家长报告用 */
export function addFound(chapterId, id, date) {
  const state = load();
  const list = Array.isArray(state.found?.[chapterId]) ? state.found[chapterId] : [];
  if (list.includes(id)) return false;
  state.found = { ...state.found, [chapterId]: [...list, id] };
  const day = exploreDayOf(state, date);
  day.found = [...day.found, id];
  save(state);
  return true;
}

/** 某一天的闲逛记录：找到了哪些（id 列表）、逛了多少秒 */
export function exploreDay(date) {
  return exploreDayOf(load(), date);
}

export function addExploreTime(date, seconds) {
  if (!(seconds > 0)) return;
  const state = load();
  const day = exploreDayOf(state, date);
  day.seconds = Math.round(day.seconds + seconds);
  save(state);
}

/** 只保留最近 14 天的闲逛记录 */
function exploreDayOf(state, date) {
  state.explore ||= {};
  if (!state.explore[date]) {
    state.explore[date] = { found: [], seconds: 0 };
    const days = Object.keys(state.explore).sort();
    for (const d of days.slice(0, Math.max(0, days.length - 14))) delete state.explore[d];
  }
  const day = state.explore[date];
  if (!Array.isArray(day.found)) day.found = [];
  if (!(day.seconds >= 0)) day.seconds = 0;
  return day;
}
