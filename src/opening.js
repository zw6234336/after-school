// 开场动画播放器：按章节里的 opening.shots 一个镜头一个镜头地播放。
// 三维画面交给 BixStage；这里负责开始卡片、逐词字幕、复习停顿、标题卡和跳过。

import { BixStage, alienWord } from './bix.js';
import { sound, speakSequence, speak, stopSpeaking } from './audio.js';
import { esc } from './lesson.js';

const WORD_MS = 430;
const SPEECH_GRACE_MS = 4000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const noEmoji = (text) => String(text).replace(/\p{Extended_Pictographic}️?/gu, '').trim();
const capital = (w) => w.charAt(0).toUpperCase() + w.slice(1);

export class OpeningPlayer {
  /** keepStage：播完不拆布景，交给调用方（着陆后直接在这个布景上显示地面地图） */
  constructor(scene, { keepStage = false } = {}) {
    this.scene = scene;
    this.keepStage = keepStage;
    this.stage = null;
    this.run = 0;
    this.question = null;
  }

  /** 播放一章的开场；看完点“开始探索”或者跳过后 resolve({ stage })，keepStage 时 stage 是留下来的布景 */
  play(chapter) {
    this.chapter = chapter;
    const op = chapter.opening;
    this.op = op;
    this.school = new Set((op.vocab?.school || []).map((w) => w.toLowerCase()));

    const el = document.createElement('div');
    el.className = 'opening';
    el.innerHTML = `
      <div class="op-top">
        <div class="op-dots" aria-hidden="true">${op.shots.map(() => '<i></i>').join('')}</div>
        <button class="op-skip" type="button" data-op="skip">跳过 ⏭</button>
      </div>
      <div class="op-card op-start">
        <small>${esc(chapter.title)}</small>
        <b>${esc(op.title)}</b>
        ${op.intro ? `<p>${esc(op.intro)}</p>` : ''}
        <button class="op-go" type="button" data-op="go">▶ 出发</button>
      </div>
      <div class="op-ask" hidden></div>
      <div class="op-card op-title" hidden>
        <small>${esc(op.title)}</small>
        <b>${esc(op.subtitle || '')}</b>
        <button class="op-go" type="button" data-op="done">开始探索 →</button>
      </div>
      <div class="op-sub" aria-live="polite"><div class="en"></div><div class="zh"></div></div>`;
    document.getElementById('app').appendChild(el);
    document.body.classList.add('cinematic');
    this.el = el;
    this.sub = el.querySelector('.op-sub');
    this.askEl = el.querySelector('.op-ask');
    this.dots = [...el.querySelectorAll('.op-dots i')];
    el.addEventListener('click', (e) => this.#onClick(e));
    this.onKey = (e) => e.key === 'Escape' && this.#skip();
    window.addEventListener('keydown', this.onKey);
    el.querySelector('[data-op="go"]').focus();

    return new Promise((resolve) => (this.resolve = resolve));
  }

  #onClick(e) {
    const t = e.target.closest('[data-op], [data-o], .w');
    if (!t) return;
    if (t.dataset.op === 'go') this.#start();
    else if (t.dataset.op === 'skip') this.#skip();
    else if (t.dataset.op === 'done') this.#finish();
    else if (t.dataset.op === 'hear') speak(this.question?.shot.speak || '');
    else if (t.dataset.o !== undefined) this.#answer(t);
    else if (t.classList.contains('w')) speak(t.dataset.w);
  }

  #start() {
    sound.click();
    this.el.querySelector('.op-start').hidden = true;
    this.stage = new BixStage(this.scene);
    this.stage.setTheme(this.chapter?.surface);
    this.scene.startCinematic(this.stage);
    this.#run();
  }

  async #run() {
    const id = ++this.run;
    const shots = this.op.shots;
    for (let i = 0; i < shots.length; i++) {
      if (id !== this.run) return;
      const shot = shots[i];
      this.#setDots(i);
      this.stage.cameraTo(shot.camera, shot.ms);
      const act = this.stage.action(shot.action);
      this.#hideSub();
      if (shot.type === 'fly') {
        this.#showSub('', shot.zh);
        await Promise.all([act, wait(shot.ms || 3000)]);
      } else if (shot.type === 'say') {
        await act;
        await this.#say(shot.text, shot.zh, id);
      } else if (shot.type === 'ask') {
        await act;
        await this.#ask(shot, id);
      } else if (shot.type === 'preview') {
        this.stage.setSign(shot.word);
        await act;
        await this.#say(shot.text, shot.zh, id, shot.word);
      } else if (shot.type === 'title') {
        this.#showTitle();
        return;
      }
    }
  }

  // ---------- 字幕 ----------

  #tokens(line) {
    return line
      .split(' ')
      .map((tok) => {
        const word = tok.replace(/[^A-Za-z']/g, '');
        if (!word) return esc(tok);
        const cls = this.school.has(word.toLowerCase()) ? ' school' : '';
        const title = cls ? ' title="学校本周学过的词"' : '';
        return `<span class="w${cls}" data-w="${esc(word)}"${title}>${esc(tok)}</span>`;
      })
      .join(' ');
  }

  #showSub(en, zh, preview) {
    this.sub.querySelector('.en').innerHTML = (preview ? `<span class="alien" title="还没破译的词">${esc(alienWord(preview))}</span>` : '') + (en ? this.#tokens(en) : '');
    this.sub.querySelector('.zh').textContent = zh || '';
    this.sub.classList.add('show');
  }

  #hideSub() {
    this.sub.classList.remove('show');
  }

  /** 逐词高亮并朗读一句话；朗读和高亮都结束才继续 */
  async #say(text, zh, id, preview) {
    this.#showSub(text, zh, preview);
    this.stage.talking = true;
    let spoken = false;
    speakSequence([text], { onDone: () => (spoken = true), rate: 0.8 });
    const words = [...this.sub.querySelectorAll('.w')];
    for (const w of words) {
      if (id !== this.run) return;
      words.forEach((x) => x.classList.remove('on'));
      w.classList.add('on');
      await wait(WORD_MS);
    }
    words.forEach((x) => x.classList.remove('on'));
    const until = performance.now() + SPEECH_GRACE_MS;
    while (!spoken && performance.now() < until && id === this.run) await wait(100);
    this.stage.talking = false;
    await wait(600);
  }

  // ---------- 复习停顿 ----------

  #ask(shot, id) {
    const r = shot.review || {};
    this.askEl.hidden = false;
    this.askEl.innerHTML = `
      <span class="tag">⏸ 复习${r.source ? ` · ${esc(r.source)}` : ''}${r.standard ? ` · ${esc(r.standard)}` : ''}</span>
      <div class="q">${esc(shot.q)}${shot.speak ? '<button class="hear" type="button" data-op="hear" aria-label="再听一遍">🔊</button>' : ''}</div>
      <div class="opts">${shot.options
        .map((o) => `<button type="button" data-o="${esc(o)}" class="${this.school.has(o.toLowerCase()) ? 'school' : ''}">${esc(o)}</button>`)
        .join('')}</div>
      <div class="hintbox"></div>`;
    speakSequence([noEmoji(shot.q), shot.speak].filter(Boolean), { rate: 0.8 });
    return new Promise((resolve) => (this.question = { shot, id, resolve, busy: false }));
  }

  async #answer(button) {
    const qn = this.question;
    if (!qn || qn.busy || button.disabled || qn.id !== this.run) return;
    const { shot } = qn;
    if (button.dataset.o === shot.a) {
      qn.busy = true;
      sound.correct();
      button.classList.add('ok');
      this.askEl.querySelectorAll('[data-o]').forEach((b) => (b.disabled = true));
      this.stage.zibReact('nod');
      await this.#say(`Yes! ${capital(shot.a)}.`, '', qn.id);
      if (qn.id !== this.run) return;
      this.askEl.hidden = true;
      this.question = null;
      qn.resolve();
    } else {
      // 答错不扣分：Zib 歪歪头，给出提示，再选一次
      sound.wrong();
      button.classList.add('no');
      button.disabled = true;
      this.stage.zibReact('tilt');
      if (shot.hint) {
        this.askEl.querySelector('.hintbox').innerHTML = `💡 ${esc(shot.hint)}`;
        speakSequence([shot.hint, shot.speak].filter(Boolean), { rate: 0.75 });
      }
    }
  }

  // ---------- 结束 ----------

  #setDots(n) {
    this.dots.forEach((d, i) => (d.className = i < n ? 'done' : i === n ? 'now' : ''));
  }

  #showTitle() {
    this.#hideSub();
    this.askEl.hidden = true;
    this.#setDots(this.dots.length);
    this.el.querySelector('.op-skip').hidden = true;
    const card = this.el.querySelector('.op-title');
    card.hidden = false;
    sound.complete();
    card.querySelector('button').focus();
  }

  #skip() {
    if (!this.stage) return this.#finish();
    if (!this.el.querySelector('.op-title').hidden) return this.#finish();
    this.run++;
    stopSpeaking();
    this.question = null;
    this.stage.talking = false;
    this.stage.cameraTo('station', 2400);
    this.#showTitle();
  }

  #finish() {
    if (this.finished) return;
    this.finished = true;
    this.run++;
    stopSpeaking();
    window.removeEventListener('keydown', this.onKey);
    this.el.classList.add('leaving');
    setTimeout(() => this.el.remove(), 600);
    document.body.classList.remove('cinematic');
    if (this.stage && !this.keepStage) {
      this.scene.endCinematic();
      // 相机飞回使命星球的路上还看得见 Bix 星，飞远了再拆掉
      const stage = this.stage;
      setTimeout(() => stage.dispose(), 4000);
    }
    this.resolve?.({ stage: this.keepStage ? this.stage : null });
  }
}
