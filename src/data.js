// 读取 homework.json，校验并整理成统一结构；“generate” 任务在这里按日期生成题目。

const DEFAULT_COLORS = ['#ff6b8b', '#ffc23d', '#4cc9f0', '#80ed99', '#b388ff', '#ff9f43'];
const DEFAULT_ICONS = ['📖', '🔢', '🔤', '🎨', '🔬', '🎵'];

export async function loadHomework(url = `${import.meta.env.BASE_URL}homework.json`) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`读取作业文件失败（${res.status}）：${url}`);
  let raw;
  try {
    raw = await res.json();
  } catch (err) {
    throw new Error(`作业文件不是合法的 JSON：${err.message}`);
  }
  return normalizeHomework(raw);
}

export function normalizeHomework(raw, today = localDate()) {
  if (!raw || !Array.isArray(raw.subjects) || raw.subjects.length === 0) {
    throw new Error('作业文件里需要一个非空的 "subjects" 数组');
  }
  const date = raw.date || today;
  const subjects = raw.subjects.map((s, si) => {
    const where = `第 ${si + 1} 个科目`;
    if (!s.name) throw new Error(`${where}缺少 "name"`);
    if (!Array.isArray(s.tasks) || s.tasks.length === 0) throw new Error(`${where}（${s.name}）缺少 "tasks"`);
    const id = s.id || `s${si}`;
    return {
      id,
      name: s.name,
      icon: s.icon || DEFAULT_ICONS[si % DEFAULT_ICONS.length],
      color: s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length],
      tasks: s.tasks.map((t, ti) => normalizeTask(t, `${id}-${ti}`, date, `${where}（${s.name}）第 ${ti + 1} 个任务`)),
    };
  });
  return { title: raw.title || '作业星球', child: raw.child || '', date, subjects };
}

function normalizeTask(t, fallbackId, date, where) {
  if (!t.title) throw new Error(`${where}缺少 "title"`);
  const id = String(t.id || fallbackId);
  const base = { id, title: t.title, note: t.note || '' };

  let questions = null;
  if (t.generate) {
    questions = generateQuestions(t.generate, `${date}|${id}|${JSON.stringify(t.generate)}`, where);
  } else if (Array.isArray(t.questions)) {
    questions = t.questions.map((q, qi) => normalizeQuestion(q, `${where}第 ${qi + 1} 题`));
  }
  if (questions && questions.length === 0) throw new Error(`${where}没有题目`);
  return questions ? { ...base, kind: 'quiz', questions } : { ...base, kind: 'check' };
}

function normalizeQuestion(q, where) {
  if (!q.q) throw new Error(`${where}缺少题目 "q"`);
  if (q.a === undefined || q.a === null || q.a === '') throw new Error(`${where}缺少答案 "a"`);
  const answers = (Array.isArray(q.a) ? q.a : [q.a]).map(String);
  const options = Array.isArray(q.options) ? q.options.map(String) : null;
  if (options && !answers.some((a) => options.includes(a))) {
    throw new Error(`${where}的答案 "${answers[0]}" 不在选项里`);
  }
  return {
    text: String(q.q),
    answers,
    options,
    hint: q.hint ? String(q.hint) : '',
    speak: q.speak ? String(q.speak) : '',
    numeric: !options && answers.every((a) => /^-?\d+(\.\d+)?$/.test(a.trim())),
  };
}

// ---------- 题目生成 ----------

const OP_WORDS = { '+': '加', '-': '减', '×': '乘', '÷': '除以' };

function generateQuestions(gen, seedText, where) {
  if (gen.kind !== 'arith') throw new Error(`${where}的 generate.kind 目前只支持 "arith"`);
  const ops = (gen.ops && gen.ops.length ? gen.ops : ['+', '-']).map((o) => ({ '*': '×', x: '×', '/': '÷' })[o] || o);
  const bad = ops.find((o) => !OP_WORDS[o]);
  if (bad) throw new Error(`${where}的运算符 "${bad}" 不支持，可用 + - × ÷`);

  const max = Math.max(2, gen.max ?? 20);
  const table = Math.max(2, gen.table ?? 9);
  const count = Math.min(50, Math.max(1, gen.count ?? 10));
  const rand = mulberry32(hashString(seedText));
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  const seen = new Set();
  const out = [];
  for (let guard = 0; out.length < count && guard < count * 50; guard++) {
    const op = ops[int(0, ops.length - 1)];
    let a, b, r;
    if (op === '+') { a = int(1, max - 1); b = int(1, max - a); r = a + b; }
    else if (op === '-') { a = int(2, max); b = int(1, a); r = a - b; }
    else if (op === '×') { a = int(2, table); b = int(2, table); r = a * b; }
    else { b = int(2, table); r = int(1, table); a = b * r; }
    const key = `${a}${op}${b}`;
    if (seen.has(key) && guard < count * 40) continue;
    seen.add(key);
    out.push({
      text: `${a} ${op} ${b} = ？`,
      answers: [String(r)],
      options: null,
      hint: '',
      speak: `${a} ${OP_WORDS[op]} ${b} 等于几？`,
      numeric: true,
    });
  }
  return out;
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
