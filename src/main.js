import './style.css';
import { loadHomework } from './data.js';
import { Progress } from './progress.js';
import { HomeworkScene } from './scene.js';
import { UI } from './ui.js';

async function start() {
  const loading = document.getElementById('loading');
  try {
    const homework = await loadHomework();
    const progress = new Progress(homework);
    const scene = new HomeworkScene(document.getElementById('stage'), homework, progress);
    new UI({ homework, progress, scene });
    requestAnimationFrame(() => loading.classList.add('hidden'));
  } catch (err) {
    console.error(err);
    loading.classList.add('error');
    loading.innerHTML = `<div class="loading-rocket">🛸</div><p>出了点小问题：</p><pre></pre>`;
    loading.querySelector('pre').textContent = err.message;
  }
}

start();
