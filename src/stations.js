// 着陆以后：把当天的任务按 CCSS 领域分到 Bix 星地面上的站点。
// 站点的作用和图标每一层都一样；名字和图标可以由故事章节改（第 1 层的研究站叫气象站）。

export const STATION_TYPES = [
  { key: 'RF', strands: ['RF'], name: '拼读站', icon: '🔤', color: '#ffb84d' },
  { key: 'RL', strands: ['RL'], name: '故事屋', icon: '📚', color: '#ff7eb6' },
  { key: 'RI', strands: ['RI'], name: '研究站', icon: '🔬', color: '#4cc9f0' },
  { key: 'L', strands: ['L'], name: '词语站', icon: '🧩', color: '#b388ff' },
  { key: 'WSL', strands: ['W', 'SL'], name: '广播站', icon: '📡', color: '#80ed99' },
];

/** 任务属于哪个 CCSS 领域：先看任务本身的标准，没有就看题目里最多的领域；都没有返回 null */
export function strandOf(task) {
  if (task.standard) return task.standard.strand;
  const counts = {};
  for (const q of task.questions || []) if (q.standard) counts[q.standard.strand] = (counts[q.standard.strand] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

/**
 * 把按学校科目分组的作业改成按站点分组：
 *   subjects        今天有任务的站点（界面、进度都按它来）
 *   stations        全部站点，包括今天没有任务的（地图上变暗显示）
 *   schoolSubjects  原来的科目分组，家长报告用
 * 没有 CCSS 标准的科目（数学、语文等）每个科目单独一个站点。
 */
export function stationize(homework, overrides = {}) {
  const types = STATION_TYPES.map((t) => ({ ...t, ...(overrides[t.key] || {}) }));
  const buckets = new Map(types.map((t) => [t.key, []]));
  const extra = new Map();
  for (const subject of homework.subjects) {
    for (const task of subject.tasks) {
      const strand = strandOf(task);
      const type = strand && types.find((t) => t.strands.includes(strand));
      if (type) buckets.get(type.key).push(task);
      else {
        if (!extra.has(subject.id)) extra.set(subject.id, { subject, tasks: [] });
        extra.get(subject.id).tasks.push(task);
      }
    }
  }
  const stations = [
    ...types.map((t) => ({ id: `st-${t.key}`, key: t.key, name: t.name, icon: t.icon, color: t.color, tasks: buckets.get(t.key) })),
    ...[...extra.values()].map(({ subject, tasks }) => ({
      id: `st-${subject.id}`,
      key: null,
      name: `${subject.name}站`,
      icon: subject.icon,
      color: subject.color,
      tasks,
    })),
  ];
  return {
    ...homework,
    mode: 'surface',
    subjects: stations.filter((s) => s.tasks.length > 0),
    stations,
    schoolSubjects: homework.subjects,
  };
}
