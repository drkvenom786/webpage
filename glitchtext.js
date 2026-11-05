/**
 * GlitchText Component (Vanilla JS adaptation of React Bits GlitchText)
 * Multi-mode procedural text slicing, RGB shift, scanlines & glyph noise
 */
(function (global) {
  'use strict';

  const MODES = ['slices', 'rgb', 'scan', 'noise'];
  const GLYPHS = '#%&@$?<>/\\=+*~^!';
  const SLICE_STOPS = [
    [20, 50],
    [10, 60],
    [15, 55],
    [25, 35],
    [30, 40],
    [40, 20],
    [10, 60],
    [15, 55],
    [25, 35],
    [30, 40],
    [20, 50],
    [10, 60],
    [15, 55],
    [25, 35],
    [30, 40],
    [40, 20],
    [20, 50],
    [10, 60],
    [15, 55],
    [25, 35],
    [30, 40]
  ];

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const bandAt = u => {
    const x = clamp(u, 0, 1) * (SLICE_STOPS.length - 1);
    const i = Math.min(SLICE_STOPS.length - 2, Math.floor(x));
    const f = x - i;
    const [t0, b0] = SLICE_STOPS[i];
    const [t1, b1] = SLICE_STOPS[i + 1];
    return [t0 + (t1 - t0) * f, b0 + (b1 - b0) * f];
  };

  const pingPong = (time, period) => {
    const p = (time / period) % 2;
    return p < 1 ? 1 - p : p - 1;
  };

  const fitBand = (top, bottom) => {
    const t = clamp(top, 0, 100);
    const b = clamp(bottom, 0, 100);
    return t + b >= 100 ? [0, 100] : [t, b];
  };

  const makeEvent = (now, ms) => {
    const r = Math.random;
    const sign = () => (r() < 0.5 ? -1 : 1);
    return {
      until: now + ms * (1 + Math.floor(r() * 3)),
      aTop: r() * 80,
      aHeight: 5 + r() * 22,
      bTop: r() * 85,
      bHeight: 3 + r() * 14,
      ax: sign() * (1.3 + r() * 1.5),
      bx: sign() * (1.1 + r() * 1.2),
      ay: (r() - 0.5) * 0.5,
      by: (r() - 0.5) * 0.5,
      skew: sign() * (0.4 + r() * 0.6),
      fresh: true
    };
  };

  const stepLength = speed => 70 * Math.sqrt(Math.max(0.05, speed) / 0.5);

  function initGlitchText(element, options = {}) {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }
    if (!element) return null;

    const mode = MODES.includes(options.mode) ? options.mode : 'slices';
    const trigger = options.trigger || 'always';
    const speed = Math.max(0.05, options.speed ?? 0.6);
    const intensity = clamp(options.intensity ?? 0.5, 0, 1);
    const offset = Math.max(0, options.offset ?? 10);
    const skew = options.skew ?? 0;
    const flicker = Boolean(options.flicker);
    const enableShadows = options.enableShadows !== false;
    const shadowColors = Array.isArray(options.shadowColors) ? options.shadowColors : ['#A855F7', '#22C55E'];
    const burstDuration = Math.max(0.1, options.burstDuration ?? 0.6);

    const s = {
      speed,
      offset,
      intensity,
      skew,
      flicker,
      enableShadows,
      shadowColors,
      burstDuration
    };

    const text = (element.getAttribute('data-text') || element.textContent || '').trim();
    const isAnimated = element.classList.contains('animate-text') || Boolean(options.animateText);
    element.classList.add('glitch', `glitch--${mode}`);
    if (isAnimated) {
      element.classList.add('glitch--animated');
    }

    // Build internal markup if not present
    if (!element.querySelector('.glitch__text')) {
      const animClass = isAnimated ? ' animate-text' : '';
      element.innerHTML = `
        <span class="glitch__text${animClass}">${text}</span>
        <span class="glitch__slice glitch__slice--b${animClass}" aria-hidden="true">${text}</span>
        <span class="glitch__slice glitch__slice--a${animClass}" aria-hidden="true">${text}</span>
      `;
    } else if (isAnimated) {
      element.querySelectorAll('.glitch__text, .glitch__slice').forEach(el => {
        el.classList.add('animate-text');
      });
    }

    element.style.setProperty('--glitch-color-a', enableShadows ? shadowColors[0] : 'currentColor');
    element.style.setProperty('--glitch-color-b', enableShadows ? shadowColors[1] : 'currentColor');

    const reduce = Boolean(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    const written = {};
    const swaps = new Map();
    let raf = 0;
    let last = 0;
    let clock = 0;
    let visible = true;
    let hovering = false;
    let burstStart = 0;
    let burstEnd = 0;
    let nextStep = 0;
    let event = null;
    let alpha = 1;
    let jitter = [1, 1, 0, 0];

    const write = (name, value) => {
      if (written[name] === value) return;
      written[name] = value;
      element.style.setProperty(name, value);
    };

    const rest = () => {
      write('--glitch-a-top', '0%');
      write('--glitch-a-bottom', '100%');
      write('--glitch-b-top', '0%');
      write('--glitch-b-bottom', '100%');
      write('--glitch-a-x', '0px');
      write('--glitch-a-y', '0px');
      write('--glitch-b-x', '0px');
      write('--glitch-b-y', '0px');
      write('--glitch-a-shadow', 'none');
      write('--glitch-b-shadow', 'none');
      write('--glitch-skew', '0deg');
      write('--glitch-alpha', '1');
      write('--glitch-split', '0');
      swaps.clear();
      event = null;
    };

    const isActive = now =>
      !reduce && visible && (trigger === 'always' || (trigger === 'hover' && hovering) || now < burstEnd);

    const step = (now, power) => {
      const ms = stepLength(s.speed);
      if (event && now >= event.until) event = null;
      if (!event && Math.random() < power * power * 0.35) event = makeEvent(now, ms);
      jitter = [0.6 + Math.random() * 0.8, 0.6 + Math.random() * 0.8, Math.random() * 2 - 1, Math.random() * 2 - 1];
      alpha = s.flicker && Math.random() < 0.04 + 0.16 * power ? 0.45 + Math.random() * 0.35 : 1;
      nextStep = now + ms * (0.7 + Math.random() * 0.6);
    };

    const frame = now => {
      raf = 0;
      if (!isActive(now)) {
        rest();
        last = 0;
        return;
      }

      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      clock += dt;

      const bursting = now < burstEnd;
      const burstLeft = bursting ? 1 - ((now - burstStart) / Math.max(1, burstEnd - burstStart)) * 0.55 : 0;
      const power = Math.max(clamp(s.intensity, 0, 1), burstLeft);
      if (now >= nextStep) step(now, power);

      const live = event && now < event.until ? event : null;
      const scale = 0.4 + 1.2 * power;
      const off = Math.max(0, s.offset);
      const pace = Math.max(0.05, s.speed);
      let a = [0, 100];
      let b = [0, 100];
      let ax = 0;
      let ay = 0;
      let bx = 0;
      let by = 0;
      let split = 0;

      if (mode === 'slices') {
        a = bandAt(pingPong(clock, 3 * pace));
        b = bandAt(pingPong(clock, 2 * pace));
        ax = off * scale;
        bx = -off * scale;
        if (live) {
          a = [live.aTop, 100 - live.aTop - live.aHeight];
          b = [live.bTop, 100 - live.bTop - live.bHeight];
          ax = off * scale * live.ax;
          bx = off * scale * live.bx;
          ay = off * live.ay;
          by = off * live.by;
        }
      } else if (mode === 'rgb') {
        const spread = off * (0.22 + 0.45 * power);
        ax = spread * jitter[0];
        bx = -spread * jitter[1];
        ay = off * 0.06 * jitter[2];
        by = off * 0.06 * jitter[3];
        if (live) {
          ax = off * scale * Math.abs(live.ax);
          bx = -off * scale * Math.abs(live.bx);
          ay = off * live.ay;
          by = off * live.by;
        }
        split = s.enableShadows ? 0.9 : 0.4;
      } else if (mode === 'scan') {
        const pass = 2.4 * pace;
        const cycle = pass * (1 + (1 - power) * 1.2);
        const local = clock % cycle;
        const height = 9 + 9 * power;
        if (local < pass) {
          const dir = Math.floor(clock / cycle) % 2 ? -1 : 1;
          const center = -height + (local / pass) * (100 + 2 * height);
          const trail = center - height * 1.5;
          const thin = height * 0.35;
          a = [center - height / 2, 100 - (center + height / 2)];
          b = [trail - thin / 2, 100 - (trail + thin / 2)];
          ax = off * scale * 1.5 * dir * (0.75 + 0.25 * Math.sin(clock * 23));
          bx = -ax * 0.5;
        }
        if (live) {
          b = [live.bTop, 100 - live.bTop - live.bHeight];
          bx = off * scale * live.bx * 1.4;
        }
      }

      a = fitBand(a[0], a[1]);
      b = fitBand(b[0], b[1]);
      const shadows = s.enableShadows && mode !== 'rgb';

      write('--glitch-a-top', `${a[0].toFixed(2)}%`);
      write('--glitch-a-bottom', `${a[1].toFixed(2)}%`);
      write('--glitch-b-top', `${b[0].toFixed(2)}%`);
      write('--glitch-b-bottom', `${b[1].toFixed(2)}%`);
      write('--glitch-a-x', `${ax.toFixed(2)}px`);
      write('--glitch-a-y', `${ay.toFixed(2)}px`);
      write('--glitch-b-x', `${bx.toFixed(2)}px`);
      write('--glitch-b-y', `${by.toFixed(2)}px`);
      write('--glitch-a-shadow', shadows ? `${(-ax / 2).toFixed(2)}px 0 ${s.shadowColors[0]}` : 'none');
      write('--glitch-b-shadow', shadows ? `${(-bx / 2).toFixed(2)}px 0 ${s.shadowColors[1]}` : 'none');
      write('--glitch-skew', `${(live ? s.skew * live.skew : 0).toFixed(2)}deg`);
      write('--glitch-alpha', alpha.toFixed(2));
      write('--glitch-split', String(split));

      raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf || !isActive(performance.now())) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const onEnter = () => {
      hovering = true;
      wake();
    };
    const onLeave = () => {
      hovering = false;
    };
    const onClick = () => {
      const now = performance.now();
      burstStart = now;
      burstEnd = now + Math.max(0.1, s.burstDuration) * 1000;
      event = makeEvent(now, stepLength(s.speed));
      nextStep = now;
      wake();
    };

    element.addEventListener('pointerenter', onEnter);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('click', onClick);

    let observer = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) wake();
      });
      observer.observe(element);
    }

    wake();

    return {
      wake,
      destroy: () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
        element.removeEventListener('pointerenter', onEnter);
        element.removeEventListener('pointerleave', onLeave);
        element.removeEventListener('click', onClick);
        rest();
      }
    };
  }

  global.GlitchText = {
    init: initGlitchText
  };
})(typeof window !== 'undefined' ? window : this);
