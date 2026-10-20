// 每天一课：homework.json 里引用单元的科目写 "lessons": "daily"，家长就不用每天手动挑课。
//   - 有故事章节的单元：航行期不排课（开场告示上的词留到着陆以后学），着陆的第二天开始排；
//     没有故事章节的单元，从第一天就开始排。
//   - 每天排单元里还没读完的前 perDay 课（默认 1 课）。当天排好就固定下来：做完了也不会马上换成下一课；
//     没读完的，第二天接着排这一课。
//   - 课都读完了就不再排：去门口试飞。
// 排课记录保存在浏览器 localStorage（after-school:plan），只留最近 30 天。

const KEY = 'after-school:plan';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') return saved;
  } catch {
    // 没有记录或者记录损坏
  }
  return {};
}

function save(state) {
  try {
    const days = Object.keys(state).sort();
    for (const d of days.slice(0, Math.max(0, days.length - 30))) delete state[d];
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 隐私模式等情况下无法保存：每次打开按“还没读完的课”重新排
  }
}

/**
 * 今天这个单元排哪几课（课的 id 列表）。
 * landedOn：这个单元所在章节的着陆日期（'YYYY-MM-DD'；老存档是 true，当作早就着陆了）；
 *           还没着陆是 null；单元不属于任何章节是 undefined。
 * learned：已经读完的课（Set）
 */
export function dailyLessons(unit, { today, landedOn, learned, perDay = 1 }) {
  if (landedOn === null) return [];
  if (typeof landedOn === 'string' && today <= landedOn) return [];
  const state = load();
  const fixed = state[today]?.[unit.id];
  if (Array.isArray(fixed)) return fixed.filter((id) => unit.lessons.some((l) => l.id === id));
  const ids = unit.lessons.filter((l) => !learned.has(l.id)).slice(0, Math.max(1, perDay)).map((l) => l.id);
  state[today] = { ...state[today], [unit.id]: ids };
  save(state);
  return ids;
}

/** 家长报告里的学习计划：一共几课、读完几课、今天排的是哪几课、什么时候开始 */
export function planStatus(unit, { today, landedOn, learned, perDay = 1 }) {
  const fixed = load()[today]?.[unit.id];
  const titleOf = (id) => unit.lessons.find((l) => l.id === id)?.title || id;
  return {
    total: unit.lessons.length,
    read: unit.lessons.filter((l) => learned.has(l.id)).length,
    today: Array.isArray(fixed) ? fixed.map(titleOf) : [],
    waiting: landedOn === null,
    startsTomorrow: typeof landedOn === 'string' && today <= landedOn,
    perDay,
  };
}
