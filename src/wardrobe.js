// 给小宇航员穿对衣服。读完一课，衣柜里就多一件这一课讲到的衣服（Winter 的连指手套、Spring 的雨靴、Summer 的防晒霜）。
// 闲逛走进天气地带时，Zib 用学过的话说该穿什么（“Brr! It is cold! Put on your mittens!”），穿对了它会夸你；
// 晴之丘里戴着连指手套也不行。穿得不对，小宇航员会发抖、溅湿、冒汗，但不拦路、不计分：
// 让“天气决定穿什么”看得见（CKLA 这个单元的核心目标之一），也让读完一课有一样看得见的东西。

import { UNITS } from './content.js';
import { sound, speak } from './audio.js';
import { esc } from './lesson.js';
import { alienWord } from './bix.js';
import { learnedLessons, outfit, setOutfit } from './story.js';
import { wordsHtml } from './explore-hud.js';

/** 某个地带穿得对不对：缺的那件、穿错的那件、Zib 该说的话、小宇航员的感觉；这个地带穿什么都行返回 null */
export function fit(wardrobe, zoneId, worn) {
  const rule = wardrobe?.zones?.[zoneId];
  if (!rule) return null;
  const wrong = Object.keys(rule.off || {}).find((id) => worn.has(id)) || null;
  const missing = rule.wear && !worn.has(rule.wear) ? rule.wear : null;
  const ok = !wrong && !missing;
  return { wrong, missing, ok, feel: ok ? null : rule.feel, line: wrong ? rule.off[wrong] : missing ? rule.need : rule.good };
}

/** 读完这几课，衣柜里多了哪些衣服 */
export function newItems(chapter, lessonIds) {
  return (chapter?.wardrobe?.items || []).filter((i) => lessonIds.includes(i.from?.lesson));
}

/** Zib 的一句话：每个词点一下能听；还没拿到的衣服，名字显示成外星符号（和发现物一样） */
function lineHtml(text, locked) {
  let parts = [{ text }];
  for (const item of locked) {
    const re = new RegExp(`(${item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
    parts = parts.flatMap((p) => (p.glyph ? [p] : p.text.split(re).map((s, i) => (i % 2 ? { glyph: item.word } : { text: s }))));
  }
  return parts
    .map((p) => (p.glyph ? `<button type="button" class="glyph" data-say="${esc(p.glyph)}">${esc(alienWord(p.glyph))}</button>` : wordsHtml(p.text)))
    .join('');
}

export class WardrobeHud {
  /** ui：toast、openModal */
  constructor(ui) {
    this.ui = ui;
    this.view = null;
    this.bound = new WeakSet();
    this.last = null;
    this.btn = document.getElementById('btn-wardrobe');
    this.bubble = document.getElementById('zib-says');
    this.btn.addEventListener('click', () => this.open());
    this.bubble.addEventListener('click', (e) => this.#onBubbleClick(e));
  }

  /** 主界面换了（着陆 / 回到航行期） */
  setView(view) {
    this.view = view;
    this.last = null;
    if (view && !this.bound.has(view)) {
      this.bound.add(view);
      view.addEventListener('zone', () => this.#check(true));
      view.addEventListener('explore', () => this.#check(false));
    }
    view?.setOutfit?.(outfit());
    this.#check(false);
    this.render();
  }

  /** 着陆的这一章有衣柜（也能闲逛）才返回章节 */
  get chapter() {
    const ch = this.view?.chapter;
    return ch?.wardrobe && this.view.canExplore ? ch : null;
  }

  /** 衣柜里的东西：拿到了没有（读完那一课）、正穿着没有 */
  items() {
    const ch = this.chapter;
    if (!ch) return [];
    const unit = UNITS[ch.unit];
    const learned = learnedLessons(ch.unit);
    const worn = outfit();
    return ch.wardrobe.items.map((item) => ({
      ...item,
      have: learned.has(item.from?.lesson),
      worn: worn.has(item.id),
      lesson: unit?.lessons.find((l) => l.id === item.from?.lesson),
    }));
  }

  render() {
    const items = this.items();
    this.btn.hidden = !items.length;
    if (items.length) this.btn.querySelector('b').textContent = `${items.filter((i) => i.have).length}/${items.length}`;
  }

  // ---------- 衣柜 ----------

  /** again：点了一件衣服以后重画，卡片不再弹一下 */
  open(again = false) {
    const ch = this.chapter;
    if (!ch) return;
    if (!again) sound.click();
    const items = this.items();
    const locked = items.filter((i) => !i.have);
    const zone = this.view.exploring ? this.view.zone : null;
    const f = zone && fit(ch.wardrobe, zone.id, outfit());
    const here = zone
      ? `<div class="wr-here"><b>${esc(zone.icon || '')} 你在${esc(zone.name)}</b>${
          f ? `<div class="dc-zib"><span class="dc-who" aria-hidden="true">👽</span><div>${lineHtml(f.line, locked)}</div></div>` : '<small>这里穿什么都可以</small>'
        }</div>`
      : '<p class="wr-note">去逛逛的时候，走进雪之谷、雨之林、晴之丘，Zib 会告诉你该穿什么。</p>';
    const cards = items
      .map((i) =>
        i.have
          ? `<button type="button" class="wr-item ${i.worn ? 'on' : ''}" data-action="wear" data-id="${esc(i.id)}" aria-pressed="${i.worn}">
              <b aria-hidden="true">${esc(i.emoji)}</b><span>${esc(i.word)}</span><small>${esc(i.zh)}</small><em>${i.worn ? '✅ 穿着' : '穿上'}</em>
            </button>`
          : `<div class="wr-item locked">
              <b aria-hidden="true">${esc(i.emoji)}</b><span class="glyph">${esc(alienWord(i.word))}</span><small>读完《${esc(i.lesson?.title || '这一课')}》就能拿到</small>
            </div>`,
      )
      .join('');
    this.ui.openModal(`
      <div class="modal-card wardrobe ${again ? 'still' : ''}">
        <header>
          <div>
            <h2>🎒 小宇航员的衣柜</h2>
            <p>读完一课，衣柜里就多一件这一课讲到的衣服。点一下穿上，再点一下脱下</p>
          </div>
          <button class="icon-btn" data-action="close-modal" aria-label="关闭">✕</button>
        </header>
        ${here}
        <div class="wr-grid">${cards}</div>
      </div>`);
  }

  /** 衣柜里点了一件衣服：穿上或脱下；不是衣柜的按钮返回 false */
  onModalAction(btn) {
    if (btn.dataset.action !== 'wear') return false;
    const worn = outfit();
    const id = btn.dataset.id;
    if (worn.has(id)) worn.delete(id);
    else worn.add(id);
    setOutfit(worn);
    sound.pop();
    this.view?.setOutfit?.(worn);
    this.#check(false);
    this.open(true);
    return true;
  }

  // ---------- 家长报告 ----------

  reportHtml() {
    const items = this.items();
    if (!items.length) return '';
    const have = items.filter((i) => i.have);
    const missing = items.filter((i) => !i.have);
    const worn = items.filter((i) => i.worn);
    const ch = this.chapter;
    const zones = Object.keys(ch.wardrobe.zones).map((id) => ch.explore.zones.find((z) => z.id === id)?.name).filter(Boolean);
    const parts = [
      have.length && `已经拿到 ${have.map((i) => `${i.emoji} ${i.word}`).join('、')}`,
      missing.length && `读完${missing.map((i) => `《${i.lesson?.title || ''}》`).join('')}还能拿到 ${missing.map((i) => i.word).join('、')}`,
      worn.length && `正穿着 ${worn.map((i) => i.word).join('、')}`,
    ].filter(Boolean);
    return `
      <li><div><b>🎒 衣柜：拿到 ${have.length}/${items.length} 件</b>
      <small>${esc(parts.join('；'))}。闲逛走进${esc(zones.join('、'))}时要穿对衣服（天气决定穿什么），穿错了只是小宇航员会不舒服，不计分</small></div></li>`;
  }

  // ---------- Zib 的提醒 ----------

  /** 走进地带（entered）或者换了衣服：算穿得对不对，告诉三维里的小宇航员，需要的话 Zib 说一句 */
  #check(entered) {
    const ch = this.chapter;
    const zone = ch && this.view.exploring ? this.view.zone : null;
    const f = zone ? fit(ch.wardrobe, zone.id, outfit()) : null;
    this.view?.setFeel?.(f?.feel || null);
    const last = this.last;
    this.last = f && { zone: zone.id, ok: f.ok, line: f.line };
    if (!f) return this.#hide();
    if (!entered && last?.zone === zone.id && last.line === f.line) return;
    // 刚刚穿对了：Zib 点头
    if (f.ok && last?.zone === zone.id && !last.ok) {
      sound.correct();
      this.view.cheer?.();
    }
    this.#say(f);
  }

  #say(f) {
    const items = this.items();
    const locked = items.filter((i) => !i.have);
    const need = f.missing && items.find((i) => i.id === f.missing);
    const tip =
      need && !need.have
        ? `<small>🔒 衣柜里还没有这件：读完《${esc(need.lesson?.title || '')}》就能拿到</small>`
        : f.ok
          ? ''
          : '<button type="button" class="zs-open" data-act="open">🎒 打开衣柜</button>';
    this.bubble.innerHTML = `
      <span class="zs-who" aria-hidden="true">👽</span>
      <div class="zs-body"><div class="zs-line">${lineHtml(f.line, locked)}</div>${tip}</div>
      <button type="button" class="zs-close" data-act="close" aria-label="关上">✕</button>`;
    this.bubble.hidden = false;
    requestAnimationFrame(() => this.bubble.classList.add('show'));
    speak(f.line);
    // 穿对了夸一句就收起来；没穿对就一直留着（可以点 ✕ 关上），不然小宇航员一直发抖，孩子不知道为什么
    clearTimeout(this.timer);
    if (f.ok) this.timer = setTimeout(() => this.#hide(), 4000);
  }

  #hide() {
    clearTimeout(this.timer);
    this.bubble.classList.remove('show');
    this.bubble.hidden = true;
  }

  #onBubbleClick(e) {
    const say = e.target.closest('[data-say]');
    if (say) return speak(say.dataset.say);
    const btn = e.target.closest('[data-act]');
    if (btn?.dataset.act === 'open') this.open();
    else if (btn?.dataset.act === 'close') this.#hide();
  }
}
