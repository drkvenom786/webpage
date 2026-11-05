/**
 * Specular Interactive Border & Button Engine
 * GPU-accelerated specular light tracing along element borders (originating from React Bits SpecularButton)
 */
(function (global) {
  'use strict';

  const PAD = 24;
  const TAU = Math.PI * 2;

  const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uPx;
uniform float uSpot;
uniform vec2 uEntry;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform vec2 uWindow;
uniform float uThickness;
uniform float uGlow;
out vec4 outColor;

float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float loopPosition(vec2 p, vec2 b, float r) {
  vec2 inner = b - r;
  float arc = 1.5707963 * r;
  float quarter = inner.x + inner.y + arc;
  vec2 a = abs(p);
  vec2 q = a - inner;
  float s = q.x > 0.0 && q.y > 0.0
    ? inner.y + atan(q.y, q.x) * r
    : (q.x > q.y ? min(a.y, inner.y) : inner.y + arc + inner.x - min(a.x, inner.x));
  if (p.x < 0.0) s = p.y >= 0.0 ? 2.0 * quarter - s : 2.0 * quarter + s;
  else if (p.y < 0.0) s = 4.0 * quarter - s;
  return s / max(4.0 * quarter, 0.0001);
}

float lobe(float position, float center) {
  float gap = abs(fract(position - center + 0.5) - 0.5);
  return 1.0 - smoothstep(uWindow.x, uWindow.x + uWindow.y, gap);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = roundedBox(p, uHalf, uRadius);
  float position = loopPosition(p, uHalf, uRadius);
  float key = lobe(position, uSpot);
  float back = lobe(position, uSpot + 0.5);
  float streak = key + back * 0.45;
  float width = max(uThickness * uPx * mix(1.0, max(key, back), 0.6), 0.35);
  float band = smoothstep(-width - 0.6, -width + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float hair = smoothstep(-uPx - 0.6, -uPx + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  vec2 pool = (p - uEntry) / (uHalf.y * vec2(1.6, 1.1));
  float glow = streak * 0.2 * exp(-abs(d + width * 0.5) / (5.0 * uPx)) + inside * 0.08 * exp(-dot(pool, pool));
  float light = clamp((band * streak + glow * uGlow) * uIntensity, 0.0, 1.0);
  vec4 base = vec4(uBaseColor, 1.0) * hair * 0.6;
  outColor = vec4(uLineColor, 1.0) * light + base * (1.0 - light);
}`;

  const UNIFORMS = [
    'uCenter',
    'uHalf',
    'uRadius',
    'uPx',
    'uSpot',
    'uEntry',
    'uLineColor',
    'uBaseColor',
    'uIntensity',
    'uWindow',
    'uThickness',
    'uGlow'
  ];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const wrap = value => value - Math.floor(value);

  const loopPosition = (x, y, halfX, halfY, r) => {
    const innerX = halfX - r;
    const innerY = halfY - r;
    const arc = (Math.PI / 2) * r;
    const quarter = innerX + innerY + arc;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const qx = ax - innerX;
    const qy = ay - innerY;
    let s;
    if (qx > 0 && qy > 0) s = innerY + Math.atan2(qy, qx) * r;
    else if (qx > qy) s = Math.min(ay, innerY);
    else s = innerY + arc + innerX - Math.min(ax, innerX);
    if (x < 0) s = y >= 0 ? 2 * quarter - s : 2 * quarter + s;
    else if (y < 0) s = 4 * quarter - s;
    return wrap(s / Math.max(4 * quarter, 0.0001));
  };

  const rimPoint = (position, halfX, halfY, r) => {
    const innerX = halfX - r;
    const innerY = halfY - r;
    const arc = (Math.PI / 2) * r;
    const quarter = innerX + innerY + arc;
    let s = wrap(position) * 4 * quarter;
    let signX = 1;
    let signY = 1;
    if (s > 3 * quarter) {
      s = 4 * quarter - s;
      signY = -1;
    } else if (s > 2 * quarter) {
      s -= 2 * quarter;
      signX = -1;
      signY = -1;
    } else if (s > quarter) {
      s = 2 * quarter - s;
      signX = -1;
    }
    let x = innerX - (s - innerY - arc);
    let y = halfY;
    if (s <= innerY) {
      x = halfX;
      y = s;
    } else if (s <= innerY + arc) {
      const angle = (s - innerY) / Math.max(r, 0.0001);
      x = innerX + Math.cos(angle) * r;
      y = innerY + Math.sin(angle) * r;
    }
    return [x * signX, y * signY];
  };

  const compileShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };

  const createProgram = gl => {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
    gl.deleteProgram(program);
    return null;
  };

  // Color conversion probe
  const probeCanvas = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d', { willReadFrequently: true }) : null;
  const colorCache = new Map();
  const toRgb = value => {
    const key = String(value || '#ffffff').trim();
    if (colorCache.has(key)) return colorCache.get(key);
    let rgb = [1, 1, 1];
    if (probeCanvas) {
      probeCanvas.clearRect(0, 0, 1, 1);
      probeCanvas.fillStyle = '#000000';
      probeCanvas.fillStyle = key;
      probeCanvas.fillRect(0, 0, 1, 1);
      const data = probeCanvas.getImageData(0, 0, 1, 1).data;
      rgb = [data[0] / 255, data[1] / 255, data[2] / 255];
    }
    colorCache.set(key, rgb);
    return rgb;
  };

  // Master WebGL2 Engine that powers all element canvases efficiently
  let masterGl = null;
  let masterCanvas = null;
  let masterProgram = null;
  let masterUniforms = {};
  let masterVao = null;
  let masterBuffer = null;

  function initMasterGl() {
    if (masterGl) return true;
    masterCanvas = document.createElement('canvas');
    masterGl = masterCanvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance'
    });
    if (!masterGl) return false;

    masterProgram = createProgram(masterGl);
    if (!masterProgram) return false;

    for (const name of UNIFORMS) {
      masterUniforms[name] = masterGl.getUniformLocation(masterProgram, name);
    }

    masterBuffer = masterGl.createBuffer();
    masterVao = masterGl.createVertexArray();
    masterGl.bindVertexArray(masterVao);
    masterGl.bindBuffer(masterGl.ARRAY_BUFFER, masterBuffer);
    masterGl.bufferData(masterGl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), masterGl.STATIC_DRAW);
    masterGl.enableVertexAttribArray(0);
    masterGl.vertexAttribPointer(0, 2, masterGl.FLOAT, false, 0, 0);
    masterGl.bindVertexArray(null);

    return true;
  }

  // Pointer tracking across window
  const pointer = { x: -9999, y: -9999, known: false };
  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', e => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.known = true;
      wakeAll();
    }, { passive: true });
    window.addEventListener('pointerdown', e => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.known = true;
      wakeAll();
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => {
      pointer.known = false;
      wakeAll();
    });
  }

  const entries = new Set();
  let rafId = 0;
  let lastTime = 0;

  function wakeAll() {
    if (!rafId && entries.size > 0) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(masterTick);
    }
  }

  function masterTick(now) {
    rafId = 0;
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    let anyNeedsWork = false;

    entries.forEach(item => {
      if (!item.visible) return;
      const needs = item.update(now, dt);
      if (needs) anyNeedsWork = true;
    });

    if (anyNeedsWork) {
      rafId = requestAnimationFrame(masterTick);
    } else {
      lastTime = 0;
    }
  }

  function attachSpecular(element, options = {}) {
    if (!element || element.dataset.specularActive) return null;
    element.dataset.specularActive = 'true';

    if (!initMasterGl()) return null;

    element.classList.add('specular-border');

    // Create overlay canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'specular-light-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    element.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Detect radius from CSS computed style
    const computedStyle = window.getComputedStyle(element);
    const rawRadius = parseFloat(computedStyle.borderRadius) || 18;
    const isPill = computedStyle.borderRadius.includes('9999') || computedStyle.borderRadius.includes('50%');

    const s = {
      radius: options.radius !== undefined ? options.radius : (isPill ? 9999 : rawRadius),
      lineColor: options.lineColor || element.getAttribute('data-line-color') || '#ffffff',
      baseColor: options.baseColor || element.getAttribute('data-base-color') || '#3f3f46',
      intensity: options.intensity ?? 1,
      idleIntensity: options.idleIntensity ?? 0.28,
      shineSize: options.shineSize ?? (element.offsetWidth > 200 ? 16 : 11),
      shineFade: options.shineFade ?? (element.offsetWidth > 200 ? 44 : 34),
      thickness: options.thickness ?? (element.offsetWidth > 200 ? 1.3 : 1.2),
      glow: options.glow ?? 1,
      speed: options.speed ?? 0.35,
      followMouse: options.followMouse !== false,
      proximity: options.proximity ?? (element.offsetWidth > 200 ? 320 : 250),
      autoAnimate: options.autoAnimate || false,
      disabled: false
    };

    const view = { width: 1, height: 1, ratio: 1 };
    const state = { spot: 0, level: 0, press: 0, ready: false };
    let visible = true;

    const cornerRadius = () => Math.min(s.radius, view.width / 2, view.height / 2);

    const restSpot = () => {
      const r = cornerRadius();
      const inset = r * (1 - Math.SQRT1_2);
      return loopPosition(inset - view.width / 2, view.height / 2 - inset, view.width / 2, view.height / 2, r);
    };

    const aim = () => {
      if (!s.followMouse || s.disabled || !pointer.known) return null;
      const rect = element.getBoundingClientRect();
      const scale = rect.width / view.width || 1;
      const halfX = view.width / 2;
      const halfY = view.height / 2;
      const x = (pointer.x - rect.left - rect.width / 2) / scale;
      const y = (rect.top + rect.height / 2 - pointer.y) / scale;
      const distance = Math.hypot(Math.max(Math.abs(x) - halfX, 0), Math.max(Math.abs(y) - halfY, 0));
      const t = clamp(1 - distance / s.proximity, 0, 1);
      const near = t * t * (3 - 2 * t);
      const nearest = loopPosition(x, y, halfX, halfY, cornerRadius());
      if (distance > 0) return { spot: nearest, near };
      const depth = clamp(Math.min(halfX - Math.abs(x), halfY - Math.abs(y)) / (halfY * 0.8), 0, 1);
      const sway = restSpot() - (x / halfX) * 0.06 - (y / halfY) * 0.02;
      const offset = sway - nearest - Math.round(sway - nearest);
      return { spot: wrap(nearest + offset * depth * depth * (3 - 2 * depth)), near };
    };

    const measure = () => {
      const rect = element.getBoundingClientRect();
      view.width = Math.max(1, rect.width || element.offsetWidth);
      view.height = Math.max(1, rect.height || element.offsetHeight);
      view.ratio = Math.min(window.devicePixelRatio || 1, 2.5);

      const targetW = Math.max(1, Math.round((view.width + PAD * 2) * view.ratio));
      const targetH = Math.max(1, Math.round((view.height + PAD * 2) * view.ratio));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      if (state.ready) render();
    };

    const render = () => {
      const { width, height } = view;
      const gl = masterGl;
      const targetW = canvas.width;
      const targetH = canvas.height;

      if (masterCanvas.width !== targetW || masterCanvas.height !== targetH) {
        masterCanvas.width = targetW;
        masterCanvas.height = targetH;
      }

      gl.viewport(0, 0, targetW, targetH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(masterProgram);

      const scaleX = targetW / (width + PAD * 2);
      const scaleY = targetH / (height + PAD * 2);

      gl.uniform2f(masterUniforms.uCenter, (PAD + width / 2) * scaleX, (PAD + height / 2) * scaleY);
      gl.uniform2f(masterUniforms.uHalf, (width / 2) * scaleX, (height / 2) * scaleY);
      gl.uniform1f(masterUniforms.uRadius, Math.min(s.radius, width / 2, height / 2) * scaleX);
      gl.uniform1f(masterUniforms.uPx, view.ratio);

      const r = Math.min(s.radius, width / 2, height / 2);
      const [rimX, rimY] = rimPoint(state.spot, width / 2, height / 2, r);
      const pull = 1 - Math.min(0.35 * (height / 2), Math.hypot(rimX, rimY)) / Math.max(Math.hypot(rimX, rimY), 0.0001);

      gl.uniform1f(masterUniforms.uSpot, state.spot);
      gl.uniform2f(masterUniforms.uEntry, rimX * pull * scaleX, rimY * pull * scaleY);
      gl.uniform3fv(masterUniforms.uLineColor, toRgb(s.lineColor));
      gl.uniform3fv(masterUniforms.uBaseColor, toRgb(s.baseColor));
      gl.uniform1f(masterUniforms.uIntensity, s.intensity * (state.level + state.press * 0.8));
      gl.uniform2f(masterUniforms.uWindow, s.shineSize / 360 + state.press * 0.06, s.shineFade / 360 + 0.0001);
      gl.uniform1f(masterUniforms.uThickness, s.thickness);
      gl.uniform1f(masterUniforms.uGlow, s.glow);

      gl.bindVertexArray(masterVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);

      // Blit to element 2D canvas
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(masterCanvas, 0, 0);
    };

    const update = (now, dt) => {
      const target = aim();
      const spinning = s.autoAnimate;
      const steering = !!target && target.near > 0;

      if (!state.ready) {
        state.spot = restSpot();
        state.level = s.autoAnimate ? 1 : s.idleIntensity;
        state.ready = true;
      }

      let diff = 0;
      if (spinning && !steering) {
        state.spot = wrap(state.spot + (s.speed / TAU) * dt);
      } else {
        diff = (steering ? target.spot : restSpot()) - state.spot;
        diff -= Math.round(diff);
        state.spot = wrap(state.spot + diff * (1 - Math.exp(-dt * 8)));
      }

      const level = s.autoAnimate ? 1 : s.idleIntensity + (1 - s.idleIntensity) * (target ? target.near : 0);
      state.level += (level - state.level) * (1 - Math.exp(-dt * 7));
      state.press *= Math.exp(-dt * 5);

      render();

      const settling = Math.abs(diff) > 0.0002 || Math.abs(level - state.level) > 0.001 || state.press > 0.002;
      return settling || (spinning && !steering);
    };

    const onPointerDown = () => {
      state.press = 1;
      wakeAll();
    };
    element.addEventListener('pointerdown', onPointerDown, { passive: true });

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(element);
    }

    let intersectionObserver = null;
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(entryList => {
        visible = entryList.some(e => e.isIntersecting);
        if (visible) wakeAll();
      });
      intersectionObserver.observe(element);
    }

    measure();

    const record = {
      el: element,
      view,
      visible,
      update
    };
    entries.add(record);

    wakeAll();

    return {
      destroy: () => {
        entries.delete(record);
        element.removeEventListener('pointerdown', onPointerDown);
        if (resizeObserver) resizeObserver.disconnect();
        if (intersectionObserver) intersectionObserver.disconnect();
        canvas.remove();
        delete element.dataset.specularActive;
      }
    };
  }

  // Auto-scan and apply to all buttons and cards
  function autoInit() {
    // Buttons
    const buttons = document.querySelectorAll(`
      .cta-button,
      button,
      a[href="#contact"].bg-primary,
      .folder-project-btn,
      .contact-card a,
      [data-specular="button"]
    `);

    buttons.forEach(btn => {
      // Determine theme line color
      let lineColor = '#ffffff';
      if (btn.classList.contains('bg-primary') || btn.classList.contains('text-primary') || btn.closest('.border-primary')) {
        lineColor = '#D8B4FE'; // Light purple glow
      } else if (btn.classList.contains('bg-secondary') || btn.classList.contains('text-secondary') || btn.closest('.border-secondary')) {
        lineColor = '#86EFAC'; // Light green glow
      } else if (btn.classList.contains('bg-blue-500') || btn.classList.contains('text-blue-500')) {
        lineColor = '#93C5FD'; // Light blue glow
      }

      attachSpecular(btn, {
        lineColor,
        baseColor: '#52525b',
        thickness: 1.2,
        glow: 1,
        idleIntensity: 0.32,
        proximity: 220
      });
    });

    // Cards
    const cards = document.querySelectorAll(`
      .stats-grid > div,
      #services .bg-white\\/\\[0\\.04\\],
      .contact-card,
      #contact .bg-card,
      [data-specular="card"]
    `);

    cards.forEach(card => {
      let lineColor = '#ffffff';
      let radius = 24;

      if (card.classList.contains('rounded-2xl')) radius = 16;
      else if (card.classList.contains('rounded-3xl')) radius = 24;

      // Card-specific theme accents
      if (card.innerHTML.includes('text-secondary') || card.innerHTML.includes('fa-whatsapp') || card.innerHTML.includes('text-green-500')) {
        lineColor = '#86EFAC'; // Emerald glow
      } else if (card.innerHTML.includes('text-primary') || card.innerHTML.includes('fa-comments') || card.innerHTML.includes('fa-envelope')) {
        lineColor = '#D8B4FE'; // Purple glow
      } else if (card.innerHTML.includes('text-blue-500') || card.innerHTML.includes('fa-telegram')) {
        lineColor = '#93C5FD'; // Blue glow
      }

      attachSpecular(card, {
        radius,
        lineColor,
        baseColor: '#3f3f46',
        thickness: 1.4,
        glow: 1.15,
        idleIntensity: 0.25,
        proximity: 320
      });
    });

    // Project Cards inside 3D Folder
    const projectCards = document.querySelectorAll('.folder-project-card');
    projectCards.forEach(card => {
      let lineColor = '#ffffff';
      const btn = card.querySelector('.folder-project-btn');
      if (btn && (btn.style.backgroundColor || btn.style.background)) {
        lineColor = btn.style.backgroundColor || btn.style.background;
      } else if (card.innerHTML.includes('#22C55E') || card.innerHTML.includes('AirBeats')) {
        lineColor = '#86EFAC';
      } else if (card.innerHTML.includes('#EF4444') || card.innerHTML.includes('AirFlix')) {
        lineColor = '#FCA5A5';
      } else if (card.innerHTML.includes('#A855F7') || card.innerHTML.includes('ChatsApp')) {
        lineColor = '#D8B4FE';
      }

      attachSpecular(card, {
        radius: 18,
        lineColor,
        baseColor: '#3f3f46',
        thickness: 1.35,
        glow: 1.25,
        idleIntensity: 0.35,
        proximity: 280
      });
    });
  }

  // MutationObserver for dynamically spawned cards & elements
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver(mutations => {
      let shouldScan = false;
      mutations.forEach(m => {
        if (m.addedNodes.length > 0) shouldScan = true;
      });
      if (shouldScan) {
        autoInit();
      }
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  global.Specular = {
    attach: attachSpecular,
    init: autoInit
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoInit);
    } else {
      setTimeout(autoInit, 50);
    }
  }
})(typeof window !== 'undefined' ? window : this);
