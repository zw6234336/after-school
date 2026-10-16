import { isCorrect } from './checker.js';
import { questionStars, STARS } from './progress.js';
import { sound, speak, canSpeak } from './audio.js';

const SHEET_MQ = window.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1100px)');
const COARSE = window.matchMedia('(pointer: coarse)').matches;
const MAX_TRIES = 3;

const PRAISE = ['答对啦！', '太棒了！', '真厉害！', '完全正确！', '你是小天才！', '继续加油！'];
const RETRY = ['再想想～', '差一点点！', '仔细看看题目哦', '别着急，再试一次'];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pick = (list) => list[(Math.random() * list.length) | 0];

export class UI {
  constructor({ homework, progress, scene }) {
    this.homework = homework;
    this.progress = progress;
    this.scene = scene;
    this.view = null;

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

    scene.addEventListener('select', (e) => this.openSubject(e.detail.subjectId, e.detail.taskId));
    scene.addEventListener('rocket', () => this.#onRocket());
    progress.addEventListener('change', (e) => this.#onProgress(e.detail));

    this.panel.addEventListener('click', (e) => this.#onPanelClick(e));
    this.panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.panel.querySelector('.answer-input');
      if (input) this.#answer(input.value);
    });
    this.modal.addEventListener('click', (e) => this.#onModalClick(e));
    document.addEventListener('keydown', (e) => this.#onKey(e));

    new ResizeObserver(() => this.#syncInset()).observe(this.panel);
    SHEET_MQ.addEventListener('change', () => this.#syncInset());

    this.shownStars = progress.stars();
    this.allDone = progress.remainingTasks() === 0;
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
    if (task?.kind === 'quiz') this.openTask(subject, task);
    else this.#show({ type: 'subject', subject });
  }

  closePanel() {
    this.view = null;
    this.panel.classList.remove('open');
    this.app.classList.remove('panel-open');
    this.scene.focus(null);
    this.#syncInset();
    window.speechSynthesis?.cancel();
  }

  #show(view) {
    this.view = view;
    this.panel.style.setProperty('--c', view.subject.color);
    if (view.type === 'subject') this.panel.innerHTML = this.#subjectHtml(view.subject);
    else if (view.type === 'quiz') this.panel.innerHTML = this.#quizHtml(view);
    else this.panel.innerHTML = this.#summaryHtml(view);
    this.panel.scrollTop = 0;
    this.panel.classList.add('open');
    this.app.classList.add('panel-open');
    this.#syncInset();
    if (view.type === 'quiz' && !COARSE) this.panel.querySelector('.answer-input, .choice')?.focus({ preventScroll: true });
  }

  #subjectHtml(subject) {
    const p = this.progress;
    const done = subject.tasks.filter((t) => p.isDone(t)).length;
    const items = subject.tasks
      .map((task) => {
        const isDone = p.isDone(task);
        const f = p.taskFraction(task);
        const state = isDone ? 'done' : f > 0 ? 'partial' : '';
        let meta;
        let action;
        if (task.kind === 'quiz') {
          const solved = task.questions.filter((_, i) => p.record(task, i)?.solved).length;
          meta = `${task.questions.length} 道题${solved ? ` · 已完成 ${solved} 道` : ''}`;
          action = `<button class="btn ${isDone ? 'ghost' : 'primary'}" data-action="open-task" data-task="${esc(task.id)}">${isDone ? '看看' : solved ? '继续' : '开始'}</button>`;
        } else {
          meta = task.note || '做完后点一下“完成啦”';
          action = `<button class="btn check ${isDone ? 'on' : ''}" data-action="toggle-check" data-task="${esc(task.id)}" aria-pressed="${isDone}">${isDone ? '✅ 已完成' : '完成啦'}</button>`;
        }
        return `
          <li class="task-card ${state}">
            <span class="tc-moon" aria-hidden="true">${isDone ? '🌕' : f > 0 ? '🌓' : '🌑'}</span>
            <div class="tc-body">
              <h3>${esc(task.title)}</h3>
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
          <h2>${esc(subject.name)}星球</h2>
          <p>${done === subject.tasks.length ? '全部完成，星球被点亮啦！' : `完成了 ${done} / ${subject.tasks.length} 项作业`}</p>
        </div>
        <button class="icon-btn close" data-action="close" aria-label="返回太空">✕</button>
      </header>
      <div class="meter"><i style="width:${p.subjectFraction(subject) * 100}%"></i></div>
      <ul class="task-list">${items}</ul>`;
  }

  // ---------- 面板：答题 ----------

  openTask(subject, task) {
    const qi = task.questions.findIndex((_, i) => !this.progress.record(task, i)?.solved);
    if (qi === -1) this.#show({ type: 'summary', subject, task });
    else this.#show({ type: 'quiz', subject, task, qi });
  }

  #quizHtml({ subject, task, qi }) {
    const q = task.questions[qi];
    const rec = this.progress.record(task, qi);
    const dots = task.questions
      .map((_, i) => {
        const r = this.progress.record(task, i);
        const cls = i === qi ? 'current' : !r?.solved ? '' : r.revealed ? 'revealed' : r.firstCorrect ? 'ok' : 'fixed';
        return `<li class="${cls}"></li>`;
      })
      .join('');

    let answerArea;
    if (q.options) {
      answerArea = `<div class="choices">${q.options
        .map((o) => `<button type="button" class="choice" data-action="choose" data-value="${esc(o)}">${esc(o)}</button>`)
        .join('')}</div>`;
    } else {
      const mode = q.numeric ? (COARSE ? 'none' : 'decimal') : 'text';
      answerArea = `
        <form class="answer" autocomplete="off">
          <input class="answer-input ${q.numeric ? 'numeric' : ''}" inputmode="${mode}" enterkeyhint="done"
                 autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40"
                 placeholder="${q.numeric ? '?' : '在这里写答案'}" aria-label="答案" />
          <button type="submit" class="btn primary">提交</button>
        </form>
        ${q.numeric ? keypadHtml() : ''}`;
    }

    return `
      <header class="panel-head">
        <button class="icon-btn" data-action="back" aria-label="返回任务列表">←</button>
        <div class="ph-text">
          <h2>${esc(task.title)}</h2>
          <p>${esc(subject.name)} · 第 ${qi + 1} / ${task.questions.length} 题</p>
        </div>
        <button class="icon-btn close" data-action="close" aria-label="返回太空">✕</button>
      </header>
      <ol class="dots" aria-hidden="true">${dots}</ol>
      <section class="question">
        <div class="q-text">${esc(q.text)}</div>
        <div class="q-tools">
          ${canSpeak ? '<button class="pill" data-action="speak">🔊 读题</button>' : ''}
          ${q.hint ? '<button class="pill" data-action="hint">💡 提示</button>' : ''}
        </div>
      </section>
      <div class="feedback" role="status">${rec?.tries ? `已经试了 ${rec.tries} 次，加油！` : ''}</div>
      ${answerArea}`;
  }

  #answer(value) {
    const view = this.view;
    if (view?.type !== 'quiz' || this.busy) return;
    const { subject, task, qi } = view;
    const q = task.questions[qi];
    if (!String(value).trim()) {
      this.#feedback('先写下你的答案吧～', 'info');
      return;
    }
    const correct = isCorrect(q, value);
    const rec = this.progress.submit(task, qi, String(value).trim(), correct);

    if (correct) {
      this.busy = true;
      sound.correct();
      this.scene.celebrate(subject.id, 'correct');
      const stars = questionStars(rec);
      this.#feedback(`${pick(PRAISE)} ${stars ? `+${stars} ⭐` : ''}`, 'ok');
      this.#lockAnswer(value);
      this.#flyStars(stars);
      setTimeout(() => {
        this.busy = false;
        if (this.view === view) this.#nextQuestion();
      }, 1100);
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
        `正确答案是 <b>${esc(q.answers[0])}</b>，记住它哦！<button class="btn primary small" data-action="reveal">记住啦，下一题 →</button>`,
        'reveal',
        true,
      );
      this.panel.querySelectorAll('.answer button, .answer input, .choice, .keypad button').forEach((el) => (el.disabled = true));
    } else {
      const hint = q.hint && rec.tries >= 1 ? `<br/>💡 ${esc(q.hint)}` : '';
      this.#feedback(`${pick(RETRY)}（还可以试 ${MAX_TRIES - rec.tries} 次）${hint}`, 'bad', true);
    }
  }

  #nextQuestion() {
    const { subject, task, qi } = this.view;
    const n = task.questions.length;
    for (let step = 1; step <= n; step++) {
      const i = (qi + step) % n;
      if (!this.progress.record(task, i)?.solved) {
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
  }

  #feedback(text, tone, html = false) {
    const el = this.panel.querySelector('.feedback');
    if (!el) return;
    el.className = `feedback ${tone}`;
    if (html) el.innerHTML = text;
    else el.textContent = text;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  #shake() {
    const el = this.panel.querySelector('.question');
    el?.classList.remove('shake');
    void el?.offsetWidth;
    el?.classList.add('shake');
  }

  #summaryHtml({ subject, task }) {
    const recs = task.questions.map((_, i) => this.progress.record(task, i));
    const firstTry = recs.filter((r) => r?.firstCorrect).length;
    const stars = recs.reduce((s, r) => s + questionStars(r), 0);
    const rows = task.questions
      .map((q, i) => {
        const r = recs[i];
        const mark = r?.firstCorrect ? '✅' : r?.revealed ? '👀' : '🔁';
        const extra = r?.firstCorrect ? '' : `<small>第一次写的是「${esc(r?.first ?? '')}」</small>`;
        return `<li><span>${mark}</span><div><b>${esc(q.text)}</b><em>答案：${esc(q.answers[0])}</em>${extra}</div></li>`;
      })
      .join('');
    return `
      <header class="panel-head">
        <button class="icon-btn" data-action="back" aria-label="返回任务列表">←</button>
        <div class="ph-text">
          <h2>${esc(task.title)}</h2>
          <p>${esc(subject.name)} · 已完成</p>
        </div>
        <button class="icon-btn close" data-action="close" aria-label="返回太空">✕</button>
      </header>
      <section class="summary">
        <div class="summary-badge">${firstTry === task.questions.length ? '🏆' : '🌟'}</div>
        <h3>${firstTry === task.questions.length ? '全部一次答对！' : '任务完成！'}</h3>
        <p>一次答对 <b>${firstTry}</b> / ${task.questions.length} 题，获得 <b>${stars}</b> ⭐</p>
      </section>
      <ul class="review">${rows}</ul>
      <button class="btn primary wide" data-action="back">返回任务列表</button>`;
  }

  // ---------- 事件 ----------

  #onPanelClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const view = this.view;
    const action = btn.dataset.action;
    if (action === 'close') return this.closePanel();
    if (!view) return;
    const task = view.task || view.subject.tasks.find((t) => t.id === btn.dataset.task);

    switch (action) {
      case 'back':
        sound.click();
        window.speechSynthesis?.cancel();
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
      case 'choose':
        this.#answer(btn.dataset.value);
        break;
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
        const q = view.task.questions[view.qi];
        speak(q.speak || q.text);
        break;
      }
      case 'hint':
        this.#feedback(`💡 ${view.task.questions[view.qi].hint}`, 'info');
        break;
      case 'reveal':
        this.progress.reveal(view.task, view.qi);
        this.#nextQuestion();
        break;
    }
  }

  #onProgress(detail) {
    this.#renderHud();
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
    if (subjectDone) this.toast(`🎉 ${subject.name}星球全部点亮啦！`);
    else this.toast(`🌕 完成「${detail.task.title}」`);

    const allDone = this.progress.remainingTasks() === 0;
    if (allDone && !this.allDone) setTimeout(() => this.#finale(), 1600);
    this.allDone = allDone;
  }

  async #finale() {
    if (this.progress.remainingTasks() !== 0) return;
    this.closePanel();
    this.#closeModal();
    this.hint.textContent = '🚀 燃料加满，火箭发射！';
    sound.launch();
    await this.scene.launch();
    this.#renderHud();
    this.#openModal(`
      <div class="modal-card celebrate">
        <div class="celebrate-emoji">🎉</div>
        <h2>今天的作业全部完成！</h2>
        <p>一共获得 <b>${this.progress.stars()}</b> 颗星星，你真是太棒了！</p>
        <div class="modal-actions">
          <button class="btn ghost" data-action="report">给爸爸妈妈看报告</button>
          <button class="btn primary" data-action="close-modal">好耶！</button>
        </div>
      </div>`);
  }

  #onRocket() {
    if (this.scene.isLaunching) return;
    const left = this.progress.remainingTasks();
    if (left === 0) {
      this.closePanel();
      sound.launch();
      this.scene.launch();
    } else {
      sound.click();
      this.scene.nudgeRocket();
      this.toast(`⛽ 还差 ${left} 项作业，燃料就加满啦！`);
    }
  }

  #onKey(e) {
    if (e.key === 'Escape') {
      if (!this.modal.hidden) this.#closeModal();
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
    const subjects = this.homework.subjects;
    let asked = 0;
    let firstRight = 0;
    const mistakes = [];
    const checks = [];

    const rows = subjects
      .map((s) => {
        let sAsked = 0;
        let sRight = 0;
        for (const task of s.tasks) {
          if (task.kind === 'check') {
            checks.push({ subject: s, task });
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
            return `<li>
              <div><b>${esc(task.title)}</b><small>${esc(subject.name)} · ${done ? '孩子已标记完成' : '还没完成'}</small></div>
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
              <div><b>${esc(q.text)}</b>
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
    this.#openModal(`
      <div class="modal-card report">
        <header>
          <div>
            <h2>📋 家长报告</h2>
            <p>${esc([this.homework.child, this.homework.date].filter(Boolean).join(' · '))}</p>
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
        <h3>✍️ 需要家长检查</h3>
        <ul class="report-list">${checkList}</ul>
        <h3>📕 错题本 <small>（第一次答错的题）</small></h3>
        <ul class="report-list mistakes">${mistakeList}</ul>
        <div class="modal-actions">
          <button class="btn danger" data-action="reset">清空今天的进度</button>
          <button class="btn ghost" data-action="print">打印</button>
        </div>
      </div>`);
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

  // ---------- HUD ----------

  #renderHud() {
    const p = this.progress;
    const stars = p.stars();
    this.starCount.textContent = stars;
    const pct = Math.round(p.overall() * 100);
    this.fuelText.textContent = `${pct}%`;
    this.fuelFill.style.width = `${pct}%`;
    const left = p.remainingTasks();
    this.hint.textContent =
      left === 0
        ? '🎉 全部完成！点一下火箭，再发射一次吧'
        : pct === 0
          ? '👆 点一颗星球，开始做作业吧！完成作业给火箭加燃料'
          : `还差 ${left} 项作业，火箭就能发射啦！`;
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

function keypadHtml() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'clear'];
  const label = { del: '⌫', clear: '清空' };
  return `<div class="keypad">${keys
    .map((k) => `<button type="button" class="key ${label[k] ? 'fn' : ''}" data-action="key" data-key="${k}" aria-label="${label[k] || k}">${label[k] || k}</button>`)
    .join('')}</div>`;
}
