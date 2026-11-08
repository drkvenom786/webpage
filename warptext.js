/**
 * WarpText (React Bits WarpText using local OGL)
 * GPU-accelerated fluid glass refraction, ambient wave undulation, cursor lens lensing & shockwaves
 * 100% Original Size & Typography Fidelity
 */
import { Renderer, Program, Mesh, Triangle, Texture } from './ogl.js';

const LENS_MODES = { bulge: 0, pinch: 1, swirl: 2 };
const INTRO_MS = 1600;
const RIPPLE_LIFE = 1.6;
const MAX_CLICKS = 4;

const vertex = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;

uniform sampler2D uTextTexture;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uPointerActive;
uniform float uTime;
uniform float uWarpStrength;
uniform float uWarpScale;
uniform float uSpeed;
uniform float uPointerInfluence;
uniform float uPointerStrength;
uniform float uRefraction;
uniform float uChromatic;
uniform float uRipple;
uniform float uMotion;
uniform float uLens;
uniform float uIntro;
uniform float uReveal;
uniform float uBackdrop;
uniform vec4 uClicks[4];

in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p *= 2.02;
    amplitude *= 0.5;
  }
  return value;
}

vec4 sampleText(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4(0.0);
  }
  return texture(uTextTexture, uv);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float time = uTime * uSpeed;
  float scale = max(uWarpScale, 0.001);

  vec2 drift = vec2(time * 0.055, -time * 0.045);
  float n1 = fbm(uv * scale * 3.1 + drift);
  float n2 = fbm((uv + 19.17) * scale * 3.4 - drift.yx);
  vec2 ambient = (vec2(n1, n2) - 0.5) * (uWarpStrength * 0.045 * uMotion + uIntro * 0.18);

  vec2 pointerDelta = uv - uPointer;
  vec2 aspectDelta = vec2(pointerDelta.x * aspect, pointerDelta.y);
  float dist = length(aspectDelta);
  float radius = max(uPointerInfluence, 0.001);
  float t = clamp(dist / radius, 0.0, 1.0);
  float lens = smoothstep(radius, 0.0, dist) * uPointerActive;
  float bulge = t * (1.0 - t) * (1.0 - t) * 6.75 * uPointerActive;
  vec2 dir = dist > 0.0001 ? vec2(aspectDelta.x / aspect, aspectDelta.y) / dist : vec2(0.0);

  float rippleWave = sin(dist * 28.0 - time * 4.2) * 0.5 + 0.5;
  float rippleRing = (rippleWave - 0.5) * uRipple;
  vec2 pointerWarp = dir * rippleRing * bulge * uPointerStrength * 0.016;

  if (uLens > 1.5) {
    float twist = (1.0 - t) * (1.0 - t) * uPointerActive * uPointerStrength * 2.4;
    float s = sin(twist);
    float c = cos(twist);
    vec2 turned = vec2(aspectDelta.x * c - aspectDelta.y * s, aspectDelta.x * s + aspectDelta.y * c);
    pointerWarp += vec2(turned.x / aspect, turned.y) - pointerDelta;
  } else {
    float side = uLens > 0.5 ? -1.0 : 1.0;
    pointerWarp -= dir * side * bulge * uPointerStrength * 0.045;
  }

  vec2 shock = vec2(0.0);
  float shockLight = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 click = uClicks[i];
    if (click.w <= 0.0) continue;
    vec2 clickDelta = uv - click.xy;
    vec2 clickAspect = vec2(clickDelta.x * aspect, clickDelta.y);
    float clickDist = length(clickAspect);
    float age = click.z;
    float offset = (clickDist - age * 0.9) / (0.06 + age * 0.06);
    float fade = 1.0 - smoothstep(0.0, 1.6, age);
    float energy = exp(-offset * offset) * fade * smoothstep(0.0, 0.08, age) * click.w;
    vec2 clickDir = clickDist > 0.0001 ? vec2(clickAspect.x / aspect, clickAspect.y) / clickDist : vec2(0.0);
    shock -= clickDir * offset * energy * 0.09;
    shockLight += energy;
  }

  vec2 bend = pointerWarp + shock;
  vec2 rest = uv + ambient;
  vec2 splitDir = ambient + bend;
  float splitLen = length(splitDir);
  splitDir = splitLen > 0.00001 ? splitDir / splitLen : vec2(0.7071, 0.7071);
  vec2 split = splitDir * uRefraction * 0.16 * (0.35 + lens * 1.65 + uIntro * 3.0);
  float dispersion = uChromatic * 0.5;

  vec3 ink = vec3(0.0);
  vec3 cover = vec3(0.0);
  vec3 weight = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float k = 1.0 - float(i) / 3.0;
    vec4 tap = sampleText(rest + bend * (1.0 + dispersion * k) + split * k);
    vec3 band = vec3(max(k, 0.0), 1.0 - abs(k), max(-k, 0.0));
    ink += tap.rgb * band;
    cover += tap.a * band;
    weight += band;
  }
  ink /= weight;
  cover /= weight;
  float a = max(max(cover.r, cover.g), cover.b);
  vec3 color = ink + (a - cover) * uBackdrop;
  color = min(color + (lens + shockLight * 0.5) * cover.g * 0.055, vec3(a));
  fragColor = vec4(color, a) * uReveal;
}
`;

const measureLine = (ctx, line, letterSpacing = 0) => {
  if (!letterSpacing) return ctx.measureText(line).width;
  const chars = Array.from(line);
  const textWidth = chars.reduce((width, char) => width + ctx.measureText(char).width, 0);
  return textWidth + Math.max(0, chars.length - 1) * letterSpacing;
};

const wrapText = (ctx, text, maxWidth, letterSpacing = 0) => {
  const rawLines = String(text).replace(/\r\n/g, '\n').split('\n');
  const wrapped = [];

  rawLines.forEach(rawLine => {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push('');
      return;
    }

    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + ' ' + word;
      const testWidth = measureLine(ctx, testLine, letterSpacing);
      if (testWidth <= maxWidth + 4) {
        currentLine = testLine;
      } else {
        wrapped.push(currentLine);
        currentLine = word;
      }
    }
    wrapped.push(currentLine);
  });

  return wrapped;
};

const drawLine = (ctx, line, x, y, letterSpacing = 0, align = 'center') => {
  if (!letterSpacing) {
    ctx.textAlign = align;
    ctx.fillText(line, x, y);
    return;
  }
  const chars = Array.from(line);
  const lineLen = measureLine(ctx, line, letterSpacing);
  let cursor = align === 'center' ? x - lineLen / 2 : (align === 'right' ? x - lineLen : x);
  ctx.textAlign = 'left';
  chars.forEach((char, index) => {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + (index === chars.length - 1 ? 0 : letterSpacing);
  });
};

const buildTextCanvas = ({ container, width, height, dpr, padX, padY, props }) => {
  const totalW = Math.max(1, Math.floor((width + padX * 2) * dpr));
  const totalH = Math.max(1, Math.floor((height + padY * 2) * dpr));
  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;

  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, ink: props.color || '#FFFFFF' };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width + padX * 2, height + padY * 2);

  const computed = window.getComputedStyle(container);
  const text = props.text || container.getAttribute('data-text') || container.textContent.trim();
  const fontFamily = props.fontFamily || computed.fontFamily || 'Poppins, sans-serif';
  const fontWeight = props.fontWeight || computed.fontWeight || '700';

  // EXACT ORIGINAL FONT SIZE - NEVER SCALED DOWN
  const fontSizePx = props.fontSize
    ? parseFloat(props.fontSize)
    : parseFloat(computed.fontSize) || 24;

  let letterSpacing = computed.letterSpacing === 'normal' ? 0 : parseFloat(computed.letterSpacing) || 0;
  let lineHeight = parseFloat(computed.lineHeight);
  if (!Number.isFinite(lineHeight)) lineHeight = fontSizePx * 1.35;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
  ctx.textBaseline = 'middle';

  let ink = props.color || computed.color || '#FFFFFF';

  if (props.shadowColor) {
    ctx.shadowColor = props.shadowColor;
    ctx.shadowBlur = props.shadowBlur || 20;
  }

  const align = props.textAlign || computed.textAlign || 'center';

  // Check if multi-color segments are provided (e.g. "I am " + "VENOM")
  if (props.segments && Array.isArray(props.segments)) {
    let totalSegmentsWidth = 0;
    const segs = props.segments.map(s => {
      const w = measureLine(ctx, s.text, letterSpacing);
      totalSegmentsWidth += w;
      return { ...s, width: w };
    });

    const startY = padY + height / 2;
    let cursor = align === 'center' ? (padX + (width - totalSegmentsWidth) / 2) : padX;

    segs.forEach(s => {
      ctx.fillStyle = s.color || ink;
      drawLine(ctx, s.text, cursor, startY, letterSpacing, 'left');
      cursor += s.width;
    });

    return { canvas, ink };
  }

  // Handle single-line vs multi-line text
  const isSingleLine = props.singleLine || props.multiline === false;
  const lines = isSingleLine ? [text] : wrapText(ctx, text, width, letterSpacing);

  // Gradient support
  if (props.gradientColors && Array.isArray(props.gradientColors)) {
    let gradStartX = padX;
    let gradEndX = padX + width;
    if (align === 'center' && isSingleLine) {
      const textW = measureLine(ctx, text, letterSpacing);
      gradStartX = padX + (width - textW) / 2;
      gradEndX = gradStartX + textW;
    }
    const grad = ctx.createLinearGradient(gradStartX, 0, gradEndX, 0);
    props.gradientColors.forEach((col, idx) => {
      grad.addColorStop(idx / (props.gradientColors.length - 1), col);
    });
    ctx.fillStyle = grad;
    ink = props.gradientColors[0];
  } else {
    ctx.fillStyle = ink;
  }

  const startY = padY + height / 2 - (lineHeight * (lines.length - 1)) / 2;
  const startX = align === 'left' ? padX : (padX + width / 2);

  lines.forEach((line, index) => {
    drawLine(ctx, line, startX, startY + index * lineHeight, letterSpacing, align);
  });

  return { canvas, ink };
};

export function initWarpText(container, userOptions = {}) {
  if (typeof container === 'string') container = document.querySelector(container);
  if (!container) return null;

  // Cleanup any previous instance on this container
  if (container._warpInstance && typeof container._warpInstance.destroy === 'function') {
    container._warpInstance.destroy();
  }

  // Strict mobile & touch guard: Never run WebGL text effects on mobile/touch screens
  const isTouch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const isSmall = typeof window !== 'undefined' && window.innerWidth < 1024;
  const isMobileUA = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isTouch || isSmall || isMobileUA) {
    return null;
  }

  const props = {
    text: userOptions.text || container.getAttribute('data-text') || container.textContent.trim(),
    color: userOptions.color,
    gradientColors: userOptions.gradientColors,
    segments: userOptions.segments,
    shadowColor: userOptions.shadowColor,
    shadowBlur: userOptions.shadowBlur,
    fontSize: userOptions.fontSize,
    fontWeight: userOptions.fontWeight,
    fontFamily: userOptions.fontFamily || 'Poppins, sans-serif',
    letterSpacing: userOptions.letterSpacing || '-0.02em',
    lineHeight: userOptions.lineHeight,
    warpStrength: userOptions.warpStrength ?? 0.15,
    warpScale: userOptions.warpScale ?? 1.2,
    speed: userOptions.speed ?? 0.85,
    pointerInfluence: userOptions.pointerInfluence ?? 0.52,
    pointerStrength: userOptions.pointerStrength ?? 0.50,
    refraction: userOptions.refraction ?? 0.026,
    chromatic: userOptions.chromatic ?? 0.05,
    ripple: userOptions.ripple !== false,
    clickRipple: userOptions.clickRipple !== false,
    idleDrift: userOptions.idleDrift ?? 0.65,
    lens: userOptions.lens || 'bulge',
    intro: userOptions.intro ?? false,
    textAlign: userOptions.textAlign,
    singleLine: userOptions.singleLine ?? false,
    multiline: userOptions.multiline,
    padX: userOptions.padX,
    padY: userOptions.padY
  };

  const isHeading = props.singleLine || container.classList.contains('warp-heading');
  const padX = props.padX ?? (isHeading ? 20 : 10);
  const padY = props.padY ?? (isHeading ? 16 : 8);

  let renderer, gl, program, geometry, mesh, texture;
  let raf = 0;
  let alive = true;
  let visible = true;
  let textReady = false;
  let renderedFrames = 0;
  let introProgress = props.intro ? 0 : 1;
  let lastFrame = 0;

  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: 0, activeTarget: 0 };
  const clicks = Array.from({ length: MAX_CLICKS }, () => [0.5, 0.5, 0, 0]);
  let clickSlot = 0;
  const startTime = performance.now();

  try {
    renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    });
    gl = renderer.gl;
  } catch (err) {
    console.warn('WarpText: WebGL2 error', err);
    return null;
  }

  gl.clearColor(0, 0, 0, 0);
  const canvas = gl.canvas;
  canvas.className = 'warptext-canvas';
  canvas.style.position = 'absolute';
  canvas.style.top = `-${padY}px`;
  canvas.style.left = `-${padX}px`;
  canvas.style.display = 'block';
  canvas.style.cursor = 'pointer';
  canvas.style.pointerEvents = 'auto';
  canvas.style.zIndex = '2';
  canvas.style.background = 'transparent';
  container.appendChild(canvas);

  const onContextLost = (e) => {
    e.preventDefault();
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    if (canvas && canvas.parentNode === container) {
      container.removeChild(canvas);
    }
    container.classList.remove('warp-active');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  texture = new Texture(gl, {
    generateMipmaps: false,
    premultiplyAlpha: true,
    minFilter: gl.LINEAR,
    magFilter: gl.LINEAR,
    wrapS: gl.CLAMP_TO_EDGE,
    wrapT: gl.CLAMP_TO_EDGE
  });

  geometry = new Triangle(gl);
  program = new Program(gl, {
    vertex,
    fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTextTexture: { value: texture },
      uResolution: { value: new Float32Array([1, 1]) },
      uPointer: { value: new Float32Array([0.5, 0.5]) },
      uPointerActive: { value: 0 },
      uTime: { value: 0 },
      uWarpStrength: { value: props.warpStrength },
      uWarpScale: { value: props.warpScale },
      uSpeed: { value: props.speed },
      uPointerInfluence: { value: props.pointerInfluence },
      uPointerStrength: { value: props.pointerStrength },
      uRefraction: { value: props.refraction },
      uChromatic: { value: props.chromatic },
      uRipple: { value: props.ripple ? 1 : 0 },
      uMotion: { value: 1 },
      uLens: { value: LENS_MODES[props.lens] ?? 0 },
      uIntro: { value: 0 },
      uReveal: { value: 1 },
      uBackdrop: { value: 0 },
      uClicks: { value: clicks }
    }
  });

  mesh = new Mesh(gl, { geometry, program });

  const renderOnce = () => {
    if (!alive) return;
    renderer.render({ scene: mesh });
  };

  const rasterize = () => {
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const raster = buildTextCanvas({
      container,
      width: rect.width,
      height: rect.height,
      dpr,
      padX,
      padY,
      props
    });

    texture.image = raster.canvas;
    texture.needsUpdate = true;
    textReady = true;
    renderOnce();
  };

  const resize = () => {
    if (!alive) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const bufferW = Math.round(rect.width + padX * 2);
    const bufferH = Math.round(rect.height + padY * 2);

    canvas.style.top = `-${padY}px`;
    canvas.style.left = `-${padX}px`;
    canvas.style.width = `${bufferW}px`;
    canvas.style.height = `${bufferH}px`;

    renderer.dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setSize(bufferW, bufferH);
    program.uniforms.uResolution.value[0] = gl.drawingBufferWidth;
    program.uniforms.uResolution.value[1] = gl.drawingBufferHeight;
    rasterize();
  };

  const onPointerMove = event => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointer.tx = (event.clientX - rect.left) / rect.width;
    pointer.ty = 1 - (event.clientY - rect.top) / rect.height;
    pointer.activeTarget = 1;
  };

  const onPointerLeave = () => {
    pointer.activeTarget = 0;
  };

  const onPointerDown = event => {
    if (!props.clickRipple) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const click = clicks[clickSlot];
    clickSlot = (clickSlot + 1) % clicks.length;
    click[0] = (event.clientX - rect.left) / rect.width;
    click[1] = 1 - (event.clientY - rect.top) / rect.height;
    click[2] = 0;
    click[3] = 1;
  };

  const loop = now => {
    if (!alive || !visible || document.hidden) return;

    const elapsed = (now - startTime) * 0.001;
    const delta = lastFrame ? Math.min(now - lastFrame, 50) : 16;
    lastFrame = now;

    if (textReady && introProgress < 1) {
      introProgress = Math.min(1, introProgress + delta / INTRO_MS);
    }
    const settle = 1 - introProgress;

    const drift = Math.min(Math.max(props.idleDrift, 0), 1);
    const engaged = pointer.activeTarget > 0;
    const idleX = 0.5 + Math.sin(elapsed * 0.33) * (0.08 + drift * 0.2);
    const idleY = 0.5 + Math.cos(elapsed * 0.27) * (0.06 + drift * 0.2);
    const follow = 1 - Math.exp(-delta / (engaged ? 130 : 470));

    pointer.x += ((engaged ? pointer.tx : idleX) - pointer.x) * follow;
    pointer.y += ((engaged ? pointer.ty : idleY) - pointer.y) * follow;
    pointer.active += ((engaged ? 1 : drift) - pointer.active) * (1 - Math.exp(-delta / 270));

    clicks.forEach(click => {
      if (click[3] <= 0) return;
      click[2] += delta / 1000;
      if (click[2] > RIPPLE_LIFE) click[3] = 0;
    });

    program.uniforms.uPointer.value[0] = pointer.x;
    program.uniforms.uPointer.value[1] = pointer.y;
    program.uniforms.uPointerActive.value = pointer.active;
    program.uniforms.uTime.value = elapsed;
    program.uniforms.uIntro.value = settle * settle * settle;
    program.uniforms.uReveal.value = textReady ? 1 : 0;

    renderOnce();
    renderedFrames++;

    if (renderedFrames >= 1 && !container.classList.contains('warp-active')) {
      container.classList.add('warp-active');
    }

    raf = requestAnimationFrame(loop);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointerdown', onPointerDown);

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (alive) resize();
    });
  }

  resize();
  raf = requestAnimationFrame(loop);

  const instance = {
    destroy: () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      if (canvas.parentNode === container) container.removeChild(canvas);
      container.classList.remove('warp-active');
      delete container._warpInstance;
    }
  };

  container._warpInstance = instance;
  return instance;
}

if (typeof window !== 'undefined') {
  window.WarpText = { init: initWarpText };
}
