// 通往下一层的门：两把锁和试飞。
// 读完这一层单元的所有课（解码锁的词来自另一个单元的话，那个单元的课也要读完），就能来门口“试飞”：
//   🔤 解码锁：屏幕上只显示英文单词（不朗读），孩子从三张图里选出它，认出 need 个就开。
//      词来自 decode.unit（比如短元音拼读单元的 cat、pig、box），没写就用这一层的单元；
//   🔍 理解锁：读 Zib 的一封短信，每道题都答对、并在信里点出证据句才开。
// 每把锁只看这一次孩子自己做的结果：没有提示、不计时、不扣星星。没打开就记下“收集到的数据”
// （哪些词没认出来、哪道题没答对），练完再来；锁打开以后一直开着。两把锁都开了，门打开，升起这一层的设计。

import { UNITS } from './content.js';
import { normalizeHomework } from './data.js';
import { sound, speak, speakSequence, stopSpeaking, canSpeak } from './audio.js';
import { esc, icanHtml, standardChip, passageHtml } from './lesson.js';
import { parseStandard } from './standards.js';
import { learnedLessons, doorState, addFlight, setDoorOpened } from './story.js';

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const dayText = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });

/**
 * 门现在的样子：哪几课还没读、两把锁开没开、能不能试飞；这一章没有门返回 null。
 * unit 是这一层的单元，decodeUnit 是解码锁的词来自的单元（没写就是同一个）；两个单元的课都要读完
 */
export function doorStatus(chapter) {
  const door = chapter?.door;
  const unit = door && UNITS[chapter.unit];
  if (!unit) return null;
  const decodeUnit = UNITS[door.decode.unit] || unit;
  const lessons = [...new Set([decodeUnit, unit])].flatMap((u) => {
    const learned = learnedLessons(u.id);
    return u.lessons.map((l) => ({ id: l.id, title: l.title, icon: u.icon, read: learned.has(l.id) }));
  });
  const left = lessons.filter((l) => !l.read);
  const state = doorState(chapter.id);
  return { ...state, door, unit, decodeUnit, lessons, left, ready: left.length === 0, open: state.decode && state.comprehend };
}

/** 单元里的词 → 图和出自哪一课：先看词墙，再看每篇文章的生词表 */
function wordInfo(unit) {
  const map = new Map();
  for (const w of unit.wordWall || []) {
    map.set(w.word.toLowerCase(), { emoji: w.emoji, lesson: unit.lessons.find((l) => l.id === w.lesson) });
  }
  for (const lesson of unit.lessons) {
    for (const t of lesson.tasks) {
      for (const v of t.passage?.vocab || []) {
        const key = v.word.toLowerCase();
        if (!map.has(key)) map.set(key, { emoji: v.emoji, lesson });
      }
    }
  }
  return map;
}

/** 解码锁的题：词的顺序打乱；干扰图先挑同一个字母开头的词，只看首字母猜不出来，要往后读 */
function decodeItems(door, unit) {
  const info = wordInfo(unit);
  const words = door.decode.words.map((word) => ({ word, ...info.get(word.toLowerCase()) }));
  return shuffle(words).map((item) => {
    const others = shuffle(words.filter((w) => w !== item));
    others.sort((a, b) => (b.word[0] === item.word[0]) - (a.word[0] === item.word[0]));
    return { ...item, options: shuffle([item, ...others.slice(0, 2)]).map((w) => w.emoji) };
  });
}

/** 理解锁的短信：按普通任务的规则整理（句子、证据句的位置） */
function ticketTasks(door, date) {
  const tasks = door.comprehend.tickets.map((t) => ({
    id: t.id,
    title: t.title,
    standard: door.comprehend.standard,
    passage: { title: t.title, genre: 'informational', text: t.text },
    questions: t.questions,
  }));
  return normalizeHomework({ subjects: [{ id: 'door', name: '理解锁', tasks }] }, { level: 'normal', today: date }).subjects[0].tasks;
}

/** 一次试飞的结果，一行字 */
function flightLine(f) {
  const parts = [];
  if (f.decode) parts.push(`🔤 认出 ${f.decode.right}/${f.decode.total} 个词${f.decode.open ? ' 🔓' : ''}`);
  if (f.comprehend) parts.push(`🔍 短信 ${f.comprehend.right}/${f.comprehend.total} 题${f.comprehend.open ? ' 🔓' : ''}`);
  return parts.join(' · ');
}

/** 收集到的数据：没打开的锁差在哪儿、回去练什么 */
function flightData(f, unit) {
  const out = [];
  if (f.decode && !f.decode.open) {
    const info = wordInfo(unit);
    const titles = [...new Set(f.decode.missed.map((w) => info.get(w.toLowerCase())?.lesson?.title).filter(Boolean))];
    out.push(`没认出来的词：${f.decode.missed.join('、')}${titles.length ? ` → 再读一读${titles.map((t) => `《${t}》`).join('')}` : ''}`);
  }
  if (f.comprehend && !f.comprehend.open) {
    const wrong = f.comprehend.results.filter((r) => !r.answer).length;
    const noEvidence = f.comprehend.results.filter((r) => r.answer && r.evidence === false).length;
    const what = [wrong && `${wrong} 道题答案没选对`, noEvidence && `${noEvidence} 道题证据句没找对`].filter(Boolean).join('，');
    out.push(`短信：${what} → 做阅读任务时，答完题再找一找证据句；下次换一封短信`);
  }
  return out;
}

export class DoorHud {
  /** ui：toast、openModal（开门以后的解锁卡片）、closePanel、date（今天的日期） */
  constructor(ui) {
    this.ui = ui;
    this.view = null;
    this.bound = new WeakSet();
    this.flight = null;
    this.busy = false;
    this.stopReading = null;
    this.el = document.getElementById('flight');
    this.el.addEventListener('click', (e) => this.#onClick(e));
  }

  /** 主界面换了（着陆 / 回到航行期） */
  setView(view) {
    this.close();
    this.view = view;
    if (view && !this.bound.has(view)) {
      this.bound.add(view);
      view.addEventListener('door', () => this.open());
    }
    this.render();
  }

  /** 着陆的这一章有门才返回章节 */
  get chapter() {
    const ch = this.view?.chapter;
    return ch?.door ? ch : null;
  }

  /** 地图上的门跟着状态变：两盏锁灯、名牌上的进度 */
  render() {
    const status = doorStatus(this.chapter);
    if (status) this.view.setDoor?.(status);
  }

  /** 打开门口的面板：两把锁、还差几课、试飞记录 */
  open() {
    const status = doorStatus(this.chapter);
    if (!status) return;
    sound.click();
    this.ui.closePanel();
    this.flight = null;
    this.#show(this.#homeHtml(status));
  }

  /** 关上；本来就关着返回 false。试飞做到一半关上的，这次不算 */
  close() {
    if (this.el.hidden) return false;
    this.#stopReading();
    stopSpeaking();
    this.flight = null;
    this.busy = false;
    this.el.classList.remove('show');
    this.el.hidden = true;
    this.el.innerHTML = '';
    return true;
  }

  // ---------- 家长报告 ----------

  reportHtml() {
    const s = doorStatus(this.chapter);
    if (!s) return '';
    const { door, flights } = s;
    const last = flights[flights.length - 1];
    let detail;
    if (s.opened) detail = `门已经打开${door.unlock ? `，解锁了${door.unlock.name}` : ''}。一共试飞 ${flights.length} 次`;
    else if (!s.ready) detail = `读完这一层的 ${s.lessons.length} 课才能试飞，还差：${s.left.map((l) => l.title).join('、')}`;
    else if (!last) detail = '这一层的课都读完了，可以去门口试飞了';
    else detail = `试飞 ${flights.length} 次。最近一次（${dayText(last.date)}）：${[flightLine(last), ...flightData(last, s.decodeUnit)].join('；')}`;
    return `
      <li><div><b>🚪 第 ${this.chapter.layer} 层的门 · 解码锁 ${s.decode ? '🔓' : '🔒'} · 理解锁 ${s.comprehend ? '🔓' : '🔒'}</b>
      <small>${esc(detail)}。门只锁故事，不锁使命任务；试飞不计分，只看孩子自己做的结果</small></div></li>`;
  }

  // ---------- 门口 ----------

  #homeHtml(s) {
    const { door } = s;
    const lock = (open, title, code, desc) => `
      <li class="lock ${open ? 'open' : ''}">
        <span class="lock-icon" aria-hidden="true">${open ? '🔓' : '🔒'}</span>
        <div><b>${title} ${standardChip(parseStandard(code))}</b><small>${desc}</small></div>
        <span class="lock-state">${open ? '已打开' : '还锁着'}</span>
      </li>`;
    const locks = `
      <ul class="locks">
        ${lock(s.decode, '🔤 解码锁', door.decode.standard, `读英文单词，选出对应的图：${door.decode.words.length} 个词认出 ${door.decode.need} 个`)}
        ${lock(s.comprehend, '🔍 理解锁', door.comprehend.standard, '读 Zib 的一封短信：每道题都答对，并在信里点出证明答案的句子')}
      </ul>`;
    let body;
    if (s.opened) {
      const u = door.unlock;
      body = u ? `<div class="door-unlocked"><span aria-hidden="true">${esc(u.emoji)}</span><div><b>门已经打开，解锁了${esc(u.name)}</b><small>${esc(u.note)}</small></div></div>` : '';
    } else if (s.open) {
      body = '<button class="btn primary wide" data-act="unlock">🚪 两把锁都开了，开门！</button>';
    } else if (!s.ready) {
      const items = s.lessons.map((l) => `<li class="${l.read ? 'read' : ''}">${l.read ? '✅' : '⬜'} ${esc(l.icon || '')} ${esc(l.title)}</li>`).join('');
      body = `
        <h3>先读完这一层的课 <small>还差 ${s.left.length} 课 · 读完文章、做完那一课的阅读题就算读完</small></h3>
        <ul class="door-lessons">${items}</ul>
        <button class="btn primary wide" disabled>🚀 读完 ${s.lessons.length} 课就能试飞</button>`;
    } else {
      body = `<button class="btn primary wide" data-act="start">🚀 开始试飞 · 第 ${s.flights.length + 1} 次</button>`;
    }
    return `
      <header>
        <div>
          <h2>🚪 通往第 ${door.to.layer} 层 · ${esc(door.to.icon || '')} ${esc(door.to.name)}</h2>
          <p>两把锁都打开，门就开了。试飞不计分、不扣星星：没打开就收集数据，练完再来。</p>
        </div>
        <button class="icon-btn" data-act="close" aria-label="关闭">✕</button>
      </header>
      ${locks}
      ${body}
      ${this.#logHtml(s)}`;
  }

  #logHtml(s) {
    if (!s.flights.length) return '';
    const items = [...s.flights]
      .reverse()
      .slice(0, 5)
      .map((f) => {
        const ok = (!f.decode || f.decode.open) && (!f.comprehend || f.comprehend.open);
        const data = flightData(f, s.decodeUnit);
        return `
          <li class="${ok ? 'ok' : ''}">
            <b>${ok ? '✅' : '🧪'} 试飞 ${f.n} · ${esc(dayText(f.date))}</b>
            <span>${esc(flightLine(f))}</span>
            ${data.map((d) => `<small>${esc(d)}</small>`).join('')}
          </li>`;
      })
      .join('');
    return `<h3>🛰️ 试飞记录</h3><ul class="flight-log">${items}</ul>`;
  }

  // ---------- 试飞 ----------

  #start() {
    const s = doorStatus(this.chapter);
    if (!s?.ready || s.open) return;
    const date = this.ui.date();
    const steps = [!s.decode && 'decode', !s.comprehend && 'comprehend'].filter(Boolean);
    // 理解锁每次换一封短信：按以前试过几次理解锁轮流
    const tickets = ticketTasks(s.door, date);
    const tried = s.flights.filter((f) => f.comprehend).length;
    this.flight = {
      n: s.flights.length + 1,
      steps,
      step: 0,
      record: { n: s.flights.length + 1, date },
      decode: steps.includes('decode') ? { items: decodeItems(s.door, s.decodeUnit), i: 0, picks: [] } : null,
      comprehend: steps.includes('comprehend') ? { ticket: tickets[tried % tickets.length], qi: 0, stage: 'answer', results: [], collapsed: false } : null,
    };
    sound.click();
    this.#renderStep();
  }

  #renderStep() {
    const f = this.flight;
    this.#show(f.steps[f.step] === 'decode' ? this.#decodeHtml() : this.#ticketHtml());
  }

  #flightHead(title) {
    return `
      <header>
        <div>
          <h2>${title}</h2>
          <p>🚀 试飞 ${this.flight.n} · ${esc(this.chapter.title)}</p>
        </div>
        <button class="icon-btn" data-act="close" aria-label="结束试飞">✕</button>
      </header>`;
  }

  // ---------- 解码锁 ----------

  #decodeHtml() {
    const d = this.flight.decode;
    const item = d.items[d.i];
    const dots = d.items.map((_, i) => `<li class="${i < d.i ? (d.picks[i] ? 'ok' : 'revealed') : i === d.i ? 'current' : ''}"></li>`).join('');
    return `
      ${this.#flightHead('🔤 解码锁')}
      ${icanHtml(parseStandard(this.chapter.door.decode.standard))}
      <ol class="dots" aria-hidden="true">${dots}</ol>
      <div class="decode-word" lang="en">${esc(item.word)}</div>
      <p class="decode-tip">Which picture is it? <small>自己读一读这个词，点出它的图（这里不朗读哦）</small></p>
      <div class="decode-pics">${item.options
        .map((e) => `<button type="button" class="decode-pic" data-act="pick" data-emoji="${esc(e)}" aria-label="${esc(e)}">${esc(e)}</button>`)
        .join('')}</div>
      <div class="feedback" role="status"></div>`;
  }

  #pick(btn) {
    if (this.busy) return;
    const d = this.flight.decode;
    const item = d.items[d.i];
    const ok = btn.dataset.emoji === item.emoji;
    d.picks.push(ok);
    this.busy = true;
    for (const b of this.el.querySelectorAll('.decode-pic')) {
      b.disabled = true;
      if (b.dataset.emoji === item.emoji) b.classList.add('right');
    }
    if (!ok) btn.classList.add('wrong');
    if (ok) sound.correct();
    else {
      sound.wrong();
      speak(item.word);
    }
    this.#feedback(ok ? '✅ 认出来了！' : `记下来了：这个词是 <b>${esc(item.word)}</b> ${esc(item.emoji)}`, ok ? 'ok' : 'info');
    setTimeout(
      () => {
        this.busy = false;
        if (this.flight?.decode !== d) return;
        d.i++;
        if (d.i < d.items.length) this.#show(this.#decodeHtml());
        else this.#finishLock('decode');
      },
      ok ? 800 : 1700,
    );
  }

  // ---------- 理解锁 ----------

  #ticketHtml() {
    const c = this.flight.comprehend;
    const t = c.ticket;
    const q = t.questions[c.qi];
    const evidence = c.stage === 'evidence';
    const dots = t.questions.map((_, i) => `<li class="${i < c.qi ? (pass(c.results[i]) ? 'ok' : 'revealed') : i === c.qi ? 'current' : ''}"></li>`).join('');
    const reader = passageHtml(t.passage, { mode: evidence ? 'evidence' : 'read', collapsed: !evidence && c.collapsed });
    const question = `
      <section class="question">
        <div class="q-text">${esc(q.text)}</div>
        <div class="q-tools">
          ${canSpeak ? '<button class="pill" data-act="speak">🔊 Listen</button>' : ''}
          ${q.evidence && !evidence ? '<span class="pill static">🔍 答对后要找证据</span>' : ''}
        </div>
      </section>`;
    const answer = evidence
      ? `<div class="answer-done">✅ <b>${esc(q.answers[0])}</b></div>`
      : `<div class="choices">${q.options.map((o) => `<button type="button" class="choice" data-act="choose" data-value="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    const status = `<div class="feedback ${evidence ? 'info' : ''}" role="status">${evidence ? '🔍 Now find the evidence! <small>在信里点出能证明答案的句子</small>' : ''}</div>`;
    return `
      ${this.#flightHead('🔍 理解锁')}
      ${icanHtml(t.standard)}
      <ol class="dots" aria-hidden="true">${dots}</ol>
      ${evidence ? `${question}${answer}${status}${reader}` : `${reader}${question}${status}${answer}`}`;
  }

  #choose(btn) {
    if (this.busy) return;
    const c = this.flight.comprehend;
    const q = c.ticket.questions[c.qi];
    const ok = q.answers.includes(btn.dataset.value);
    this.busy = true;
    for (const b of this.el.querySelectorAll('.choice')) {
      b.disabled = true;
      if (q.answers.includes(b.dataset.value)) b.classList.add('right');
    }
    if (!ok) btn.classList.add('wrong');
    if (ok && q.evidence) {
      sound.correct();
      this.#feedback('✅ 答对了！再找一找证据', 'ok');
      setTimeout(() => {
        this.busy = false;
        if (this.flight?.comprehend !== c) return;
        c.stage = 'evidence';
        this.#show(this.#ticketHtml());
      }, 900);
      return;
    }
    c.results.push({ q: q.text, answer: ok, evidence: null });
    if (ok) sound.correct();
    else sound.wrong();
    this.#feedback(ok ? '✅ 答对了！' : `记下来了：答案是 <b>${esc(q.answers[0])}</b>`, ok ? 'ok' : 'info');
    this.#afterQuestion(c, ok ? 900 : 1800);
  }

  #pickEvidence(i, el) {
    const c = this.flight?.comprehend;
    if (this.busy || c?.stage !== 'evidence') return;
    const q = c.ticket.questions[c.qi];
    const ok = q.evidence.includes(i);
    c.results.push({ q: q.text, answer: true, evidence: ok });
    this.busy = true;
    el.classList.add(ok ? 'found' : 'miss');
    if (!ok) for (const s of q.evidence) this.el.querySelector(`.sent[data-s="${s}"]`)?.classList.add('reveal');
    if (ok) sound.correct();
    else sound.wrong();
    this.#feedback(ok ? '🔍 找到证据啦！' : '记下来了：证据在这里，读一读它', ok ? 'ok' : 'info');
    this.#afterQuestion(c, ok ? 1200 : 2400);
  }

  #afterQuestion(c, ms) {
    setTimeout(() => {
      this.busy = false;
      if (this.flight?.comprehend !== c) return;
      c.qi++;
      c.stage = 'answer';
      if (c.qi < c.ticket.questions.length) this.#show(this.#ticketHtml());
      else this.#finishLock('comprehend');
    }, ms);
  }

  // ---------- 一把锁做完、整次试飞做完 ----------

  #finishLock(kind) {
    const f = this.flight;
    if (kind === 'decode') {
      const { items, picks } = f.decode;
      const right = picks.filter(Boolean).length;
      const need = this.chapter.door.decode.need;
      f.record.decode = { right, total: items.length, need, open: right >= need, missed: items.filter((_, i) => !picks[i]).map((it) => it.word) };
    } else {
      const { ticket, results } = f.comprehend;
      const right = results.filter(pass).length;
      f.record.comprehend = { ticket: ticket.id, right, total: results.length, open: right === results.length, results };
    }
    const r = f.record[kind];
    const last = f.step === f.steps.length - 1;
    const name = kind === 'decode' ? '🔤 解码锁' : '🔍 理解锁';
    const score = kind === 'decode' ? `认出了 ${r.right} / ${r.total} 个词${r.open ? '' : `，要 ${r.need} 个`}` : `${r.total} 道题里过了 ${r.right} 道${r.open ? '' : '，要全部答对并找到证据'}`;
    const data = flightData({ [kind]: r }, doorStatus(this.chapter).decodeUnit);
    if (r.open) sound.complete();
    this.#show(`
      ${this.#flightHead(name)}
      <div class="lock-result ${r.open ? 'open' : ''}">
        <div class="lr-icon" aria-hidden="true">${r.open ? '🔓' : '🧪'}</div>
        <h3>${r.open ? `${name}打开了！` : `${name}还没打开`}</h3>
        <p>${esc(score)}</p>
        ${data.length ? `<div class="lr-data"><b>收集到的数据</b>${data.map((d) => `<small>${esc(d)}</small>`).join('')}</div>` : ''}
      </div>
      <button class="btn primary wide" data-act="${last ? 'finish' : 'next-step'}">${last ? '看看试飞结果 →' : '继续 → 🔍 理解锁'}</button>`);
  }

  #finish() {
    const ch = this.chapter;
    const f = this.flight;
    addFlight(ch.id, f.record);
    const s = doorStatus(ch);
    this.flight = null;
    this.render();
    const open = s.decode && s.comprehend;
    const data = flightData(f.record, s.decodeUnit);
    if (open) sound.complete();
    this.#show(`
      <header>
        <div>
          <h2>${open ? '🎉 两把锁都打开了！' : `🧪 试飞 ${f.n} 收集到了数据`}</h2>
          <p>${esc(flightLine(f.record))}</p>
        </div>
        <button class="icon-btn" data-act="close" aria-label="关闭">✕</button>
      </header>
      <ul class="locks">
        <li class="lock ${s.decode ? 'open' : ''}"><span class="lock-icon" aria-hidden="true">${s.decode ? '🔓' : '🔒'}</span><div><b>🔤 解码锁</b></div><span class="lock-state">${s.decode ? '已打开' : '还锁着'}</span></li>
        <li class="lock ${s.comprehend ? 'open' : ''}"><span class="lock-icon" aria-hidden="true">${s.comprehend ? '🔓' : '🔒'}</span><div><b>🔍 理解锁</b></div><span class="lock-state">${s.comprehend ? '已打开' : '还锁着'}</span></li>
      </ul>
      ${data.length ? `<div class="lr-data"><b>收集到的数据</b>${data.map((d) => `<small>${esc(d)}</small>`).join('')}</div>` : ''}
      ${
        open
          ? '<button class="btn primary wide" data-act="unlock">🚪 开门！</button>'
          : `<p class="door-note">真正的火箭也要试飞很多次，每次改进一点。打开的锁会一直开着，练完再来试飞。</p>
             <div class="modal-actions"><button class="btn ghost" data-act="home">回到门口</button><button class="btn primary" data-act="close">知道啦</button></div>`
      }`);
  }

  /** 开门：关掉面板，镜头拍门打开、建筑升起来，然后弹出解锁卡片 */
  async #unlock() {
    const ch = this.chapter;
    const s = doorStatus(ch);
    if (!s?.open) return;
    this.close();
    this.ui.closePanel();
    sound.launch();
    await this.view.openDoor?.();
    setDoorOpened(ch.id);
    this.render();
    const { unlock: u, to } = s.door;
    this.ui.openModal(`
      <div class="modal-card celebrate door-unlock">
        <div class="celebrate-emoji">${esc(u?.emoji || '🚪')}</div>
        <h2>第 ${ch.layer} 层的门打开了！</h2>
        ${u ? `<p>解锁了 <b>${esc(u.name)}</b></p><p class="unlock-note">${esc(u.note)}</p>` : ''}
        <div class="next-layer">${esc(to.icon || '')} 第 ${to.layer} 层 · ${esc(to.name)}正在建造中，敬请期待！</div>
        <div class="modal-actions"><button class="btn primary" data-action="close-modal">好耶！</button></div>
      </div>`);
  }

  // ---------- 内部 ----------

  #show(html) {
    this.#stopReading();
    // 只有第一次打开时弹出来；之后换题只换内容，卡片不再闪一下
    this.el.innerHTML = `<div class="modal-card door-card ${this.el.hidden ? '' : 'still'}">${html}</div>`;
    this.el.firstElementChild.scrollTop = 0;
    if (this.el.hidden) {
      this.el.hidden = false;
      requestAnimationFrame(() => this.el.classList.add('show'));
    }
  }

  #feedback(html, tone) {
    const el = this.el.querySelector('.feedback');
    if (!el) return;
    el.className = `feedback ${tone}`;
    el.innerHTML = html;
  }

  #onClick(e) {
    if (e.target === this.el) return;
    const sentence = e.target.closest('.reader .sent');
    if (sentence && this.flight?.comprehend?.stage === 'evidence') return this.#pickEvidence(Number(sentence.dataset.s), sentence);
    const word = e.target.closest('.reader .w');
    if (word) return speak(word.textContent.replace(/[^A-Za-z'’-]/g, ''));
    const btn = e.target.closest('[data-act], [data-action]');
    if (!btn || btn.disabled) return;
    switch (btn.dataset.act || btn.dataset.action) {
      case 'close':
        sound.click();
        this.close();
        break;
      case 'home':
        this.open();
        break;
      case 'start':
        this.#start();
        break;
      case 'pick':
        this.#pick(btn);
        break;
      case 'choose':
        this.#choose(btn);
        break;
      case 'speak': {
        const c = this.flight?.comprehend;
        if (c) speak(c.ticket.questions[c.qi].text);
        break;
      }
      case 'read-aloud':
        this.#toggleReading();
        break;
      case 'toggle-reader':
        if (this.flight?.comprehend) {
          this.flight.comprehend.collapsed = !this.flight.comprehend.collapsed;
          this.#show(this.#ticketHtml());
        }
        break;
      case 'next-step':
        this.flight.step++;
        this.#renderStep();
        break;
      case 'finish':
        this.#finish();
        break;
      case 'unlock':
        this.#unlock();
        break;
    }
  }

  /** 一句一句读短信并高亮；再点一次停止 */
  #toggleReading() {
    if (this.stopReading) return this.#stopReading();
    if (sound.muted) {
      this.ui.toast('🔇 声音关着呢，点右上角的喇叭打开');
      return;
    }
    const passage = this.flight?.comprehend?.ticket.passage;
    if (!passage) return;
    const sentences = () => this.el.querySelectorAll('.reader .sent');
    let ended = false;
    const stop = speakSequence(passage.sentences, {
      onStart: (i) => sentences().forEach((el, j) => el.classList.toggle('speaking', i === j)),
      onDone: () => {
        ended = true;
        sentences().forEach((el) => el.classList.remove('speaking'));
        this.stopReading = null;
        this.#readButton();
      },
    });
    if (!ended) this.stopReading = stop;
    this.#readButton();
  }

  #stopReading() {
    const stop = this.stopReading;
    this.stopReading = null;
    stop?.();
  }

  #readButton() {
    const b = this.el.querySelector('[data-action="read-aloud"]');
    if (b) b.textContent = this.stopReading ? '⏹ Stop' : '🔊 Read to me';
  }
}

/** 理解锁的一道题算过：答对了，要找证据的也找对了 */
function pass(r) {
  return !!r?.answer && r.evidence !== false;
}
