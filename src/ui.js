import { isCorrect, writingChecks } from './checker.js';
import { questionStars, STARS } from './progress.js';
import { sound, speak, speakSequence, stopSpeaking, canSpeak } from './audio.js';
import { LEVELS, levelInfo } from './data.js';
import {
  esc,
  standardChip,
  icanHtml,
  taskStandards,
  passageHtml,
  vocabCardsHtml,
  tileSource,
  shuffledOrder,
  tilesHtml,
  checklistHtml,
  writeHtml,
  fluencyHtml,
  standardsReportHtml,
} from './lesson.js';
import { ExploreHud } from './explore-hud.js';
import { DoorHud } from './door.js';

const SHEET_MQ = window.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1100px)');
const COARSE = window.matchMedia('(pointer: coarse)').matches;
const MAX_TRIES = 3;
const MAX_WPM = 250;

const PRAISE = ['答对啦！', '太棒了！', '真厉害！', '完全正确！', '你是小天才！', '继续加油！'];
const RETRY = ['再想想～', '差一点点！', '仔细看看题目哦', '别着急，再试一次'];
const PRAISE_EN = ['Great job! 答对啦！', 'Awesome! 太棒了！', 'You got it! 完全正确！', 'Super! 真厉害！'];
const RETRY_EN = ['Try again! 再想想～', 'So close! 差一点点！', 'Look again! 再仔细看看'];

const pick = (list) => list[(Math.random() * list.length) | 0];

export class UI {
  constructor({ homework, progress, scene, levels, story }) {
    this.homework = homework;
    this.progress = progress;
    this.scene = scene;
    this.levels = levels;
    this.story = story;
    this.listening = new WeakSet();
    this.view = null;
    this.introSeen = new Set();
    this.drafts = {};
    this.readerCollapsed = false;

    this.app = document.getElementById('app');
    this.panel = document.getElementById('panel');
    this.modal = document.getElementById('modal');
    this.toastEl = document.getElementById('toast');
    this.starCount = document.getElementById('star-count');
    this.starCounter = document.getElementById('star-counter');
    this.fuelText = document.getElementById('fuel-text');
    this.fuelFill = document.getElementById('fuel-fill');
    this.hint = document.getElementById('hint');
    this.soundBtn = document.getElementById('btn-sound');
    this.levelBtn = document.getElementById('btn-level');

    document.getElementById('title').textContent = homework.title;
    document.title = homework.title;
    const day = new Date(`${homework.date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    document.getElementById('subtitle').textContent = [homework.child, day].filter(Boolean).join(' · ');

    this.#updateSoundButton();
    this.soundBtn.addEventListener('click', () => {
      sound.setMuted(!sound.muted);
      this.#updateSoundButton();
      sound.click();
    });
    document.getElementById('btn-report').addEventListener('click', () => this.openReport());
    this.levelBtn.addEventListener('click', () => this.openLevelPicker());

    this.fuelLabel = document.querySelector('.fuel-label span');
    this.#listen(scene);
    this.exploreHud = new ExploreHud({
      toast: (text) => this.toast(text),
      openModal: (html) => this.#openModal(html),
      closePanel: () => this.closePanel(),
      refresh: () => this.#renderHud(),
      date: () => this.homework.date,
    });
    this.exploreHud.setView(scene);
    this.door = new DoorHud({
      toast: (text) => this.toast(text),
      openModal: (html) => this.#openModal(html),
      closePanel: () => this.closePanel(),
      date: () => this.homework.date,
    });
    this.door.setView(scene);
    progress.addEventListener('change', (e) => this.#onProgress(e.detail));

    this.panel.addEventListener('click', (e) => this.#onPanelClick(e));
    this.panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.panel.querySelector('.answer-input');
      if (input) this.#answer(input.value);
    });
    this.panel.addEventListener('input', (e) => {
      if (e.target.classList.contains('write-input')) this.#onWriteInput(e.target);
    });
    this.modal.addEventListener('click', (e) => this.#onModalClick(e));
    document.addEventListener('keydown', (e) => this.#onKey(e));

    new ResizeObserver(() => this.#syncInset()).observe(this.panel);
    SHEET_MQ.addEventListener('change', () => this.#syncInset());

    this.allDone = progress.remainingTasks() === 0;
    this.#renderHud();
  }

  #listen(view) {
    // 回到航行期时太空场景会再交给 UI 一次，事件只绑一次
    if (this.listening.has(view)) return;
    this.listening.add(view);
    view.addEventListener('select', (e) => this.openSubject(e.detail.subjectId, e.detail.taskId));
    view.addEventListener('rocket', () => this.#onRocket());
  }

  /** 着陆以后：三维视图换成 Bix 星的地面地图，作业按站点分组；回到航行期时换回太空 */
  setView(view, homework) {
    this.closePanel();
    this.scene = view;
    this.#listen(view);
    this.exploreHud.setView(view);
    this.door.setView(view);
    this.setHomework(homework);
  }

  /** 着陆以后的地面地图模式：站点代替科目星球，信号塔代替火箭 */
  #onSurface() {
    return this.homework.mode === 'surface';
  }

  /** 换难度后：关掉面板，按新的作业刷新界面 */
  setHomework(homework) {
    this.homework = homework;
    this.closePanel();
    this.allDone = this.progress.remainingTasks() === 0;
    this.#renderHud();
  }

  // ---------- 面板：科目 ----------

  openSubject(subjectId, taskId) {
    if (this.scene.isLaunching) return;
    const subject = this.homework.subjects.find((s) => s.id === subjectId);
    if (!subject) return;
    sound.click();
    this.scene.focus(subject.id);
    const task = taskId && subject.tasks.find((t) => t.id === taskId);
    if (task && task.kind !== 'check') this.openTask(subject, task);
    else this.#show({ type: 'subject', subject });
  }

  closePanel() {
    this.#stopActivity();
    this.view = null;
    this.panel.classList.remove('open');
    this.app.classList.remove('panel-open');
    this.scene.focus(null);
    this.#syncInset();
  }

  /** 停掉正在进行的朗读和计时 */
  #stopActivity() {
    this.stopReading?.();
    this.stopReading = null;
    clearInterval(this.timer);
    this.timer = null;
    stopSpeaking();
  }

  #show(view) {
    this.#stopActivity();
    this.view = view;
    this.panel.style.setProperty('--c', view.subject.color);
    const render = {
      subject: () => this.#subjectHtml(view.subject),
      intro: () => this.#introHtml(view),
      quiz: () => this.#quizHtml(view),
      summary: () => this.#summaryHtml(view),
      write: () => this.#writeView(view),
      fluency: () => this.#fluencyView(view),
    }[view.type];
    this.panel.innerHTML = render();
    this.panel.scrollTop = 0;
    this.panel.classList.add('open');
    this.app.classList.add('panel-open');
    this.#syncInset();
    if (view.type === 'quiz' && !COARSE) this.panel.querySelector('.answer-input, .choice, .tile')?.focus({ preventScroll: true });
    // 听力题自动播放一遍，之后可以点“Listen”再听
    if (view.type === 'quiz' && view.stage === 'answer') {
      const q = view.task.questions[view.qi];
      if (q.listen) setTimeout(() => this.view === view && speak(q.speak || q.text), 400);
    }
  }

  #head(title, sub, back = true) {
    return `
      <header class="panel-head">
        ${back ? '<button class="icon-btn" data-action="back" aria-label="返回任务列表">←</button>' : ''}
        <div class="ph-text">
          <h2>${esc(title)}</h2>
          <p>${esc(sub)}</p>
        </div>
        <button class="icon-btn close" data-action="close" aria-label="返回太空">✕</button>
      </header>`;
  }

  #subjectHtml(subject) {
    const p = this.progress;
    const done = subject.tasks.filter((t) => p.isDone(t)).length;
    const items = subject.tasks
      .map((task) => {
        const isDone = p.isDone(task);
        const f = p.taskFraction(task);
        const state = isDone ? 'done' : f > 0 ? 'partial' : '';
        const stds = taskStandards(task);
        const main = task.standard || stds[0];
        let meta;
        let action;
        if (task.kind === 'quiz') {
          const finished = task.questions.filter((_, i) => p.questionDone(task, i)).length;
          meta = `${task.passage ? `📖 ${task.passage.title || '阅读'} · ` : ''}${task.questions.length} 道题${finished ? ` · 已完成 ${finished} 道` : ''}`;
          action = `<button class="btn ${isDone ? 'ghost' : 'primary'}" data-action="open-task" data-task="${esc(task.id)}">${isDone ? '看看' : finished ? '继续' : '开始'}</button>`;
        } else if (task.kind === 'write') {
          meta = isDone ? (p.isVerified(task) ? '✅ 家长已检查' : '已交，等爸爸妈妈检查') : task.note || '写几句英语';
          action = `<button class="btn ${isDone ? 'ghost' : 'primary'}" data-action="open-task" data-task="${esc(task.id)}">${isDone ? '修改' : '开始'}</button>`;
        } else if (task.kind === 'fluency') {
          const best = p.fluencyRuns(task).reduce((m, r) => Math.max(m, r.wpm), 0);
          meta = best ? `最好成绩 ${best} WPM · 目标 ${task.fluency.goal}` : `${task.fluency.passage.words} words · 目标 ${task.fluency.goal} WPM`;
          action = `<button class="btn ${isDone ? 'ghost' : 'primary'}" data-action="open-task" data-task="${esc(task.id)}">${isDone ? '再读一次' : '开始'}</button>`;
        } else {
          meta = task.note || '做完后点一下“完成啦”';
          action = `<button class="btn check ${isDone ? 'on' : ''}" data-action="toggle-check" data-task="${esc(task.id)}" aria-pressed="${isDone}">${isDone ? '✅ 已完成' : '完成啦'}</button>`;
        }
        return `
          <li class="task-card ${state}">
            <span class="tc-moon" aria-hidden="true">${isDone ? '🌕' : f > 0 ? '🌓' : '🌑'}</span>
            <div class="tc-body">
              ${stds.length ? `<div class="tc-stds">${stds.map(standardChip).join('')}</div>` : ''}
              <h3>${esc(task.title)}</h3>
              ${main ? `<p class="tc-ican">🎯 ${esc(main.ican)}</p>` : ''}
              <p>${esc(meta)}</p>
              ${task.kind === 'quiz' && f > 0 && !isDone ? `<div class="tc-bar"><i style="width:${f * 100}%"></i></div>` : ''}
            </div>
            ${action}
          </li>`;
      })
      .join('');
    return `
      <header class="panel-head">
        <span class="ph-icon" aria-hidden="true">${esc(subject.icon)}</span>
        <div class="ph-text">
          <h2>${esc(subject.name)}${this.#onSurface() ? '' : '星球'}</h2>
          <p>${done === subject.tasks.length ? `全部完成，${this.#onSurface() ? '站点' : '星球'}被点亮啦！` : `完成了 ${done} / ${subject.tasks.length} 项任务`}</p>
        </div>
        <button class="icon-btn close" data-action="close" aria-label="${this.#onSurface() ? '返回地图' : '返回太空'}">✕</button>
      </header>
      <div class="meter"><i style="width:${p.subjectFraction(subject) * 100}%"></i></div>
      <ul class="task-list">${items}</ul>`;
  }

  openTask(subject, task) {
    if (task.kind === 'write') return this.#show({ type: 'write', subject, task });
    if (task.kind === 'fluency') return this.#show({ type: 'fluency', subject, task, step: 'listen', running: false });
    if (task.kind !== 'quiz') return this.#show({ type: 'subject', subject });
    const qi = task.questions.findIndex((_, i) => !this.progress.questionDone(task, i));
    if (qi === -1) return this.#show({ type: 'summary', subject, task });
    const started = task.questions.some((_, i) => this.progress.record(task, i));
    if (task.passage && !started && !this.introSeen.has(task.id)) return this.#show({ type: 'intro', subject, task });
    this.#show({ type: 'quiz', subject, task, qi });
  }

  // ---------- 读前准备 ----------

  #introHtml({ subject, task }) {
    const { passage } = task;
    const kind = passage.genre === 'informational' ? ['text', '文章'] : ['story', '故事'];
    return `
      ${this.#head(task.title, `${subject.name} · Before you read · 读前准备`)}
      ${icanHtml(task.standard || taskStandards(task)[0])}
      <ol class="intro-steps">
        ${
          passage.vocab.length
            ? `<li><span>1</span><div><b>Words to know</b><small>先认识这些新词，点一下听发音</small>${vocabCardsHtml(passage.vocab)}</div></li>`
            : ''
        }
        <li><span>${passage.vocab.length ? 2 : 1}</span><div><b>Read the ${kind[0]}</b><small>读${kind[1]}《${esc(passage.title || task.title)}》，${passage.words} 个词。不认识的词可以点一下听</small></div></li>
        <li><span>${passage.vocab.length ? 3 : 2}</span><div><b>Answer and find evidence</b><small>回答问题，并在文中找出证明答案的句子 🔍</small></div></li>
      </ol>
      <button class="btn primary wide" data-action="start-reading">Start reading · 开始阅读 →</button>`;
  }

  // ---------- 答题 ----------

  #quizHtml(view) {
    const { subject, task, qi } = view;
    const q = task.questions[qi];
    const rec = this.progress.record(task, qi);
    const evidenceStage = !!(q.evidence && rec?.solved && !rec.evidenceDone);
    view.stage = evidenceStage ? 'evidence' : 'answer';

    const dots = task.questions
      .map((_, i) => {
        const r = this.progress.record(task, i);
        let cls = '';
        if (i === qi) cls = 'current';
        else if (this.progress.questionDone(task, i)) cls = r.revealed ? 'revealed' : r.firstCorrect ? 'ok' : 'fixed';
        else if (r?.solved) cls = 'partial';
        return `<li class="${cls}"></li>`;
      })
      .join('');

    let answerArea;
    if (evidenceStage) {
      answerArea = `<div class="answer-done">✅ <b>${esc(rec.revealed ? q.answers[0] : rec.last ?? q.answers[0])}</b></div>`;
    } else if (q.type === 'choice') {
      answerArea = `<div class="choices">${q.options
        .map((o) => `<button type="button" class="choice" data-action="choose" data-value="${esc(o)}">${esc(o)}</button>`)
        .join('')}</div>`;
    } else if (q.type === 'build' || q.type === 'order') {
      if (this.tileState?.key !== q.key) this.tileState = { key: q.key, order: shuffledOrder(q), picked: [] };
      answerArea = tilesHtml(q, this.tileState);
    } else {
      const mode = q.numeric ? (COARSE ? 'none' : 'decimal') : 'text';
      answerArea = `
        <form class="answer" autocomplete="off">
          <input class="answer-input ${q.numeric ? 'numeric' : ''}" inputmode="${mode}" enterkeyhint="done"
                 autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40"
                 placeholder="${q.numeric ? '?' : q.standard ? 'Type your answer' : '在这里写答案'}" aria-label="答案" />
          <button type="submit" class="btn primary">提交</button>
        </form>
        ${q.numeric ? keypadHtml() : ''}`;
    }

    const feedback = evidenceStage
      ? '🔍 Now find the evidence! <small>再到文章里点出能证明答案的句子</small>'
      : rec?.tries
        ? `已经试了 ${rec.tries} 次，加油！`
        : '';
    const reader = task.passage
      ? passageHtml(task.passage, { mode: evidenceStage ? 'evidence' : 'read', collapsed: !evidenceStage && this.readerCollapsed })
      : '';

    const question = `
      <section class="question ${q.text.length > 24 ? 'long' : ''}">
        <div class="q-text">${esc(q.text)}</div>
        <div class="q-tools">
          ${canSpeak ? `<button class="pill" data-action="speak">🔊 ${q.standard ? 'Listen' : '读题'}</button>` : ''}
          ${q.hint && !evidenceStage ? '<button class="pill" data-action="hint">💡 提示</button>' : ''}
          ${q.evidence && !evidenceStage ? '<span class="pill static">🔍 答对后要找证据</span>' : ''}
        </div>
      </section>`;
    const status = `<div class="feedback ${evidenceStage ? 'info' : ''}" role="status">${feedback}</div>`;
    // 答题时先读文章再看题；找证据时题目和答案放上面，下面是要点句子的文章
    const body = evidenceStage ? `${question}${answerArea}${status}${reader}` : `${reader}${question}${status}${answerArea}`;

    return `
      ${this.#head(task.title, `${subject.name} · 第 ${qi + 1} / ${task.questions.length} 题`)}
      <ol class="dots" aria-hidden="true">${dots}</ol>
      ${icanHtml(q.standard || task.standard)}
      ${body}`;
  }

  #answer(value) {
    const view = this.view;
    if (view?.type !== 'quiz' || view.stage !== 'answer' || this.busy) return;
    const { subject, task, qi } = view;
    const q = task.questions[qi];
    if (!String(value).trim()) {
      this.#feedback('先写下你的答案吧～', 'info');
      return;
    }
    const english = !!(q.standard || task.standard);
    const correct = isCorrect(q, value);
    const rec = this.progress.submit(task, qi, String(value).trim(), correct);

    if (correct) {
      this.busy = true;
      sound.correct();
      this.scene.celebrate(subject.id, 'correct');
      const stars = questionStars(rec);
      const next = q.evidence ? ' 🔍 Now find the evidence!' : '';
      this.#feedback(`${pick(english ? PRAISE_EN : PRAISE)} ${stars ? `+${stars} ⭐` : ''}${next}`, 'ok');
      this.#lockAnswer(value);
      this.#flyStars(stars);
      setTimeout(
        () => {
          this.busy = false;
          if (this.view !== view) return;
          if (q.evidence) this.#show(view);
          else this.#nextQuestion();
        },
        q.evidence ? 1000 : 1100,
      );
      return;
    }

    sound.wrong();
    this.#shake();
    const input = this.panel.querySelector('.answer-input');
    if (input) {
      input.select();
    } else {
      const btn = [...this.panel.querySelectorAll('.choice')].find((b) => b.dataset.value === value);
      if (btn) {
        btn.disabled = true;
        btn.classList.add('wrong');
      }
    }
    if (rec.tries >= MAX_TRIES) {
      this.#feedback(
        `正确答案是 <b>${esc(q.answers[0])}</b>，记住它哦！<button class="btn primary small" data-action="reveal">记住啦，${q.evidence ? '去找证据' : '下一题'} →</button>`,
        'reveal',
        true,
      );
      this.panel.querySelectorAll('.answer button, .answer input, .choice, .keypad button').forEach((el) => (el.disabled = true));
      if (this.tileState && (q.type === 'build' || q.type === 'order')) this.#renderTiles(true);
    } else {
      const hint = q.hint && rec.tries >= 1 ? `<br/>💡 ${esc(q.hint)}` : '';
      this.#feedback(`${pick(english ? RETRY_EN : RETRY)}（还可以试 ${MAX_TRIES - rec.tries} 次）${hint}`, 'bad', true);
    }
  }

  /** 在文章里点句子找证据 */
  #pickEvidence(si, el) {
    const view = this.view;
    if (this.busy || view.stage !== 'evidence') return;
    const { subject, task, qi } = view;
    const q = task.questions[qi];
    const correct = q.evidence.includes(si);
    const rec = this.progress.submitEvidence(task, qi, correct);
    if (correct) {
      this.busy = true;
      view.stage = 'done';
      el.classList.add('found');
      sound.correct();
      this.scene.celebrate(subject.id, 'correct');
      const stars = rec.evidenceFirst ? STARS.evidence : 0;
      this.#feedback(`🔍 You found the evidence! 找到证据啦 ${stars ? `+${stars} ⭐` : ''}`, 'ok');
      this.#flyStars(stars, el);
      setTimeout(() => {
        this.busy = false;
        if (this.view === view) this.#nextQuestion();
      }, 1400);
      return;
    }
    sound.wrong();
    el.classList.remove('miss');
    void el.offsetWidth;
    el.classList.add('miss');
    if (rec.evidenceTries >= MAX_TRIES) {
      view.stage = 'done';
      this.progress.revealEvidence(task, qi);
      for (const i of q.evidence) this.panel.querySelector(`.sent[data-s="${i}"]`)?.classList.add('reveal');
      this.#feedback(
        '👀 The evidence is here. 证据在这里，读一读它<button class="btn primary small" data-action="evidence-next">Next · 下一题 →</button>',
        'reveal',
        true,
      );
    } else {
      this.#feedback(`That sentence doesn’t prove it. Look again! 这句证明不了答案，再找找（还可以试 ${MAX_TRIES - rec.evidenceTries} 次）`, 'bad');
    }
  }

  #nextQuestion() {
    const { subject, task, qi } = this.view;
    const n = task.questions.length;
    for (let step = 1; step <= n; step++) {
      const i = (qi + step) % n;
      if (!this.progress.questionDone(task, i)) {
        this.#show({ type: 'quiz', subject, task, qi: i });
        return;
      }
    }
    this.#show({ type: 'summary', subject, task });
  }

  #lockAnswer(value) {
    this.panel.querySelectorAll('.answer button, .answer input, .choice, .keypad button').forEach((el) => (el.disabled = true));
    const btn = [...this.panel.querySelectorAll('.choice')].find((b) => b.dataset.value === value);
    btn?.classList.add('right');
    this.panel.querySelector('.answer-input')?.classList.add('right');
    if (this.panel.querySelector('.tiles')) {
      this.#renderTiles(true);
      this.panel.querySelector('.tile-slots')?.classList.add('right');
    }
  }

  #renderTiles(locked = false) {
    const el = this.panel.querySelector('.tiles');
    if (!el || this.view?.type !== 'quiz') return;
    el.outerHTML = tilesHtml(this.view.task.questions[this.view.qi], this.tileState, locked);
  }

  #feedback(text, tone, html = false) {
    const el = this.panel.querySelector('.feedback');
    if (!el) return;
    el.className = `feedback ${tone}`;
    if (html) el.innerHTML = text;
    else el.textContent = text;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  #shake(selector = '.question') {
    const el = this.panel.querySelector(selector);
    el?.classList.remove('shake');
    void el?.offsetWidth;
    el?.classList.add('shake');
  }

  #summaryHtml({ subject, task }) {
    const recs = task.questions.map((_, i) => this.progress.record(task, i));
    const firstTry = recs.filter((r) => r?.firstCorrect).length;
    const stars = recs.reduce((s, r) => s + questionStars(r), 0);
    const evidenceQs = task.questions.filter((q) => q.evidence).length;
    const evidenceFirst = task.questions.filter((q, i) => q.evidence && recs[i]?.evidenceFirst).length;
    const rows = task.questions
      .map((q, i) => {
        const r = recs[i];
        const mark = r?.firstCorrect ? '✅' : r?.revealed ? '👀' : '🔁';
        const extra = r?.firstCorrect ? '' : `<small>第一次写的是「${esc(r?.first ?? '')}」</small>`;
        const evidence = q.evidence ? `<small class="ev">${r?.evidenceFirst ? '🔍 一次找到证据' : '🔍 找到了证据'}</small>` : '';
        return `<li><span>${mark}</span><div>${standardChip(q.standard)}<b>${esc(q.text)}</b><em>答案：${esc(q.answers[0])}</em>${extra}${evidence}</div></li>`;
      })
      .join('');
    return `
      ${this.#head(task.title, `${subject.name} · 已完成`)}
      <section class="summary">
        <div class="summary-badge">${firstTry === task.questions.length ? '🏆' : '🌟'}</div>
        <h3>${firstTry === task.questions.length ? '全部一次答对！' : '任务完成！'}</h3>
        <p>一次答对 <b>${firstTry}</b> / ${task.questions.length} 题${evidenceQs ? `，一次找到证据 <b>${evidenceFirst}</b> / ${evidenceQs}` : ''}，获得 <b>${stars}</b> ⭐</p>
      </section>
      <ul class="review">${rows}</ul>
      <button class="btn primary wide" data-action="back">返回任务列表</button>`;
  }

  // ---------- 写作 ----------

  #writeView({ subject, task }) {
    const text = this.drafts[task.id] ?? this.progress.writing(task);
    return `
      ${this.#head(task.title, `${subject.name} · Writing · 写作`)}
      ${icanHtml(task.standard)}
      ${writeHtml(task, text, writingChecks(task.write, text), this.progress.isDone(task))}`;
  }

  #onWriteInput(el) {
    const { task } = this.view;
    this.drafts[task.id] = el.value;
    this.panel.querySelector('.checklist').innerHTML = checklistHtml(writingChecks(task.write, el.value));
  }

  #submitWriting(btn) {
    const { task } = this.view;
    const area = this.panel.querySelector('.write-input');
    const text = area.value.trim();
    const checks = writingChecks(task.write, text);
    const passed = checks.every((c) => c.ok);
    const wasDone = this.progress.isDone(task);
    this.progress.saveWriting(task, text, passed);
    delete this.drafts[task.id];
    if (passed) {
      sound.correct();
      if (!wasDone) this.#flyStars(STARS.check, btn);
      this.#feedback(wasDone ? 'Updated! 已更新，等爸爸妈妈检查' : 'Great writing! 写得真棒！已交给爸爸妈妈检查 ✅', 'ok');
      btn.textContent = 'Update · 更新';
    } else {
      sound.wrong();
      this.#shake('.checklist');
      const missing = checks.filter((c) => !c.ok).map((c) => c.zh);
      this.#feedback(`Almost there! 还差一点：${missing.join('；')}`, 'bad');
    }
  }

  // ---------- 朗读 ----------

  #fluencyView(view) {
    const { subject, task } = view;
    return `
      ${this.#head(task.title, `${subject.name} · Fluency · 朗读`)}
      ${icanHtml(task.standard)}
      ${fluencyHtml(task, this.progress.fluencyRuns(task), { step: view.step, running: view.running, reading: !!this.stopReading })}`;
  }

  #startFluency() {
    const view = this.view;
    view.step = 'alone';
    view.running = true;
    this.#show(view);
    const start = performance.now();
    view.startedAt = start;
    const time = this.panel.querySelector('.time');
    this.timer = setInterval(() => {
      time.textContent = `${((performance.now() - start) / 1000).toFixed(1)}s`;
    }, 100);
  }

  #stopFluency(btn) {
    const view = this.view;
    const seconds = (performance.now() - view.startedAt) / 1000;
    view.running = false;
    const { task } = view;
    const wpm = Math.round((task.fluency.passage.words / seconds) * 60);
    // 小学生朗读一般不会超过每分钟 250 词，太快说明还没读完就点了
    if (wpm > MAX_WPM) {
      this.#show(view);
      this.#feedback('太快啦，是不是还没读完？读完整篇再点“读完了”', 'info');
      return;
    }
    const wasDone = this.progress.isDone(task);
    this.progress.saveFluency(task, { wpm, seconds: Math.round(seconds * 10) / 10, at: Date.now() });
    this.#show(view);
    this.panel.querySelector('.time').textContent = `${seconds.toFixed(1)}s`;
    const met = wpm >= task.fluency.goal;
    this.#feedback(
      `📣 ${wpm} words per minute! ${met ? '🎯 You met the goal! 达到目标啦' : `目标是 ${task.fluency.goal}，多读几遍会更流利`}`,
      'ok',
    );
    sound.correct();
    if (!wasDone) this.#flyStars(STARS.check, btn);
  }

  /** 一句一句读文章并高亮；再点一次停止 */
  #toggleReading(passage, rate) {
    if (this.stopReading) {
      this.stopReading();
      return;
    }
    if (sound.muted) {
      this.toast('🔇 声音关着呢，点右上角的喇叭打开');
      return;
    }
    const sentences = () => this.panel.querySelectorAll('.reader .sent');
    let ended = false;
    const stop = speakSequence(passage.sentences, {
      rate,
      onStart: (i) => sentences().forEach((el, j) => el.classList.toggle('speaking', i === j)),
      onDone: () => {
        ended = true;
        sentences().forEach((el) => el.classList.remove('speaking'));
        this.stopReading = null;
        this.#refreshReadButtons();
      },
    });
    if (!ended) this.stopReading = stop;
    this.#refreshReadButtons();
  }

  #refreshReadButtons() {
    const reading = !!this.stopReading;
    const step = this.view?.step;
    const set = (action, on, off) => {
      const b = this.panel.querySelector(`[data-action="${action}"]`);
      if (b) b.textContent = on ? '⏹ Stop' : off;
    };
    set('read-aloud', reading, '🔊 Read to me');
    set('model-read', reading && step === 'listen', '🎧 Listen');
    set('read-along', reading && step === 'along', '👀 Read along');
  }

  #sayWord(el) {
    const view = this.view;
    if (view?.running) return;
    speak(el.textContent.replace(/[^A-Za-z'’-]/g, ''));
    const passage = view?.task?.passage || view?.task?.fluency?.passage;
    const v = el.dataset.vocab !== undefined && passage?.vocab[Number(el.dataset.vocab)];
    if (v) this.toast(`${v.emoji} ${v.word}：${v.meaning}`);
  }

  // ---------- 事件 ----------

  #onPanelClick(e) {
    const view = this.view;
    // 文章里的句子和单词
    const sentence = e.target.closest('.reader .sent');
    if (sentence && view?.type === 'quiz' && view.stage === 'evidence') return this.#pickEvidence(Number(sentence.dataset.s), sentence);
    const word = e.target.closest('.reader .w');
    if (word) return this.#sayWord(word);

    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    if (action === 'close') return this.closePanel();
    if (!view) return;
    const task = view.task || view.subject.tasks.find((t) => t.id === btn.dataset.task);

    switch (action) {
      case 'back':
        sound.click();
        this.#show({ type: 'subject', subject: view.subject });
        break;
      case 'open-task':
        sound.click();
        this.openTask(view.subject, task);
        break;
      case 'toggle-check': {
        const done = !this.progress.isDone(task);
        this.progress.setChecked(task, done);
        if (done) {
          sound.correct();
          this.#flyStars(STARS.check, btn);
        } else {
          sound.click();
        }
        this.#show({ type: 'subject', subject: view.subject });
        break;
      }
      case 'start-reading':
        sound.click();
        this.introSeen.add(task.id);
        this.openTask(view.subject, task);
        break;
      case 'say':
        speak(btn.dataset.text);
        break;
      case 'read-aloud':
        this.#toggleReading(task.passage);
        break;
      case 'toggle-reader': {
        this.readerCollapsed = !this.readerCollapsed;
        this.panel.querySelector('.reader')?.classList.toggle('collapsed', this.readerCollapsed);
        btn.textContent = this.readerCollapsed ? '📖 展开文章' : '收起';
        break;
      }
      case 'choose':
        this.#answer(btn.dataset.value);
        break;
      case 'tile':
        if (this.busy) break;
        sound.click();
        this.tileState.picked.push(Number(btn.dataset.i));
        this.#renderTiles();
        break;
      case 'untile':
        if (this.busy) break;
        this.tileState.picked = this.tileState.picked.filter((i) => i !== Number(btn.dataset.i));
        this.#renderTiles();
        break;
      case 'tile-reset':
        this.tileState.picked = [];
        this.#renderTiles();
        break;
      case 'tile-check': {
        const q = task.questions[view.qi];
        const source = tileSource(q);
        const picked = this.tileState.picked;
        if (picked.length === 0) {
          this.#feedback(q.type === 'order' ? '先按顺序点卡片吧' : '先点字母块拼单词吧', 'info');
        } else if (q.type === 'order' && picked.length < source.length) {
          this.#feedback('Put every card in order. 把每张卡片都排进去哦', 'info');
        } else {
          this.#answer(picked.map((i) => source[i]).join(q.type === 'order' ? ' → ' : q.joiner));
        }
        break;
      }
      case 'key': {
        const input = this.panel.querySelector('.answer-input');
        const k = btn.dataset.key;
        sound.click();
        if (k === 'del') input.value = input.value.slice(0, -1);
        else if (k === 'clear') input.value = '';
        else if (input.value.length < 8) input.value += k;
        break;
      }
      case 'speak': {
        const q = task.questions[view.qi];
        speak(q.speak || q.text);
        break;
      }
      case 'hint':
        this.#feedback(`💡 ${task.questions[view.qi].hint}`, 'info');
        break;
      case 'reveal': {
        this.progress.reveal(task, view.qi);
        if (task.questions[view.qi].evidence) this.#show(view);
        else this.#nextQuestion();
        break;
      }
      case 'evidence-next':
        this.#nextQuestion();
        break;
      case 'use-frame': {
        const area = this.panel.querySelector('.write-input');
        const start = task.write.frame.split(/_{2,}/)[0];
        if (!area.value.trim()) area.value = start;
        else if (!area.value.includes(start.trim())) area.value = `${area.value.trimEnd()} ${start}`;
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
        this.#onWriteInput(area);
        break;
      }
      case 'write-submit':
        this.#submitWriting(btn);
        break;
      case 'model-read':
      case 'read-along': {
        const step = action === 'model-read' ? 'listen' : 'along';
        if (this.stopReading && view.step === step) {
          this.stopReading();
          break;
        }
        view.step = step;
        this.#show(view);
        this.#toggleReading(task.fluency.passage, step === 'listen' ? 0.85 : 0.65);
        break;
      }
      case 'fluency-start':
        sound.click();
        this.#startFluency();
        break;
      case 'fluency-stop':
        this.#stopFluency(btn);
        break;
    }
  }

  #onProgress(detail) {
    this.#renderHud();
    if (detail?.homework) return;
    if (detail?.reset) {
      this.allDone = false;
      if (this.view) this.#show({ type: 'subject', subject: this.view.subject });
      return;
    }
    if (!detail?.completed) return;

    const subject = this.homework.subjects.find((s) => s.tasks.includes(detail.task));
    sound.complete();
    const subjectDone = subject.tasks.every((t) => this.progress.isDone(t));
    this.scene.celebrate(subject.id, subjectDone ? 'subject' : 'task');
    if (subjectDone) this.toast(this.#onSurface() ? `🎉 ${subject.name}的任务全部完成啦！` : `🎉 ${subject.name}星球全部点亮啦！`);
    else this.toast(`🌕 完成「${detail.task.title}」`);

    const allDone = this.progress.remainingTasks() === 0;
    if (allDone && !this.allDone) setTimeout(() => this.#finale(), 1600);
    this.allDone = allDone;
  }

  async #finale() {
    if (this.progress.remainingTasks() !== 0) return;
    this.closePanel();
    this.#closeModal();
    this.hint.textContent = this.#onSurface() ? '📡 信号塔向地球发送信号！' : '🚀 燃料加满，火箭发射！';
    sound.launch();
    await this.scene.launch();
    this.#renderHud();
    // 航行期：今天加了一天燃料；加满了就可以降落 Bix 星
    const voyage = this.#onSurface() ? null : this.story?.voyage();
    this.#openModal(`
      <div class="modal-card celebrate">
        <div class="celebrate-emoji">🎉</div>
        <h2>今天的使命任务全部完成！</h2>
        <p>一共获得 <b>${this.progress.stars()}</b> 颗星星，你真是太棒了！</p>
        ${voyage ? voyageHtml(voyage) : ''}
        <div class="modal-actions">
          <button class="btn ghost" data-action="report">给爸爸妈妈看报告</button>
          ${
            voyage?.ready
              ? '<button class="btn primary" data-action="land">🛬 降落 Bix 星</button>'
              : '<button class="btn primary" data-action="close-modal">好耶！</button>'
          }
        </div>
      </div>`);
  }

  /** 降落 Bix 星：关掉弹窗，播放开场，播完换成地面地图 */
  #land() {
    if (this.scene.isLaunching) return;
    this.#closeModal();
    sound.click();
    this.story.land();
  }

  #onRocket() {
    if (this.scene.isLaunching) return;
    const left = this.progress.remainingTasks();
    // 燃料加满还没降落：再发射一次，然后问要不要降落
    if (left === 0 && this.story?.voyage()?.ready) {
      this.#finale();
    } else if (left === 0) {
      this.closePanel();
      sound.launch();
      this.scene.launch();
    } else {
      sound.click();
      this.scene.nudgeRocket();
      this.toast(this.#onSurface() ? `📡 还差 ${left} 项任务，信号塔就能向地球发信号啦！` : `⛽ 还差 ${left} 项任务，燃料就加满啦！`);
    }
  }

  #onKey(e) {
    if (e.key === 'Escape') {
      if (!this.modal.hidden) this.#closeModal();
      else if (this.door.close()) return;
      else if (this.exploreHud.closeCard()) return;
      else if (this.view && this.view.type !== 'subject') this.#show({ type: 'subject', subject: this.view.subject });
      else if (this.view) this.closePanel();
      return;
    }
    // 数字题：允许直接用键盘输入（输入框没有焦点时也可以）
    if (this.view?.type === 'quiz' && !this.busy && this.modal.hidden) {
      const input = this.panel.querySelector('.answer-input.numeric');
      if (input && document.activeElement !== input && /^[0-9.]$/.test(e.key) && input.value.length < 8) {
        input.value += e.key;
      } else if (input && document.activeElement !== input && e.key === 'Backspace') {
        input.value = input.value.slice(0, -1);
      } else if (input && document.activeElement !== input && e.key === 'Enter') {
        this.#answer(input.value);
      }
    }
  }

  // ---------- 家长报告 ----------

  openReport() {
    sound.click();
    const p = this.progress;
    // 家长报告按学校的科目分组；着陆后界面按站点分组，原来的科目保存在 schoolSubjects
    const subjects = this.homework.schoolSubjects || this.homework.subjects;
    let asked = 0;
    let firstRight = 0;
    const mistakes = [];
    const checks = [];

    const rows = subjects
      .map((s) => {
        let sAsked = 0;
        let sRight = 0;
        for (const task of s.tasks) {
          if (task.kind !== 'quiz') {
            if (task.kind === 'check' || task.kind === 'write') checks.push({ subject: s, task });
            continue;
          }
          task.questions.forEach((q, i) => {
            const r = p.record(task, i);
            if (!r) return;
            sAsked++;
            if (r.firstCorrect) sRight++;
            else mistakes.push({ subject: s, task, q, r });
          });
        }
        asked += sAsked;
        firstRight += sRight;
        const done = s.tasks.filter((t) => p.isDone(t)).length;
        return `<tr>
          <td>${esc(s.icon)} ${esc(s.name)}</td>
          <td>${done} / ${s.tasks.length}</td>
          <td>${sAsked ? `${Math.round((sRight / sAsked) * 100)}%` : '—'}</td>
        </tr>`;
      })
      .join('');

    const checkList = checks.length
      ? checks
          .map(({ subject, task }) => {
            const done = p.isDone(task);
            const ok = p.isVerified(task);
            const writing = task.kind === 'write' && p.writing(task);
            const status = task.kind === 'write' ? (done ? '孩子已交' : writing ? '还没写完' : '还没开始') : done ? '孩子已标记完成' : '还没完成';
            return `<li>
              <div>
                ${standardChip(task.standard)}
                <b>${esc(task.title)}</b><small>${esc(subject.name)} · ${status}</small>
                ${writing ? `<blockquote class="writing-sample">${esc(writing)}</blockquote>` : ''}
              </div>
              <button class="btn small ${ok ? 'on' : 'ghost'}" data-action="verify" data-task="${esc(task.id)}" ${done ? '' : 'disabled'}>
                ${ok ? '✅ 已检查' : '检查通过'}
              </button>
            </li>`;
          })
          .join('')
      : '<li class="empty">今天没有需要家长检查的任务</li>';

    const mistakeList = mistakes.length
      ? mistakes
          .map(
            ({ subject, task, q, r }) => `<li>
              <div>${standardChip(q.standard)}<b>${esc(q.text)}</b>
              <small>${esc(subject.name)} · ${esc(task.title)}</small></div>
              <div class="mistake-answers">
                <span class="wrong">第一次：${esc(r.first)}</span>
                <span class="right">正确：${esc(q.answers[0])}</span>
                <span class="tag">${r.revealed ? '看了答案' : r.solved ? `第 ${r.tries} 次答对` : '还没答对'}</span>
              </div>
            </li>`,
          )
          .join('')
      : `<li class="empty">${asked ? '今天没有错题，真棒！🎉' : '还没有开始答题'}</li>`;

    const total = p.allTasks.length;
    const finished = total - p.remainingTasks();
    const level = levelInfo(this.homework.level);
    this.#openModal(`
      <div class="modal-card report">
        <header>
          <div>
            <h2>📋 家长报告</h2>
            <p>${esc([this.homework.child, this.homework.date, `${level.icon} ${level.name}难度`].filter(Boolean).join(' · '))}</p>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">✕</button>
        </header>
        <div class="stats">
          <div><b>${finished}/${total}</b><span>完成作业</span></div>
          <div><b>${asked ? `${Math.round((firstRight / asked) * 100)}%` : '—'}</b><span>一次答对率</span></div>
          <div><b>${p.stars()}</b><span>获得星星</span></div>
        </div>
        <table class="subject-table">
          <thead><tr><th>科目</th><th>完成</th><th>一次答对率</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${standardsReportHtml(this.homework, p)}
        <h3>✍️ 需要家长检查</h3>
        <ul class="report-list">${checkList}</ul>
        <h3>📕 错题本 <small>（第一次答错的题）</small></h3>
        <ul class="report-list mistakes">${mistakeList}</ul>
        ${this.#storyReportHtml()}
        <div class="modal-actions">
          <button class="btn danger" data-action="reset">清空今天的进度</button>
          <button class="btn ghost" data-action="print">打印</button>
        </div>
      </div>`);
  }

  /** 家长报告里的故事进度：航行期可以直接降落，着陆后可以回到航行期 */
  #storyReportHtml() {
    if (!this.story) return '';
    const chapter = this.story.landed();
    const voyage = this.story.voyage();
    let title;
    let detail;
    let action = '';
    if (chapter) {
      title = `已降落 Bix 星 · ${chapter.title}`;
      detail = '主界面是这一层的地面地图，作业按站点分组。回到航行期会清空着陆、燃料天数、图鉴和门锁，做题记录不受影响';
      action = '<button class="btn small ghost" data-action="story-reset">回到航行期</button>';
    } else if (voyage) {
      title = `航行中 · 燃料 ${voyage.days}/${voyage.target} 天`;
      detail = voyage.ready
        ? '燃料已经加满，孩子下次完成全部作业时就能降落 Bix 星'
        : `孩子每天完成全部作业给飞船加一天燃料，再坚持 ${voyage.target - voyage.days} 天就能降落 Bix 星`;
      action = `<button class="btn small ghost" data-action="land" ${this.scene.isLaunching ? 'disabled' : ''}>直接降落</button>`;
    } else {
      return '';
    }
    return `
      <h3>🚀 故事进度 <small>（星际破译）</small></h3>
      <ul class="report-list">
        <li><div><b>${esc(title)}</b><small>${esc(detail)}</small></div>${action}</li>
        ${chapter ? this.exploreHud.reportHtml() : ''}
        ${chapter ? this.door.reportHtml() : ''}
      </ul>`;
  }

  #onModalClick(e) {
    if (e.target === this.modal) return this.#closeModal();
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    switch (btn.dataset.action) {
      case 'close-modal':
        this.#closeModal();
        break;
      case 'report':
        this.openReport();
        break;
      case 'level':
        this.#chooseLevel(btn.dataset.level);
        break;
      case 'print':
        window.print();
        break;
      case 'verify': {
        const task = this.progress.allTasks.find((t) => t.id === btn.dataset.task);
        this.progress.setVerified(task, !this.progress.isVerified(task));
        this.openReport();
        break;
      }
      case 'reset':
        if (window.confirm('确定要清空今天的所有做题记录吗？这个操作不能撤销。')) {
          this.progress.reset();
          this.openReport();
        }
        break;
      case 'land':
        this.#land();
        break;
      case 'find':
        this.#closeModal();
        this.exploreHud.onModalAction(btn);
        break;
      case 'story-reset':
        if (window.confirm('确定回到航行期吗？已经降落的进度、燃料天数、图鉴和门锁都会清空，做题记录不受影响。')) {
          this.story.reset();
          this.openReport();
        }
        break;
    }
  }

  #openModal(html) {
    this.modal.innerHTML = html;
    this.modal.hidden = false;
    requestAnimationFrame(() => this.modal.classList.add('show'));
  }

  #closeModal() {
    this.modal.classList.remove('show');
    this.modal.hidden = true;
    this.modal.innerHTML = '';
  }

  // ---------- 难度 ----------

  openLevelPicker() {
    if (this.homework.lockDifficulty) {
      this.toast(`🔒 难度由爸爸妈妈设置为「${levelInfo(this.homework.level).name}」`);
      return;
    }
    if (this.scene.isLaunching) return;
    sound.click();
    const cards = LEVELS.map((level) => {
      const sum = this.levels.summary(level.id);
      const current = level.id === this.homework.level;
      const detail = sum ? `${sum.tasks} 项任务 · ${sum.questions} 道题` : '这个难度下没有任务';
      return `
        <button class="level-card ${current ? 'current' : ''}" data-action="level" data-level="${level.id}" ${sum ? '' : 'disabled'}
                aria-pressed="${current}">
          <span class="lc-icon" aria-hidden="true">${level.icon}</span>
          <span class="lc-name">${esc(level.name)}${current ? '<em>当前</em>' : ''}</span>
          <span class="lc-desc">${esc(level.desc)}</span>
          <span class="lc-detail">${esc(detail)}</span>
        </button>`;
    }).join('');
    this.#openModal(`
      <div class="modal-card levels">
        <header>
          <div>
            <h2>选择难度</h2>
            <p>换难度后会换一套题目。已完成的打卡任务和星星都会保留，换回来进度还在。</p>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">✕</button>
        </header>
        <div class="level-grid">${cards}</div>
      </div>`);
  }

  #chooseLevel(id) {
    this.#closeModal();
    if (id === this.homework.level) return;
    const level = levelInfo(id);
    this.levels.apply(id);
    sound.complete();
    this.toast(`${level.icon} 已切换到「${level.name}」难度`);
  }

  // ---------- HUD ----------

  #renderHud() {
    const level = levelInfo(this.homework.level);
    this.levelBtn.dataset.level = level.id;
    this.levelBtn.querySelector('.lv-icon').textContent = this.homework.lockDifficulty ? '🔒' : level.icon;
    this.levelBtn.querySelector('.lv-name').textContent = level.name;
    this.levelBtn.setAttribute('aria-label', `难度：${level.name}${this.homework.lockDifficulty ? '（家长已锁定）' : '，点击更换'}`);

    const p = this.progress;
    const stars = p.stars();
    this.starCount.textContent = stars;
    const pct = Math.round(p.overall() * 100);
    this.fuelText.textContent = `${pct}%`;
    this.fuelFill.style.width = `${pct}%`;
    const left = p.remainingTasks();
    this.exploreHud?.render();
    this.door?.render();
    if (this.#onSurface()) {
      this.fuelLabel.textContent = '📡 信号塔能量';
      this.hint.textContent = this.exploreHud?.exploring
        ? this.exploreHud.hint(left)
        : left === 0
          ? '🎉 全部完成！点一下使命号，再向地球发一次信号吧'
          : pct === 0
            ? '👆 点一个站点，开始使命任务吧！完成任务给信号塔充能'
            : `还差 ${left} 项任务，信号塔就能向地球发信号啦！`;
      return;
    }
    this.fuelLabel.textContent = '🔥 火箭燃料';
    this.hint.textContent = spaceHint(left, pct, this.story?.voyage());
  }

  #flyStars(count, from) {
    if (!count) return;
    const src = (from || this.panel.querySelector('.feedback') || this.panel).getBoundingClientRect();
    const dst = this.starCounter.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const star = document.createElement('span');
      star.className = 'flying-star';
      star.textContent = '⭐';
      star.style.left = `${src.left + src.width / 2}px`;
      star.style.top = `${src.top + src.height / 2}px`;
      document.body.appendChild(star);
      const dx = dst.left + dst.width / 2 - (src.left + src.width / 2);
      const dy = dst.top + dst.height / 2 - (src.top + src.height / 2);
      const anim = star.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
          { transform: `translate(calc(-50% + ${dx * 0.3 - 40 + i * 30}px), calc(-50% + ${dy * 0.3 - 60}px)) scale(1.6)`, opacity: 1, offset: 0.35 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8)`, opacity: 1 },
        ],
        { duration: 900, delay: i * 120, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' },
      );
      anim.onfinish = () => {
        star.remove();
        this.starCounter.classList.remove('bump');
        void this.starCounter.offsetWidth;
        this.starCounter.classList.add('bump');
        sound.pop();
      };
    }
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  #updateSoundButton() {
    this.soundBtn.textContent = sound.muted ? '🔇' : '🔊';
    this.soundBtn.setAttribute('aria-label', sound.muted ? '打开声音' : '关闭声音');
  }

  #syncInset() {
    if (!this.view) {
      this.scene.setInset({ right: 0, bottom: 0 });
      return;
    }
    if (SHEET_MQ.matches) this.scene.setInset({ right: 0, bottom: this.panel.offsetHeight });
    else this.scene.setInset({ right: this.panel.offsetWidth + 24, bottom: 0 });
  }
}

/** 航行进度：一格一天燃料 */
function voyageHtml({ days, target, ready }) {
  const cells = Array.from({ length: target }, (_, i) => `<i class="${i < days ? 'on' : ''}"></i>`).join('');
  return `
    <div class="voyage ${ready ? 'ready' : ''}">
      <div class="voyage-cells" aria-hidden="true">${cells}</div>
      <p>${ready ? `⛽ 燃料 ${days}/${target} 天，加满啦！可以降落 Bix&nbsp;星了` : `⛽ 燃料 ${days}/${target} 天，再坚持 ${target - days} 天就能降落 Bix&nbsp;星`}</p>
    </div>`;
}

/** 太空里的提示：今天还差什么；用得着的时候说一下航行进度（voyage 为 null 时不提） */
function spaceHint(left, pct, voyage) {
  if (left === 0) {
    if (voyage?.ready) return '🛬 燃料加满啦！点一下火箭，降落 Bix 星';
    if (voyage) return `🎉 全部完成！燃料 ${voyage.days}/${voyage.target} 天，再坚持 ${voyage.target - voyage.days} 天就能降落 Bix 星`;
    return '🎉 全部完成！点一下火箭，再发射一次吧';
  }
  if (voyage?.ready) return `🛬 燃料已经加满，完成今天的 ${left} 项任务就能降落 Bix 星！`;
  if (voyage && voyage.days === voyage.target - 1) return `还差 ${left} 项任务！今天加满最后一天燃料，就能降落 Bix 星`;
  if (pct === 0) {
    return voyage
      ? `👆 点一颗星球，开始使命任务吧！燃料 ${voyage.days}/${voyage.target} 天，加满就能降落 Bix 星`
      : '👆 点一颗星球，开始使命任务吧！完成任务给火箭加燃料';
  }
  return `还差 ${left} 项任务，火箭就能发射啦！`;
}

function keypadHtml() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'clear'];
  const label = { del: '⌫', clear: '清空' };
  return `<div class="keypad">${keys
    .map((k) => `<button type="button" class="key ${label[k] ? 'fn' : ''}" data-action="key" data-key="${k}" aria-label="${label[k] || k}">${label[k] || k}</button>`)
    .join('')}</div>`;
}
