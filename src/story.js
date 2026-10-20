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

/** 回到航行期：着陆和燃料都清空（家长报告里的“回到航行期”，开发时用 ?story=reset） */
export function resetStory() {
  save({});
}
