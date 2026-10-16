// 读取 homework.json，校验并按难度整理成统一结构；“generate” 任务在这里按日期生成题目。

import { parseStandard, FLUENCY_GOALS } from './standards.js';

const DEFAULT_COLORS = ['#ff6b8b', '#ffc23d', '#4cc9f0', '#80ed99', '#b388ff', '#ff9f43'];
const DEFAULT_ICONS = ['📖', '🔢', '🔤', '🎨', '🔬', '🎵'];

export const LEVELS = [
  { id: 'easy', icon: '🌱', name: '简单', desc: '数字小一点，题目少一点' },
  { id: 'normal', icon: '⭐', name: '普通', desc: '老师布置的标准难度' },
  { id: 'hard', icon: '🔥', name: '挑战', desc: '多一步计算，再加几道难题' },
];
const LEVEL_IDS = LEVELS.map((l) => l.id);

export async function fetchHomework(url = `${import.meta.env.BASE_URL}homework.json`) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`读取作业文件失败（${res.status}）：${url}`);
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`作业文件不是合法的 JSON：${err.message}`);
  }
}

/** 文件里设置的默认难度 */
export function defaultLevel(raw) {
  const level = raw?.difficulty ?? 'normal';
  if (!LEVEL_IDS.includes(level)) throw new Error(`"difficulty" 只能是 ${LEVEL_IDS.join(' / ')}，现在是 "${level}"`);
  return level;
}

export function normalizeHomework(raw, { level = defaultLevel(raw), today = localDate() } = {}) {
  if (!raw || !Array.isArray(raw.subjects) || raw.subjects.length === 0) {
    throw new Error('作业文件里需要一个非空的 "subjects" 数组');
  }
  if (!LEVEL_IDS.includes(level)) throw new Error(`未知难度 "${level}"`);
  const date = raw.date || today;
  const subjects = raw.subjects
    .map((s, si) => {
      const where = `第 ${si + 1} 个科目`;
      if (!s.name) throw new Error(`${where}缺少 "name"`);
      if (!Array.isArray(s.tasks) || s.tasks.length === 0) throw new Error(`${where}（${s.name}）缺少 "tasks"`);
      const id = s.id || `s${si}`;
      const tasks = s.tasks
        .map((t, ti) =>
          normalizeTask(t, { fallbackId: `${id}-${ti}`, date, level, siblings: s.tasks, where: `${where}（${s.name}）第 ${ti + 1} 个任务` }),
        )
        .filter(Boolean);
      return {
        id,
        name: s.name,
        icon: s.icon || DEFAULT_ICONS[si % DEFAULT_ICONS.length],
        color: s.color || DEFAULT_COLORS[si % DEFAULT_COLORS.length],
        tasks,
      };
    })
    .filter((s) => s.tasks.length > 0);
  if (subjects.length === 0) throw new Error(`“${levelInfo(level).name}”难度下没有任何作业`);
  return {
    title: raw.title || '作业星球',
    child: raw.child || '',
    date,
    level,
    lockDifficulty: !!raw.lockDifficulty,
    subjects,
  };
}

export function levelInfo(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[1];
}

/** level 不写：所有难度都出现；写了（字符串或数组）：只在这些难度出现 */
function inLevel(spec, level, where) {
  if (spec === undefined || spec === null) return true;
  const list = Array.isArray(spec) ? spec : [spec];
  const bad = list.find((l) => !LEVEL_IDS.includes(l));
  if (bad !== undefined) throw new Error(`${where}的 "level" 只能是 ${LEVEL_IDS.join(' / ')}，现在是 "${bad}"`);
  return list.includes(level);
}

function standardOf(code, where) {
  const std = parseStandard(code);
  if (!std) throw new Error(`${where}的 "standard" 应该是 CCSS 代码，比如 "RI.1.1"、"RF.2.3"，现在是 "${code}"`);
  return std;
}

/**
 * 任务类型：
 *   quiz    有 questions 或 generate
 *   write   有 write：写作，按清单自动检查格式，家长再看内容
 *   fluency 有 fluency：朗读计时，算出每分钟读多少词
 *   check   其他：打卡任务
 */
function normalizeTask(t, { fallbackId, date, level, siblings, where }) {
  if (!t.title) throw new Error(`${where}缺少 "title"`);
  const show = inLevel(t.level, level, where);
  const id = String(t.id || fallbackId);
  const standard = t.standard ? standardOf(t.standard, where) : null;
  const passage = t.passage ? normalizePassage(t.passage, standard, where) : null;
  if (passage && !Array.isArray(t.questions)) throw new Error(`${where}的 "passage" 需要和 "questions" 一起使用`);
  const base = { id, title: t.title, note: t.note || '', standard, passage };

  if (t.write) {
    const write = normalizeWrite(t.write, where);
    return show ? { ...base, kind: 'write', write } : null;
  }
  if (t.fluency) {
    const fluency = normalizeFluency(t.fluency, standard, siblings, where);
    return show ? { ...base, kind: 'fluency', fluency } : null;
  }

  let questions = null;
  if (t.generate) {
    const cfg = arithConfig(t.generate, level, where);
    questions = generateQuestions(cfg, `${date}|${id}|${level}|${JSON.stringify(cfg)}`);
  } else if (Array.isArray(t.questions)) {
    if (t.questions.length === 0) throw new Error(`${where}没有题目`);
    // 先校验全部题目，再按难度筛选，这样换难度前就能发现文件里的错误
    questions = t.questions
      .map((q, qi) => {
        const w = `${where}第 ${qi + 1} 题`;
        return { q: normalizeQuestion(q, { passage, standard, where: w }), show: inLevel(q.level, level, w) };
      })
      .filter((x) => x.show)
      .map((x) => x.q);
    // 这个难度下一道题都没有，就不显示这个任务
    if (questions.length === 0) return null;
  }
  if (!show) return null;
  return questions ? { ...base, kind: 'quiz', questions } : { ...base, kind: 'check' };
}

/**
 * 题目类型：
 *   choice  有 options
 *   build   有 tiles：点字母块拼出答案（自然拼读）
 *   order   有 order：把几项按正确顺序排好（复述、步骤）
 *   input   其他：输入答案
 * evidence：答对后还要在文章里点出能证明答案的句子（文本证据）
 */
function normalizeQuestion(q, { passage, standard, where }) {
  if (!q.q) throw new Error(`${where}缺少题目 "q"`);
  const text = String(q.q);
  let type;
  let answers;
  let options = null;
  let tiles = null;
  let items = null;

  if (Array.isArray(q.order)) {
    items = q.order.map(String);
    if (items.length < 2) throw new Error(`${where}的 "order" 至少需要 2 项`);
    type = 'order';
    answers = [items.join(' → ')];
  } else {
    if (q.a === undefined || q.a === null || q.a === '') throw new Error(`${where}缺少答案 "a"`);
    answers = (Array.isArray(q.a) ? q.a : [q.a]).map(String);
    if (Array.isArray(q.tiles)) {
      tiles = q.tiles.map(String);
      if (tiles.some((tile) => !tile.trim())) throw new Error(`${where}的 "tiles" 里有空的字母块`);
      if (!canBuild(answers[0].toLowerCase().replace(/\s+/g, ''), tiles.map((tile) => tile.toLowerCase().trim()))) {
        throw new Error(`${where}的答案 "${answers[0]}" 不能用这些字母块拼出来`);
      }
      type = 'build';
    } else if (Array.isArray(q.options)) {
      options = q.options.map(String);
      if (!answers.some((a) => options.includes(a))) throw new Error(`${where}的答案 "${answers[0]}" 不在选项里`);
      type = 'choice';
    } else {
      type = 'input';
    }
  }

  let evidence = null;
  if (q.evidence !== undefined && q.evidence !== null) {
    if (!passage) throw new Error(`${where}写了 "evidence"，但这个任务没有 "passage"`);
    const needles = (Array.isArray(q.evidence) ? q.evidence : [q.evidence]).map(String);
    evidence = [
      ...new Set(
        needles.flatMap((needle) => {
          const found = passage.sentences.flatMap((s, i) => (s.toLowerCase().includes(needle.toLowerCase()) ? [i] : []));
          if (found.length === 0) throw new Error(`${where}的 evidence “${needle}” 在文章里找不到`);
          return found;
        }),
      ),
    ];
  }

  return {
    key: hashString(`${text}|${answers.join('|')}`).toString(36),
    type,
    text,
    answers,
    options,
    tiles,
    items,
    evidence,
    standard: q.standard ? standardOf(q.standard, where) : standard,
    hint: q.hint ? String(q.hint) : '',
    speak: q.speak ? String(q.speak) : '',
    numeric: type === 'input' && answers.every((a) => /^-?\d+(\.\d+)?$/.test(a.trim())),
  };
}

/** 字母块能不能拼出目标单词（字母块可以有多余的干扰项） */
function canBuild(target, tiles, used = new Set()) {
  if (target === '') return true;
  return tiles.some((tile, i) => !used.has(i) && target.startsWith(tile) && canBuild(target.slice(tile.length), tiles, new Set(used).add(i)));
}

function normalizePassage(p, standard, where) {
  if (!p || typeof p !== 'object' || !p.text) throw new Error(`${where}的 "passage" 需要 "text"`);
  const text = String(p.text).replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?]["'”’)]?)\s+/).filter(Boolean);
  const genre = p.genre || (standard?.strand === 'RI' ? 'informational' : 'literature');
  if (!['literature', 'informational'].includes(genre)) throw new Error(`${where}的 passage.genre 只能是 literature 或 informational`);
  const vocab = (p.vocab || []).map((v, i) => {
    if (!v.word) throw new Error(`${where}的 passage.vocab 第 ${i + 1} 个缺少 "word"`);
    return { word: String(v.word), meaning: String(v.meaning || ''), emoji: v.emoji ? String(v.emoji) : '' };
  });
  return { title: p.title ? String(p.title) : '', genre, sentences, vocab, words: countWords(text) };
}

function normalizeWrite(w, where) {
  if (!w.prompt) throw new Error(`${where}的 "write" 需要 "prompt"`);
  return {
    prompt: String(w.prompt),
    frame: w.frame ? String(w.frame) : '',
    require: (w.require || []).map(String),
    minWords: Math.max(1, Number(w.minWords ?? 5)),
  };
}

function normalizeFluency(f, standard, siblings, where) {
  let passage;
  if (f.passage) {
    const source = siblings.find((t) => String(t.id) === String(f.passage));
    if (!source?.passage) throw new Error(`${where}的 fluency.passage "${f.passage}" 找不到：需要是同一科目里带 passage 的任务 id`);
    passage = normalizePassage(source.passage, null, where);
  } else if (f.text) {
    passage = normalizePassage({ title: f.title, text: f.text, genre: f.genre }, standard, where);
  } else {
    throw new Error(`${where}的 "fluency" 需要 "passage"（引用任务 id）或 "text"`);
  }
  const goal = Number(f.goal ?? FLUENCY_GOALS[standard?.grade ?? '1'] ?? 60);
  return { passage, goal };
}

export function countWords(text) {
  return String(text)
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

// ---------- 题目生成 ----------

const OP_WORDS = { '+': '加', '-': '减', '×': '乘', '÷': '除以' };
const OP_ALIASES = { '*': '×', x: '×', '/': '÷' };

/**
 * 合并出某个难度下的口算参数。
 * 文件里可以用 generate.levels.easy / hard 精确指定；没写时：
 *   简单 → 数字范围缩小、口诀到 5、题目少四成
 *   挑战 → 三个数连算（连加连减、乘加乘减）
 */
export function arithConfig(gen, level, where = '') {
  if (gen.kind !== 'arith') throw new Error(`${where}的 generate.kind 目前只支持 "arith"`);
  const base = { ops: gen.ops, max: gen.max ?? 20, table: gen.table ?? 9, count: gen.count ?? 10, terms: gen.terms ?? 2 };
  const auto =
    level === 'easy'
      ? { max: easyMax(base.max), table: Math.min(base.table, 5), count: Math.max(3, Math.round(base.count * 0.6)), terms: 2 }
      : level === 'hard'
        ? { terms: 3 }
        : {};
  const override = gen.levels?.[level] ?? {};
  const cfg = { ...base, ...auto, ...override };

  cfg.ops = (cfg.ops && cfg.ops.length ? cfg.ops : ['+', '-']).map((o) => OP_ALIASES[o] || o);
  const bad = cfg.ops.find((o) => !OP_WORDS[o]);
  if (bad) throw new Error(`${where}的运算符 "${bad}" 不支持，可用 + - × ÷`);
  cfg.max = Math.max(2, cfg.max);
  cfg.table = Math.max(2, cfg.table);
  cfg.count = Math.min(50, Math.max(1, cfg.count));
  cfg.terms = cfg.terms >= 3 ? 3 : 2;
  return cfg;
}

function easyMax(max) {
  if (max <= 10) return max;
  if (max <= 20) return 10;
  return Math.max(20, Math.round(max / 50) * 10);
}

function generateQuestions(cfg, seedText) {
  const rand = mulberry32(hashString(seedText));
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const addOps = cfg.ops.filter((o) => o === '+' || o === '-');

  const seen = new Set();
  const out = [];
  for (let guard = 0; out.length < cfg.count && guard < cfg.count * 50; guard++) {
    const op = cfg.ops[int(0, cfg.ops.length - 1)];
    let a, b, r;
    if (op === '+') { a = int(1, cfg.max - 1); b = int(1, cfg.max - a); r = a + b; }
    else if (op === '-') { a = int(2, cfg.max); b = int(1, a); r = a - b; }
    else if (op === '×') { a = int(2, cfg.table); b = int(2, cfg.table); r = a * b; }
    else { b = int(2, cfg.table); r = int(1, cfg.table); a = b * r; }
    const tokens = [a, op, b];

    if (cfg.terms === 3) {
      // 第三个数只用加减，乘除始终在前面，按从左到右算就符合运算顺序
      const multiplicative = op === '×' || op === '÷';
      let op2 = addOps.length ? addOps[int(0, addOps.length - 1)] : int(0, 1) ? '+' : '-';
      if (op2 === '+' && !multiplicative && r >= cfg.max) op2 = '-';
      if (op2 === '-' && r < 1) op2 = '+';
      let c;
      if (op2 === '+') c = multiplicative ? int(1, 20) : int(1, cfg.max - r);
      else c = int(1, multiplicative ? Math.min(r, 20) : r);
      r = op2 === '+' ? r + c : r - c;
      tokens.push(op2, c);
    }

    // 交换顺序的加法、乘法（3 + 5 和 5 + 3）算同一道题
    const key = tokens.length === 3 && (op === '+' || op === '×') ? `${Math.min(a, b)}${op}${Math.max(a, b)}` : tokens.join('');
    if (seen.has(key) && guard < cfg.count * 40) continue;
    seen.add(key);
    const text = `${tokens.join(' ')} = ？`;
    out.push({
      key: hashString(text).toString(36),
      type: 'input',
      text,
      answers: [String(r)],
      options: null,
      tiles: null,
      items: null,
      evidence: null,
      standard: null,
      hint: '',
      speak: `${tokens.map((t) => OP_WORDS[t] ?? t).join(' ')} 等于几？`,
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
