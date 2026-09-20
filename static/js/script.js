/* ==========================================================
   Graduation site v2 - script.js
   Fetches /api/site (texts in Arabic + English, photos, music)
   and builds the whole page. Arabic is the base language.
   ========================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const list = (x) => (Array.isArray(x) ? x : []);
  const hasArabic = (s) => /[\u0600-\u06FF]/.test(s || '');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  let RAW = null;   // whole config.json
  let DATA = null;  // full /api/site response
  let CFG = null;   // current language block, {placeholders} filled
  let isRTL = true;

  // things that must survive a language switch
  const state = {
    lang: 'ar', opened: false, switching: false,
    popped: new Set(), scratched: false, ps: false,
    termDone: false, termSeen: false, ach: new Set(), finaleRained: false,
  };

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */
  function make(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function setText(sel, text) {
    const n = typeof sel === 'string' ? $(sel) : sel;
    if (n) n.textContent = text == null ? '' : text;
    return n;
  }

  // reveal-on-scroll helper: rv(el, 'up' | 'side' | 'zoom' | 'clip', delaySeconds)
  function rv(el, kind = 'up', delay = 0) {
    el.classList.add('rv', 'rv-' + kind);
    el.style.setProperty('--d', delay + 's');
    return el;
  }

  // section titles: words rise in one by one (words, not letters, so Arabic keeps joining)
  function setHeading(sel, text) {
    const el = $(sel);
    if (!el) return;
    el.textContent = '';
    el.classList.add('rv', 'split');
    const words = String(text || '').split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      const s = make('span', 'w', w);
      s.style.setProperty('--w', i);
      el.append(s);
      if (i < words.length - 1) el.append(document.createTextNode(' '));
    });
  }

  function setSub(sel, text) {
    const el = setText(sel, text);
    if (el) rv(el, 'up', 0.25);
  }

  // Replace {name} {from} {year} ... everywhere in a config block
  function format(value, vars) {
    if (typeof value === 'string') return value.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    if (Array.isArray(value)) return value.map((v) => format(v, vars));
    if (value && typeof value === 'object') {
      const out = {};
      for (const k in value) out[k] = format(value[k], vars);
      return out;
    }
    return value;
  }

  // one shared, rAF-throttled scroll handler
  const scrollFns = [];
  let scrollTicking = false;
  const onScroll = (fn) => scrollFns.push(fn);
  const runScroll = () => scrollFns.forEach((f) => f());
  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => { runScroll(); scrollTicking = false; });
  }, { passive: true });
  window.addEventListener('resize', runScroll);

  // reveal observer (adds .rv-in the first time an element is visible)
  let revealIO = null;
  function observeReveals() {
    if (!revealIO) {
      revealIO = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add('rv-in'); revealIO.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    }
    $$('.rv').forEach((el) => { if (!el.classList.contains('rv-in')) revealIO.observe(el); });
  }

  /* ---------------------------------------------------------
     Language helpers
     --------------------------------------------------------- */
  const localeFor = (lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US');

  function birthDate() {
    const d = new Date((RAW.birth_date || '') + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  function ageParts(from, to = new Date()) {
    let y = to.getFullYear() - from.getFullYear();
    let m = to.getMonth() - from.getMonth();
    let d = to.getDate() - from.getDate();
    if (d < 0) { m--; d += new Date(to.getFullYear(), to.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return { y, m, d };
  }

  function buildCfg(lang) {
    const block = RAW[lang];
    const b = birthDate();
    let birthText = '';
    if (b) {
      try { birthText = b.toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric' }); }
      catch (e) { birthText = RAW.birth_date; }
    }
    CFG = format(block, {
      name: block.her_name || '', from: block.from_name || '', year: block.graduation_year || '',
      university: block.university || '', major: block.major || '',
      birth: birthText, age: b ? ageParts(b).y : '',
    });
  }

  /* ---------------------------------------------------------
     FX: confetti, tossed graduation caps, hearts (canvas)
     --------------------------------------------------------- */
  const FX = (() => {
    const canvas = $('#fx');
    const ctx = canvas.getContext('2d');
    const COLORS = ['#f7e5ae', '#e6bf6a', '#f2b5c4', '#d8688a', '#ffffff', '#9fb0ff'];
    let w = 0, h = 0, dpr = 1;
    let parts = [];
    let running = false;
    let last = 0;
    let rainUntil = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    function start() {
      if (running) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(tick);
    }

    function piece(x, y, vx, vy, decay, palette) {
      const pal = palette || COLORS;
      return {
        type: Math.random() < 0.28 ? 'dot' : 'rect',
        x, y, vx, vy,
        w: rand(6, 11), h: rand(4, 7),
        rot: rand(0, 6.28), vr: rand(-0.25, 0.25),
        wob: rand(0, 6.28), wobSpeed: rand(0.05, 0.2),
        color: pal[(Math.random() * pal.length) | 0],
        life: 1, decay, drag: 0.985, g: 0.18,
      };
    }

    function burst(x, y, n = 110, spread = 2.4, power = 1, palette) {
      if (reduceMotion) return;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const s = rand(5, 13) * power;
        parts.push(piece(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.004, 0.009), palette));
      }
      start();
    }

    function fireworks(n = 5) {
      if (reduceMotion) return;
      const sets = [['#f7e5ae', '#e6bf6a'], ['#f2b5c4', '#d8688a'], ['#ffffff', '#9fb0ff'], ['#f7e5ae', '#f2b5c4']];
      for (let i = 0; i < n; i++) {
        setTimeout(() => burst(rand(w * 0.15, w * 0.85), rand(h * 0.14, h * 0.5), 90, 6.283, 0.62, sets[i % sets.length]), i * 380);
      }
    }

    function capToss(n = 12) {
      if (reduceMotion) return;
      for (let i = 0; i < n; i++) {
        const g = 0.2;
        const apex = h * rand(0.5, 0.88);
        parts.push({
          type: 'cap',
          x: rand(w * 0.06, w * 0.94), y: h + 50,
          vx: rand(-2.2, 2.2), vy: -Math.sqrt(2 * g * apex),
          size: rand(38, 62), rot: rand(-0.6, 0.6), vr: rand(-0.07, 0.07),
          rose: Math.random() < 0.35,
          life: 1, decay: 0, drag: 1, g,
          delay: rand(0, 380),
        });
      }
      start();
    }

    function hearts(x, y, n = 5) {
      if (reduceMotion) return;
      for (let i = 0; i < n; i++) {
        parts.push({
          type: 'heart',
          x: x + rand(-16, 16), y: y + rand(-8, 8),
          vx: rand(-0.7, 0.7), vy: -rand(1.2, 2.6),
          size: rand(10, 20), rot: rand(-0.4, 0.4), vr: rand(-0.02, 0.02),
          color: Math.random() < 0.55 ? '#f2b5c4' : '#e6bf6a',
          life: 1, decay: rand(0.012, 0.02), drag: 0.995, g: -0.004,
          delay: i * 60,
        });
      }
      start();
    }

    function rain(ms = 3500) {
      if (reduceMotion) return;
      rainUntil = performance.now() + ms;
      start();
    }

    function celebrate() {
      capToss(10);
      fireworks(6);
      rain(3800);
    }

    function drawCap(p) {
      const s = p.size;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(s, s);
      const hi = p.rose ? '#f8d4de' : '#f7e5ae';
      const mid = p.rose ? '#d8688a' : '#b8893a';
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.moveTo(-0.3, 0.04); ctx.lineTo(-0.3, 0.22);
      ctx.quadraticCurveTo(0, 0.4, 0.3, 0.22); ctx.lineTo(0.3, 0.04); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.moveTo(0, -0.26); ctx.lineTo(0.62, 0.02); ctx.lineTo(0, 0.3); ctx.lineTo(-0.62, 0.02); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = mid; ctx.lineWidth = 0.03; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0.02); ctx.lineTo(0.46, 0.13); ctx.lineTo(0.46, 0.4); ctx.stroke();
      ctx.fillStyle = mid; ctx.fillRect(0.43, 0.38, 0.06, 0.12);
      ctx.restore();
    }

    function drawHeart(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = clamp(p.life * 1.4, 0, 1);
      ctx.scale(p.size / 20, p.size / 20);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.bezierCurveTo(-12, -2, -8, -12, 0, -6);
      ctx.bezierCurveTo(8, -12, 12, -2, 0, 6);
      ctx.fill();
      ctx.restore();
    }

    function drawConfetti(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = clamp(p.life * 1.6, 0, 1);
      ctx.fillStyle = p.color;
      if (p.type === 'dot') {
        ctx.beginPath(); ctx.arc(0, 0, p.w * 0.35, 0, 6.283); ctx.fill();
      } else {
        const flutter = 0.35 + 0.65 * Math.abs(Math.cos(p.wob));
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * flutter);
      }
      ctx.restore();
    }

    function tick(now) {
      const dt = Math.min(40, now - last);
      last = now;
      const k = dt / 16.667;
      ctx.clearRect(0, 0, w, h);

      if (now < rainUntil) {
        const n = Math.ceil(2 * k);
        for (let i = 0; i < n; i++) {
          parts.push(piece(rand(0, w), -12, rand(-1.2, 1.2), rand(1, 3.2), rand(0.0015, 0.003)));
        }
      }

      for (const p of parts) {
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.vx *= Math.pow(p.drag, k);
        p.vy = p.vy * Math.pow(p.drag, k) + p.g * k;
        p.x += p.vx * k; p.y += p.vy * k;
        p.rot += p.vr * k;
        if (p.wob !== undefined) p.wob += p.wobSpeed * k;
        p.life -= p.decay * k;
        if (p.type === 'cap') drawCap(p);
        else if (p.type === 'heart') drawHeart(p);
        else drawConfetti(p);
      }

      parts = parts.filter((p) => {
        if (p.type === 'cap') return !(p.y > h + 90 && p.vy > 0);
        return p.life > 0 && p.y < h + 40 && p.y > -80;
      });

      if (parts.length || now < rainUntil) requestAnimationFrame(tick);
      else { running = false; ctx.clearRect(0, 0, w, h); }
    }

    return { burst, fireworks, capToss, hearts, rain, celebrate };
  })();

  /* ---------------------------------------------------------
     Ambient sparkles (very light, behind the content)
     --------------------------------------------------------- */
  function startSparkles() {
    if (reduceMotion) return;
    const c = $('#sparkles');
    const ctx = c.getContext('2d');
    let w = 0, h = 0, dpr = 1, parts = [];

    const spawn = (anywhere) => ({
      x: Math.random() * w, y: anywhere ? Math.random() * h : h + 10,
      r: rand(0.4, 1.9), vy: -rand(0.04, 0.2), vx: rand(-0.05, 0.05),
      ph: rand(0, 6.28), sp: rand(0.0006, 0.002), gold: Math.random() < 0.7,
    });
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = clamp(Math.round((w * h) / 26000), 16, 44);
      parts = Array.from({ length: n }, () => spawn(true));
    };
    window.addEventListener('resize', resize);
    resize();

    const loop = (t) => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.y < -10) parts[i] = spawn(false);
        ctx.globalAlpha = 0.22 + 0.45 * (0.5 + 0.5 * Math.sin(t * p.sp + p.ph));
        ctx.fillStyle = p.gold ? '#f7e5ae' : '#f2b5c4';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------
     Achievement toasts (appear, stay a few seconds, disappear)
     --------------------------------------------------------- */
  const toastQueue = [];
  let toasting = false;

  function achieve(id) {
    if (state.ach.has(id)) return;
    const item = list(CFG.achievements?.items).find((i) => i.id === id);
    if (!item) return;
    state.ach.add(id);
    toastQueue.push(item);
    if (!toasting) nextToast();
  }

  function nextToast() {
    const it = toastQueue.shift();
    if (!it) { toasting = false; return; }
    toasting = true;
    const t = make('div', 'toast');
    const body = make('div', 'toast__body');
    body.append(make('div', 'toast__label', CFG.achievements?.label), make('div', 'toast__title', it.title), make('div', 'toast__text', it.text));
    t.append(make('div', 'toast__icon', it.icon), body);
    $('#toasts').append(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('is-in')));
    setTimeout(() => {
      t.classList.remove('is-in');
      t.classList.add('is-out');
      setTimeout(() => { t.remove(); nextToast(); }, 650);
    }, 4200);
  }

  /* ---------------------------------------------------------
     RENDER: UI labels, intro, hero
     --------------------------------------------------------- */
  function renderUI() {
    const ui = CFG.ui || {};
    setText('#lang-label', ui.switch_label);
    $('#music-toggle').setAttribute('aria-label', ui.music || 'Music');
    $('.lb__close').setAttribute('aria-label', ui.close || 'Close');
    $('.lb__prev').setAttribute('aria-label', ui.prev || 'Previous');
    $('.lb__next').setAttribute('aria-label', ui.next || 'Next');
    $('.lb__play').setAttribute('aria-label', ui.play || 'Autoplay');
    $('#lang-toggle').hidden = !(RAW.ar && RAW.en);
  }

  function renderIntro() {
    setText('#intro-line', CFG.intro?.line);
    setText('#open-btn-text', CFG.intro?.button);
  }

  let heroTimer = null;
  function renderHeroPhoto() {
    const box = $('#hero-img');
    clearInterval(heroTimer);
    box.textContent = '';
    box.classList.remove('is-empty');
    box.style.backgroundImage = '';

    let urls = list(DATA.hero_urls).slice();
    if (!urls.length) urls = DATA.gallery.slice(0, 4).map((g) => g.src); // no hero photo: borrow from gallery
    if (!urls.length) {
      box.classList.add('is-empty');
      box.textContent = [...(CFG.her_name || '')][0] || '\u2605';
      console.info('[hero] No hero photo found. Put one at static/images/hero.jpg');
      return;
    }
    const focus = RAW.hero_photo_focus || '50% 30%';
    const slides = urls.map((u, i) => {
      const s = make('div', 'slide' + (i === 0 ? ' is-active' : ''));
      s.style.backgroundImage = `url("${u}")`;
      s.style.backgroundPosition = focus;
      box.append(s);
      return s;
    });
    if (slides.length > 1 && !reduceMotion) {
      let k = 0;
      heroTimer = setInterval(() => {
        slides[k].classList.remove('is-active');
        slides[k].classList.add('is-prev');
        k = (k + 1) % slides.length;
        slides[k].classList.remove('is-prev');
        slides[k].classList.add('is-active');
      }, 4800);
    }
  }

  function renderHero() {
    const kicker = setText('#hero-kicker', CFG.hero?.kicker);
    if (kicker) kicker.classList.toggle('tracked', !hasArabic(kicker.textContent));
    const title = setText('#hero-title', CFG.hero?.title);
    if (title) title.classList.add('gold-text');
    setText('#hero-name', CFG.her_name);
    setText('#hero-sub', CFG.hero?.subtitle);
    setText('#chip-uni', CFG.university);
    setText('#chip-major', CFG.major);
    setText('#scroll-hint-text', CFG.hero?.scroll_hint);
    $('#hero-frame').setAttribute('aria-label', CFG.her_name || '');
    renderHeroPhoto();
  }

  /* ---------------------------------------------------------
     RENDER: journey
     --------------------------------------------------------- */
  function countUp(el, target, suffix = '', dur = 1600) {
    if (reduceMotion) { el.textContent = target + suffix; return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = clamp((now - t0) / dur, 0, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + (p >= 1 ? suffix : '');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let statsIO = null;
  function renderJourney() {
    const j = CFG.journey || {};
    setHeading('#journey-title', j.title);
    setSub('#journey-sub', j.subtitle);

    const stats = $('#stats');
    stats.textContent = '';
    const nums = [];
    list(j.stats).forEach((s, i) => {
      const box = rv(make('div', 'stat'), 'up', i * 0.12);
      const num = make('span', 'stat__num gold-text', '0');
      nums.push([num, Number(s.value) || 0, s.suffix || '']);
      box.append(num, make('span', 'stat__label', s.label));
      stats.append(box);
    });
    if (statsIO) statsIO.disconnect();
    if (nums.length) {
      statsIO = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          nums.forEach(([el, v, suf]) => countUp(el, v, suf));
          statsIO.disconnect();
        }
      }, { threshold: 0.4 });
      statsIO.observe(stats);
    }

    const tl = $('#timeline');
    tl.textContent = '';
    const fill = make('div', 'timeline__fill');
    tl.append(fill);
    list(j.items).forEach((it) => {
      const li = rv(make('li', 'tl-item'), 'side', 0);
      li.append(make('span', 'tl-dot'), make('div', 'tl-year', it.year), make('h3', 'tl-title', it.title), make('p', 'tl-text', it.text));
      tl.append(li);
    });
    timelineRefs = { tl, fill, items: $$('.tl-item', tl) };
  }

  let timelineRefs = null;
  onScroll(() => {
    if (!timelineRefs) return;
    const { tl, fill, items } = timelineRefs;
    const mid = window.innerHeight * 0.58;
    const rect = tl.getBoundingClientRect();
    fill.style.height = clamp(mid - rect.top - 8, 0, Math.max(0, rect.height - 8)) + 'px';
    items.forEach((li) => {
      const d = $('.tl-dot', li).getBoundingClientRect();
      li.classList.toggle('is-reached', d.top + 12 < mid);
    });
  });

  /* ---------------------------------------------------------
     RENDER: live age counter
     --------------------------------------------------------- */
  let ageTimer = null;
  function renderAge() {
    const sec = $('#age');
    clearInterval(ageTimer);
    const birth = birthDate();
    if (!birth) { sec.hidden = true; return; }
    sec.hidden = false;

    const a = CFG.age || {};
    setHeading('#age-title', a.title);
    setSub('#age-sub', a.subtitle);
    setText('#age-lead', a.lead);
    setText('#age-foot', a.foot);

    const p = ageParts(birth);
    const ymd = $('#age-ymd');
    ymd.textContent = '';
    [['y', p.y], ['m', p.m], ['d', p.d]].forEach(([k, v], i) => {
      const b = rv(make('div', 'age__ymd-item'), 'zoom', i * 0.12);
      b.append(make('span', 'age__big gold-text', String(v)), make('span', 'age__small', a.ymd?.[k]));
      ymd.append(b);
    });

    const grid = $('#age-grid');
    grid.textContent = '';
    const cells = {};
    ['days', 'hours', 'minutes', 'seconds'].forEach((k, i) => {
      const c = rv(make('div', 'age__cell'), 'zoom', 0.1 + i * 0.1);
      const v = make('span', 'age__val', '0');
      cells[k] = v;
      c.append(v, make('span', 'age__unit', a.units?.[k]));
      grid.append(c);
    });

    const nf = new Intl.NumberFormat('en-US');
    const tick = () => {
      const s = Math.floor((Date.now() - birth.getTime()) / 1000);
      cells.seconds.textContent = nf.format(s);
      cells.minutes.textContent = nf.format(Math.floor(s / 60));
      cells.hours.textContent = nf.format(Math.floor(s / 3600));
      cells.days.textContent = nf.format(Math.floor(s / 86400));
    };
    tick();
    ageTimer = setInterval(tick, 1000);
  }

  /* ---------------------------------------------------------
     RENDER: terminal (types itself when she reaches it)
     --------------------------------------------------------- */
  let termToken = 0;
  async function runTerminal(instant) {
    const token = ++termToken;
    const t = CFG.terminal || {};
    const body = $('#term-body');
    body.textContent = '';
    const lines = list(t.lines);
    body.style.minHeight = `calc(${lines.length} * 1.75em + 2.4rem)`;

    for (const ln of lines) {
      if (token !== termToken) return;
      const row = make('div', 'term__row term__' + (ln.type || 'out'));
      body.append(row);
      if (ln.type === 'cmd') {
        row.append(make('span', 'term__prompt', t.prompt || '$ '));
        const txt = make('span', 'term__text');
        row.append(txt);
        if (instant) txt.textContent = ln.text;
        else {
          for (const ch of ln.text) {
            if (token !== termToken) return;
            txt.textContent += ch;
            await sleep(rand(24, 58));
          }
          await sleep(320);
        }
      } else {
        row.textContent = (ln.type === 'ok' ? '\u2713 ' : '') + ln.text;
        if (!instant) await sleep(ln.type === 'ok' ? 520 : 380);
      }
    }
    if (token !== termToken) return;
    body.append(make('span', 'term__cursor'));
    state.termDone = true;
  }

  function renderTerminal() {
    const t = CFG.terminal || {};
    setHeading('#terminal-title', t.title);
    setSub('#terminal-sub', t.subtitle);
    setText('#term-title', t.window_title);
    rv($('#term'), 'up', 0.1);
    if (state.termDone) runTerminal(true);
    else if (state.termSeen) runTerminal(false);
    else { termToken++; $('#term-body').textContent = ''; }
  }

  /* ---------------------------------------------------------
     RENDER: gallery, film strip, lightbox
     --------------------------------------------------------- */
  const lb = {
    el: $('#lightbox'), img: $('#lb-img'), cap: $('#lb-caption'), count: $('#lb-count'),
    i: 0, isOpen: false, tx: 0, timer: null,
  };
  const captionOf = (item) => (CFG.gallery?.captions || {})[item.name] || '';

  function lbShow(i) {
    const items = DATA.gallery;
    if (!items.length) return;
    lb.i = (i + items.length) % items.length;
    const it = items[lb.i];
    const c = captionOf(it);
    lb.img.classList.remove('is-in');
    void lb.img.offsetWidth; // restart the entrance animation
    lb.img.src = it.src;
    lb.img.alt = c;
    lb.img.classList.add('is-in');
    lb.cap.textContent = c;
    lb.count.textContent = `${lb.i + 1} / ${items.length}`;
  }
  function lbStopPlay() {
    clearInterval(lb.timer);
    lb.timer = null;
    const btn = $('.lb__play');
    btn.setAttribute('aria-pressed', 'false');
    btn.firstElementChild.innerHTML = '&#9654;';
  }
  function lbTogglePlay() {
    if (lb.timer) { lbStopPlay(); return; }
    const btn = $('.lb__play');
    btn.setAttribute('aria-pressed', 'true');
    btn.firstElementChild.innerHTML = '&#10074;&#10074;';
    lb.timer = setInterval(() => lbShow(lb.i + 1), 3200);
  }
  function lbOpen(i) {
    lb.el.hidden = false; lb.isOpen = true;
    document.body.classList.add('is-locked', 'lb-open');
    lbShow(i);
    $('.lb__close').focus({ preventScroll: true });
  }
  function lbClose() {
    lbStopPlay();
    lb.el.hidden = true; lb.isOpen = false;
    document.body.classList.remove('is-locked', 'lb-open');
  }
  const lbLeft = () => { lbStopPlay(); lbShow(lb.i + (isRTL ? 1 : -1)); };
  const lbRight = () => { lbStopPlay(); lbShow(lb.i + (isRTL ? -1 : 1)); };

  function tilt(el) {
    if (!canHover || reduceMotion) return;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(800px) rotateY(${x * 9}deg) rotateX(${-y * 9}deg) scale(1.02)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  }

  function renderStrip() {
    const wrap = $('#strip');
    wrap.textContent = '';
    const items = DATA.gallery;
    if (!items.length) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const rows = items.length >= 5 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      let seq = r === 0 ? items.slice() : items.slice().reverse();
      while (seq.length < 8) seq = seq.concat(seq);
      const row = make('div', 'strip__row');
      const track = make('div', 'strip__track' + (r === 1 ? ' is-rev' : ''));
      track.style.animationDuration = Math.max(36, seq.length * 6) + 's';
      for (let copy = 0; copy < 2; copy++) {
        seq.forEach((it) => {
          const fig = make('figure', 'strip__item');
          const img = new Image();
          img.decoding = 'async';
          img.alt = '';
          if (it.width && it.height) img.style.aspectRatio = `${it.width} / ${it.height}`;
          img.src = it.src;
          fig.append(img);
          fig.addEventListener('click', () => lbOpen(items.indexOf(it)));
          track.append(fig);
        });
      }
      row.append(track);
      wrap.append(row);
    }
    rv(wrap, 'up', 0.1);
  }

  function renderGallery() {
    setHeading('#gallery-title', CFG.gallery?.title);
    setSub('#gallery-sub', CFG.gallery?.subtitle);
    const grid = $('#gallery-grid');
    grid.textContent = '';
    const items = DATA.gallery;
    renderStrip();

    if (!items.length) {
      console.info('[gallery] No photos found. Put photos in static/images/gallery/');
      [4 / 5, 1, 3 / 4, 5 / 4, 4 / 5, 1].forEach((r) => {
        const d = make('div', 'g-item g-item--empty', '\u2726');
        d.style.aspectRatio = String(r);
        grid.append(d);
      });
      return;
    }

    items.forEach((it, i) => {
      const cap = captionOf(it);
      const fig = rv(make('figure', 'g-item'), 'clip', (i % 3) * 0.12);
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');
      fig.setAttribute('aria-label', cap || `${CFG.ui?.photo || 'Photo'} ${i + 1}`);
      if (it.width && it.height) fig.style.aspectRatio = `${it.width} / ${it.height}`;

      const img = new Image();
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = cap;
      const done = () => fig.classList.add('is-loaded');
      img.addEventListener('load', done);
      img.addEventListener('error', done);
      img.src = it.src;
      if (img.complete && img.naturalWidth) done();

      fig.append(img);
      if (cap) fig.append(make('figcaption', '', cap));
      fig.addEventListener('click', () => lbOpen(i));
      fig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lbOpen(i); } });
      tilt(fig);
      grid.append(fig);
    });
  }

  /* ---------------------------------------------------------
     RENDER: then / now slider
     --------------------------------------------------------- */
  let tnIO = null;
  function renderThenNow() {
    const sec = $('#thennow');
    if (tnIO) tnIO.disconnect();
    if (!DATA.then_url || !DATA.now_url) { sec.hidden = true; return; }
    sec.hidden = false;
    const c = CFG.thennow || {};
    setHeading('#thennow-title', c.title);
    setSub('#thennow-sub', c.subtitle);

    const box = $('#tn-box');
    box.textContent = '';
    const tn = rv(make('div', 'tn'), 'zoom', 0.1);
    tn.style.setProperty('--pos', '50%');

    const imgNow = make('img', 'tn__img');
    imgNow.src = DATA.now_url; imgNow.alt = c.now || '';
    const imgThen = make('img', 'tn__img tn__top');
    imgThen.src = DATA.then_url; imgThen.alt = c.then || '';
    const line = make('span', 'tn__line');
    const knob = make('span', 'tn__knob', '\u2194');
    const tagL = make('span', 'tn__tag tn__tag--l', c.then);
    const tagR = make('span', 'tn__tag tn__tag--r', c.now);
    const range = make('input', 'tn__range');
    range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '50';
    range.setAttribute('aria-label', `${c.then || ''} / ${c.now || ''}`);
    const setPos = (v) => tn.style.setProperty('--pos', v + '%');
    range.addEventListener('input', () => setPos(range.value));
    tn.append(imgNow, imgThen, line, knob, tagL, tagR, range);
    box.append(tn);

    // one small sweep the first time it is visible, to show it can be dragged
    tnIO = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      tnIO.disconnect();
      if (reduceMotion) return;
      const t0 = performance.now();
      const dur = 2200;
      const step = (now) => {
        const p = clamp((now - t0) / dur, 0, 1);
        const v = 50 + Math.sin(p * Math.PI * 2) * 32 * (1 - p * 0.3);
        range.value = v; setPos(v);
        if (p < 1) requestAnimationFrame(step); else { range.value = 50; setPos(50); }
      };
      requestAnimationFrame(step);
    }, { threshold: 0.6 });
    tnIO.observe(tn);
  }

  /* ---------------------------------------------------------
     RENDER: reasons (flip cards)
     --------------------------------------------------------- */
  function renderReasons() {
    const r = CFG.reasons || {};
    setHeading('#reasons-title', r.title);
    setSub('#reasons-sub', r.subtitle);
    const grid = $('#reasons-grid');
    grid.textContent = '';
    list(r.items).forEach((it, i) => {
      const card = rv(make('div', 'flip'), 'zoom', (i % 3) * 0.12);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', 'false');
      const inner = make('div', 'flip__inner');
      const front = make('div', 'flip__face flip__front');
      front.append(make('div', 'flip__icon', it.icon), make('div', 'flip__title', it.title));
      const back = make('div', 'flip__face flip__back');
      back.append(make('p', '', it.text));
      inner.append(front, back);
      card.append(inner);
      const toggle = () => {
        const on = card.classList.toggle('is-flipped');
        card.setAttribute('aria-pressed', String(on));
      };
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      grid.append(card);
    });
  }

  /* ---------------------------------------------------------
     RENDER: balloons (pop -> wish appears -> wish disappears)
     --------------------------------------------------------- */
  const BALLOON_COLORS = [
    ['#f7e5ae', '#c8963f'], ['#f2b5c4', '#d8688a'], ['#9fb0ff', '#4a5bd0'], ['#ffd6a5', '#e08a3c'],
    ['#f8e1e6', '#e07a99'], ['#c9b8ff', '#7a5fd6'], ['#ffe7a0', '#d9a030'],
  ];

  function updateBalloonCount() {
    const b = CFG.balloons || {};
    const total = list(b.wishes).length;
    const n = state.popped.size;
    setText('#balloon-count', (b.count || '{n} / {total}').replace('{n}', n).replace('{total}', total));
    const done = total > 0 && n >= total;
    const msg = $('#balloon-done');
    msg.hidden = !done;
    if (done) msg.textContent = b.done || '';
    $('#balloon-count').hidden = done;
  }

  function popBalloon(el, i, text) {
    if (state.popped.has(i)) return;
    state.popped.add(i);
    const r = el.getBoundingClientRect();
    FX.burst(r.left + r.width / 2, r.top + r.height * 0.4, 46, 6.283, 0.55, BALLOON_COLORS[i % BALLOON_COLORS.length].concat(['#ffffff']));

    const stage = $('#balloon-stage');
    const sr = stage.getBoundingClientRect();
    const bub = make('div', 'wish', text);
    bub.style.left = clamp(r.left - sr.left + r.width / 2, 110, Math.max(110, sr.width - 110)) + 'px';
    bub.style.top = (r.top - sr.top) + 'px';
    stage.append(bub);
    setTimeout(() => bub.remove(), 4300);

    el.classList.add('is-pop');
    setTimeout(() => el.classList.add('is-gone'), 380);
    updateBalloonCount();
    if (state.popped.size >= list(CFG.balloons?.wishes).length) {
      setTimeout(() => { FX.rain(2600); FX.capToss(6); }, 500);
    }
  }

  function renderBalloons() {
    const b = CFG.balloons || {};
    setHeading('#balloons-title', b.title);
    setSub('#balloons-sub', b.subtitle);
    const stage = $('#balloon-stage');
    stage.textContent = '';
    list(b.wishes).forEach((w, i) => {
      const [c1, c2] = BALLOON_COLORS[i % BALLOON_COLORS.length];
      const el = rv(make('button', 'balloon'), 'up', i * 0.1);
      el.type = 'button';
      el.style.setProperty('--c', c1);
      el.style.setProperty('--c2', c2);
      el.style.setProperty('--bob', (4 + (i % 4) * 0.7) + 's');
      el.style.setProperty('--bd', (-i * 0.6) + 's');
      el.setAttribute('aria-label', String(i + 1));
      if (state.popped.has(i)) el.classList.add('is-gone');
      el.addEventListener('click', () => popBalloon(el, i, w));
      stage.append(el);
    });
    updateBalloonCount();
  }

  /* ---------------------------------------------------------
     RENDER: scratch card
     --------------------------------------------------------- */
  function renderScratch() {
    const s = CFG.scratch || {};
    setHeading('#scratch-title', s.title);
    setSub('#scratch-sub', s.subtitle);
    setText('#scratch-reveal-title', s.reveal_title);
    setText('#scratch-reveal-text', s.reveal_text);

    const card = $('#scratch-card');
    rv(card, 'zoom', 0.1);
    const under = $('#scratch-under');
    if (DATA.secret_url) {
      under.style.backgroundImage = `url("${DATA.secret_url}")`;
      under.classList.add('has-photo');
    } else {
      under.style.backgroundImage = '';
      under.classList.remove('has-photo');
    }

    const canvas = $('#scratch-canvas');
    if (state.scratched) { card.classList.add('is-revealed'); canvas.hidden = true; return; }
    card.classList.remove('is-revealed');
    canvas.hidden = false;

    const W = Math.max(260, card.clientWidth || 320);
    const H = Math.max(160, card.clientHeight || Math.round(W * 0.625));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // gold foil
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#b8893a'); g.addColorStop(0.3, '#f7e5ae'); g.addColorStop(0.55, '#e6bf6a'); g.addColorStop(0.8, '#f7e5ae'); g.addColorStop(1, '#b8893a');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '120,80,20'},${rand(0.04, 0.14)})`;
      ctx.fillRect(rand(0, W), rand(0, H), rand(1, 3), rand(1, 3));
    }
    ctx.fillStyle = 'rgba(70,45,8,.75)';
    ctx.font = `700 ${Math.round(clamp(W / 11, 20, 34))}px "Reem Kufi", "Amiri", serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.hint || '', W / 2, H / 2);

    let drawing = false;
    let lx = 0, ly = 0;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
    };
    const erase = (x, y) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = clamp(W / 8, 30, 54);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke();
      lx = x; ly = y;
    };
    const cleared = () => {
      try {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let clear = 0, total = 0;
        for (let i = 3; i < data.length; i += 4 * 64) { total++; if (data[i] < 40) clear++; }
        return total ? clear / total : 0;
      } catch (err) { return 0; }
    };
    const reveal = () => {
      state.scratched = true;
      card.classList.add('is-revealed');
      setTimeout(() => { canvas.hidden = true; }, 1100);
      const r = card.getBoundingClientRect();
      FX.burst(r.left + r.width / 2, r.top + r.height / 2, 100, 3.2);
      FX.hearts(r.left + r.width / 2, r.top + r.height / 2, 8);
    };
    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      [lx, ly] = pos(e);
      erase(lx + 0.1, ly + 0.1);
    });
    canvas.addEventListener('pointermove', (e) => { if (drawing) { const [x, y] = pos(e); erase(x, y); } });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      if (cleared() > 0.5) reveal();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /* ---------------------------------------------------------
     RENDER: letter + wax seal (click to reveal the P.S.)
     --------------------------------------------------------- */
  function renderLetter() {
    const l = CFG.letter || {};
    setText('#letter-title', l.title);
    setText('#letter-greeting', l.greeting);
    const body = $('#letter-body');
    body.textContent = '';
    list(l.paragraphs).forEach((p, i) => body.append(rv(make('p', '', p), 'up', i * 0.1)));
    setText('#letter-closing', l.closing);
    setText('#letter-signature', l.signature);
    setText('#letter-ps', l.ps);
    setText('#wax-letter', [...(CFG.from_name || '')][0] || '\u2665');
    setText('#wax-hint', CFG.ui?.seal_hint);
    rv($('.paper-wrap'), 'up', 0);
    $('#paper').classList.toggle('is-ps', state.ps);
    $('#wax').classList.toggle('is-cracked', state.ps);
    $('#wax').setAttribute('aria-expanded', String(state.ps));
  }

  function toggleSeal() {
    state.ps = !state.ps;
    $('#paper').classList.toggle('is-ps', state.ps);
    const wax = $('#wax');
    wax.classList.toggle('is-cracked', state.ps);
    wax.setAttribute('aria-expanded', String(state.ps));
    if (state.ps) {
      const r = wax.getBoundingClientRect();
      FX.hearts(r.left + r.width / 2, r.top + r.height / 2, 10);
      FX.burst(r.left + r.width / 2, r.top + r.height / 2, 50, 3, 0.7, ['#f2b5c4', '#d8688a', '#f7e5ae']);
    }
  }

  /* ---------------------------------------------------------
     RENDER: finale
     --------------------------------------------------------- */
  function renderFinale() {
    const f = CFG.finale || {};
    const title = setText('#finale-title', f.title);
    if (title) title.classList.add('gold-text');
    setText('#finale-text', f.text);
    setText('#celebrate-text', f.button);
    setText('#top-text', f.top);
    setText('#footer', CFG.footer);
  }

  /* ---------------------------------------------------------
     Render everything (also used when switching language)
     --------------------------------------------------------- */
  function renderAll() {
    renderUI();
    renderIntro();
    renderHero();
    renderJourney();
    renderAge();
    renderTerminal();
    renderGallery();
    renderThenNow();
    renderReasons();
    renderBalloons();
    renderScratch();
    renderLetter();
    renderFinale();
    observeReveals();
    runScroll();
  }

  function applyLang(lang) {
    state.lang = lang;
    buildCfg(lang);
    const html = document.documentElement;
    html.lang = CFG.lang || lang;
    html.dir = CFG.dir || (lang === 'ar' ? 'rtl' : 'ltr');
    isRTL = html.dir === 'rtl';
    document.title = CFG.page_title || document.title;
  }

  function captureAnchor() {
    if (!state.opened) return null;
    const secs = $$('#site > header, #site > section').filter((s) => !s.hidden);
    const line = window.innerHeight * 0.3;
    for (const s of secs) {
      const r = s.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) return { id: s.id, frac: (line - r.top) / Math.max(1, r.height) };
    }
    return null;
  }
  function restoreAnchor(a) {
    if (!a) return;
    const el = document.getElementById(a.id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY + a.frac * el.offsetHeight - window.innerHeight * 0.3;
    window.scrollTo({ top, behavior: 'instant' });
  }

  async function switchLang() {
    if (state.switching) return;
    const to = state.lang === 'ar' ? 'en' : 'ar';
    if (!RAW[to]) return;
    state.switching = true;
    const anchor = captureAnchor();
    document.body.classList.add('is-switching');
    await sleep(340);
    applyLang(to);
    try { localStorage.setItem('jana_lang', to); } catch (e) { /* private mode */ }
    renderAll();
    restoreAnchor(anchor);
    await sleep(60);
    document.body.classList.remove('is-switching');
    state.switching = false;
    runScroll();
  }

  /* ---------------------------------------------------------
     Music + opening the surprise
     --------------------------------------------------------- */
  let audio = null;
  function setupMusic() {
    if (!DATA.music_url) return;
    audio = new Audio(DATA.music_url);
    audio.loop = true;
    audio.volume = 0.6;
    audio.preload = 'auto';
    const btn = $('#music-toggle');
    const sync = () => {
      const playing = !audio.paused;
      btn.classList.toggle('is-playing', playing);
      btn.setAttribute('aria-pressed', String(playing));
    };
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    btn.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  }

  function openSurprise() {
    if (state.opened) return;
    state.opened = true;
    $('#intro').classList.add('is-open');
    document.body.classList.remove('is-locked');
    document.body.classList.add('is-ready');
    window.scrollTo(0, 0);

    if (audio) {
      audio.play().catch(() => {});
      $('#music-toggle').hidden = false;
    }
    setTimeout(() => {
      FX.capToss(14);
      FX.burst(window.innerWidth / 2, window.innerHeight * 0.6, 120, 2.6);
      FX.fireworks(3);
    }, 700);
    setTimeout(() => { $('#intro').hidden = true; runScroll(); }, 2300);
    setTimeout(() => achieve('hero'), 3600);
  }

  /* ---------------------------------------------------------
     One-time wiring (static elements that never get re-created)
     --------------------------------------------------------- */
  function setupOnce() {
    // lightbox
    $('.lb__close').addEventListener('click', lbClose);
    $('.lb__play').addEventListener('click', lbTogglePlay);
    $('.lb__prev').addEventListener('click', lbLeft);
    $('.lb__next').addEventListener('click', lbRight);
    lb.el.addEventListener('click', (e) => { if (e.target === lb.el) lbClose(); });
    document.addEventListener('keydown', (e) => {
      if (!lb.isOpen) return;
      if (e.key === 'Escape') lbClose();
      else if (e.key === 'ArrowLeft') lbLeft();
      else if (e.key === 'ArrowRight') lbRight();
    });
    lb.el.addEventListener('touchstart', (e) => { lb.tx = e.changedTouches[0].clientX; }, { passive: true });
    lb.el.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - lb.tx;
      if (Math.abs(dx) < 50) return;
      if (dx < 0) lbRight(); else lbLeft(); // swipe left = what the right button does
    }, { passive: true });

    // buttons
    $('#open-btn').addEventListener('click', openSurprise);
    $('#lang-toggle').addEventListener('click', switchLang);
    $('#celebrate-btn').addEventListener('click', () => FX.celebrate());
    $('#top-btn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    $('#wax').addEventListener('click', toggleSeal);
    $('#hero-frame').addEventListener('click', (e) => FX.burst(e.clientX, e.clientY, 70, 3.2));

    // little hearts wherever she taps (not on controls)
    document.addEventListener('click', (e) => {
      if (!state.opened) return;
      if (e.target.closest && e.target.closest('button, a, input, canvas, .lightbox, .flip, .g-item, .strip__item, .tn')) return;
      FX.hearts(e.clientX, e.clientY, 4);
    });

    // progress bar
    const bar = $('#progress');
    onScroll(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? clamp(window.scrollY / max, 0, 1) : 0})`;
    });

    // achievements: fire when a section crosses the middle of the screen
    const ids = ['journey', 'age', 'terminal', 'gallery', 'reasons', 'balloons', 'scratch', 'letter', 'finale'];
    const achIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && state.opened) { achieve(e.target.id); achIO.unobserve(e.target); }
      });
    }, { rootMargin: '-42% 0px -42% 0px' });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) achIO.observe(el); });

    // terminal starts typing when she gets to it
    const termIO = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !state.termSeen) {
        state.termSeen = true;
        if (!state.termDone) runTerminal(false);
        termIO.disconnect();
      }
    }, { threshold: 0.45 });
    termIO.observe($('#term'));

    // first time she reaches the very end: a shower of confetti
    const endIO = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && state.opened && !state.finaleRained) {
        state.finaleRained = true;
        FX.rain(3600);
        FX.capToss(8);
        endIO.disconnect();
      }
    }, { threshold: 0.6 });
    endIO.observe($('#finale-title'));
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  function showError(msg) {
    const box = $('#load-error');
    box.hidden = false;
    box.textContent = msg;
    $('#open-btn').hidden = true;
    $('#intro-line').textContent = '';
  }

  function pickLang() {
    const avail = ['ar', 'en'].filter((l) => RAW[l]);
    const fromUrl = new URLSearchParams(location.search).get('lang');
    let saved = null;
    try { saved = localStorage.getItem('jana_lang'); } catch (e) { /* ignore */ }
    for (const c of [fromUrl, saved, RAW.default_lang, 'ar']) if (c && avail.includes(c)) return c;
    return avail[0];
  }

  async function boot() {
    try {
      const res = await fetch('/api/site', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Server error');
      DATA = json;
    } catch (err) {
      showError(err.message || String(err));
      return;
    }
    RAW = DATA.config;
    if (!(RAW.ar || RAW.en)) { showError('config.json needs an "ar" or "en" section'); return; }

    applyLang(pickLang());
    setupOnce();
    setupMusic();
    renderAll();
    startSparkles();
    $('#open-btn').focus({ preventScroll: true });
  }

  boot();
})();
