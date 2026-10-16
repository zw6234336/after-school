// 音效（用 Web Audio 现场合成，不需要音频文件）和朗读题目。

const MUTE_KEY = 'after-school:muted';

class Sound {
  constructor() {
    this.ctx = null;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // 忽略
    }
    if (muted) window.speechSynthesis?.cancel();
  }

  #ctx() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  #tone(freq, start, duration, { type = 'sine', gain = 0.18, slideTo } = {}) {
    const ctx = this.#ctx();
    if (!ctx) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  click() {
    this.#tone(660, 0, 0.08, { type: 'triangle', gain: 0.08 });
  }

  correct() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.#tone(f, i * 0.07, 0.22, { type: 'triangle' }));
  }

  wrong() {
    this.#tone(320, 0, 0.18, { type: 'sine', gain: 0.15, slideTo: 220 });
    this.#tone(240, 0.16, 0.25, { type: 'sine', gain: 0.12, slideTo: 180 });
  }

  complete() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.#tone(f, i * 0.09, 0.3, { type: 'triangle', gain: 0.16 }));
  }

  launch() {
    const ctx = this.#ctx();
    if (!ctx) return;
    // 一段从低到高的“轰——”噪声
    const len = 3.5;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const t0 = ctx.currentTime;
    filter.frequency.setValueAtTime(200, t0);
    filter.frequency.exponentialRampToValueAtTime(1800, t0 + 1.2);
    filter.frequency.exponentialRampToValueAtTime(300, t0 + len);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(0.25, t0 + 0.4);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t0);
    this.complete();
  }

  pop() {
    this.#tone(900 + Math.random() * 600, 0, 0.12, { type: 'square', gain: 0.03, slideTo: 300 });
  }
}

export const sound = new Sound();

let speechToken = 0;

function utterance(text, rate) {
  const clean = text.replace(/[_＿]+/g, ' ');
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = /[\u4e00-\u9fff]/.test(clean) ? 'zh-CN' : 'en-US';
  u.rate = rate ?? (u.lang === 'en-US' ? 0.85 : 0.9);
  u.pitch = 1.1;
  return u;
}

export function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth || sound.muted || !text) return;
  speechToken++;
  synth.cancel();
  synth.speak(utterance(text));
}

/** 一句一句地读，onStart(i) 用来高亮正在读的句子；返回一个停止函数 */
export function speakSequence(texts, { onStart, onDone, rate } = {}) {
  const synth = window.speechSynthesis;
  if (!synth || sound.muted || texts.length === 0) {
    onDone?.();
    return () => {};
  }
  synth.cancel();
  const token = ++speechToken;
  let i = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone?.();
  };
  const next = () => {
    if (token !== speechToken) return finish();
    if (i >= texts.length) return finish();
    const index = i++;
    const u = utterance(texts[index], rate);
    u.onstart = () => token === speechToken && onStart?.(index);
    u.onend = next;
    u.onerror = next;
    synth.speak(u);
  };
  next();
  return () => {
    speechToken++;
    synth.cancel();
    finish();
  };
}

export function stopSpeaking() {
  speechToken++;
  window.speechSynthesis?.cancel();
}

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
