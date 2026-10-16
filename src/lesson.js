// 英语课（CCSS）相关的界面片段：学习目标、阅读文章、字母块、写作清单、朗读计时、标准掌握报告。

import { STRANDS, STRAND_ORDER, mastery, fluencyMastery } from './standards.js';
import { canSpeak } from './audio.js';
import { hashString } from './data.js';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- 标准 ----------

export function standardChip(std) {
  if (!std) return '';
  return `<span class="std-chip s-${std.strand}" title="${esc(std.ican)}">${STRANDS[std.strand].icon} ${esc(std.code)}</span>`;
}

/** “I can”学习目标：美国课堂里每节课都会贴出来的那句话 */
export function icanHtml(std) {
  if (!std) return '';
  return `
    <div class="ican s-${std.strand}">
      <span class="ican-label" aria-hidden="true">🎯</span>
      <div class="ican-text"><b>${esc(std.ican)}</b><small>${esc(std.icanZh)}</small></div>
      ${standardChip(std)}
    </div>`;
}

/** 一个任务涉及的所有标准（任务本身 + 每道题） */
export function taskStandards(task) {
  const map = new Map();
  if (task.standard) map.set(task.standard.code, task.standard);
  for (const q of task.questions || []) if (q.standard) map.set(q.standard.code, q.standard);
  return [...map.values()];
}

// ---------- 阅读文章 ----------

const GENRE = {
  literature: '📚 Literature · 故事',
  informational: '🔬 Informational · 说明文',
};

const clean = (token) => token.toLowerCase().replace(/[^a-z'’-]/g, '');

function vocabIndex(token, vocab) {
  const t = clean(token);
  if (!t) return -1;
  return vocab.findIndex((v) => {
    const w = v.word.toLowerCase();
    return t === w || (t.startsWith(w) && t.length - w.length <= 3);
  });
}

/**
 * mode：read（点单词听发音）/ evidence（点句子找证据）/ fluency（朗读，大字号）
 * marks：{ found: [句子序号], reveal: [句子序号] }
 */
export function passageHtml(passage, { mode = 'read', collapsed = false, marks = {}, reading = false } = {}) {
  const sentences = passage.sentences
    .map((s, i) => {
      const cls = [marks.found?.includes(i) && 'found', marks.reveal?.includes(i) && 'reveal'].filter(Boolean).join(' ');
      const words = s
        .split(' ')
        .map((token) => {
          // 标点不放进单词里，点击和高亮只作用在单词本身
          const [, lead, core, trail] = /^([^A-Za-z0-9'’]*)(.*?)([^A-Za-z0-9'’]*)$/.exec(token);
          if (!core) return esc(token);
          const vi = vocabIndex(core, passage.vocab);
          return `${esc(lead)}<span class="w${vi >= 0 ? ' vocab' : ''}"${vi >= 0 ? ` data-vocab="${vi}"` : ''}>${esc(core)}</span>${esc(trail)}`;
        })
        .join(' ');
      return `<span class="sent ${cls}" data-s="${i}">${words}</span>`;
    })
    .join(' ');
  const tip =
    mode === 'evidence'
      ? '<p class="reader-tip">👆 Tap the sentence that proves your answer. <small>点一下能证明答案的句子</small></p>'
      : mode === 'read'
        ? '<p class="reader-tip subtle">Tap a word to hear it. <small>点单词听发音，彩色的是新词</small></p>'
        : '';
  return `
    <section class="reader ${passage.genre} mode-${mode} ${collapsed ? 'collapsed' : ''}">
      <header class="reader-head">
        <span class="genre-chip">${GENRE[passage.genre]}</span>
        ${passage.title ? `<h3>${esc(passage.title)}</h3>` : ''}
        <div class="reader-tools">
          ${canSpeak && mode !== 'fluency' ? `<button class="pill" data-action="read-aloud">${reading ? '⏹ Stop' : '🔊 Read to me'}</button>` : ''}
          ${mode === 'read' ? `<button class="pill" data-action="toggle-reader">${collapsed ? '📖 展开文章' : '收起'}</button>` : ''}
        </div>
      </header>
      <div class="reader-text">${sentences}</div>
      ${tip}
    </section>`;
}

export function vocabCardsHtml(vocab) {
  return `<div class="vocab-grid">${vocab
    .map(
      (v) => `
      <button class="vocab-card" data-action="say" data-text="${esc(v.word)}">
        ${v.emoji ? `<span class="vc-emoji" aria-hidden="true">${esc(v.emoji)}</span>` : ''}
        <b>${esc(v.word)}</b>
        <small>${esc(v.meaning)}</small>
        <span class="vc-say" aria-hidden="true">🔊</span>
      </button>`,
    )
    .join('')}</div>`;
}

// ---------- 字母块 / 排序 ----------

export function tileSource(q) {
  return q.type === 'build' ? q.tiles : q.items;
}

/** 按题目固定打乱顺序（刷新页面也不变），并保证不是正确顺序 */
export function shuffledOrder(q) {
  const source = tileSource(q);
  const order = source.map((_, i) => i);
  let seed = hashString(q.key);
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const solved = q.type === 'order' ? order.every((v, i) => v === i) : order.map((i) => source[i]).join('') === q.answers[0];
  if (solved && order.length > 1) order.push(order.shift());
  return order;
}

export function tilesHtml(q, state, locked = false) {
  const source = tileSource(q);
  const isOrder = q.type === 'order';
  const picked = state.picked
    .map(
      (i, n) =>
        `<button type="button" class="tile picked" data-action="untile" data-i="${i}" ${locked ? 'disabled' : ''}>${isOrder ? `<em>${n + 1}</em>` : ''}${esc(source[i])}</button>`,
    )
    .join('');
  const placeholder = isOrder
    ? 'Tap the cards in order: first → last <small>按先后顺序点卡片</small>'
    : 'Tap the letters to build the word <small>点字母块拼出单词</small>';
  const bank = state.order
    .map((i) =>
      state.picked.includes(i)
        ? `<span class="tile ghost" aria-hidden="true">${esc(source[i])}</span>`
        : `<button type="button" class="tile" data-action="tile" data-i="${i}" ${locked ? 'disabled' : ''}>${esc(source[i])}</button>`,
    )
    .join('');
  return `
    <div class="tiles ${q.type} ${locked ? 'locked' : ''}">
      <div class="tile-slots">${picked || `<span class="tile-placeholder">${placeholder}</span>`}</div>
      <div class="tile-bank">${bank}</div>
      <div class="tile-actions">
        <button type="button" class="btn ghost small" data-action="tile-reset" ${locked ? 'disabled' : ''}>↺ 重来</button>
        <button type="button" class="btn primary" data-action="tile-check" ${locked ? 'disabled' : ''}>Check ✓ 检查</button>
      </div>
    </div>`;
}

// ---------- 写作 ----------

export function checklistHtml(checks) {
  return checks
    .map(
      (c) => `
      <li class="${c.ok ? 'ok' : ''}">
        <span class="ck" aria-hidden="true">${c.ok ? '✅' : '⬜'}</span>
        <div><b>${esc(c.en)}</b><small>${esc(c.zh)}</small></div>
      </li>`,
    )
    .join('');
}

export function writeHtml(task, text, checks, done) {
  const { prompt, frame } = task.write;
  return `
    <section class="write-prompt">
      <span class="wp-label">📝 Writing prompt · 写作题目</span>
      <p class="wp-text">${esc(prompt)}</p>
      ${canSpeak ? '<button class="pill" data-action="say" data-text="' + esc(prompt) + '">🔊 Listen</button>' : ''}
    </section>
    ${
      frame
        ? `<div class="frame">
            <span>💬 Sentence starter · 可以这样开头</span>
            <b>${esc(frame)}</b>
            <button class="pill" data-action="use-frame">用这个开头</button>
          </div>`
        : ''
    }
    <textarea class="write-input" rows="5" placeholder="Write here in English…"
              autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="写作">${esc(text)}</textarea>
    <h4 class="checklist-title">✔️ My writing checklist · 写完检查一下</h4>
    <ul class="checklist">${checklistHtml(checks)}</ul>
    <div class="feedback" role="status">${done ? '✅ 已交给爸爸妈妈检查，还可以继续修改' : ''}</div>
    <button class="btn primary wide" data-action="write-submit">${done ? 'Update · 更新' : 'Turn it in · 交作业'}</button>`;
}

// ---------- 朗读计时 ----------

const FLUENCY_STEPS = [
  { id: 'listen', icon: '🎧', en: 'I listen', zh: '听示范' },
  { id: 'along', icon: '👀', en: 'We read', zh: '跟着读' },
  { id: 'alone', icon: '⏱️', en: 'I read', zh: '自己计时读' },
];

export function fluencyHtml(task, runs, { step = 'listen', running = false, reading = false } = {}) {
  const { passage, goal } = task.fluency;
  const best = runs.reduce((m, r) => Math.max(m, r.wpm), 0);
  const steps = FLUENCY_STEPS.map(
    (s, i) => `
      <li class="${s.id === step ? 'current' : ''}">
        <span>${i + 1}</span><b>${s.icon} ${s.en}</b><small>${s.zh}</small>
      </li>`,
  ).join('');
  const runList = runs
    .slice()
    .reverse()
    .map((r) => `<li><b>${r.wpm}</b> WPM <small>${r.seconds}s${r.wpm >= goal ? ' · 🎯 达到目标' : ''}</small></li>`)
    .join('');
  return `
    <ol class="fluency-steps">${steps}</ol>
    ${passageHtml(passage, { mode: 'fluency' })}
    <div class="fluency-bar">
      <div class="timer"><b class="time">0.0s</b><small>${passage.words} words · Goal ${goal} WPM</small></div>
      <div class="fluency-actions">
        ${
          running
            ? '<button class="btn primary" data-action="fluency-stop">■ I’m done · 读完了</button>'
            : `${canSpeak ? `<button class="btn ghost small" data-action="model-read">${reading && step === 'listen' ? '⏹ Stop' : '🎧 Listen'}</button>
               <button class="btn ghost small" data-action="read-along">${reading && step === 'along' ? '⏹ Stop' : '👀 Read along'}</button>` : ''}
               <button class="btn primary" data-action="fluency-start">▶ Start · 开始读</button>`
        }
      </div>
    </div>
    <div class="feedback" role="status"></div>
    ${
      runs.length
        ? `<div class="fluency-runs"><span>最好成绩 <b>${best}</b> WPM</span><ul>${runList}</ul></div>`
        : '<p class="fluency-note">👪 请家长在旁边听：读错的词可以让孩子再读一遍。WPM = 每分钟读的词数。</p>'
    }`;
}

// ---------- 标准掌握报告 ----------

/** 按 CCSS 标准汇总：题目看第一次答对率，其他任务看完成情况 */
export function standardsSummary(homework, progress) {
  const rows = new Map();
  const row = (std) => {
    if (!rows.has(std.code)) rows.set(std.code, { std, asked: 0, right: 0, tasks: [], fluency: null });
    return rows.get(std.code);
  };
  let evidenceAsked = 0;
  let evidenceFirst = 0;
  for (const subject of homework.subjects) {
    for (const task of subject.tasks) {
      if (task.kind === 'quiz') {
        task.questions.forEach((q, i) => {
          const rec = progress.record(task, i);
          if (q.evidence && rec?.evidenceDone) {
            evidenceAsked++;
            if (rec.evidenceFirst) evidenceFirst++;
          }
          if (!q.standard) return;
          const r = row(q.standard);
          if (!rec) return;
          r.asked++;
          if (rec.firstCorrect) r.right++;
        });
      } else if (task.standard) {
        const r = row(task.standard);
        r.tasks.push({ task, done: progress.isDone(task) });
        if (task.kind === 'fluency') {
          const best = progress.fluencyRuns(task).reduce((m, x) => Math.max(m, x.wpm), 0);
          if (best) r.fluency = { best, goal: task.fluency.goal };
        }
      }
    }
  }
  return { rows: [...rows.values()], evidenceAsked, evidenceFirst };
}

function resultHtml(r) {
  if (r.fluency) {
    const m = fluencyMastery(r.fluency.best / r.fluency.goal);
    return `<span class="mastery m${m.level}">${m.en} · ${m.zh}</span><small>${r.fluency.best} / ${r.fluency.goal} WPM</small>`;
  }
  if (r.asked) {
    const m = mastery(r.right / r.asked);
    return `<span class="mastery m${m.level}">${m.en} · ${m.zh}</span><small>一次答对 ${r.right}/${r.asked}</small>`;
  }
  if (r.tasks.length) {
    const done = r.tasks.filter((t) => t.done).length;
    return `<span class="mastery ${done === r.tasks.length ? 'done' : 'todo'}">${done === r.tasks.length ? '✅ 已完成' : '未完成'}</span><small>${done}/${r.tasks.length} 项</small>`;
  }
  return '<span class="mastery todo">未开始</span>';
}

export function standardsReportHtml(homework, progress) {
  const { rows, evidenceAsked, evidenceFirst } = standardsSummary(homework, progress);
  if (rows.length === 0) return '';
  const groups = STRAND_ORDER.map((strand) => {
    const list = rows.filter((r) => r.std.strand === strand).sort((a, b) => a.std.code.localeCompare(b.std.code, 'en', { numeric: true }));
    if (list.length === 0) return '';
    return `
      <div class="strand s-${strand}">
        <h4>${STRANDS[strand].icon} ${STRANDS[strand].en} <small>${STRANDS[strand].zh}</small></h4>
        <ul>${list
          .map(
            (r) => `
            <li class="std-row">
              ${standardChip(r.std)}
              <div class="std-text"><b>${esc(r.std.ican)}</b><small>${esc(r.std.icanZh)}</small></div>
              <div class="std-result">${resultHtml(r)}</div>
            </li>`,
          )
          .join('')}</ul>
      </div>`;
  }).join('');
  return `
    <h3>🇺🇸 Common Core 英语标准 <small>（按标准统计今天的表现，4 级：Exceeds 优秀 / Meets 达标 / Approaching 接近 / Beginning 起步）</small></h3>
    ${evidenceAsked ? `<p class="evidence-stat">🔍 文本证据（Text evidence）：一次就找对 <b>${evidenceFirst}/${evidenceAsked}</b></p>` : ''}
    <div class="standards">${groups}</div>`;
}
