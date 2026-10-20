// 故事进度（星际破译）：孩子是否已经降落在某一章的星球表面。保存在浏览器 localStorage。

const KEY = 'after-school:story';

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

export function isLanded(chapter) {
  return !!chapter && !!load().landed?.[chapter.id];
}

export function setLanded(chapter) {
  const state = load();
  state.landed = { ...state.landed, [chapter.id]: true };
  save(state);
}

/** 回到航行期（家长或开发时用 ?story=reset） */
export function resetStory() {
  save({});
}
