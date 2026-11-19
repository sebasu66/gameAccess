import { gsap } from 'gsap';
window.gsap = gsap;
import './game-access-hdd.js';

const units = [
  { letter: 'C:', label: 'SISTEMA', totalBytes: 1000e9, usedBytes: 682e9, activity: 'reading' },
  { letter: 'D:', label: 'BIBLIOTECA STEAM', totalBytes: 2000e9, usedBytes: 1712e9, activity: 'writing' },
  { letter: 'E:', label: 'JUEGOS SSD', totalBytes: 1000e9, usedBytes: 925e9, activity: 'idle' },
  { letter: 'F:', label: 'BACKUP', totalBytes: 4000e9, usedBytes: 988e9, activity: 'idle' },
];

const grid = document.querySelector('#drive-grid');
units.forEach((data, i) => {
  const item = document.createElement('div');
  item.className = 'drive-item';
  const disk = document.createElement('game-access-hdd');
  disk.setData(data);
  item.appendChild(disk);
  const controls = document.createElement('div');
  controls.className = 'control-row';
  controls.innerHTML = `<span>DISCO ${data.letter}</span>
    <div class="actions">
      <button data-mode="idle">Reposo</button>
      <button data-mode="reading">Leer</button>
      <button data-mode="writing">Escribir</button>
      <button data-random="true">Simular capacidad</button>
    </div>`;
  controls.querySelectorAll('button[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      disk.setActivity(button.dataset.mode);
      updateButtons(controls, button.dataset.mode);
    });
  });
  controls.querySelector('[data-random]').addEventListener('click', () => {
    const total = Number(disk.getAttribute('total'));
    disk.setUsage(total * (.1 + Math.random() * .89));
  });
  function updateButtons(root, state) {
    root.querySelectorAll('button[data-mode]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.mode === state);
    });
  }
  updateButtons(controls, data.activity);
  item.appendChild(controls);
  grid.appendChild(item);
});
