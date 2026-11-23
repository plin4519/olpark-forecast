/* 올팍예보 — 프런트엔드(외부 라이브러리 없음). 데이터: data/app.json (pipeline/build_data.py 산출물) */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n).toLocaleString('ko-KR');
  const hm = (h) => {
    const t = Math.round(h * 60);
    return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(((t % 60) + 60) % 60).padStart(2, '0')}`;
  };
  const GRADE = { 여유: { cls: 'g-good', icon: '●', color: 'var(--good)' }, 보통: { cls: 'g-warn', icon: '▲', color: 'var(--warn)' }, 혼잡: { cls: 'g-crit', icon: '■', color: 'var(--crit)' } };
  const gradeHtml = (g) => `<span class="grade ${GRADE[g].cls}"><i aria-hidden="true">${GRADE[g].icon}</i><span>${g}</span></span>`;
  const TIER_SHORT = { DOME: 'KSPO DOME', ARENA: '핸드볼경기장', HALL: '올림픽홀', OUTDOOR: '야외무대', SMALL: '소극장' };
  const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'].reverse();
  let D, EV, selDate, selShow, mode = 'car';

  /* ---------- 툴팁 ---------- */
  const tip = $('#tip');
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-tip');
    tip.hidden = false;
    const w = tip.offsetWidth, x = Math.min(window.innerWidth - w - 8, Math.max(8, e.clientX + 12));
    tip.style.left = x + 'px';
    tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 10) + 'px';
  });
  document.addEventListener('pointerleave', () => { tip.hidden = true; });

  /* ---------- 차트 도우미(SVG) ---------- */
  const niceMax = (v) => {
    const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
    return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= v) || v;
  };
  function frame(W, H, m, ymax, ticks = 4, fmt = num) {
    let s = '';
    for (let i = 0; i <= ticks; i++) {
      const v = (ymax / ticks) * i, y = H - m.b - ((H - m.b - m.t) * i) / ticks;
      s += `<line class="${i ? 'gl' : 'ax'}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`;
    }
    return s;
  }
  /* 세로 막대: 한 시리즈 또는 강조 시리즈(색은 항목의 '종류'를 따른다) */
  function columns(el, { labels, values, kinds, colors = ['var(--s1)'], tips, H = 190, xEvery = 1, ymax, fmt = num, valueLabels }) {
    const W = Math.max(300, Math.round(el.clientWidth) || 720), m = { l: 46, r: 8, t: 18, b: 24 };
    const max = ymax || niceMax(Math.max(...values));
    xEvery = Math.max(xEvery, Math.ceil((Math.max(...labels.map((l) => String(l).length)) * 9 + 8) / ((W - m.l - m.r) / values.length)));
    const bw = (W - m.l - m.r) / values.length, w = Math.min(24, bw - 2);
    let s = frame(W, H, m, max, 4, fmt);
    values.forEach((v, i) => {
      const h = ((H - m.b - m.t) * v) / max, x = m.l + bw * i + (bw - w) / 2, y = H - m.b - h, r = Math.min(4, h);
      const c = colors[kinds ? kinds[i] : 0];
      s += `<path d="M${x},${H - m.b}V${y + r}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}V${H - m.b}z" fill="${c}"/>`;
      if (valueLabels && valueLabels[i]) s += `<text class="lbl" x="${x + w / 2}" y="${y - 4}" text-anchor="middle">${esc(valueLabels[i])}</text>`;
      if (i % xEvery === 0) s += `<text x="${x + w / 2}" y="${H - 7}" text-anchor="middle">${esc(labels[i])}</text>`;
      s += `<rect class="hit" x="${m.l + bw * i}" y="${m.t}" width="${bw}" height="${H - m.b - m.t}" data-tip="${esc(tips ? tips[i] : `${labels[i]}: ${fmt(v)}`)}"/>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
  }
  /* 선 그래프: series=[{name, values, color}], band={lo,hi}, vlines=[{x,label}], hline={y,label} */
  function lines(el, { x, series, band, vlines = [], hline, H = 230, ymax, xEvery = 3, xfmt = (v) => v, tipfn, endLabels = true, marker }) {
    const W = Math.max(300, Math.round(el.clientWidth) || 720), m = { l: 46, r: endLabels ? 60 : 12, t: 16, b: 24 };
    xEvery = Math.max(xEvery, Math.ceil(34 / ((W - m.l - m.r) / (x.length - 1))));
    const all = series.flatMap((s) => s.values).concat(band ? band.hi : [], hline ? [hline.y] : []);
    const max = ymax || niceMax(Math.max(...all));
    const X = (i) => m.l + ((W - m.l - m.r) * i) / (x.length - 1), Y = (v) => H - m.b - ((H - m.b - m.t) * v) / max;
    let s = frame(W, H, m, max);
    x.forEach((v, i) => { if (i % xEvery === 0) s += `<text x="${X(i)}" y="${H - 7}" text-anchor="middle">${esc(xfmt(v))}</text>`; });
    if (hline) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(hline.y)}" y2="${Y(hline.y)}" stroke="var(--ink2)" stroke-width="1"/><text class="lbl" x="${m.l + 4}" y="${Y(hline.y) - 5}">${esc(hline.label)}</text>`;
    if (band) {
      const up = band.hi.map((v, i) => `${X(i)},${Y(v)}`).join(' L'), dn = band.lo.map((v, i) => `${X(i)},${Y(v)}`).reverse().join(' L');
      s += `<path d="M${up} L${dn} Z" fill="var(--s1)" opacity="0.2"/>`;
    }
    vlines.forEach((v) => {
      s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-width="1"/><text class="lbl" x="${X(v.x) + (X(v.x) > W * 0.6 ? -5 : 5)}" y="${m.t + (v.row || 0) * 14 + 8}" text-anchor="${X(v.x) > W * 0.6 ? 'end' : 'start'}">${esc(v.label)}</text>`;
    });
    const ends = [];
    series.forEach((sr) => {
      s += `<path d="M${sr.values.map((v, i) => `${X(i)},${Y(v)}`).join(' L')}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const li = sr.values.length - 1;
      s += `<circle cx="${X(li)}" cy="${Y(sr.values[li])}" r="4" fill="${sr.color}" stroke="var(--surface)" stroke-width="2"/>`;
      ends.push({ y: Y(sr.values[li]), name: sr.name });
    });
    if (endLabels) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
      ends.forEach((e) => { s += `<text class="lbl" x="${W - m.r + 8}" y="${e.y + 4}">${esc(e.name)}</text>`; });
    }
    if (marker != null) {
      const mx = X(marker);
      s += `<line x1="${mx}" x2="${mx}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink)" stroke-width="1" opacity=".75"/>`;
      series.forEach((sr) => {
        const a = Math.floor(marker), b = Math.min(sr.values.length - 1, a + 1), v = sr.values[a] + (sr.values[b] - sr.values[a]) * (marker - a);
        s += `<circle cx="${mx}" cy="${Y(v)}" r="5" fill="${sr.color}" stroke="var(--ink)" stroke-width="2"/>`;
      });
    }
    const bw = (W - m.l - m.r) / (x.length - 1);
    x.forEach((v, i) => {
      const t = tipfn ? tipfn(i) : `${xfmt(v)}\n` + series.map((sr) => `${sr.name}: ${num(sr.values[i])}`).join('\n');
      s += `<rect class="hit" x="${X(i) - bw / 2}" y="${m.t}" width="${bw}" height="${H - m.b - m.t}" data-tip="${esc(t)}"/>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
  }
  function hbars(el, rows, max, color = 'var(--s1)') {
    const mx = max || Math.max(...rows.map((r) => r.value));
    el.innerHTML = `<div class="hb">${rows.map((r) => `<div class="lab">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div><div class="row" data-tip="${esc(r.tip || `${r.label}: ${r.text}`)}"><div class="bar" style="width:${Math.max(1, (r.value / mx) * 78)}%;background:${r.color || color}"></div><span class="val">${esc(r.text)}</span></div>`).join('')}</div>`;
  }
  const legend = (el, items) => { el.innerHTML = items.map((i) => `<span><i class="sw${i.line ? ' line' : ''}" style="background:${i.color}"></i>${esc(i.name)}</span>`).join(''); };

  /* ---------- 데이터에서 뽑는 근거 수치 ---------- */
  const F = {};
  function facts() {
    const pk = D.parking.dome.filter((d) => d.type === 'parking'), dr = D.parking.dome.filter((d) => d.type === 'dropoff');
    const mean = (a, f) => Math.round(a.reduce((s, d) => s + f(d), 0) / a.length);
    F.arr = [0, 1, 2, 3, 4].map((i) => mean(pk, (d) => d.arrP[i])); // 시작 전 분: 상위 10/25/50/75/90% 도착 시점
    F.exitShare = mean(pk, (d) => d.exitShare30);
    F.exitShareAll = mean(D.parking.dome, (d) => d.exitShare30);
    F.pkPeak = mean(pk, (d) => d.peakVsBase * 100) / 100;
    F.drShort = mean(dr, (d) => d.shortVsBase * 100) / 100;
    F.drShortExcess = mean(dr, (d) => d.shortExcess);
    F.fee = Math.round(mean(D.parking.dome, (d) => d.medianFee) / 100) * 100;
    F.pkDays = pk.map((d) => d.date.slice(5)).join('·');
    const hh = D.congestion.hourHist, tot = hh.reduce((a, b) => a + b, 0);
    F.peakHourShare = Math.round(((hh[5] + hh[6] + hh[7]) / tot) * 100); // 13~15시
    F.first = D.congestion.domino.slice(0, 2).map((d) => d.zone);
    F.last = D.congestion.domino.slice(-2).map((d) => d.zone);
    F.m = D.model.facts;
  }

  /* ---------- 탭 ---------- */
  function tabs() {
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab, true)));
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g) { e.preventDefault(); show(g.dataset.go, true); return; }
      const sc = e.target.closest('[data-scroll]');
      if (sc) document.querySelector(sc.dataset.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const h = location.hash.replace('#', '');
    show(['forecast', 'planner', 'insight', 'data'].includes(h) ? h : 'forecast');
  }
  function show(name, top) {
    document.querySelectorAll('.tabs button[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
    history.replaceState(null, '', '#' + name);
    if (top) window.scrollTo({ top: 0, behavior: 'instant' });
    if (D) redraw(name);
    observe();
  }

  /* ---------- 모션: 블러 인, 숫자 카운트업 ---------- */
  // ?still = 모션 없이 최종 상태로 표시(화면 캡처용)
  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]still/.test(location.search);
  if (REDUCE) document.documentElement.classList.add('still');
  let io;
  function countUp(root) {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const to = +el.dataset.count;
      if (REDUCE) { el.textContent = num(to); return; }
      const t0 = performance.now(), dur = 1500;
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
        el.textContent = num(Math.round(to * e));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(() => { el.textContent = num(to); }, dur + 400);
    });
  }
  // 화면에 들어온 요소를 드러낸다. 프레임이 멈춘 환경에서도 내용이 숨은 채 남지 않도록 스크롤·타이머로 직접 확인한다.
  function revealCheck() {
    const vh = window.innerHeight;
    document.querySelectorAll('[data-reveal]:not(.in)').forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width && r.top < vh * 0.94 && r.bottom > 0) { e.classList.add('in'); countUp(e); }
    });
  }
  function observe() {
    if (!io) { io = true; window.addEventListener('scroll', revealCheck, { passive: true }); window.addEventListener('resize', revealCheck); }
    revealCheck();
    setTimeout(revealCheck, 400);
  }

  function redraw(name) {
    if (name === 'insight') insight();
    else if (name === 'forecast' && selDate) { dayDetail(); if (dots.state) dots.state.resize(); }
  }
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const t = document.querySelector('.tabs button[aria-selected="true"]'); if (D && t) redraw(t.dataset.tab); }, 200); });

  /* ---------- 1. 혼잡 예보 ---------- */
  const fc = (d) => D.forecast.find((f) => f.date === d);
  const md = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8)}일`;
  function showsOf(f) {
    const seen = new Map();
    f.shows.forEach((s) => { if (!seen.has(s.id)) seen.set(s.id, []); seen.get(s.id).push(s); });
    return [...seen.entries()].map(([id, ss]) => ({ ev: EV.get(id), ss })).filter((x) => x.ev);
  }
  function hero() {
    const f0 = D.forecast[0], P = D.parking, M = D.model;
    $('#headline').innerHTML = ['올림픽공원,', null, '언제', '가면', '덜', '붐빌까.'].map((w, i) => (w ? `<span class="w" style="--i:${i}">${w}</span>` : '<br>')).join(' ');
    const soon = D.forecast.slice(0, 14);
    const busy = soon.reduce((a, b) => (b.p > a.p ? b : a));
    const banded = soon.filter((f) => f.hi.some((v, i) => v !== f.lo[i]));
    const feat = banded.length ? banded.reduce((a, b) => (Math.max(...b.hi) > Math.max(...a.hi) ? b : a)) : busy;
    const domeDay = D.forecast.find((f) => f.shows.some((s) => s.tier === 'DOME'));
    const cards = [
      `<button class="hcard" data-pick="${f0.date}"><span class="k">오늘 · ${md(f0.date)} (${f0.dow})</span><span class="v">${gradeHtml(f0.grade)}<small>혼잡 확률 ${f0.p}%</small></span><span class="s">${esc(f0.factors.join(' · ') || '특별한 혼잡 요인 없음')}</span></button>`,
      `<button class="hcard" data-pick="${busy.date}"><span class="k">2주 안에 가장 붐빌 날</span><span class="v">${gradeHtml(busy.grade)}<small>${md(busy.date)} (${busy.dow}) · ${busy.p}%</small></span><span class="s">${esc(busy.factors.join(' · '))}</span></button>`,
    ];
    if (domeDay) {
      const s = domeDay.shows.filter((x) => x.tier === 'DOME').pop(), ev = EV.get(s.id);
      cards.push(`<button class="hcard" data-planid="${s.id}" data-plandate="${domeDay.date}"><span class="k">다음 KSPO DOME 공연 · ${md(domeDay.date)} (${domeDay.dow})</span><span class="v">${hm(s.start - F.arr[1] / 60)}<small>이전 도착 권장</small></span><span class="s">${esc(ev ? ev.title : '')}</span></button>`);
    }
    $('#hero-cards').innerHTML = cards.map((c, i) => c.replace('class="hcard"', `class="hcard" data-reveal style="--d:${(0.55 + i * 0.1).toFixed(2)}s"`)).join('');
    $('#hero-cards').addEventListener('click', (e) => {
      const b = e.target.closest('.hcard');
      if (!b) return;
      if (b.dataset.pick) { pickDate(b.dataset.pick); $('#step2').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else { show('planner', true); pickShow(+b.dataset.planid, b.dataset.plandate); }
    });
    $('#hero-note').textContent = `배경의 점은 ${md(feat.date)}(${feat.dow})의 시간대별 예상 주차 대수입니다. 흰 점은 하한, 주황 점은 주차형 공연일 때의 상한까지.`;
    dots(feat);

    const up = upcoming();
    const item = ({ ev }) => `<span class="it"><span class="badge ${ev.tier === 'DOME' ? 'dome' : ''}">${esc(TIER_SHORT[ev.tier])}</span><b>${esc(ev.title)}</b>${ev.begin === ev.end ? md(ev.begin) : `${md(ev.begin)} ~ ${md(ev.end)}`}</span>`;
    $('#marquee').innerHTML = `<div class="track" style="animation-duration:${Math.max(30, up.length * 7)}s">${up.map(item).join('')}<span aria-hidden="true" style="display:contents">${up.map(item).join('')}</span></div>`;

    const st = [
      ['분석한 실제 입출차 기록', P.rows, '건', '2024년 7월 한 달 치를 5분 단위 주차 대수로 복원했습니다'],
      ['주말·휴일에 혼잡 기록이 생긴 비율', M.facts.offRate, '%', `평일은 ${M.facts.workRate}%. 혼잡의 주원인은 주말 낮 나들이였습니다`],
      ['공연 날 관측된 최대 주차 대수', P.peakAll.value, '대', `전체 주차면 약 ${num(D.meta.capacity)}대의 ${P.peakAll.capShare}%, 평소의 ${F.pkPeak}배`],
      ['종료 후 30분 안에 나가는 공연 주차 차량', F.exitShareAll, '%', '45분만 늦추면 가장 붐비는 구간을 피합니다'],
    ];
    $('#stats').innerHTML = st.map((x, i) => `<div class="stat" data-reveal style="--d:${(i * 0.08).toFixed(2)}s"><div class="lab">${x[0]}</div><div class="num"><span data-count="${x[1]}">0</span><small>${x[2]}</small></div><div class="desc">${esc(x[3])}</div></div>`).join('');
    $('#cal-sub').textContent = `날짜를 누르면 시간대별 예상과 방문 가이드가 열립니다. 확률은 주차장 혼잡도 기록 ${M.nDays}일치를 요일·공휴일·날씨·공연 일정으로 학습한 결과입니다.`;
  }

  /* 히어로 배경: 예보 데이터를 도트 매트릭스로 그린다(이미지 파일 없음) */
  function dots(feat) {
    const cv = $('#dots'), ctx = cv.getContext('2d'), heroEl = cv.parentElement;
    const S = { t0: performance.now(), hover: -1, on: true, last: 0 };
    const at = (arr, h) => { const i = Math.max(0, Math.min(22.999, h)), a = Math.floor(i); return arr[a] + (arr[a + 1] - arr[a]) * (i - a); };
    function size() {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      S.w = r.width; S.h = r.height; S.wm = $('.wordmark').offsetHeight;
    }
    function draw(now) {
      const { w, h } = S, gap = w < 640 ? 9 : 10, cols = Math.floor(w / gap), rows = Math.floor(h / gap);
      // 차트 꼭대기 = 전체 주차면(가득 차면 화면 위쪽 눈금선에 닿는다)
      const base = h - S.wm * 0.42, top = Math.max(118, h * 0.14), cap = D.meta.capacity, capRow = Math.round((top - gap / 2) / gap);
      const prog = REDUCE ? 1 : Math.min(1, (now - S.t0) / 2400);
      ctx.clearRect(0, 0, w, h);
      for (let c = 0; c < cols; c++) {
        const x = c * gap + gap / 2, hour = (c / (cols - 1)) * 23;
        const yLo = base - (at(feat.lo, hour) / cap) * (base - top), yHi = base - (at(feat.hi, hour) / cap) * (base - top);
        const shown = c / cols <= prog * 1.05, near = S.hover >= 0 ? Math.max(0, 1 - Math.abs(c - S.hover) / 2.5) : 0;
        for (let r = 0; r < rows; r++) {
          const y = r * gap + gap / 2;
          let a = 0.07, rad = 0.9, col = '241,242,243';
          if (shown && r === capRow && c / cols > 0.5) { a = 0.42; rad = 1.1; }
          if (shown && y <= base + gap) {
            const tw = REDUCE ? 0.5 : 0.5 + 0.5 * Math.sin(now / 900 + c * 0.33 + r * 0.61);
            if (y >= yLo) { a = 0.5 + 0.3 * (1 - (y - yLo) / Math.max(1, base - yLo)) + 0.2 * tw; rad = 2.1; }
            else if (y >= yHi) { a = 0.4 + 0.3 * tw; rad = 1.8; col = '236,110,58'; }
          }
          if (near) { a = Math.min(1, a + 0.35 * near); rad += 0.5 * near; }
          ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
        }
      }
      ctx.font = '500 12px "Pretendard Variable", system-ui, sans-serif'; ctx.fillStyle = 'rgba(241,242,243,.62)'; ctx.textAlign = 'center';
      if (w >= 700 && prog >= 1) {
        for (let hh = 12; hh <= 21; hh += 3) ctx.fillText(`${hh}시`, (hh / 23) * (cols - 1) * gap + gap / 2, capRow * gap + gap / 2 + 22);
        ctx.textAlign = 'right';
        ctx.fillText(`전체 주차면 약 ${num(cap)}대`, w - 22, capRow * gap + gap / 2 - 10);
        ctx.textAlign = 'center';
      }
      if (S.hover >= 0 && prog >= 1) {
        const hour = (S.hover / (cols - 1)) * 23, lo = Math.round(at(feat.lo, hour)), hi = Math.round(at(feat.hi, hour));
        const label = `${hm(hour)} · ${hi > lo ? `${num(lo)}~${num(hi)}대` : `${num(lo)}대`}`;
        const x = Math.min(w - 90, Math.max(90, S.hover * gap)), y = base - (hi / cap) * (base - top) - 16;
        ctx.font = '600 13px "Pretendard Variable", system-ui, sans-serif';
        const tw = ctx.measureText(label).width + 20;
        ctx.fillStyle = 'rgba(241,242,243,.95)'; ctx.beginPath(); ctx.roundRect(x - tw / 2, y - 22, tw, 26, 13); ctx.fill();
        ctx.fillStyle = '#0d0d0d'; ctx.fillText(label, x, y - 4);
      }
    }
    function loop(now) {
      if (!S.on) return;
      if (now - S.last > 40) { S.last = now; draw(now); }
      if (!REDUCE || now - S.t0 < 100) requestAnimationFrame(loop);
    }
    const start = () => { if (!S.on) { S.on = true; requestAnimationFrame(loop); } };
    size();
    requestAnimationFrame(loop);
    heroEl.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect(), gap = S.w < 640 ? 9 : 11;
      S.hover = Math.round((e.clientX - r.left) / gap);
      if (REDUCE) draw(performance.now());
    });
    heroEl.addEventListener('pointerleave', () => { S.hover = -1; if (REDUCE) draw(performance.now()); });
    window.addEventListener('resize', () => { size(); draw(performance.now()); });
    if ('IntersectionObserver' in window) new IntersectionObserver((en) => { if (en[0].isIntersecting) start(); else S.on = false; }).observe(heroEl);
    S.resize = () => { size(); draw(performance.now()); };
    dots.state = S;
    setTimeout(() => { if (S.w) S.resize(); $('#headline').classList.add('done'); }, 2700);
  }

  function calendar() {
    legend($('#grade-legend'), []);
    $('#grade-legend').innerHTML = Object.keys(GRADE).map((g) => `<span>${gradeHtml(g)} <span class="muted">${D.model.gradeCalibration.find((c) => c.grade === g).range}</span></span>`).join('') + '<span class="muted">칸 아래 글자는 그날의 대·중형 공연장</span>';
    const first = new Date(D.forecast[0].date + 'T00:00:00'), pad = (first.getDay() + 6) % 7;
    let h = '월화수목금토일'.split('').map((d) => `<div class="cal-h">${d}</div>`).join('');
    for (let i = 0; i < pad; i++) h += '<div class="cal-cell empty" aria-hidden="true"></div>';
    D.forecast.forEach((f) => {
      const venues = [...new Set(f.shows.filter((s) => s.tier !== 'SMALL').map((s) => TIER_SHORT[s.tier]))];
      const cls = f.grade === '혼잡' ? 'c-crit' : f.grade === '보통' ? 'c-warn' : '';
      h += `<button class="cal-cell ${cls}" data-date="${f.date}" aria-pressed="false" aria-label="${md(f.date)} ${f.dow}요일 ${f.grade} ${f.p}%">
        <span class="d"><span>${+f.date.slice(8) === 1 || f === D.forecast[0] ? `${+f.date.slice(5, 7)}/` : ''}${+f.date.slice(8)}</span>${f.holiday ? '<span class="hol">휴일</span>' : ''}</span>
        <span class="g">${gradeHtml(f.grade)}</span><span class="p">${f.p}%</span>
        <span class="ev">${esc(venues.join('·'))}</span></button>`;
    });
    $('#calendar').innerHTML = h;
    $('#calendar').addEventListener('click', (e) => { const b = e.target.closest('[data-date]'); if (b) pickDate(b.dataset.date); });
  }
  function pickDate(d) {
    selDate = d;
    document.querySelectorAll('.cal-cell[data-date]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.date === d));
    dayDetail();
  }
  function dayDetail() {
    const f = fc(selDate), off = f.dow === '토' || f.dow === '일' || !!f.holiday;
    const sh = showsOf(f), dome = f.shows.filter((s) => s.tier === 'DOME');
    const hasBand = f.hi.some((v, i) => v !== f.lo[i]);
    const wx = f.tmax == null ? '' : ` · ${f.wxSrc === '예보' ? '예보' : '평년 기준'} 최고 ${f.tmax}℃${f.rain >= 1 ? `, 비 ${f.rain}mm` : ''}`;
    let html = `<div class="card-head"><h2>${md(f.date)} (${f.dow}) ${gradeHtml(f.grade)} <span class="muted small">혼잡 기록 확률 ${f.p}%${wx}</span></h2></div>`;
    html += `<h3>시간대별 예상 주차 대수</h3><div class="legend">${hasBand ? '<span><i class="sw line" style="background:var(--s2)"></i>주차형 공연일 때(상한)</span><span><i class="sw line" style="background:var(--s1)"></i>승하차형 공연일 때(하한)</span>' : '<span><i class="sw line" style="background:var(--s1)"></i>예상 주차 대수</span>'}</div><div id="c-day"></div>
      <div class="arrive"><div class="q">도착 시각을 움직여 보세요</div><div class="big" id="arr-big"></div><span class="verdict" id="arr-verdict"></span>
      <input type="range" id="arr" min="5" max="23" step="0.5" aria-label="도착 시각"><div class="ticks"><span>05시</span><span>08</span><span>11</span><span>14</span><span>17</span><span>20</span><span>23시</span></div></div>`;
    html += '<p class="note">2024년 7월 실제 입출차 기록의 시간대별 주차 대수에 월별 주차 실적(2023~2025)의 계절 차이를 곱한 값입니다. KSPO DOME 공연일은 같은 달 공연일 7일에서 관측된 초과 주차 대수를 공연 시작 시각에 맞춰 더했으며, 관객 구성에 따라 차이가 커서 범위로 보여 드립니다.</p>';
    if (sh.length) {
      html += '<h3 style="margin-top:14px">이날의 공연</h3><ul class="shows">' + sh.map((x) => `<li><span class="badge ${x.ev.tier === 'DOME' ? 'dome' : ''}">${esc(TIER_SHORT[x.ev.tier])}</span><b>${esc(x.ev.title)}</b><span class="muted">${x.ss.map((s) => `${hm(s.start)}~${hm(s.end)}${s.durKnown ? '' : '(종료 추정)'}`).join(', ')}</span>${x.ev.tier !== 'SMALL' && x.ev.end >= D.meta.today ? `<a href="#planner" data-plan="${x.ev.id}">플래너로 보기</a>` : ''}</li>`).join('') + '</ul>';
    }
    const g = [];
    if (dome.length) {
      const s = dome[dome.length - 1];
      g.push([`자가용이라면 ${hm(s.start - F.arr[1] / 60)} 이전에 도착하세요`, `KSPO DOME 주차형 공연일(2024-${F.pkDays})에 공연 주차 차량의 절반은 시작 ${F.arr[2]}분 전~${F.arr[4]}분 전 사이에 한꺼번에 들어왔습니다. 시작 ${F.arr[1]}분 전이면 4대 중 3대보다 먼저 도착합니다.`, '입출차 정보']);
      g.push([`공연이 끝나면 ${hm(s.end + 0.75)} 이후에 출차하거나 대중교통을 이용하세요`, `공연 주차 차량의 약 ${F.exitShareAll}%가 종료 직후 30분 안에 몰려 나갔습니다(주차형 공연일은 ${F.exitShare}%). 30분만 늦춰도 가장 붐비는 구간을 피합니다.`, '입출차 정보']);
    }
    if (off && f.grade !== '여유') g.push(['주말 낮 나들이 혼잡은 13~15시에 집중됩니다', `혼잡·만차 기록의 ${F.peakHourShare}%가 13~15시에 남았습니다. 공연과 무관한 방문이라면 오전 11시 이전 도착을 권합니다.`, '주차장 혼잡도 정보']);
    if (f.grade !== '여유') g.push([`${F.first.join('·')} 구역이 먼저 차고, ${F.last.join('·')} 구역이 가장 늦게 찹니다`, '혼잡한 날 구역별로 기록이 남은 순서를 평균한 결과입니다. 늦게 도착했다면 늦게 차는 구역부터 확인하세요.', '주차장 혼잡도 정보']);
    if (f.factors.includes('비 예보')) g.push(['비 오는 주말·휴일은 주차장이 더 붐빕니다', `비(5mm 이상)가 온 주말·휴일 ${F.m.rainOff.n}일 중 ${F.m.rainOff.rate}%에 혼잡 기록이 있었습니다(비가 오지 않은 날 ${F.m.dryOff.rate}%).`, '주차장 혼잡도 정보 + 날씨']);
    if (f.grade === '여유') g.push(['주차 여유가 예상됩니다', `같은 조건의 날 가운데 혼잡·만차 기록이 있었던 날은 ${D.model.gradeCalibration[0].actual}%였습니다. 평일 오전(10~11시)은 스포츠센터 이용 차량으로 하루 중 가장 많이 찹니다.`, '주차장 혼잡도 정보 · 입출차 정보']);
    g.push(['대중교통', '지하철 5·9호선 올림픽공원역 3번 출구, 8호선 몽촌토성역 1번 출구. 공연 시간이 임박하면 공원 주변이 혼잡해 1시간가량 여유가 필요합니다.', '자주 묻는 질문정보']);
    html += '<h3 style="margin-top:14px">방문 가이드</h3><ul class="guide">' + g.map((x) => `<li><b>${esc(x[0])}</b>${esc(x[1])}<span class="src">근거 데이터: ${esc(x[2])}</span></li>`).join('') + '</ul>';
    $('#day-detail').innerHTML = html;
    const hrs = [...Array(24).keys()];
    const vl = [], seen = new Set();
    f.shows.filter((s) => s.tier !== 'SMALL').forEach((s) => { const k = Math.round(s.start); if (!seen.has(k)) { seen.add(k); vl.push({ x: s.start, label: `${TIER_SHORT[s.tier]} ${hm(s.start)}`, row: vl.length }); } });
    const chart = (mk) => lines($('#c-day'), {
      x: hrs, xfmt: (h) => `${h}시`, ymax: 3000, endLabels: false, marker: mk,
      series: hasBand ? [{ name: '주차형(상한)', values: f.hi, color: 'var(--s2)' }, { name: '승하차형(하한)', values: f.lo, color: 'var(--s1)' }] : [{ name: '예상 주차 대수', values: f.lo, color: 'var(--s1)' }],
      band: hasBand ? { lo: f.lo, hi: f.hi } : null, vlines: vl, hline: { y: D.meta.capacity, label: `전체 주차면 약 ${num(D.meta.capacity)}대` },
      tipfn: (i) => `${i}시\n예상 주차 대수: ${hasBand ? `${num(f.lo[i])}~${num(f.hi[i])}대` : num(f.lo[i]) + '대'}\n(전체의 ${Math.round((f.lo[i] / D.meta.capacity) * 100)}${hasBand ? '~' + Math.round((f.hi[i] / D.meta.capacity) * 100) : ''}%)`,
    });
    const ds = dome.length ? dome[dome.length - 1] : null, cap = D.meta.capacity, dayMax = Math.max(...f.hi);
    const arr = $('#arr');
    const init = ds ? ds.start - F.arr[1] / 60 : f.date === D.meta.today ? new Date().getHours() : 11;
    arr.value = Math.min(23, Math.max(5, Math.round(init * 2) / 2));
    const upd = () => {
      const h = +arr.value, iv = (v) => { const a = Math.floor(h), b = Math.min(23, a + 1); return Math.round(v[a] + (v[b] - v[a]) * (h - a)); };
      const lo = iv(f.lo), hi = iv(f.hi), pl = Math.round((lo / cap) * 100), ph = Math.round((hi / cap) * 100);
      $('#arr-big').innerHTML = `${hm(h)} 도착<small>예상 주차 ${hi > lo ? `${num(lo)}~${num(hi)}대 · 전체의 ${pl}~${ph}%` : `${num(lo)}대 · 전체의 ${pl}%`}</small>`;
      let v = hi >= dayMax * 0.9 ? '이날 가장 붐비는 시간대' : hi <= dayMax * 0.5 ? '여유 있는 시간대' : '보통 수준';
      if (ds) {
        const m = (ds.start - h) * 60, pts = [[360, 0], [F.arr[0], 10], [F.arr[1], 25], [F.arr[2], 50], [F.arr[3], 75], [F.arr[4], 90], [0, 100]];
        if (m <= 0) v = 'KSPO DOME 공연 시작 이후';
        else {
          let got = 0;
          for (let i = 0; i < pts.length - 1; i++) if (m <= pts[i][0] && m >= pts[i + 1][0]) got = pts[i][1] + ((pts[i][0] - m) / (pts[i][0] - pts[i + 1][0])) * (pts[i + 1][1] - pts[i][1]);
          v = `KSPO DOME 공연 주차 차량의 약 ${Math.round(100 - got)}%보다 먼저 도착`;
        }
      }
      $('#arr-verdict').textContent = v;
      chart(h);
    };
    arr.addEventListener('input', upd);
    upd();
    $('#day-detail').querySelectorAll('[data-plan]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); show('planner'); pickShow(+a.dataset.plan, selDate); window.scrollTo(0, 0); }));
  }

  /* ---------- 2. 공연 방문 플래너 ---------- */
  function upcoming() {
    const ids = new Map();
    D.forecast.forEach((f) => f.shows.forEach((s) => { if (s.tier !== 'SMALL' && !ids.has(s.id)) ids.set(s.id, f.date); }));
    return [...ids.entries()].map(([id, first]) => ({ ev: EV.get(id), first })).filter((x) => x.ev);
  }
  function showList() {
    const up = upcoming();
    const newCut = new Date(new Date(D.meta.today).getTime() - 21 * 864e5).toISOString().slice(0, 10);
    $('#show-list').innerHTML = up.map(({ ev }) => `<button class="show" data-id="${ev.id}" aria-pressed="false">
      <span class="badge ${ev.tier === 'DOME' ? 'dome' : ''}">${esc(TIER_SHORT[ev.tier])}</span>${ev.reg >= newCut ? '<span class="new">새로 등록</span>' : ''}
      <span class="t">${esc(ev.title)}</span><span class="m">${ev.begin === ev.end ? md(ev.begin) : `${md(ev.begin)} ~ ${md(ev.end)}`}</span></button>`).join('');
    $('#show-list').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) pickShow(+b.dataset.id); });
    if (up.length) pickShow(up[0].ev.id);
  }
  function pickShow(id, date) {
    selShow = { id, date: null, idx: 0 };
    document.querySelectorAll('.show').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.id === id));
    const days = D.forecast.filter((f) => f.shows.some((s) => s.id === id));
    selShow.date = date && days.some((f) => f.date === date) ? date : days[0].date;
    plan();
  }
  function plan() {
    const ev = EV.get(selShow.id), days = D.forecast.filter((f) => f.shows.some((s) => s.id === ev.id));
    const f = fc(selShow.date), sessions = f.shows.filter((s) => s.id === ev.id);
    const s = sessions[Math.min(selShow.idx, sessions.length - 1)], dome = ev.tier === 'DOME';
    const arrive = s.start - (dome ? F.arr[1] : 60) / 60, rushA = s.start - (dome ? F.arr[2] : 60) / 60, rushB = s.start - (dome ? F.arr[4] : 20) / 60;
    const leaveRush = s.end + 10 / 60, leaveCalm = s.end + 45 / 60;
    const fee = (a, b) => Math.ceil(((b - a) * 60) / 10) * D.meta.fee;
    let h = `<div class="card-head"><h2>${esc(ev.title)}</h2><p class="muted">${esc(ev.venue)} · ${esc(ev.tm)}</p></div>
      <div class="controls">
        <label>관람일<select id="p-date">${days.map((d) => `<option value="${d.date}" ${d.date === f.date ? 'selected' : ''}>${md(d.date)} (${d.dow}) · ${d.grade}</option>`).join('')}</select></label>
        ${sessions.length > 1 ? `<label>회차<select id="p-sess">${sessions.map((x, i) => `<option value="${i}" ${x === s ? 'selected' : ''}>${hm(x.start)} 공연</option>`).join('')}</select></label>` : ''}
        <label>이동 수단<span class="seg"><button data-mode="car" aria-pressed="${mode === 'car'}">자가용</button><button data-mode="transit" aria-pressed="${mode === 'transit'}">대중교통·픽업</button></span></label>
      </div>
      <p>이날 예보: ${gradeHtml(f.grade)} <span class="muted">혼잡 기록 확률 ${f.p}% · ${esc(f.factors.join(', ') || '특별한 요인 없음')}</span></p>`;
    if (mode === 'car') {
      h += `<ol class="timeline">
        <li class="key"><time>${hm(arrive)}</time><b>이 시각 전에 도착</b><span class="why">${dome ? `KSPO DOME 주차형 공연일 기준, 시작 ${F.arr[1]}분 전이면 공연 주차 차량 4대 중 3대보다 먼저 들어옵니다.` : '이 규모 공연장은 2024년 7월 표본에서 주차 대수 변화가 뚜렷하지 않았습니다. 기관 안내(공연 임박 시 1시간 여유)를 기준으로 했습니다.'}</span></li>
        <li class="warn"><time>${hm(rushA)}~${hm(rushB)}</time><b>입차 집중 구간</b><span class="why">${dome ? '공연 주차 차량의 약 40%가 이 구간에 들어옵니다. 매표소 대기가 길어집니다.' : '공연 시작 직전에는 공원 주변 도로가 혼잡합니다.'}</span></li>
        <li><time>${hm(s.start)}</time><b>공연 시작</b></li>
        <li><time>${hm(s.end)}</time><b>공연 종료 ${s.durKnown ? '' : '(추정)'}</b><span class="why">${s.durKnown ? `공연정보의 공연 시간 ${ev.dur}분 기준` : '공연 시간 정보가 없어 150분으로 가정했습니다.'}</span></li>
        <li class="warn"><time>${hm(s.end)}~${hm(s.end + 40 / 60)}</time><b>출차 러시</b><span class="why">공연 주차 차량의 약 ${F.exitShareAll}%가 종료 직후 30분 안에 나갑니다(2024년 7월 KSPO DOME 공연일 7일 평균).</span></li>
        <li class="key"><time>${hm(leaveCalm)}</time><b>여유 출차 권장</b><span class="why">아래 "기다리는 동안"을 참고해 45분만 머물면 가장 붐비는 구간을 피합니다.</span></li>
      </ol>
      <div class="kv">
        <div><div class="k">러시에 바로 출차할 때 주차요금</div><div class="v">${num(fee(arrive, leaveRush))}원</div></div>
        <div><div class="k">45분 뒤 여유 출차할 때</div><div class="v">${num(fee(arrive, leaveCalm))}원</div></div>
        <div><div class="k">실제 공연 주차 1대당 요금(중앙값)</div><div class="v">약 ${num(F.fee)}원</div></div>
      </div>
      <p class="note">요금은 일반 승용차 10분당 ${num(D.meta.fee)}원 후불제(FAQ 데이터) 기준 추정이며 할인은 반영하지 않았습니다. 여유 출차는 요금이 ${num(fee(arrive, leaveCalm) - fee(arrive, leaveRush))}원 늘어나는 대신 출구 대기를 피하는 선택입니다.</p>`;
    } else {
      h += `<ol class="timeline">
        <li class="key"><time>${hm(s.start - 1)}</time><b>공원 도착 권장</b><span class="why">지하철 5·9호선 올림픽공원역 3번 출구, 8호선 몽촌토성역 1번 출구(FAQ 데이터).</span></li>
        <li><time>${hm(s.start)}</time><b>공연 시작</b></li>
        <li><time>${hm(s.end)}</time><b>공연 종료 ${s.durKnown ? '' : '(추정)'}</b></li>
        <li class="warn"><time>${hm(s.end)}~${hm(s.end + 40 / 60)}</time><b>픽업 차량이 몰리는 구간</b><span class="why">${dome ? `승하차형 공연일에는 10분 이하로 들어왔다 나가는 차량이 평소의 ${F.drShort}배(하루 약 ${num(F.drShortExcess)}대 증가)였습니다. 픽업은 종료 45분 뒤로 약속하는 편이 빠릅니다.` : '공연 종료 직후에는 공원 주변 승하차가 몰립니다.'}</span></li>
      </ol>
      <div class="kv"><div><div class="k">자가용 대비 절약되는 주차요금</div><div class="v">약 ${num(F.fee)}원</div></div><div><div class="k">차량 출입 가능 시간</div><div class="v">06~22시</div></div></div>
      <p class="note">절약액은 2024년 7월 KSPO DOME 공연일의 공연 주차 차량 요금 중앙값입니다.</p>`;
    }
    h += `<p><button class="btn primary" id="ics">내 캘린더에 일정·알림 추가(.ics)</button> ${ev.ticket ? `<a class="btn" href="${esc(ev.ticket)}" target="_blank" rel="noopener">예매 페이지</a>` : ''} <a class="btn" href="${esc(ev.page)}" target="_blank" rel="noopener">공연 상세(올림픽공원)</a></p>`;
    h += `<h3 style="margin-top:16px">기다리는 동안, 올림픽공원에서</h3><div class="mini">${waitContent(f.date, ev)}</div>`;
    $('#plan').innerHTML = h;
    $('#p-date').addEventListener('change', (e) => { selShow.date = e.target.value; selShow.idx = 0; plan(); });
    if ($('#p-sess')) $('#p-sess').addEventListener('change', (e) => { selShow.idx = +e.target.value; plan(); });
    $('#plan').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; plan(); }));
    $('#ics').addEventListener('click', () => ics(ev, f.date, s, arrive, leaveCalm));
  }
  function waitContent(date, ev) {
    const mdn = date.slice(5), open = [];
    D.content.lawn.forEach((l) => {
      const m = /(\d\d-\d\d)\s*~\s*(\d\d-\d\d)/.exec(l.open);
      if (l.place.includes('통제')) return;
      if (!m || (mdn >= m[1] && mdn <= m[2])) open.push(l.place);
    });
    const lawn = [...new Set(open)];
    const imm = D.content.immersive.filter((i) => (ev.tier === 'DOME' && i.venue.includes('DOME')) || (ev.tier === 'ARENA' && i.venue.includes('핸드볼')) || (ev.tier === 'OUTDOOR' && i.kind === '실외'));
    const crs = D.content.courses.filter((c) => c.center !== '올림픽테니스장').slice(0, 4);
    return `<div><h4>지금 개방 중인 잔디·쉼터</h4><ul>${lawn.map((p) => `<li>${esc(p)}</li>`).join('') || '<li>개방 정보 없음</li>'}</ul><p class="small muted">잔디시설정보 데이터 기준(잔디 보호 기간에는 일부 통제)</p></div>
      <div><h4>공원 소식</h4><ul>${D.content.news.slice(0, 4).map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`).join('')}</ul><p class="small muted">올림픽공원 핫뉴스 정보</p></div>
      <div><h4>다음엔 운동하러: 스포츠센터 강좌</h4><ul>${crs.map((c) => `<li><a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.name)}</a> <span class="muted">${esc(c.center)}</span></li>`).join('')}</ul><p class="small muted">스포츠센터 강좌 정보</p></div>
      ${imm.length ? `<div><h4>공연장 미리 보기(3D)</h4><ul><li><a href="${esc(imm[0].link)}" target="_blank" rel="noopener">${esc(imm[0].venue)} 실감형 콘텐츠</a> <span class="muted">${esc([...new Set(imm.map((i) => i.ext))].join('·'))}</span></li></ul><p class="small muted">공연장 실감형 콘텐츠 데이터</p></div>` : ''}`;
  }
  function ics(ev, date, s, arrive, leave) {
    const dt = (h) => { const t = Math.round(h * 60); const d = new Date(date + 'T00:00:00'); d.setMinutes(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`; };
    const clean = (t) => String(t).replace(/[\\;,]/g, ' ').replace(/\s+/g, ' ');
    const block = (uid, a, b, sum, desc, alarm) => ['BEGIN:VEVENT', `UID:${uid}-${ev.id}-${date}@olpark-forecast`, `DTSTAMP:${dt(0)}`, `DTSTART;TZID=Asia/Seoul:${dt(a)}`, `DTEND;TZID=Asia/Seoul:${dt(b)}`, `SUMMARY:${clean(sum)}`, `DESCRIPTION:${clean(desc)}`, 'LOCATION:서울 올림픽공원', ...(alarm ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${clean(sum)}`, `TRIGGER:-PT${alarm}M`, 'END:VALARM'] : []), 'END:VEVENT'];
    const rows = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//olpark-forecast//KO', 'CALSCALE:GREGORIAN',
      ...(mode === 'car' ? block('arr', arrive, arrive + 0.25, `[올팍예보] 이 시각 전 도착 권장 - ${ev.title}`, '입차 집중 구간 전에 도착하세요.', 90) : []),
      ...block('show', s.start, s.end, ev.title, `${ev.venue} / 올팍예보`, mode === 'car' ? 0 : 120),
      ...(mode === 'car' ? block('lv', leave, leave + 0.25, '[올팍예보] 여유 출차 권장 시각', '출차 러시가 지난 뒤 출차하세요.', 0) : []),
      'END:VCALENDAR'];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/calendar' }));
    a.download = `olpark-${date}-${ev.id}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- 3. 데이터 인사이트 ---------- */
  function insight() {
    const P = D.parking, C = D.congestion, M = D.model;
    $('#tiles').innerHTML = [
      ['분석한 입출차 기록', num(P.rows) + '건', '2024년 7월 한 달'],
      ['10분 이하 회차·승하차', P.segments[0].share + '%', `${num(P.segments[0].n)}건`],
      ['관측된 최대 주차 대수', num(P.peakAll.value) + '대', `${P.peakAll.time} · 전체 주차면의 약 ${P.peakAll.capShare}%`],
      ['주말·휴일 혼잡 기록 발생률', M.facts.offRate + '%', `평일은 ${M.facts.workRate}%`],
    ].map((t) => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('');

    hbars($('#c-dwell'), P.segments.map((s) => ({ label: s.name, sub: s.range, value: s.share, text: `${s.share}% · ${num(s.n)}건` })), 50);
    $('#n-dwell').textContent = `체류시간 중앙값은 ${P.medianDwell}분입니다. 10분 이하로 들어왔다 나가는 차량이 ${P.segments[0].share}%나 되어, 주차 "면" 못지않게 출입구 "흐름" 관리가 중요합니다.`;

    const hrs = [...Array(24).keys()];
    legend($('#lg-profile'), [{ name: '평일', color: 'var(--s1)', line: true }, { name: '주말', color: 'var(--s2)', line: true }]);
    lines($('#c-profile'), { x: hrs, xfmt: (h) => `${h}시`, endLabels: false, series: [{ name: '평일', values: P.profile.weekday, color: 'var(--s1)' }, { name: '주말', values: P.profile.weekend, color: 'var(--s2)' }] });
    $('#n-profile').textContent = `평일은 05~07시에 하루 평균 ${num(P.dawn.perDay)}대가 들어와 ${P.dawn.medianDwell}분(중앙값) 머뭅니다. 새벽 수영·운동 회원으로 보이며 10시대에 하루 최대(약 ${num(P.basePeak.weekday)}대)에 이릅니다. 주말 기준선은 KSPO DOME 공연이 없던 주말 ${P.profile.n_weekend}일로 만들어 표본이 작습니다.`;

    legend($('#lg-july'), [{ name: '일반일', color: 'var(--s1)' }, { name: 'KSPO DOME 공연일', color: 'var(--s2)' }]);
    const domeSet = new Map(P.dome.map((d) => [d.date, d]));
    const lab = P.daily.map((d) => `${+d.date.slice(8)}`), kinds = P.daily.map((d) => (domeSet.has(d.date) ? 1 : 0));
    const evName = (d) => d.events.map((id) => EV.get(id)).filter((e) => e && e.tier !== 'SMALL').map((e) => e.title).join(', ');
    columns($('#c-july-peak'), { labels: lab, values: P.daily.map((d) => d.peak), kinds, colors: ['var(--s1)', 'var(--s2)'], ymax: 2500, H: 170,
      tips: P.daily.map((d) => `7월 ${+d.date.slice(8)}일(${d.dow}) 최대 주차 ${num(d.peak)}대 (${d.peakTime})${evName(d) ? '\n' + evName(d) : ''}`) });
    columns($('#c-july-short'), { labels: lab, values: P.daily.map((d) => d.short), kinds, colors: ['var(--s1)', 'var(--s2)'], ymax: 4000, H: 170,
      tips: P.daily.map((d) => `7월 ${+d.date.slice(8)}일(${d.dow}) 10분 이하 회차 ${num(d.short)}건${evName(d) ? '\n' + evName(d) : ''}`) });
    $('#t-dome').innerHTML = '<thead><tr><th>날짜</th><th>KSPO DOME 공연</th><th class="n">시작</th><th class="n">최대 주차(평소 대비)</th><th class="n">10분 이하 회차(평소 대비)</th><th>유형</th><th class="n">종료 후 30분 출차 집중</th></tr></thead><tbody>' +
      P.dome.map((d) => `<tr><td class="nw">${+d.date.slice(5, 7)}/${+d.date.slice(8)} (${d.dow})</td><td>${esc(d.ids.map((id) => EV.get(id)?.title || '').join(', '))}</td><td class="n">${hm(d.start)}</td><td class="n">${num(d.peak)}대 (${d.peakVsBase}배)</td><td class="n">${num(d.short)}건 (${d.shortVsBase}배)</td><td style="white-space:nowrap">${d.type === 'parking' ? '주차형' : '승하차형'}</td><td class="n">${d.exitShare30}%</td></tr>`).join('') + '</tbody>';
    $('#n-dome').textContent = `주차형 공연일(7/20·21)은 최대 주차 대수가 평소의 ${F.pkPeak}배로 뛰었지만, 나머지 공연일은 주차 대수는 거의 그대로이고 10분 이하 회차만 평소의 ${F.drShort}배(하루 약 ${num(F.drShortExcess)}건 증가)였습니다. 한 달 표본(공연일 7일)에서 관측된 패턴이며, 7/20·21은 올림픽홀 공연이 같은 날 겹쳤습니다. 관객 연령대·동시 공연 중 무엇이 원인인지는 2025년 전체 구역 입출차 데이터(약 240만 건)로 검증이 필요합니다.`;

    const hours = [...Array(14).keys()].map((i) => i + 8), zmax = Math.max(...C.zones.flatMap((z) => z.hours));
    const order = C.domino.map((d) => d.zone), zs = [...C.zones].sort((a, b) => order.indexOf(a.zone) - order.indexOf(b.zone));
    $('#c-zone').innerHTML = `<div class="table-wrap"><table class="heat"><thead><tr><th class="z">먼저 차는 순</th>${hours.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
      zs.map((z, i) => `<tr><th class="z">${i + 1}. ${z.zone}</th>${z.hours.map((v, j) => { const k = v ? Math.min(SEQ.length - 1, Math.round((v / zmax) * (SEQ.length - 1))) : -1; return `<td style="background:${k < 0 ? 'rgba(241,242,243,.05)' : SEQ[k]};color:${k >= 7 ? '#0b0b0b' : '#fff'}" data-tip="${z.zone} · ${hours[j]}시대 혼잡·만차 기록 ${v}건">${v || ''}</td>`; }).join('')}</tr>`).join('') + '</tbody></table></div>';
    $('#n-zone').textContent = `${F.first.join('·')} 구역이 가장 먼저, ${F.last.join('·')} 구역이 가장 늦게 기록됩니다. 기록의 ${F.peakHourShare}%가 13~15시에 몰려 있고, 한 번 혼잡해진 구역이 "원활"로 돌아오기까지 중앙값 ${C.relief.medianHours}시간이 걸렸습니다(${C.relief.n}건, 시간 단위).`;

    const mr = M.facts.offMonthRate;
    columns($('#c-month'), { labels: mr.map((m) => m.month + '월'), values: mr.map((m) => m.rate), ymax: 100, fmt: (v) => v + '%', tips: mr.map((m) => `${m.month}월 주말·휴일 ${m.n}일 중 ${m.rate}%에 혼잡·만차 기록`) });
    $('#n-month').textContent = `3~4월은 주말·휴일 전부에 혼잡 기록이 있었고 12~1월은 10~20%대입니다. 주말·휴일의 ${M.facts.domeShareOff}%에 KSPO DOME 공연이 있어, 날마다 달라지는 요인은 공연 유무보다 계절과 날씨였습니다. 나들이하기 좋은 기온(최고 10~28℃)의 주말은 6개 구역 이상이 함께 혼잡해진 날이 ${M.facts.niceOff.wide}%로, 그 밖의 주말(${M.facts.coldHotOff.wide}%)의 약 ${(M.facts.niceOff.wide / M.facts.coldHotOff.wide).toFixed(1)}배였습니다.`;

    hbars($('#c-odds'), M.features.map((f, i) => ({ label: f, value: M.oddsRatio[i], text: `${M.oddsRatio[i]}배` })), 8);
    $('#n-model').textContent = `학습 ${M.period} (${M.nDays}일, 혼잡 기록일 ${M.nPos}일). 2025년 9월까지 학습하고 이후 ${M.nTest}일을 맞혀 본 AUC는 ${M.aucTest}로, 요일·공휴일만 쓴 기준 모델(${M.aucBaseline})보다 높았습니다. 월 단위 교차검증 AUC는 ${M.aucCV}입니다. 공휴일 단독 효과가 1 안팎인 것은 휴일의 영향이 "주말·휴일 × 날씨" 항에 함께 담기기 때문입니다.`;
    columns($('#c-calib'), { labels: M.gradeCalibration.map((g) => `${g.grade} 예보`), values: M.gradeCalibration.map((g) => g.actual), ymax: 100, fmt: (v) => v + '%', H: 180,
      valueLabels: M.gradeCalibration.map((g) => g.actual + '%'), tips: M.gradeCalibration.map((g) => `${g.grade} 예보 ${g.days}일 중 실제 혼잡 기록 ${g.actual}%`) });
    $('#t-model').innerHTML = '<thead><tr><th>예보 등급</th><th>확률 구간</th><th class="n">해당 일수</th><th class="n">실제 혼잡 기록 발생률</th></tr></thead><tbody>' + M.gradeCalibration.map((g) => `<tr><td>${gradeHtml(g.grade)}</td><td>${g.range}</td><td class="n">${g.days}일</td><td class="n">${g.actual}%</td></tr>`).join('') + '</tbody>';

    const mon = D.monthly['올림픽공원'], cols = { 2023: 'var(--s1)', 2024: 'var(--s2)', 2025: 'var(--s3)' };
    legend($('#lg-monthly'), Object.keys(mon).map((y) => ({ name: y + '년', color: cols[y], line: true })));
    lines($('#c-monthly'), { x: [...Array(12).keys()].map((i) => i + 1), xfmt: (m) => m + '월', xEvery: 1, H: 220, endLabels: false, series: Object.keys(mon).map((y) => ({ name: y + '년', values: mon[y], color: cols[y] })) });
  }

  /* ---------- 4. 데이터·한계 ---------- */
  function dataTab() {
    const P = D.parking, C = D.congestion;
    const ds = [
      ['올림픽공원 입출차 정보', '15138735', '파일', `${num(P.rows)}건으로 5분 단위 주차 대수 복원, 체류시간 유형, 공연일 입·출차 패턴`],
      ['주차장 혼잡도 정보', '15164156', '파일', `${C.rows}건으로 혼잡 예보 모델의 정답(라벨), 구역별·시간대별 패턴`],
      ['올림픽공원 공연정보', '3037877', '오픈API(원천: 공식 일정안내)', '공연장·일자·시작 시각·공연 시간으로 예보 입력과 플래너 구성'],
      ['월별주차현황', '15131671', '파일', '2023~2025 월별 주차 대수로 계절 보정'],
      ['자주 묻는 질문정보', '15089962', '파일', '전체 주차면 수, 주차요금, 대중교통, 이용 시간'],
      ['잔디시설정보', '15143220', '파일', '날짜별 개방 중인 잔디·쉼터 안내'],
      ['스포츠센터 강좌 정보', '15147992', '파일', '체류·재방문 유도 콘텐츠, 새벽 입차 패턴 해석'],
      ['올림픽공원 핫뉴스 정보', '15090715', '파일', '진행 중인 공원 소식'],
      ['올림픽공원 공연장 실감형 콘텐츠', '15127487', '파일', '공연장 3D 미리 보기 연결'],
    ];
    const next = [
      ['올림픽공원 차량입출차·공연·날씨 연계 데이터', '15164822', '오픈API', '2025년 시간대별 주차·공연 관람객 수로 모델 재학습(인증키 발급 후)'],
      ['올림픽공원 입출차정보(전체구역)', '15159093', '오픈API', '2025년 약 240만 건으로 구역별 예측, 주차형·승하차형 가설 검증'],
      ['실시간 주차현황', '15168686', '오픈API', '예보와 실제의 차이를 실시간 보정'],
    ];
    $('#t-datasets').innerHTML = '<thead><tr><th>데이터(한국체육산업개발)</th><th>유형</th><th>이 서비스에서의 쓰임</th></tr></thead><tbody>' +
      ds.map((d) => `<tr><td><a href="https://www.data.go.kr/data/${d[1]}/${d[2] === '파일' ? 'fileData' : 'openapi'}.do" target="_blank" rel="noopener">${d[0]}</a></td><td>${d[2]}</td><td>${d[3]}</td></tr>`).join('') +
      '<tr><th colspan="3">다음 단계에서 연동(인증키 필요)</th></tr>' +
      next.map((d) => `<tr><td><a href="https://www.data.go.kr/data/${d[1]}/openapi.do" target="_blank" rel="noopener">${d[0]}</a></td><td>${d[2]}</td><td>${d[3]}</td></tr>`).join('') +
      '<tr><th colspan="3">타 기관 데이터</th></tr><tr><td>날씨(일 강수량·최고기온)</td><td>프로토타입: Open-Meteo / 운영: 기상청 단기·중기예보</td><td>나들이 기온·비 변수</td></tr><tr><td>공휴일</td><td>프로토타입: 내장 목록 / 운영: 한국천문연구원 특일 정보</td><td>휴일 변수</td></tr></tbody>';
    $('#method').innerHTML = [
      `입출차 ${num(P.rows)}건에서 입차 누계와 출차 누계의 차이로 5분 단위 주차 대수를 복원합니다.`,
      '공연 영향이 적은 날의 평일·주말 시간대별 평균을 기준선으로 삼고, 월별 주차 실적으로 계절 차이를 보정합니다.',
      'KSPO DOME 공연일 7일의 초과 주차 대수를 공연 시작 시각에 맞춰 평균해 "주차형"과 "승하차형" 두 패턴을 만듭니다.',
      `혼잡도 기록이 있는 날을 정답으로, 요일·공휴일·날씨·공연 수를 입력으로 로지스틱 회귀를 학습해 날짜별 혼잡 확률을 냅니다(${D.model.nDays}일).`,
      '확률을 여유·보통·혼잡 3등급으로 나누고, 등급별 실제 발생률을 함께 공개합니다.',
    ].map((t) => `<li>${t}</li>`).join('');
    $('#limits').innerHTML = [
      '시간대별 주차 대수는 2024년 7월 한 달(동2문·남2문·북2문 구역) 기록에서 만든 패턴입니다. 다른 계절은 월별 실적으로 보정한 추정입니다.',
      '혼잡도 기록은 운영자가 남긴 기록이라 혼잡했지만 기록되지 않은 날이 있을 수 있습니다. 2026년 2월 이후는 기록이 드물어 학습에서 제외했습니다.',
      '혼잡 등급 안에서 더 세밀한 구분(혼잡과 매우 혼잡)은 현재 데이터로는 신뢰할 만큼 가려지지 않아 3등급만 제공합니다.',
      '주차형·승하차형 구분은 공연일 7일 표본의 관측입니다. 예보에서는 두 경우를 범위로 함께 보여 줍니다.',
      '구역(P1A~P11)의 위치는 데이터에 없어 지도로 표시하지 않았습니다. 위치는 올림픽공원 안내도를 참고하세요.',
    ].map((t) => `<li>${t}</li>`).join('');
    const q = [
      ['주차장 혼잡도 정보', `등록시간의 분·초 자리가 등록일의 월·일과 ${C.timeFormatBugShare}% 일치(예: 8월 12일 → 17:08:12)`, '시각 포맷 오류로 보이며 "시" 단위만 쓸 수 있음. 분 단위 복원 시 구역별 만차 순서·해소 시간 분석 정밀도 향상'],
      ['영문 공연정보', '공연일자 값이 실제 공연일이 아니라 등록 시점에 가까움(같은 날짜에 10건 이상 몰림)', '공연 시작·종료일을 별도 항목으로 제공'],
      ['올림픽공원 공연정보', '공연 시간(tm)이 자유 서술형, 공연장 표기가 50가지 이상으로 제각각', '회차별 시작 시각을 구조화하고 공연장 코드를 표준화'],
      ['올림픽공원 입출차 정보(파일)', '2024년 7월 한 달, 3개 출입구 구역만 포함하고 구역 구분이 없음', '2025년 전체 구역 데이터를 파일로도 제공하면 인증키 없이 분석 가능'],
      ['(신규 제안) 주차구역 기준정보', '구역별 주차면 수·좌표·가까운 공연장이 공개 데이터에 없음', '구역 단위 잔여 예측과 지도 안내가 가능해짐'],
      ['(신규 제안) 공연별 관객 규모', '예매·입장 인원 또는 연령대 분포', '주차형·승하차형 사전 판별과 승하차 구역 운영 계획에 활용'],
    ];
    $('#t-quality').innerHTML = '<thead><tr><th>데이터</th><th>발견한 점</th><th>제안·기대 효과</th></tr></thead><tbody>' + q.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') + '</tbody>';
    $('#faq').innerHTML = D.content.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
    $('#foot-meta').textContent = `데이터 생성: ${D.meta.generated} · 출처: 한국체육산업개발(주) 공공데이터(공공데이터포털), 올림픽공원 공식 일정안내 · 날씨: Open-Meteo`;
  }

  fetch('data/app.json').then((r) => r.json()).then((d) => {
    D = d;
    EV = new Map(D.events.map((e) => [e.id, e]));
    facts();
    $('#loading').remove();
    hero(); calendar(); selDate = D.forecast[0].date; showList(); dataTab(); tabs(); pickDate(selDate); observe();
  }).catch((e) => { $('#loading').textContent = '데이터를 불러오지 못했습니다: ' + e.message; });
})();
