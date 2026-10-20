// 检查内容库（content/units/*/unit.json）：npm run check:content
// 用和页面一样的 data.js 在三档难度下加载每个单元，再检查来源、署名、标准年级、生词和 id。

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveUnits, normalizeHomework, LEVELS } from '../src/data.js';
import { parseStandard } from '../src/standards.js';
import { STATION_TYPES } from '../src/stations.js';

const UNITS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'units');
const GRADES = ['K', '1', '2', '3', '4', '5'];
const GENRES = ['literature', 'informational'];
/** Dolch 高频词表：开场字幕、Zib 的话、门的短信、可解码短文都用它 */
const dolch = JSON.parse(readFileSync(join(UNITS_DIR, '..', 'wordlists', 'dolch.json'), 'utf8'));
const DOLCH = new Set(Object.values(dolch.lists).flat());

const errors = [];
const units = {};

for (const dir of readdirSync(UNITS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const file = join(UNITS_DIR, dir.name, 'unit.json');
  if (!existsSync(file)) {
    errors.push(`${dir.name}：缺少 unit.json`);
    continue;
  }
  try {
    const unit = JSON.parse(readFileSync(file, 'utf8'));
    if (unit.id !== dir.name) errors.push(`${dir.name}：id "${unit.id}" 和目录名不一致`);
    units[unit.id] = unit;
  } catch (err) {
    errors.push(`${dir.name}/unit.json 不是合法的 JSON：${err.message}`);
  }
}

const taskIds = new Map();

for (const unit of Object.values(units)) {
  const at = (msg) => errors.push(`${unit.id}：${msg}`);
  if (!GRADES.includes(String(unit.grade))) at(`grade 应该是 ${GRADES.join(' / ')}，现在是 "${unit.grade}"`);
  if (!unit.title) at('缺少 title');
  if (!unit.license) at('缺少 license（这个单元发布用的授权）');
  if (!Array.isArray(unit.lessons) || unit.lessons.length === 0) {
    at('缺少 lessons');
    continue;
  }
  if (unit.source) {
    for (const key of ['work', 'author', 'url', 'license']) if (!unit.source[key]) at(`source 缺少 ${key}`);
  }

  const lessonIds = new Set();
  for (const lesson of unit.lessons) {
    const where = `${unit.id} / ${lesson.id}`;
    if (!lesson.id) at('有一课缺少 id');
    if (lessonIds.has(lesson.id)) at(`课的 id "${lesson.id}" 重复`);
    lessonIds.add(lesson.id);
    if (!GENRES.includes(lesson.genre)) errors.push(`${where}：genre 只能是 ${GENRES.join(' / ')}`);
    if (unit.source && (!lesson.from || !lesson.changes)) errors.push(`${where}：改编内容要写 from（改编自哪一部分）和 changes（改了什么）`);
    if (!Array.isArray(lesson.tasks) || lesson.tasks.length === 0) {
      errors.push(`${where}：没有 tasks`);
      continue;
    }

    for (const task of lesson.tasks) {
      if (!task.id) errors.push(`${where}：有任务没写 id（内容库里的任务必须写 id，进度按它保存）`);
      else if (taskIds.has(task.id)) errors.push(`${where}：任务 id "${task.id}" 和 ${taskIds.get(task.id)} 重复`);
      else taskIds.set(task.id, where);

      checkGrade(task.standard, task.level, unit.grade, `${where} / ${task.id}`);
      for (const q of task.questions || []) checkGrade(q.standard, q.level ?? task.level, unit.grade, `${where} / ${task.id}「${q.q}」`);

      const p = task.passage;
      if (p?.decodable) checkDecodable(p, `${where} / ${task.id}`);
      if (p?.text) {
        const tokens = p.text.toLowerCase().split(/[^a-z'’-]+/).filter(Boolean);
        for (const v of p.vocab || []) {
          const w = String(v.word).toLowerCase();
          if (!tokens.some((t) => t === w || (t.startsWith(w) && t.length - w.length <= 3))) {
            errors.push(`${where} / ${task.id}：生词 "${v.word}" 在文章里没有出现`);
          }
        }
      }
    }
  }
  for (const w of unit.wordWall || []) {
    if (w.lesson && !lessonIds.has(w.lesson)) at(`词墙里 "${w.word}" 指向的课 "${w.lesson}" 不存在`);
  }

  // 和页面一样加载：三档难度都要能正常展开
  for (const { id: level } of LEVELS) {
    try {
      const raw = resolveUnits({ subjects: [{ id: 'check', unit: unit.id }] }, units);
      normalizeHomework(raw, { level, today: '2026-01-01' });
    } catch (err) {
      at(`在“${level}”难度下加载出错：${err.message}`);
    }
  }
}

/**
 * 可解码短文（passage.decodable）：每个词要么是 Dolch 高频词，要么是 vowels 里教过的短元音拼出来的
 * “辅音-元音-辅音”词（开头、结尾可以是两个辅音，可以加复数 s），要么是 names 里的人名
 */
function checkDecodable(p, where) {
  const vowels = String(p.decodable.vowels || '');
  if (!/^[aeiou]+$/.test(vowels)) return errors.push(`${where}：decodable.vowels 要写教过的元音，比如 "ae"`);
  const names = new Set((p.decodable.names || []).map((n) => String(n).toLowerCase()));
  const cvc = new RegExp(`^[^aeiou]{1,2}[${vowels}][^aeiouwy]{1,2}s?$`);
  const bad = [...new Set(String(p.text).toLowerCase().match(/[a-z']+/g).filter((w) => !DOLCH.has(w) && !names.has(w) && !cvc.test(w)))];
  if (bad.length) errors.push(`${where}：可解码短文里有还不会拼读的词：${bad.join('、')}（只能用高频词和短元音 ${vowels} 的词）`);
}

/** 标准年级要和单元一致；挑战难度可以用高一个年级的标准 */
function checkGrade(code, level, grade, where) {
  if (!code) return;
  const std = parseStandard(code);
  if (!std) return; // 格式错误由 data.js 报出
  const diff = GRADES.indexOf(std.grade) - GRADES.indexOf(String(grade));
  const hardOnly = level === 'hard' || (Array.isArray(level) && level.length === 1 && level[0] === 'hard');
  if (diff === 0 || (diff === 1 && hardOnly)) return;
  errors.push(
    diff === 1
      ? `${where}：${std.code} 是高一个年级的标准，只能放在 "level": "hard" 里`
      : `${where}：${std.code} 和单元的年级 ${grade} 不一致`,
  );
}

// ---------- 故事章节和开场动画 ----------

const STORY_DIR = join(UNITS_DIR, '..', 'story');
const SHOT_TYPES = ['fly', 'say', 'ask', 'preview', 'title'];
/** 着陆区：离北极这么多度以内（和 src/explore.js 的 HOME_COLAT 一致），发现物不能放在里面 */
const HOME_COLAT = 26;
const STATION_KEYS = STATION_TYPES.map((t) => t.key);
const chapters = existsSync(STORY_DIR)
  ? readdirSync(STORY_DIR).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, ...JSON.parse(readFileSync(join(STORY_DIR, f), 'utf8')) }))
  : [];

/** 字幕里的词：小写，去掉标点；let's → let，Zib's → zib；单个字母（拼读提示里的 w、e、t）不算 */
const wordsOf = (text) =>
  String(text)
    .toLowerCase()
    .split(/[^a-z']+/)
    .map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
    .filter((w) => w.length > 1 || w === 'a' || w === 'i');

/** 一个单元里孩子学过的词：词墙 + 每篇文章的生词 */
const unitWords = (unit) => [
  ...(unit.wordWall || []).map((w) => w.word),
  ...(unit.lessons || []).flatMap((l) => (l.tasks || []).flatMap((t) => (t.passage?.vocab || []).map((v) => v.word))),
].map((w) => String(w).toLowerCase());

for (const ch of chapters) {
  const at = (msg) => errors.push(`story/${ch.file}：${msg}`);
  if (`${ch.id}.json` !== ch.file) at(`id "${ch.id}" 和文件名不一致`);
  if (!units[ch.unit]) at(`引用的单元 "${ch.unit}" 不存在`);
  if (!Number.isInteger(ch.layer) || ch.layer < 1) at('layer 需要是从 1 开始的整数');
  for (const key of Object.keys(ch.surface?.stations || {})) {
    if (!STATION_KEYS.includes(key)) at(`surface.stations 里的 "${key}" 不是站点，可用：${STATION_KEYS.join(' / ')}`);
  }
  if (ch.explore) checkExplore(ch, at);
  if (ch.wardrobe) checkWardrobe(ch, at);
  if (ch.door) checkDoor(ch, at);
  const op = ch.opening;
  if (!op) continue;
  if (!Array.isArray(op.shots) || op.shots.length === 0) {
    at('opening 缺少 shots');
    continue;
  }

  // 能用的词：高频词表 + 章节声明的词（学校本周、名字等）+ 更浅的层里学过的单元词
  const earlier = chapters.filter((c) => c.layer < ch.layer && units[c.unit]).flatMap((c) => unitWords(units[c.unit]));
  const allowed = new Set([...DOLCH, ...Object.values(op.vocab || {}).flat().map((w) => w.toLowerCase()), ...earlier]);
  const thisUnit = units[ch.unit] ? unitWords(units[ch.unit]) : [];

  op.shots.forEach((s, i) => {
    const where = `第 ${i + 1} 个镜头（${s.type}）`;
    if (!SHOT_TYPES.includes(s.type)) at(`${where}的 type 只能是 ${SHOT_TYPES.join(' / ')}`);
    if (!s.camera) at(`${where}缺少 camera`);
    const texts = [s.text, s.q, s.hint, s.speak, ...(s.options || [])].filter(Boolean);
    for (const w of texts.flatMap(wordsOf)) {
      if (!allowed.has(w)) at(`${where}用到了没学过的词 "${w}"。只能用高频词、前面学过的词，或者在 opening.vocab 里声明`);
    }
    if (s.type === 'ask' && !(s.options || []).includes(s.a)) at(`${where}的答案 "${s.a}" 不在选项里`);
    if (s.type === 'preview') {
      if (!s.word) at(`${where}缺少要预告的 word`);
      else if (!thisUnit.includes(s.word.toLowerCase())) at(`${where}预告的 "${s.word}" 不是单元 ${ch.unit} 要学的词`);
    }
  });
  const previews = op.shots.filter((s) => s.type === 'preview').length;
  if (previews > 1) at(`每段开场最多预告一个新词，现在有 ${previews} 个`);
}

/**
 * 闲逛：地带和发现物。发现物的名字要能“破译”：学校本周的词，或者某一课文章里的词；
 * Zib 介绍它的话只能用高频词、章节声明的词、前面几层学过的词，加上这一课文章里的词
 */
function checkExplore(ch, at) {
  const ex = ch.explore;
  const unit = units[ch.unit];
  const zones = Array.isArray(ex.zones) ? ex.zones : [];
  if (!zones.length) at('explore 缺少 zones');
  const zoneIds = new Set();
  zones.forEach((z, i) => {
    const where = `explore 第 ${i + 1} 个地带`;
    if (!z.id) at(`${where}缺少 id`);
    else if (zoneIds.has(z.id)) at(`${where}的 id "${z.id}" 重复`);
    zoneIds.add(z.id);
    if (!z.name) at(`${where}缺少 name`);
    if (!/^#[0-9a-f]{6}$/i.test(z.color || '')) at(`${where}的 color 要写成 #rrggbb`);
    if (!(z.lon >= 0 && z.lon < 360)) at(`${where}的 lon（经度）要在 0–360 之间`);
  });

  const earlier = chapters.filter((c) => c.layer < ch.layer && units[c.unit]).flatMap((c) => unitWords(units[c.unit]));
  const base = [...DOLCH, ...Object.values(ch.opening?.vocab || {}).flat().map((w) => w.toLowerCase()), ...earlier];
  const lessonWords = (lesson) =>
    (lesson.tasks || []).flatMap((t) => [...wordsOf(t.passage?.text || ''), ...(t.passage?.vocab || []).map((v) => String(v.word).toLowerCase())]);
  const ids = new Set();
  const dirs = [];
  (ex.discoveries || []).forEach((d, i) => {
    const where = `explore 第 ${i + 1} 个发现物${d.id ? `（${d.id}）` : ''}`;
    if (!d.id) at(`${where}缺少 id`);
    else if (ids.has(d.id)) at(`${where}的 id 重复`);
    ids.add(d.id);
    for (const key of ['emoji', 'zh', 'word', 'say']) if (!d[key]) at(`${where}缺少 ${key}`);
    if (!zoneIds.has(d.zone)) at(`${where}的 zone "${d.zone}" 不在 zones 里`);
    const word = String(d.word || '').toLowerCase();
    const allowed = new Set([...base, word]);
    if (d.from?.lesson) {
      const lesson = unit?.lessons.find((l) => l.id === d.from.lesson);
      if (!lesson) at(`${where}的 from.lesson "${d.from.lesson}" 在单元 ${ch.unit} 里找不到`);
      else {
        const words = lessonWords(lesson);
        if (!words.includes(word)) at(`${where}的名字 "${d.word}" 不在《${lesson.title}》的文章里，读完这一课也破译不了`);
        for (const w of words) allowed.add(w);
      }
    } else if (!d.from?.school) {
      at(`${where}要写 from.lesson（读完哪一课破译）或 from.school（学校本周教过）`);
    }
    if (d.say) {
      for (const w of wordsOf(d.say)) if (!allowed.has(w)) at(`${where}的 say 用到了没学过的词 "${w}"`);
      if (!wordsOf(d.say).includes(word)) at(`${where}的 say 里要说出它的名字 "${d.word}"`);
    }
    const [lat, lon] = Array.isArray(d.at) ? d.at : [];
    if (!(lat >= -90 && lat <= 90) || !(lon >= 0 && lon < 360)) at(`${where}的 at 要写成 [纬度, 经度]`);
    else if (90 - lat < HOME_COLAT + 4) at(`${where}离北极太近，在着陆区里了（纬度最多 ${90 - HOME_COLAT - 4}）`);
    else {
      const c = ((90 - lat) * Math.PI) / 180;
      const l = (lon * Math.PI) / 180;
      const dir = [Math.sin(c) * Math.sin(l), Math.cos(c), -Math.sin(c) * Math.cos(l)];
      for (const o of dirs) {
        if (Math.hypot(dir[0] - o.dir[0], dir[1] - o.dir[1], dir[2] - o.dir[2]) * 14 < 3.5) at(`${where}和 ${o.id} 挨得太近`);
      }
      dirs.push({ id: d.id, dir });
    }
  });
}

/**
 * 衣柜：每件衣服的名字要出现在那一课的文章里（读完那一课才拿得到）；
 * 地带要在 explore.zones 里，wear / off 指向衣柜里的衣服，feel 是 cold / wet / hot；
 * Zib 的话只能用高频词、章节声明的词、前面几层学过的词，和这个地带提到的衣服那几课文章里的词
 */
function checkWardrobe(ch, at) {
  const wr = ch.wardrobe;
  const unit = units[ch.unit];
  if (!unit) return;
  const items = Array.isArray(wr.items) ? wr.items : [];
  const byId = new Map();
  const lessonText = (lesson) =>
    (lesson.tasks || []).flatMap((t) => [t.passage?.text || '', ...(t.passage?.vocab || []).map((v) => v.word)]).join(' ').toLowerCase();
  items.forEach((item, i) => {
    const where = `wardrobe 第 ${i + 1} 件衣服${item.id ? `（${item.id}）` : ''}`;
    for (const key of ['id', 'word', 'emoji', 'zh']) if (!item[key]) at(`${where}缺少 ${key}`);
    if (byId.has(item.id)) at(`${where}的 id 重复`);
    const lesson = unit.lessons.find((l) => l.id === item.from?.lesson);
    if (!lesson) at(`${where}的 from.lesson "${item.from?.lesson}" 在单元 ${ch.unit} 里找不到`);
    else if (!lessonText(lesson).includes(String(item.word).toLowerCase())) at(`${where}的 "${item.word}" 不在《${lesson.title}》的文章里，读完这一课也拿不到`);
    byId.set(item.id, { item, lesson });
  });

  const zoneIds = new Set((ch.explore?.zones || []).map((z) => z.id));
  const earlier = chapters.filter((c) => c.layer < ch.layer && units[c.unit]).flatMap((c) => unitWords(units[c.unit]));
  const base = [...DOLCH, ...Object.values(ch.opening?.vocab || {}).flat().map((w) => w.toLowerCase()), ...earlier];
  for (const [zoneId, rule] of Object.entries(wr.zones || {})) {
    const where = `wardrobe.zones.${zoneId}`;
    if (!zoneIds.has(zoneId)) at(`${where}：地带 "${zoneId}" 不在 explore.zones 里`);
    if (!['cold', 'wet', 'hot'].includes(rule.feel)) at(`${where}的 feel 只能是 cold / wet / hot`);
    const mentioned = [rule.wear, ...Object.keys(rule.off || {})];
    for (const id of mentioned) if (id && !byId.has(id)) at(`${where}提到的 "${id}" 不是衣柜里的衣服`);
    if (rule.wear && (!rule.need || !rule.good)) at(`${where}要写 need（没穿时 Zib 说的话）和 good（穿对了说的话）`);
    const allowed = new Set([...base, ...mentioned.flatMap((id) => (byId.get(id) ? [...wordsOf(lessonText(byId.get(id).lesson)), ...wordsOf(byId.get(id).item.word)] : []))]);
    for (const [key, text] of [['need', rule.need], ['good', rule.good], ...Object.entries(rule.off || {}).map(([id, t]) => [`off.${id}`, t])]) {
      const bad = [...new Set(wordsOf(text || '').filter((w) => !allowed.has(w)))];
      if (bad.length) at(`${where}.${key} 用到了没学过的词：${bad.join('、')}`);
    }
  }
}

/**
 * 通往下一层的门。解码锁的词要是单元词墙或生词表里带图的词，图不能重复（孩子是看词选图）；
 * 理解锁的每封短信按普通任务的规则加载（答案在选项里、证据句找得到），每道题都要有证据句，
 * 短信本身只能用高频词、单元文章里的词、前面几层学过的词和 comprehend.vocab 里声明的词
 */
function checkDoor(ch, at) {
  const door = ch.door;
  const unit = units[ch.unit];
  if (!unit) return;
  if (!door.to?.layer || !door.to?.name) at('door.to 要写 layer 和 name（通往第几层、叫什么）');

  const dec = door.decode || {};
  if (!parseStandard(dec.standard || '')) at(`door.decode.standard "${dec.standard}" 不是 CCSS 代码`);
  // 解码锁的词来自 decode.unit（比如拼读单元），没写就是这一层的单元
  const decodeUnit = dec.unit ? units[dec.unit] : unit;
  if (!decodeUnit) return at(`door.decode.unit "${dec.unit}" 在内容库里找不到`);
  const pics = new Map();
  for (const w of decodeUnit.wordWall || []) pics.set(String(w.word).toLowerCase(), w.emoji);
  for (const l of decodeUnit.lessons) {
    for (const t of l.tasks || []) for (const v of t.passage?.vocab || []) if (!pics.has(String(v.word).toLowerCase())) pics.set(String(v.word).toLowerCase(), v.emoji);
  }
  const words = Array.isArray(dec.words) ? dec.words : [];
  if (words.length < 3) at('door.decode.words 至少要 3 个词（每道题要两张干扰图）');
  const byPic = new Map();
  for (const w of words) {
    const pic = pics.get(String(w).toLowerCase());
    if (!pic) at(`door.decode.words 里的 "${w}" 不是单元 ${decodeUnit.id} 词墙或生词表里带图的词`);
    else if (byPic.has(pic)) at(`door.decode.words 里 "${w}" 和 "${byPic.get(pic)}" 的图一样（${pic}），看图分不出来`);
    else byPic.set(pic, w);
  }
  if (!(dec.need >= 1 && dec.need <= words.length)) at(`door.decode.need 要在 1 到 ${words.length} 之间`);

  const com = door.comprehend || {};
  if (!parseStandard(com.standard || '')) at(`door.comprehend.standard "${com.standard}" 不是 CCSS 代码`);
  const tickets = Array.isArray(com.tickets) ? com.tickets : [];
  if (!tickets.length) at('door.comprehend.tickets 至少要有一封短信');
  try {
    const tasks = tickets.map((t) => ({ id: t.id, title: t.title, standard: com.standard, passage: { title: t.title, genre: 'informational', text: t.text }, questions: t.questions }));
    normalizeHomework({ subjects: [{ id: 'door', name: '理解锁', tasks }] }, { level: 'normal', today: '2026-01-01' });
  } catch (err) {
    at(`door 的短信加载出错：${err.message}`);
  }
  const earlier = chapters.filter((c) => c.layer < ch.layer && units[c.unit]).flatMap((c) => unitWords(units[c.unit]));
  const allowed = new Set([
    ...DOLCH,
    ...Object.values(ch.opening?.vocab || {}).flat().map((w) => w.toLowerCase()),
    ...earlier,
    ...unitWords(unit),
    ...unit.lessons.flatMap((l) => (l.tasks || []).flatMap((t) => wordsOf(t.passage?.text || ''))),
    ...(com.vocab || []).map((w) => String(w).toLowerCase()),
  ]);
  const ids = new Set();
  tickets.forEach((t, i) => {
    const where = `door 第 ${i + 1} 封短信${t.id ? `（${t.id}）` : ''}`;
    if (!t.id || !t.title || !t.text) at(`${where}要写 id、title 和 text`);
    else if (ids.has(t.id)) at(`${where}的 id 重复`);
    ids.add(t.id);
    for (const q of t.questions || []) if (q.evidence === undefined) at(`${where}「${q.q}」没写 evidence：理解锁每道题都要找证据句`);
    const bad = [...new Set(wordsOf(t.text || '').filter((w) => !allowed.has(w)))];
    if (bad.length) at(`${where}用到了没学过的词：${bad.join('、')}。只能用高频词、单元里学过的词，或者在 door.comprehend.vocab 里声明`);
  });
}

// ---------- 汇总 ----------

for (const unit of Object.values(units)) {
  const counts = { literature: 0, informational: 0 };
  console.log(`\n📦 ${unit.id} · ${unit.title}${unit.titleZh ? `（${unit.titleZh}）` : ''} · Grade ${unit.grade} · ${unit.license}`);
  if (unit.source) console.log(`   改编自：${unit.source.work}（${unit.source.license}）`);
  for (const lesson of unit.lessons || []) {
    counts[lesson.genre] = (counts[lesson.genre] || 0) + 1;
    const passage = (lesson.tasks || []).find((t) => t.passage)?.passage;
    const words = passage ? passage.text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length : 0;
    const perLevel = LEVELS.map(({ id }) => {
      try {
        const hw = normalizeHomework(resolveUnits({ subjects: [{ id: 'check', unit: unit.id, lessons: [lesson.id] }] }, units), { level: id, today: '2026-01-01' });
        const tasks = hw.subjects.flatMap((s) => s.tasks);
        return `${LEVELS.find((l) => l.id === id).icon} ${tasks.length} 项 ${tasks.reduce((n, t) => n + (t.questions?.length ?? 0), 0)} 题`;
      } catch {
        return `${id} ✗`;
      }
    });
    console.log(`   ${lesson.genre === 'literature' ? '📚' : '🔬'} ${lesson.id.padEnd(16)} ${String(words).padStart(3)} 词 · ${perLevel.join(' · ')}`);
  }
  console.log(`   文学 ${counts.literature} 课 · 说明文 ${counts.informational} 课`);
}

for (const ch of chapters) {
  const shots = ch.opening?.shots || [];
  const asks = shots.filter((s) => s.type === 'ask').length;
  const preview = shots.find((s) => s.type === 'preview')?.word;
  console.log(`\n🎬 ${ch.id} · 第 ${ch.layer} 层 · 单元 ${ch.unit}`);
  console.log(`   开场：${shots.length} 个镜头 · ${asks} 道复习题${preview ? ` · 预告新词 ${preview}` : ''}`);
  if (ch.explore) {
    const finds = ch.explore.discoveries || [];
    const school = finds.filter((d) => d.from?.school).length;
    console.log(`   闲逛：${ch.explore.zones?.length || 0} 个地带 · ${finds.length} 个发现物（${school} 个是学校本周的词，${finds.length - school} 个读完课文才能破译）`);
  }
  if (ch.wardrobe) {
    const zones = Object.keys(ch.wardrobe.zones || {});
    console.log(`   衣柜：${ch.wardrobe.items?.length ?? 0} 件衣服（${(ch.wardrobe.items || []).map((i) => i.word).join('、')}）· ${zones.length} 个地带要穿对（${zones.join('、')}）`);
  }
  if (ch.door) {
    const { to, decode, comprehend } = ch.door;
    console.log(`   门：通往第 ${to?.layer} 层 ${to?.name} · 解码锁 ${decode?.words?.length ?? 0} 个${decode?.unit ? ` ${decode.unit} 的` : ''}词认出 ${decode?.need} 个 · 理解锁 ${comprehend?.tickets?.length ?? 0} 封短信`);
  }
}

if (errors.length) {
  console.error(`\n❌ ${errors.length} 个问题：`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
console.log(`\n✅ ${Object.keys(units).length} 个单元，${taskIds.size} 项任务，${chapters.length} 个故事章节，检查通过`);
