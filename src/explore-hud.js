// 闲逛模式的网页部分：HUD 上的“去逛逛 / 回着陆点 / 图鉴”按钮、发现卡片、发现图鉴、家长报告里的闲逛记录。
// 发现物的名字用翻译机的规则：学校本周教过的词一开始就认识；单元里的词要读完那一课，没读之前显示外星符号。

import { UNITS } from './content.js';
import { sound, speak } from './audio.js';
import { esc } from './lesson.js';
import { alienWord } from './bix.js';
import { learnedLessons, foundDiscoveries, addFound, exploreDay, addExploreTime } from './story.js';

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
/** 和 ui.js 一样：窄屏和竖屏时卡片从底部弹出，宽屏时在右边 */
const SHEET_MQ = window.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1100px)');

export class ExploreHud {
  /** ui：toast、openModal、closePanel、refresh（重画 HUD）、date（今天的日期） */
  constructor(ui) {
    this.ui = ui;
    this.view = null;
    this.bound = new WeakSet();
    this.current = null;
    this.bar = document.getElementById('explore-bar');
    this.btnGo = document.getElementById('btn-explore');
    this.btnHome = document.getElementById('btn-home');
    this.btnJournal = document.getElementById('btn-journal');
    this.card = document.getElementById('discovery');
    this.app = document.getElementById('app');

    this.btnGo.addEventListener('click', () => {
      sound.click();
      this.ui.closePanel();
      this.view?.startExplore?.();
    });
    this.btnHome.addEventListener('click', () => {
      sound.click();
      this.closeCard();
      this.view?.goHome?.();
    });
    this.btnJournal.addEventListener('click', () => this.openJournal());
    this.card.addEventListener('click', (e) => this.#onCardClick(e));
    new ResizeObserver(() => this.#syncInset()).observe(this.card);
    SHEET_MQ.addEventListener('change', () => this.#syncInset());

    // 逛了多久：每 15 秒记一次；页面切到后台时先记下来，回来以后重新计时（后台的时间不算）
    this.timer = setInterval(() => document.visibilityState === 'visible' && this.#flushTime(), 15000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.#flushTime();
      else if (this.since != null) this.since = performance.now();
    });
  }

  /** 主界面换了（着陆 / 回到航行期） */
  setView(view) {
    this.#flushTime();
    this.closeCard();
    this.view = view;
    if (view && !this.bound.has(view)) {
      this.bound.add(view);
      view.addEventListener('explore', (e) => this.#onExplore(e.detail.on));
      view.addEventListener('discover', (e) => this.openCard(e.detail.id, { speakNow: true }));
      view.addEventListener('zone', (e) => this.#onZone(e.detail.zone));
      view.addEventListener('walk', () => this.closeCard());
    }
    this.since = view?.exploring ? performance.now() : null;
    this.render();
  }

  /** 这一章的闲逛数据；没着陆或者这一章没有闲逛，返回 null */
  get chapter() {
    return this.view?.canExplore ? this.view.chapter : null;
  }

  get exploring() {
    return !!this.view?.exploring;
  }

  /** HUD 提示行：正在逛哪儿 */
  hint(left) {
    const zone = this.view?.zone;
    const where = zone ? `正在逛${zone.icon || ''} ${zone.name}` : '正在着陆区附近逛';
    return left === 0 ? `🧭 ${where} · 今天的使命任务都完成啦，尽情逛吧！` : `🧭 ${where} · 还有 ${left} 项使命任务，在着陆区的站点`;
  }

  render() {
    const ch = this.chapter;
    this.bar.hidden = !ch;
    if (!ch) return;
    const total = ch.explore.discoveries.length;
    const found = foundDiscoveries(ch.id).length;
    this.btnGo.hidden = this.exploring;
    this.btnHome.hidden = !this.exploring;
    this.btnJournal.querySelector('b').textContent = `${found}/${total}`;
  }

  // ---------- 发现卡片 ----------

  openCard(id, { speakNow = false } = {}) {
    const ch = this.chapter;
    const d = ch?.explore.discoveries.find((x) => x.id === id);
    if (!d) return;
    this.current = d;
    const learned = learnedLessons(ch.unit);
    const known = decoded(d, learned);
    const zone = ch.explore.zones.find((z) => z.id === d.zone);
    const got = foundDiscoveries(ch.id).includes(d.id);
    // 中文旁白只在翻译机刚着陆的阶段出现：这个单元一课都还没读完
    const narrate = learned.size === 0;
    const glyph = `<button type="button" class="glyph" data-say="${esc(d.word)}" aria-label="听这个词">${esc(alienWord(d.word))}</button>`;
    const line = known ? wordsHtml(d.say) : `${wordsHtml('Look!')} ${glyph}!`;
    const lesson = lessonOf(ch, d);
    const why = known
      ? `✅ 名字破译了：<b>${esc(d.word)}</b> ${d.from?.school ? `出自${esc(d.from.school)}` : `出自《${esc(lesson?.title || '')}》`}`
      : `🔒 读完《${esc(lesson?.title || '这一课')}》，翻译机就能破译它的名字`;
    this.card.innerHTML = `
      <button type="button" class="icon-btn dc-close" data-act="close" aria-label="关上卡片">✕</button>
      <div class="dc-top">
        <div class="dc-pic" aria-hidden="true">${esc(d.emoji)}</div>
        <div>
          <div class="dc-name">${known ? esc(cap(d.word)) : glyph}</div>
          <div class="dc-zh">${esc(d.zh)}${zone ? ` · ${esc(zone.icon || '')} ${esc(zone.name)}` : ''}</div>
        </div>
      </div>
      <div class="dc-zib"><span class="dc-who" aria-hidden="true">👽</span><div>${line}${narrate ? `<small>${esc(d.note || '')}</small>` : ''}</div></div>
      <p class="dc-why">${why}</p>
      <div class="dc-acts">
        <button type="button" class="btn small" data-act="hear">🔊 听 Zib 说</button>
        <button type="button" class="btn small ${got ? 'on' : 'primary'}" data-act="keep" ${got ? 'disabled' : ''}>${got ? '📔 已在图鉴里' : '📔 收进图鉴'}</button>
        <button type="button" class="btn small ghost" data-act="tell">🗣️ 讲给大人听</button>
      </div>
      <p class="dc-tell" hidden>跟大人说一说：它是什么样子的？在哪儿看到的？<br /><i>I see ${known ? `… It is ${esc(d.word)}!` : '…'}</i></p>`;
    this.card.hidden = false;
    this.app.classList.add('card-open');
    requestAnimationFrame(() => this.card.classList.add('show'));
    if (speakNow) {
      sound.correct();
      setTimeout(() => this.current === d && speak(spoken(d, known)), 500);
    }
  }

  /** 关上卡片；本来就关着返回 false */
  closeCard() {
    if (this.card.hidden) return false;
    this.current = null;
    this.card.classList.remove('show');
    this.card.hidden = true;
    this.card.innerHTML = '';
    this.app.classList.remove('card-open');
    this.#syncInset();
    return true;
  }

  #onCardClick(e) {
    const btn = e.target.closest('[data-act], [data-say]');
    const d = this.current;
    if (!btn || !d) return;
    if (btn.dataset.say) return speak(btn.dataset.say);
    const ch = this.chapter;
    switch (btn.dataset.act) {
      case 'close':
        sound.click();
        this.closeCard();
        break;
      case 'hear':
        speak(spoken(d, decoded(d, learnedLessons(ch.unit))));
        break;
      case 'keep':
        if (addFound(ch.id, d.id, this.ui.date())) {
          sound.collect();
          this.view.markFound(d.id);
          const n = foundDiscoveries(ch.id).length;
          const total = ch.explore.discoveries.length;
          this.ui.toast(n === total ? `🎉 ${total} 样新奇的东西全找到啦！` : `📔 收进图鉴啦！还有 ${total - n} 样没找到`);
          this.render();
        }
        this.openCard(d.id);
        break;
      case 'tell':
        sound.click();
        this.card.querySelector('.dc-tell').hidden = false;
        btn.disabled = true;
        break;
    }
  }

  /** 卡片挡住的地方（像素），闲逛的画面挪到剩下的区域中间 */
  #syncInset() {
    const open = !this.card.hidden;
    if (SHEET_MQ.matches) this.view?.setCardInset?.({ right: 0, bottom: open ? this.card.offsetHeight + 24 : 0 });
    else this.view?.setCardInset?.({ right: open ? this.card.offsetWidth + 24 : 0, bottom: 0 });
  }

  // ---------- 图鉴 ----------

  openJournal() {
    const ch = this.chapter;
    if (!ch) return;
    sound.click();
    this.closeCard();
    const learned = learnedLessons(ch.unit);
    const found = new Set(foundDiscoveries(ch.id));
    const list = ch.explore.discoveries;
    const zones = ch.explore.zones
      .map((z) => {
        const cells = list
          .filter((d) => d.zone === z.id)
          .map((d) => {
            if (!found.has(d.id)) return `<div class="jr-cell"><b aria-hidden="true">${esc(d.emoji)}</b><span>？</span><small>还没找到</small></div>`;
            const name = decoded(d, learned) ? esc(d.word) : `<span class="glyph">${esc(alienWord(d.word))}</span>`;
            return `<button type="button" class="jr-cell got" data-action="find" data-id="${esc(d.id)}"><b aria-hidden="true">${esc(d.emoji)}</b><span>${name}</span><small>${esc(d.zh)}</small></button>`;
          })
          .join('');
        return cells ? `<h3>${esc(z.icon || '')} ${esc(z.name)}</h3><div class="jr-grid">${cells}</div>` : '';
      })
      .join('');
    this.ui.openModal(`
      <div class="modal-card journal">
        <header>
          <div>
            <h2>📔 发现图鉴</h2>
            <p>${esc(ch.title)} · 找到了 ${found.size} / ${list.length} 样</p>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">✕</button>
        </header>
        ${zones}
        <p class="jr-note">没找到的是灰色剪影。名字还是外星符号的，读完那一课，翻译机就能破译。</p>
      </div>`);
  }

  /** 图鉴里点了一个找到的东西：关上图鉴，打开它的卡片 */
  onModalAction(btn) {
    if (btn.dataset.action !== 'find') return false;
    this.openCard(btn.dataset.id);
    return true;
  }

  // ---------- 家长报告 ----------

  reportHtml() {
    const ch = this.chapter;
    if (!ch) return '';
    this.#flushTime();
    const day = exploreDay(this.ui.date());
    const all = ch.explore.discoveries;
    const today = day.found.map((id) => all.find((d) => d.id === id)).filter(Boolean);
    const minutes = Math.round(day.seconds / 60);
    const learned = learnedLessons(ch.unit);
    const decodedCount = all.filter((d) => decoded(d, learned)).length;
    return `
      <li><div><b>🧭 今天闲逛 ${day.seconds < 30 ? '不到 1 分钟' : `约 ${Math.max(1, minutes)} 分钟`}，找到 ${today.length} 样新东西</b>
      <small>${today.length ? today.map((d) => `${esc(d.emoji)} ${esc(d.zh)}`).join('、') : '今天还没有新发现'} · 图鉴一共 ${foundDiscoveries(ch.id).length}/${all.length} · 翻译机破译了 ${decodedCount}/${all.length} 个名字。闲逛不计分、不限时，只作参考</small></div></li>`;
  }

  // ---------- 内部 ----------

  #onExplore(on) {
    this.#flushTime();
    this.since = on ? performance.now() : null;
    if (on) this.ui.toast('🧭 点地面走过去，点 ❔ 看看是什么；拖动屏幕可以转着看');
    else this.closeCard();
    this.render();
    this.ui.refresh();
  }

  #onZone(zone) {
    if (zone) this.ui.toast(`${zone.icon || '🧭'} 来到了${zone.name}`);
    this.ui.refresh();
  }

  /** 把上次记录以后逛的时间记下来 */
  #flushTime() {
    if (this.since == null) return;
    const now = performance.now();
    addExploreTime(this.ui.date(), (now - this.since) / 1000);
    this.since = this.exploring ? now : null;
  }
}

/** 名字破译了没有：学校本周教过的词一开始就认识；单元里的词要读完那一课 */
export function decoded(d, learned) {
  return !!d.from?.school || (!!d.from?.lesson && learned.has(d.from.lesson));
}

/** 读到哪些课，哪些发现物的名字就能破译：返回新破译的发现物 */
export function newlyDecoded(chapter, lessonIds) {
  return (chapter?.explore?.discoveries || []).filter((d) => d.from?.lesson && lessonIds.includes(d.from.lesson));
}

function lessonOf(chapter, d) {
  return d.from?.lesson ? UNITS[chapter.unit]?.lessons.find((l) => l.id === d.from.lesson) : null;
}

/** Zib 说的话：破译了说整句，没破译只能指着说 “Look! ___!” */
function spoken(d, known) {
  return known ? d.say : `Look! ${d.word}!`;
}

/** 一句英文，每个词都可以点一下再听 */
export function wordsHtml(text) {
  return text
    .split(/(\s+)/)
    .map((part) => {
      const word = part.replace(/[^A-Za-z']/g, '');
      return word ? `<button type="button" class="w" data-say="${esc(word)}">${esc(part)}</button>` : part;
    })
    .join('');
}
