/* Calm effects (monochrome): confetti, floating point pops, count-up numbers, level ring. No dependencies. */
window.FX = (() => {
  const canvas = document.getElementById('confetti');
  const ctx = canvas.getContext('2d');
  let parts = [], raf = null;

  function resize() { canvas.width = window.innerWidth * devicePixelRatio; canvas.height = window.innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); }
  window.addEventListener('resize', resize);

  function confetti({ count = 140, origin = null, colors = ['#111111', '#3a3a3a', '#7a7a7a', '#b5b5b5', '#ffffff', '#111111'], spread = 1 } = {}) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    resize(); canvas.classList.remove('hidden');
    const ox = origin ? origin.x : window.innerWidth / 2, oy = origin ? origin.y : window.innerHeight * 0.35;
    for (let i = 0; i < count; i++) {
      const a = (Math.random() * Math.PI * 2), sp = (4 + Math.random() * 9) * spread;
      parts.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6, g: .28 + Math.random() * .1, w: 6 + Math.random() * 7, h: 4 + Math.random() * 5, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3, c: colors[i % colors.length], life: 90 + Math.random() * 50, shape: Math.random() < .3 ? 'circle' : 'rect' });
    }
    if (!raf) tick();
  }
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = parts.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);
    for (const p of parts) {
      p.vy += p.g; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life--;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.min(1, p.life / 30); ctx.fillStyle = p.c;
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(tick); else { raf = null; canvas.classList.add('hidden'); }
  }

  function popPoints(amount, el) {
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const x = r ? r.left + r.width / 2 : window.innerWidth / 2, y = r ? r.top : window.innerHeight / 2;
    const d = document.createElement('div'); d.className = 'pop-pts'; d.textContent = `+${amount}`; d.style.left = `${x}px`; d.style.top = `${y}px`;
    document.body.appendChild(d); setTimeout(() => d.remove(), 1400);
  }

  function countUp(el, to, { from = null, ms = 900, suffix = '' } = {}) {
    if (!el) return;
    const start = from == null ? Number(String(el.textContent).replace(/[^\d.-]/g, '')) || 0 : from;
    if (start === to) { el.textContent = `${to}${suffix}`; return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - k, 3); el.textContent = `${Math.round(start + (to - start) * e)}${suffix}`; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  /** SVG progress ring. progress 0..100 */
  function ring(progress, size = 132) {
    const r = 54, c = 2 * Math.PI * r; const off = c - (c * Math.max(0, Math.min(100, progress))) / 100;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 132 132" aria-hidden="true"><circle class="track" cx="66" cy="66" r="${r}"/><circle class="bar" cx="66" cy="66" r="${r}" data-off="${off.toFixed(1)}" style="stroke-dasharray:${c.toFixed(1)}"/></svg>`;
  }
  function animateRings(root = document) { requestAnimationFrame(() => root.querySelectorAll('.ring-wrap .bar').forEach((b) => { b.style.strokeDashoffset = b.dataset.off; })); }
  function animateBars(root = document) { requestAnimationFrame(() => root.querySelectorAll('[data-w]').forEach((b) => { b.style.width = b.dataset.w + '%'; })); }

  function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  return { confetti, popPoints, countUp, ring, animateRings, animateBars, bump };
})();
