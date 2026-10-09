(function () {
  'use strict';

  const EVENTS = window.EVENTS || [];
  const HOLIDAYS = window.HOLIDAYS || {};
  const WD = '일월화수목금토';
  const VENUE_COLOR = { M: 'var(--vM)', C: 'var(--vC)', E: 'var(--vE)' };
  const VENUE_NAME = { M: '수원메쎄', C: '수원컨벤션센터', E: '' };

  // ---- 날짜 도우미 (프론트 PC의 현지 시간 기준) ----
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const diffDays = (a, b) => Math.round((parse(ymd(b)) - parse(ymd(a))) / 86400000);
  const md = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const shortName = n => n
    .replace(/\s*20\d\d\s*/g, ' ')
    .replace(/제\d+회\s*/, '')
    .replace(/\s*in 수원/, '')
    .replace(/\s+수원$/, '')
    .replace(/\s*\(.*?\)/, '')
    .replace(/[‘’']/g, '')
    .trim();

  const eventsOn = s => EVENTS.filter(e => s >= e.start && s <= e.end);

  // 수요 점수: 그날 행사 가중치 합 + 금·토요일이면 +1
  function score(s) {
    const evs = eventsOn(s);
    if (!evs.length) return 0;
    const dow = parse(s).getDay();
    return evs.reduce((a, e) => a + (e.weight || 1), 0) + (dow === 5 || dow === 6 ? 1 : 0);
  }
  const level = sc => (sc >= 5 ? 3 : sc >= 3 ? 2 : sc >= 1 ? 1 : 0);

  function eventPeak(e) {
    let best = 0;
    for (let d = parse(e.start); ymd(d) <= e.end; d = addDays(d, 1)) best = Math.max(best, level(score(ymd(d))));
    return best;
  }

  // ---- 상단바 ----
  function renderTop(today) {
    const t = ymd(today);
    const dow = today.getDay();
    const hol = HOLIDAYS[t];
    document.getElementById('today').innerHTML =
      `${today.getMonth() + 1}월 ${today.getDate()}일 (${WD[dow]})${hol ? `<br>${hol}` : ''}`;

    let peak = null;
    for (let i = 1; i <= 60 && !peak; i++) {
      const s = ymd(addDays(today, i));
      if (level(score(s)) === 3) peak = s;
    }
    const np = document.getElementById('nextPeak');
    if (peak) {
      const names = eventsOn(peak).map(e => shortName(e.name)).slice(0, 2).join(' · ');
      np.innerHTML = `다음 대목 <b>D-${diffDays(today, parse(peak))}</b> <span class="nm">${md(peak)} ${esc(names)}</span>`;
    } else {
      np.innerHTML = '다음 대목 <b>없음</b> 60일 이내';
    }

    const end = ymd(addDays(today, 6));
    const n = EVENTS.filter(e => e.start <= end && e.end >= t).length;
    document.getElementById('weekCount').innerHTML = `이번 7일 행사 <b>${n}</b>건`;
  }

  function tickClock() {
    const d = new Date();
    document.getElementById('clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---- 달력 (이번 주 일요일부터 5주) ----
  function renderCalendar(today) {
    const t = ymd(today);
    const start = addDays(today, -today.getDay());
    const last = addDays(start, 34);
    document.getElementById('calTitle').textContent =
      `행사 달력 · ${start.getMonth() + 1}월 ${start.getDate()}일 ~ ${last.getMonth() + 1}월 ${last.getDate()}일`;

    let h = '';
    for (let i = 0; i < 7; i++) h += `<div class="wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${WD[i]}</div>`;
    for (let i = 0; i < 35; i++) {
      const d = addDays(start, i);
      const s = ymd(d);
      const lv = level(score(s));
      const evs = eventsOn(s);
      const dow = d.getDay();
      const hol = HOLIDAYS[s];
      const nCls = hol || dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
      const showMonth = d.getDate() === 1 || i === 0;
      const cls = ['day', lv ? 'l' + lv : '', s === t ? 'today' : '', s < t ? 'past' : ''].join(' ');
      const shown = evs.slice(0, evs.length > 3 ? 2 : 3).map(e =>
        `<div class="ev"><i class="dot" style="background:${VENUE_COLOR[e.venue]}"></i>${esc(shortName(e.name))}</div>`).join('');
      const more = evs.length > 3 ? `<div class="ev more">+${evs.length - 2}개 더</div>` : '';
      h += `<div class="${cls}">` +
        `<span class="n ${nCls}">${d.getDate()}</span>` +
        (showMonth ? `<span class="mon">${d.getMonth() + 1}월</span>` : '') +
        (hol ? `<span class="hol">${esc(hol)}</span>` : '') +
        (evs.length ? `<span class="badge">${evs.length}</span>` : '') +
        shown + more + '</div>';
    }
    document.getElementById('cal').innerHTML = h;
  }

  // ---- 진행 중 · 다가오는 행사 ----
  function renderUpcoming(today) {
    const t = ymd(today);
    const list = EVENTS.filter(e => e.end >= t).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6);
    if (!list.length) {
      document.getElementById('upcoming').innerHTML = '<div class="empty">등록된 다가오는 행사가 없어요.</div>';
      return;
    }
    document.getElementById('upcoming').innerHTML = list.map(e => {
      const ongoing = e.start <= t;
      const dn = diffDays(today, parse(e.start));
      const pk = eventPeak(e);
      const sd = parse(e.start);
      const dd = ongoing
        ? `<div class="dd now"><b>진행중</b><small>~${md(e.end)}</small></div>`
        : `<div class="dd ${pk >= 2 ? 'hot' : ''}"><b>D-${dn}</b><small>${md(e.start)} ${WD[sd.getDay()]}</small></div>`;
      const period = e.start === e.end ? md(e.start) : `${md(e.start)}–${md(e.end)}`;
      const place = VENUE_NAME[e.venue] || e.place;
      return `<div class="up-item">${dd}<div>` +
        `<div class="up-name"><span class="t">${esc(shortName(e.name))}</span><span class="stars">${'★'.repeat(pk)}</span></div>` +
        `<div class="up-meta">${period} · ${esc(place)} · ${esc(e.type)}</div>` +
        `<div class="up-aud">${esc(e.audience)}</div>` +
        '</div></div>';
    }).join('');
  }

  // ---- 앞으로 30일 수요 흐름 ----
  function renderFlow(today) {
    const days = [];
    for (let i = 0; i < 30; i++) {
      const d = addDays(today, i);
      const s = ymd(d);
      days.push({ d, s, sc: score(s), n: eventsOn(s).length });
    }
    const max = Math.max(6, ...days.map(x => x.sc));
    document.getElementById('flow').innerHTML = days.map((x, i) =>
      `<div class="bar l${level(x.sc)} ${i === 0 ? 'today' : ''}">` +
      `<span class="v">${x.n ? x.n + '개' : ''}</span>` +
      `<div class="b" style="height:${Math.round(x.sc / max * 120)}px"></div></div>`).join('');
    document.getElementById('flowDates').innerHTML = days.map(x => {
      const dow = x.d.getDay();
      const cls = HOLIDAYS[x.s] || dow === 0 ? 'sun' : dow === 6 || dow === 5 ? 'we' : '';
      return `<div class="${cls}">${x.d.getDate()}<br>${WD[dow]}</div>`;
    }).join('');
  }

  // ---- 할 일 알림 (행사 일정에서 자동 생성) ----
  function renderAlerts(today) {
    const items = [];
    EVENTS.forEach(e => {
      const dn = diffDays(today, parse(e.start));
      const name = shortName(e.name);
      if (e.b2b && dn >= 21 && dn <= 30) {
        items.push({ p: 1, dn, ic: 'g', mark: '₩', t: `단체 영업 타이밍 · ${name}`,
          s: `${md(e.start)} 개막 D-${dn} · 참가업체·기관에 단체 숙박 제안` });
      }
      if ((e.weight || 1) >= 2 && dn >= 10 && dn <= 16) {
        const kw = (e.keywords || []).slice(0, 2).join(', ');
        items.push({ p: 2, dn, ic: 'b', mark: 'B', t: `블로그 글 올릴 때 · ${name}`,
          s: `D-${dn}${kw ? ' · 키워드: ' + kw : ''}` });
      }
    });
    const seen = new Set();
    for (let i = 3; i <= 14; i++) {
      const s = ymd(addDays(today, i));
      if (level(score(s)) !== 3) continue;
      const names = eventsOn(s).map(e => shortName(e.name));
      const key = names.join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const d = parse(s);
      items.push({ p: 0, dn: i, ic: 't', mark: '₩', t: `요금 점검 · ${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) 대목`,
        s: `D-${i} · ${names.slice(0, 2).join(', ')}${names.length > 2 ? ' 외' : ''}` });
    }
    items.sort((a, b) => a.p - b.p || a.dn - b.dn);
    const el = document.getElementById('alerts');
    el.innerHTML = items.length
      ? items.slice(0, 3).map(a =>
        `<div class="al"><div class="ic ${a.ic}">${a.mark}</div><div><div class="t">${esc(a.t)}</div><div class="s">${esc(a.s)}</div></div></div>`).join('')
      : '<div class="empty">오늘은 알림이 없어요.</div>';
  }

  // ---- 전체 그리기 ----
  let lastDay = '';
  function renderAll() {
    const now = new Date();
    lastDay = ymd(now);
    renderTop(now);
    renderCalendar(now);
    renderUpcoming(now);
    renderFlow(now);
    renderAlerts(now);
    tickClock();
    document.getElementById('foot').textContent =
      `행사 데이터: 2026.09.12 엑셀 기준 · 화면 갱신 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  renderAll();
  setInterval(() => {
    tickClock();
    if (ymd(new Date()) !== lastDay) renderAll(); // 자정 지나면 날짜·D-day 다시 계산
  }, 15000);
  setTimeout(() => location.reload(), 30 * 60 * 1000); // 30분마다 새로 불러오기 (새 데이터·수정 반영)
})();
