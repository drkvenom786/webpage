/**
 * Folder 3D Component (Vanilla JS adaptation of React Bits Folder)
 * Realistic 3D perspective folder with spring physics, drag & drop, and peek/zoom.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const STEP = 1 / 240;
  const PILE_TURN = [0.5, -1.1, 1.5, -0.7, 1.2, -1.6];
  const FLAP_REST = [
    { x: 0.16, rise: 0, r: 3 },
    { x: -0.17, rise: 0.05, r: -3.5 },
    { x: 0, rise: 0.1, r: 0.5 },
    { x: 0.25, rise: 0.08, r: 5 },
    { x: -0.25, rise: 0.09, r: -5.5 },
    { x: 0.08, rise: 0.12, r: 1.5 }
  ];
  const SPREAD_TURN = [4, -5, 3, -6, 5, -3];
  const SPREAD_DROP = [0.03, -0.04, 0.05, -0.02, 0.04, -0.05];
  const DROP_TURN = [-6, 4, -3, 7, -5, 3];
  const FLAP_ANGLES = { open: -64, receive: -30, peek: -15, rest: 0 };
  const LAYERS = { out: 50, drag: 80, focus: 90 };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const parseColor = value => {
    const text = String(value || '').trim();
    const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (hex) {
      const full = hex[1].length === 3 ? hex[1].replace(/./g, d => d + d) : hex[1];
      return [0, 2, 4].map(idx => parseInt(full.slice(idx, idx + 2), 16));
    }
    const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(text);
    if (rgb) return [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])];
    return [61, 139, 255];
  };

  const mixRgb = (rgb, target, amount) => rgb.map((channel, i) => Math.round(channel + (target[i] - channel) * amount));
  const rgbString = rgb => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const luma = rgb => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;

  const multiply = (a, b) => {
    const out = new Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
      }
    }
    return out;
  };

  const chain = (...list) => list.reduce(multiply);
  const move = (x, y, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const stretch = (x, y) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  const turnX = degrees => {
    const r = (degrees * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  };

  const turnY = degrees => {
    const r = (degrees * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  };

  const turnZ = degrees => {
    const r = (degrees * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  };

  const toCss = m => `matrix3d(${m.map(v => (Math.abs(v) < 1e-7 ? 0 : Number(v.toFixed(6)))).join(', ')})`;

  const measureFolder = (book, scale, labelWidth, hasLabel, tabPosition) => {
    const w = (book ? 180 : 230) * scale;
    const h = (book ? 232 : 180) * scale;
    const tabH = 22 * scale;
    const r = 14 * scale;
    const shoulder = tabH * 0.75;
    const frontTop = book ? tabH : tabH + h * 0.32;
    const corners = [r, r, r, r];
    const maxTab = w - corners[0] - corners[1] - shoulder * 2 - 10 * scale;
    const tabW = clamp(hasLabel ? labelWidth + 16 * scale + shoulder : w * 0.36, Math.min(w * 0.3, maxTab), maxTab);
    const tabX =
      tabPosition === 'left'
        ? corners[0] + 5 * scale + shoulder
        : tabPosition === 'center'
          ? (w - tabW) / 2
          : w - corners[1] - 5 * scale - shoulder - tabW;
    const docW = w * 0.58;
    return {
      book,
      scale,
      w,
      h,
      tabH,
      r,
      shoulder,
      corners,
      tabW,
      tabX,
      frontTop,
      frontH: tabH + h - frontTop,
      docW,
      docH: docW * 1.3
    };
  };

  const backPath = g => {
    const { w, h, tabX, tabW, tabH, shoulder } = g;
    const [tl, tr, br, bl] = g.corners;
    const top = tabH;
    const bottom = tabH + h;
    return [
      `M 0 ${top + tl}`,
      `Q 0 ${top} ${tl} ${top}`,
      `L ${tabX - shoulder} ${top}`,
      `C ${tabX} ${top} ${tabX} 0 ${tabX + shoulder} 0`,
      `L ${tabX + tabW - shoulder} 0`,
      `C ${tabX + tabW} 0 ${tabX + tabW} ${top} ${tabX + tabW + shoulder} ${top}`,
      `L ${w - tr} ${top}`,
      `Q ${w} ${top} ${w} ${top + tr}`,
      `L ${w} ${bottom - br}`,
      `Q ${w} ${bottom} ${w - br} ${bottom}`,
      `L ${bl} ${bottom}`,
      `Q 0 ${bottom} 0 ${bottom - bl}`,
      'Z'
    ].join(' ');
  };

  const placeFlap = (rank, count, phase, layout, g, pointer) => {
    const rest = FLAP_REST[rank] ?? FLAP_REST[FLAP_REST.length - 1];
    const floor = g.tabH + g.h - 5 * g.scale - g.docH / 2;
    const mid = (count - 1) / 2;
    if (phase === 'open') {
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
      const lift = g.tabH - g.h * (isMobile ? 0.08 : 0.04);
      const gap = (isMobile ? 8 : 16) * g.scale;
      const maxSpreadWidth = isMobile
        ? Math.min(window.innerWidth - 32, g.w * 2.2)
        : g.w * 2.5;
      const fit = Math.min(0.98, (maxSpreadWidth - gap * (count - 1)) / (count * g.docW));
      const step = Math.min(g.docW * fit + gap, maxSpreadWidth / Math.max(1, count - 0.5));
      const tidy = layout === 'row';
      return {
        x: g.w / 2 + (rank - mid) * step,
        y: lift + (tidy ? 0 : SPREAD_DROP[rank] * g.h * (isMobile ? 0.4 : 0.7)),
        z: 0,
        r: tidy ? 0 : SPREAD_TURN[rank] * (isMobile ? 0.35 : 0.55),
        ry: 0,
        s: fit
      };
    }
    const part = phase === 'receive' ? 1.7 : phase === 'peek' ? 1.3 : 1;
    const x = g.w / 2 + rest.x * g.w * part;
    if (phase === 'rest') return { x, y: floor - rest.rise * g.h, z: 0, r: rest.r, ry: 0, s: 1 };
    const near = phase === 'peek' && pointer != null ? Math.max(0, 1 - Math.abs(pointer - x) / (g.w * 0.32)) : 0;
    const rise = rest.rise + (phase === 'receive' ? 0.03 : 0.12);
    return { x, y: floor - rise * g.h - near * near * g.h * 0.11, z: 0, r: rest.r * 1.6, ry: 0, s: 1 };
  };

  function initFolder(container, options = {}) {
    if (!container) return null;

    const label = options.label || 'Projects';
    const variant = options.variant || 'glass';
    const color = options.color || '#A855F7';
    const paperColor = options.paperColor || '#121212';
    const tabPosition = options.tabPosition || 'right';
    const layout = options.layout || 'spread';
    const baseScale = Math.max(0.3, Number(options.size) || 1.6);
    const getResponsiveScale = (base) => {
      if (typeof window === 'undefined') return base;
      const w = window.innerWidth;
      if (w < 400) return Math.min(base, 0.95);
      if (w < 500) return Math.min(base, 1.08);
      if (w < 640) return Math.min(base, 1.22);
      if (w < 1024) return Math.min(base, 1.45);
      return base;
    };
    let scale = getResponsiveScale(baseScale);
    const openOn = options.openOn || 'click';
    let isOpen = options.defaultOpen !== undefined ? options.defaultOpen : false;
    const draggable = options.draggable !== false;
    const zoomOnClick = options.zoomOnClick !== false;
    const peek = options.peek !== false;
    const intro = options.intro !== false;
    const tilt = clamp(options.tilt ?? 0.5, 0, 1.5);
    const bounce = clamp(options.bounce ?? 0.4, 0, 1);
    const speed = clamp(options.speed ?? 1, 0.2, 3);
    const frost = clamp(options.frost ?? 0.3, 0, 1);
    const closeOnOutsideClick = options.closeOnOutsideClick !== false;
    const itemsData = options.items || [];
    const count = Math.min(itemsData.length, 6);

    const rgb = parseColor(color);
    const paper = parseColor(paperColor);
    const backTone = mixRgb(rgb, [0, 0, 0], 0.16);
    const insideTop = rgbString(mixRgb(rgb, [0, 0, 0], 0.08));
    const insideBottom = rgbString(backTone);

    // Measure label width estimate
    let labelWidth = label ? label.length * 8 * scale : 60 * scale;
    let g = measureFolder(false, scale, labelWidth, Boolean(label), tabPosition);
    let total = g.tabH + g.h;
    let shape = backPath(g);

    // Build DOM
    container.innerHTML = `
      <div class="folder-root" data-mode="flap" data-variant="${variant}" data-theme="dark" ${isOpen ? 'data-open=""' : ''} ${draggable ? 'data-draggable=""' : ''} style="
        --folder-rgb: ${rgb.join(', ')};
        --folder-base: ${rgbString(rgb)};
        --folder-front-top: ${rgbString(mixRgb(rgb, [255, 255, 255], 0.12))};
        --folder-front-bottom: ${rgbString(mixRgb(rgb, [0, 0, 0], 0.06))};
        --folder-inside-top: ${insideTop};
        --folder-inside-bottom: ${insideBottom};
        --folder-tab-ink: ${luma(backTone) > 0.6 ? 'rgba(0, 0, 0, 0.72)' : 'rgba(255, 255, 255, 0.95)'};
        --folder-paper: ${rgbString(paper)};
        --folder-w: ${g.w}px;
        --folder-h: ${g.h}px;
        --folder-tab-h: ${g.tabH}px;
        --folder-front-y: ${g.frontTop}px;
        --folder-front-h: ${g.frontH}px;
        --folder-r: ${g.r}px;
        --folder-front-radius: ${g.r}px;
        --folder-doc-w: ${g.docW}px;
        --folder-doc-h: ${g.docH}px;
        --folder-frost: ${(1.5 + frost * 10) * scale}px;
        --folder-depth: ${Math.round(Math.max(g.w, g.h) * 5)}px;
        --folder-scale: ${scale};
      ">
        <div class="folder-stage" role="button" tabindex="0" aria-expanded="${isOpen}">
          <span class="folder-layer folder-ground" aria-hidden="true"></span>
          <div class="folder-layer folder-back" aria-hidden="true">
            <div class="folder-back-fill" style="clip-path: path('${shape}')"></div>
            <svg class="folder-back-rim" width="${g.w}" height="${total}" viewBox="0 0 ${g.w} ${total}">
              <path class="folder-focus" d="${shape}"></path>
            </svg>
            ${label ? `<span class="folder-tab-text" style="left: ${g.tabX}px; width: ${g.tabW}px;">${label}</span>` : ''}
          </div>
          <div class="folder-items-container"></div>
          <div class="folder-layer folder-front" data-face="outer" aria-hidden="true">
            <div class="folder-face folder-face-outer"></div>
          </div>
        </div>
      </div>
    `;

    const root = container.querySelector('.folder-root');
    const stage = container.querySelector('.folder-stage');
    const groundRef = container.querySelector('.folder-ground');
    const backRef = container.querySelector('.folder-back');
    const frontRef = container.querySelector('.folder-front');
    const itemsContainer = container.querySelector('.folder-items-container');

    const itemRefs = [];
    itemsData.slice(0, count).forEach((item, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'folder-layer folder-item';
      itemEl.setAttribute('data-folder-item', index);
      itemEl.setAttribute('role', 'button');
      itemEl.setAttribute('tabindex', '0');

      if (item.html) {
        itemEl.innerHTML = item.html;
      } else {
        itemEl.innerHTML = `
          <div class="folder-project-card">
            <div class="folder-project-icon" style="border: 2px solid ${item.accentColor || '#A855F7'}; background: ${item.accentColor || '#A855F7'}15;">
              ${item.iconHtml || '<i class="fas fa-layer-group text-primary"></i>'}
            </div>
            <h4 class="folder-project-title">${item.title}</h4>
            <div class="folder-project-rating">
              <i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i>
            </div>
            <p class="folder-project-desc">${item.description}</p>
            <a href="${item.url || '#'}" target="_blank" class="folder-project-btn" style="background: ${item.accentColor || '#A855F7'};">
              ${item.btnText || 'View Project'} <i class="fas fa-external-link-alt text-[9px]"></i>
            </a>
          </div>
        `;
      }

      itemsContainer.appendChild(itemEl);
      itemRefs.push(itemEl);
    });

    if (typeof global.Specular !== 'undefined' && typeof global.Specular.init === 'function') {
      global.Specular.init();
    }

    const spring = val => ({ value: val, velocity: 0 });
    const state = {
      raf: 0,
      last: 0,
      ready: false,
      hovered: false,
      pressed: false,
      pointerX: 0,
      pointerY: 0,
      deskX: 0,
      deskY: 0,
      hoveredItem: -1,
      phase: isOpen ? 'open' : 'rest',
      previous: 'rest',
      changedAt: 0,
      front: spring(isOpen ? FLAP_ANGLES.open : 0),
      rx: spring(0),
      ry: spring(0),
      lift: spring(0),
      squash: spring(1),
      items: [],
      focus: -1,
      drag: null,
      receiving: false,
      receiveUntil: 0,
      suppressClick: false,
      dropCount: 0,
      intro: { phase: intro ? 'wait' : 'done', start: 0 },
      anchor: spring(0),
      appear: 1
    };

    itemsData.slice(0, count).forEach(() => {
      state.items.push({
        x: spring(0),
        y: spring(0),
        z: spring(0),
        r: spring(0),
        ry: spring(0),
        s: spring(1),
        hover: spring(0),
        mx: spring(0),
        my: spring(0),
        alpha: spring(1),
        place: 'inside',
        rank: 0,
        layer: 'inside',
        elevated: false,
        insertUntil: 0,
        insertFrom: null,
        outX: 0,
        outY: 0,
        outR: 0,
        outS: 1,
        outOrder: 0,
        localX: 0,
        localY: 0,
        fresh: true
      });
    });

    const integrate = (item, target, omega, zeta, dt) => {
      const k = omega * omega;
      const d = 2 * zeta * omega;
      const steps = Math.max(1, Math.ceil(dt / STEP));
      const s = dt / steps;
      for (let i = 0; i < steps; i++) {
        item.velocity += (k * (target - item.value) - d * item.velocity) * s;
        item.value += item.velocity * s;
      }
      return Math.abs(target - item.value) > 0.01 || Math.abs(item.velocity) > 0.01;
    };

    const snap = (item, val) => {
      item.value = val;
      item.velocity = 0;
    };

    const toDesk = (clientX, clientY) => {
      const box = root.getBoundingClientRect();
      const kx = root.offsetWidth / (box.width || 1);
      const ky = root.offsetHeight / (box.height || 1);
      return [(clientX - box.left) * kx, (clientY - box.top) * ky];
    };

    const clipBounds = () => {
      const box = root.getBoundingClientRect();
      const kx = root.offsetWidth / (box.width || 1);
      const ky = root.offsetHeight / (box.height || 1);
      return {
        left: -box.left * kx,
        top: -box.top * ky,
        right: (window.innerWidth - box.left) * kx,
        bottom: (window.innerHeight - box.top) * ky
      };
    };

    const overFolder = (x, y) => x >= 0 && x <= g.w && y >= 0 && y <= g.tabH + g.h;

    const inPocket = item => {
      return (
        item.y.value + (g.docH * item.s.value) / 2 > g.frontTop + 4 * g.scale &&
        item.x.value + (g.docW * item.s.value) / 2 > 0 &&
        item.x.value - (g.docW * item.s.value) / 2 < g.w
      );
    };

    const velocityOf = samples => {
      if (samples.length < 2) return [0, 0];
      const first = samples[0];
      const last = samples[samples.length - 1];
      const span = Math.max(0.016, (last[0] - first[0]) / 1000);
      return [(last[1] - first[1]) / span, (last[2] - first[2]) / span];
    };

    const phaseOf = time => {
      if (isOpen) return 'open';
      if (state.receiving || time < state.receiveUntil) return 'receive';
      if (peek && state.hovered && !state.drag?.active) return 'peek';
      return 'rest';
    };

    const place = (rank, inside, phase) => {
      const pointer = state.hovered ? ((state.pointerX + 1) / 2) * g.w : null;
      return placeFlap(rank, inside, phase, layout, g, pointer);
    };

    const frame = now => {
      state.raf = 0;
      const time = now / 1000;
      const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
      state.last = now;
      const zeta = 1 - 0.72 * bounce;
      const frontOmega = TAU * 2 * speed;
      const itemOmega = TAU * 2.1 * speed;
      const soft = TAU * 1.6 * speed;
      const phase = phaseOf(time);

      if (phase !== state.phase) {
        state.previous = state.phase;
        state.phase = phase;
        state.changedAt = now;
      }
      const elapsed = (now - state.changedAt) / 1000;
      let busy = time < state.receiveUntil;

      const ranks = [];
      state.items.forEach((item, index) => {
        if (item.place === 'inside') ranks.push(index);
      });
      const inside = ranks.length;
      ranks.forEach((index, rank) => {
        state.items[index].rank = rank;
      });

      if (state.focus >= 0 && phase !== 'open' && state.items[state.focus]?.place === 'inside') state.focus = -1;

      const frontTarget = FLAP_ANGLES[phase];
      busy = integrate(state.front, frontTarget, frontOmega, zeta, dt) || busy;

      const engaged = state.hovered;
      busy = integrate(state.rx, engaged ? -state.pointerY * 8 * tilt : 0, soft, 1, dt) || busy;
      busy = integrate(state.ry, engaged ? state.pointerX * 10 * tilt : 0, soft, 1, dt) || busy;
      busy = integrate(state.lift, state.hovered && phase !== 'open' ? 1 : 0, soft, 1, dt) || busy;
      busy = integrate(state.squash, state.pressed ? 0.975 : 1, TAU * 3.2, 0.6, dt) || busy;

      const drag = state.drag?.active ? state.drag : null;
      const hover = state.hoveredItem;
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
      const focusScale = isMobile
        ? clamp((window.innerWidth * 0.88) / g.docW, 1.25, 2.5)
        : clamp(((g.tabH + g.h) * 1.25) / g.docH, 1.3, 2.2);
      const focusY = isMobile ? g.tabH + g.h * 0.42 : g.tabH + g.h * 0.35;

      state.items.forEach((item, index) => {
        if (item.fresh) {
          const start = place(item.rank, inside, 'rest');
          snap(item.x, start.x);
          snap(item.y, start.y);
          snap(item.r, start.r);
          item.fresh = false;
        }

        let target;
        let omega = itemOmega;
        let damping = zeta;
        let lift = 0;
        let fade = 1;

        if (state.focus === index) {
          target = { x: g.w / 2, y: focusY, z: 0, r: 0, ry: 0, s: focusScale };
          lift = 2.4;
          item.layer = 'focus';
        } else if (drag && drag.index === index) {
          const [vx] = velocityOf(drag.samples);
          target = {
            x: state.deskX + drag.grabX,
            y: state.deskY + drag.grabY,
            z: 0,
            r: clamp(vx * 0.012, -14, 14),
            ry: 0,
            s: drag.scale * 1.05
          };
          omega = TAU * 5;
          damping = 0.78;
          lift = 1.4;
          if (!item.elevated && !inPocket(item)) item.elevated = true;
          item.layer = item.elevated ? 'drag' : 'inside';
        } else if (item.place === 'out') {
          target = { x: item.outX, y: item.outY, z: 0, r: item.outR, ry: 0, s: item.outS };
          lift = hover === index ? 1 : 0.15;
          item.layer = 'out';
        } else {
          target = place(item.rank, inside, phase);
          item.elevated = false;
          item.layer = 'inside';
          if (phase === 'open') {
            lift = hover === index ? 1 : 0.2;
            if (hover === index) {
              target = { ...target, y: target.y - 8 * g.scale, r: target.r * 0.2, s: target.s * 1.05 };
            }
          }
        }

        busy = integrate(item.x, target.x, omega, damping, dt) || busy;
        busy = integrate(item.y, target.y, omega, damping, dt) || busy;
        busy = integrate(item.z, target.z, itemOmega, zeta, dt) || busy;
        busy = integrate(item.r, target.r, omega, damping, dt) || busy;
        busy = integrate(item.ry, target.ry, itemOmega, zeta, dt) || busy;
        busy = integrate(item.s, target.s, itemOmega, zeta, dt) || busy;
        busy = integrate(item.hover, lift, itemOmega, zeta, dt) || busy;
        busy = integrate(item.alpha, fade, TAU * 3 * speed, 1, dt) || busy;
      });

      write();
      if (busy || drag) state.raf = requestAnimationFrame(frame);
      else state.last = 0;
    };

    const write = () => {
      const pivotX = g.w / 2;
      const pivotY = g.tabH + g.h / 2;
      const theta = state.front.value;
      const angle = (theta * Math.PI) / 180;
      const zoom = (1 + state.lift.value * 0.012) * state.squash.value;

      const desk = chain(
        move(pivotX, pivotY),
        turnX(state.rx.value),
        turnY(state.ry.value),
        stretch(zoom, zoom),
        move(-pivotX, -pivotY)
      );

      const folder = desk;
      if (backRef) {
        backRef.style.transform = toCss(folder);
        backRef.style.setProperty('--folder-label', (1 - clamp((-theta - 18) / 26, 0, 1)).toFixed(3));
      }

      const frontMatrix = chain(folder, move(0, g.tabH + g.h, 2 * scale), turnX(theta), move(0, -g.frontH));
      const facing = Math.sin(angle) * 0.5 + Math.cos(angle) * 0.86;
      const light = facing / 0.86;
      const glint = clamp((light - 1) * 0.9, 0, 0.18);
      const dim = clamp((1 - light) * 0.22, 0, 0.5);

      if (frontRef) {
        frontRef.style.transform = toCss(frontMatrix);
        frontRef.style.setProperty('--folder-glint', glint.toFixed(3));
        frontRef.style.setProperty('--folder-dim', dim.toFixed(3));
      }

      if (groundRef) {
        groundRef.style.transform = toCss(multiply(folder, move(0, g.tabH + g.h)));
        groundRef.style.opacity = (0.75 + state.lift.value * 0.25).toFixed(3);
      }

      state.items.forEach((item, index) => {
        const node = itemRefs[index];
        const z = 3 * scale + item.z.value + item.hover.value * 26 * scale;
        const matrix = chain(
          desk,
          move(item.x.value, item.y.value, z),
          turnY(item.ry.value),
          turnZ(item.r.value),
          stretch(item.s.value, item.s.value),
          move(-g.docW / 2, -g.docH / 2)
        );
        let layer = 10 + count - item.rank;
        if (item.layer === 'inside' && state.phase === 'open' && state.hoveredItem === index) layer = 30;
        if (item.layer === 'out') layer = LAYERS.out + index;
        if (item.layer === 'drag') layer = LAYERS.drag;
        if (item.layer === 'focus') layer = LAYERS.focus;

        if (node) {
          node.style.transform = toCss(matrix);
          node.style.zIndex = String(layer);
          node.style.setProperty('--folder-lift', clamp(item.hover.value, 0, 2.4).toFixed(3));
          node.style.opacity = item.alpha.value < 0.995 ? Math.max(0, item.alpha.value).toFixed(3) : '';
        }
      });
    };

    const wake = () => {
      if (!state.raf) state.raf = requestAnimationFrame(frame);
    };

    const setFolderOpen = nextVal => {
      isOpen = Boolean(nextVal);
      if (isOpen) {
        root.setAttribute('data-open', '');
        stage.setAttribute('aria-expanded', 'true');
      } else {
        root.removeAttribute('data-open');
        stage.setAttribute('aria-expanded', 'false');
      }
      wake();
    };

    const toggle = () => {
      if (state.focus >= 0) {
        state.focus = -1;
        wake();
        return;
      }
      setFolderOpen(!isOpen);
    };

    // Events
    const onMove = event => {
      const drag = state.drag;
      if (drag && event.pointerId === drag.id) {
        const [x, y] = toDesk(event.clientX, event.clientY);
        state.deskX = x;
        state.deskY = y;
        const now = performance.now();
        drag.samples.push([now, x, y]);
        while (drag.samples.length > 2 && now - drag.samples[0][0] > 100) drag.samples.shift();
        if (!drag.active) {
          const threshold = event.pointerType === 'touch' ? 14 : 4;
          if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > threshold) {
            drag.active = true;
            drag.grabX = state.items[drag.index].x.value - drag.downX;
            drag.grabY = state.items[drag.index].y.value - drag.downY;
            drag.scale = state.items[drag.index].place === 'out' ? state.items[drag.index].outS : state.items[drag.index].s.value;
            drag.clip = clipBounds();
            state.suppressClick = true;
            if (state.focus === drag.index) state.focus = -1;
            state.items[drag.index].elevated = state.items[drag.index].place === 'out' || !inPocket(state.items[drag.index]);
            root.setAttribute('data-dragging', '');
          }
        }
        wake();
      }

      if (event.pointerType === 'touch') return;
      const box = root.getBoundingClientRect();
      state.pointerX = clamp(((event.clientX - box.left) / box.width) * 2 - 1, -1.5, 1.5);
      state.pointerY = clamp(((event.clientY - box.top) / box.height) * 2 - 1, -1.5, 1.5);

      const target = event.target.closest('[data-folder-item]');
      state.hoveredItem = target && root.contains(target) ? Number(target.getAttribute('data-folder-item')) : -1;

      if (!state.hovered) {
        state.hovered = true;
        if (openOn === 'hover') setFolderOpen(true);
      }
      wake();
    };

    const onLeave = event => {
      if (event.pointerType === 'touch' || state.drag?.active) return;
      state.hovered = false;
      state.pressed = false;
      state.hoveredItem = -1;
      if (openOn === 'hover') setFolderOpen(false);
      wake();
    };

    const onDown = event => {
      if (event.button > 0) return;
      state.suppressClick = false;
      const target = event.target.closest('[data-folder-item]');
      if (target && root.contains(target) && draggable) {
        if (event.target.closest('a')) return;
        const [x, y] = toDesk(event.clientX, event.clientY);
        state.deskX = x;
        state.deskY = y;
        state.drag = {
          index: Number(target.getAttribute('data-folder-item')),
          id: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          downX: x,
          downY: y,
          grabX: 0,
          grabY: 0,
          scale: 1,
          clip: null,
          active: false,
          samples: [[performance.now(), x, y]]
        };
      } else {
        state.pressed = true;
      }
      wake();
    };

    const onUp = event => {
      state.pressed = false;
      const drag = state.drag;
      if (drag && event.pointerId === drag.id) {
        state.drag = null;
        root.removeAttribute('data-dragging');
        if (drag.active) {
          const item = state.items[drag.index];
          if (item) {
            if (overFolder(state.deskX, state.deskY)) {
              item.place = 'inside';
              item.elevated = false;
            } else {
              const clip = drag.clip ?? clipBounds();
              item.place = 'out';
              item.elevated = true;
              item.outX = clamp(state.deskX + drag.grabX, clip.left + 50, clip.right - 50);
              item.outY = clamp(state.deskY + drag.grabY, clip.top + 50, clip.bottom - 50);
              item.outR = clamp(item.r.value * 0.5, -12, 12);
              item.outS = drag.scale;
            }
          }
        }
      }
      wake();
    };

    stage.addEventListener('click', event => {
      const itemEl = event.target.closest('[data-folder-item]');
      if (itemEl) {
        // If clicking on a link inside the card, allow default navigation!
        if (event.target.closest('a')) return;
        event.stopPropagation();
        if (state.suppressClick) {
          state.suppressClick = false;
          return;
        }
        const idx = Number(itemEl.getAttribute('data-folder-item'));
        if (zoomOnClick) {
          state.focus = state.focus === idx ? -1 : idx;
          wake();
        }
        return;
      }
      toggle();
    });

    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    document.addEventListener('pointerdown', event => {
      if (root.contains(event.target)) return;
      if (state.focus >= 0) {
        state.focus = -1;
        wake();
      }
      if (isOpen && closeOnOutsideClick) {
        setFolderOpen(false);
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (state.focus >= 0) {
          state.focus = -1;
          wake();
        } else if (isOpen && closeOnOutsideClick) {
          setFolderOpen(false);
        }
      }
    });

    // Intro scroll observer
    if (intro && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        entries => {
          if (entries.some(e => e.isIntersecting)) {
            observer.disconnect();
            setFolderOpen(true);
          }
        },
        { threshold: 0.25 }
      );
      observer.observe(root);
    }

    // Responsive layout auto-resize listener
    function updateLayoutMetrics() {
      scale = getResponsiveScale(baseScale);
      labelWidth = label ? label.length * 8 * scale : 60 * scale;
      g = measureFolder(false, scale, labelWidth, Boolean(label), tabPosition);
      total = g.tabH + g.h;
      shape = backPath(g);

      root.style.setProperty('--folder-w', `${g.w}px`);
      root.style.setProperty('--folder-h', `${g.h}px`);
      root.style.setProperty('--folder-tab-h', `${g.tabH}px`);
      root.style.setProperty('--folder-front-y', `${g.frontTop}px`);
      root.style.setProperty('--folder-front-h', `${g.frontH}px`);
      root.style.setProperty('--folder-r', `${g.r}px`);
      root.style.setProperty('--folder-front-radius', `${g.r}px`);
      root.style.setProperty('--folder-doc-w', `${g.docW}px`);
      root.style.setProperty('--folder-doc-h', `${g.docH}px`);
      root.style.setProperty('--folder-frost', `${(1.5 + frost * 10) * scale}px`);
      root.style.setProperty('--folder-depth', `${Math.round(Math.max(g.w, g.h) * 5)}px`);
      root.style.setProperty('--folder-scale', `${scale}`);

      const backFill = root.querySelector('.folder-back-fill');
      if (backFill) backFill.style.clipPath = `path('${shape}')`;
      const backRim = root.querySelector('.folder-back-rim');
      if (backRim) {
        backRim.setAttribute('width', String(g.w));
        backRim.setAttribute('height', String(total));
        backRim.setAttribute('viewBox', `0 0 ${g.w} ${total}`);
        const focusPath = backRim.querySelector('.folder-focus');
        if (focusPath) focusPath.setAttribute('d', shape);
      }
      wake();
    }

    let resizeTimer;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateLayoutMetrics, 100);
    };
    window.addEventListener('resize', onResize);

    wake();

    return {
      open: () => setFolderOpen(true),
      close: () => setFolderOpen(false),
      toggle: toggle,
      destroy: () => {
        cancelAnimationFrame(state.raf);
        window.removeEventListener('resize', onResize);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
        root.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
    };
  }

  global.Folder = {
    init: initFolder
  };
})(typeof window !== 'undefined' ? window : this);
