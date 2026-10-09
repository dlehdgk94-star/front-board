(function () {
  'use strict';

  const EVENTS = window.EVENTS || [];
  const HOLIDAYS = window.HOLIDAYS || {};
  const WD = '일월화수목금토';
  const CAT_NAME = { expo: '박람회', conf: '학회·비즈니스', fest: '공연·축제' };
  const VENUE_NAME = { M: '수원메쎄', C: '수원컨벤션센터' };

  // ---------- 날짜 도우미 (프런트 PC 현지 시간) ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const shift = (s, n) => ymd(addDays(parse(s), n));
  const diff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const md = s => { const d = parse(s); return `${d.getMonth() + 1}.${d.getDate()}`; };
  const mdw = s => { const d = parse(s); return `${d.getMonth() + 1}.${d.getDate()}(${WD[d.getDay()]})`; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = id => document.getElementById(id);

  const shortName = n => n
    .replace(/\s*20\d\d\s*/g, ' ')
    .replace(/제\d+회\s*/, '')
    .replace(/\s*in 수원/, '')
    .replace(/\s+수원$/, '')
    .replace(/\s*\(.*?\)/, '')
    .replace(/[‘’']/g, '')
    .trim();

  // 행사 종류: 박람회 / 학회·비즈니스 / 공연·축제
  function cat(e) {
    if (/축제|공연|문화|관광|음악/.test(e.type)) return 'fest';
    if (e.b2b || /학술|컨퍼런스|서밋|회의/.test(e.type + e.name)) return 'conf';
    return 'expo';
  }

  const eventsOn = s => EVENTS.filter(e => s >= e.start && s <= e.end);
  // 숙박(밤) 기준: D일 밤에 묵는 손님은 D+1일 행사에 가는 사람
  const nightEvents = s => eventsOn(shift(s, 1));
  const eveEvents = s => EVENTS.filter(e => e.start === shift(s, 1));
  // 달력·흐름에 '전날 숙박' 표시: 그날 행사가 없는 밤이거나, 다음 날 행사가 2건 이상 시작할 때만 (화면 정리용)
  const showEve = s => { const n = eveEvents(s).length; return n >= 2 || (n === 1 && !eventsOn(s).length); };

  function nightScore(s) {
    const evs = nightEvents(s);
    if (!evs.length) return 0;
    const dow = parse(s).getDay();
    let sc = evs.reduce((a, e) => a + (e.weight || 1), 0);
    if (dow === 5 || dow === 6) sc += 1;          // 금·토 밤
    if (HOLIDAYS[shift(s, 1)]) sc += 1;            // 공휴일 전날 밤
    return sc;
  }
  const level = sc => (sc >= 5 ? 3 : sc >= 3 ? 2 : sc >= 1 ? 1 : 0);
  const nightLevel = s => level(nightScore(s));

  function isCandidate(s) {
    if (nightLevel(s) >= 2) return true;
    return eveEvents(s).some(e => (e.weight || 1) >= 2);
  }

  function reason(s) {
    const evs = nightEvents(s);
    const counts = {};
    evs.forEach(e => { const c = cat(e); counts[c] = (counts[c] || 0) + 1; });
    const keys = Object.keys(counts);
    let r = keys.length === 1
      ? `${CAT_NAME[keys[0]]} ${counts[keys[0]]}건`
      : keys.map(k => CAT_NAME[k].split('·')[0]).join('·') + ' 일정 중복';
    if (eveEvents(s).length) r += ' · 전날 숙박';
    return r;
  }

  // ---------- 검토 기록 (이 PC 브라우저에 저장, 2단계에서 서버 저장으로 이전) ----------
  const KEY = 'frontboard.reviews.v1';
  let REV = {};
  try { REV = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { REV = {}; }
  const saveRev = () => { try { localStorage.setItem(KEY, JSON.stringify(REV)); } catch (e) { /* 저장 불가 환경 */ } };
  const isDone = s => !!(REV[s] && REV[s].done);

  // ---------- 상태 ----------
  let monthOffset = 0;
  let view = 'cal';
  let range = 14;
  let selected = null;
  let backTimer = null;

  const todayStr = () => ymd(new Date());

  function queueList(t, n) {
    const out = [];
    for (let i = 0; i < n; i++) { const s = shift(t, i); if (isCandidate(s)) out.push(s); }
    return out;
  }

  // ---------- 상단 ----------
  function renderTop() {
    const t = todayStr();
    const d = parse(t);
    $('today').textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${WD[d.getDay()]}요일${HOLIDAYS[t] ? ' · ' + HOLIDAYS[t] : ''}`;

    const q14 = queueList(t, 14);
    $('smPending').textContent = q14.filter(s => !isDone(s)).length;
    $('smDone').textContent = q14.filter(isDone).length;
    let peak = null;
    for (let i = 0; i < 60 && !peak; i++) { const s = shift(t, i); if (nightLevel(s) === 3) peak = s; }
    if (peak) {
      const dn = diff(t, peak);
      $('smPeak').textContent = dn === 0 ? '오늘 밤' : `D-${dn}`;
      $('smPeakName').textContent = `${mdw(peak)} 밤 · ${nightEvents(peak).map(e => shortName(e.name)).slice(0, 2).join(', ')}`;
    } else {
      $('smPeak').textContent = '없음';
      $('smPeakName').textContent = '60일 이내';
    }
  }

  function tickClock() {
    const d = new Date();
    $('clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- 달력 (주 단위 · 여러 날 행사는 이어진 막대) ----------
  function renderCalendar() {
    const t = todayStr();
    const now = parse(t);
    const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((first.getDay() + dim) / 7);
    const start = addDays(first, -first.getDay());
    const LANES = weeks === 6 ? 3 : 4;
    const showPast = monthOffset < 0;   // 지난 달을 넘겨 볼 때만 지난 행사 표시
    $('calTitle').textContent = `${first.getFullYear()}년 ${first.getMonth() + 1}월`;

    let h = '<div class="wdrow">';
    for (let i = 0; i < 7; i++) h += `<div class="wd ${i === 0 || i >= 5 ? 'sun' : ''}">${WD[i]}</div>`;  // 금·토·일 같은 색
    h += '</div><div class="weeks" style="grid-template-rows:repeat(' + weeks + ',minmax(0,1fr))">';

    for (let w = 0; w < weeks; w++) {
      const ws = ymd(addDays(start, w * 7));
      const we = shift(ws, 6);
      const from = showPast ? ws : (t > ws ? t : ws);   // 오늘 이전은 막대를 그리지 않음
      // 이번 주에 보이는 행사 → 줄(lane) 배정
      const evs = from > we ? [] : EVENTS
        .filter(e => e.start <= we && e.end >= from)
        .map(e => ({ e, a: e.start > from ? e.start : from, b: e.end < we ? e.end : we }))
        .sort((x, y) => x.a.localeCompare(y.a) || diff(y.a, y.b) - diff(x.a, x.b));
      const laneEnd = [];
      const placed = [];
      const hidden = {};
      evs.forEach(x => {
        let L = laneEnd.findIndex(end => end < x.a);
        if (L === -1) L = laneEnd.length;
        if (L < LANES) { laneEnd[L] = x.b; placed.push(Object.assign(x, { L })); }
        else for (let s2 = x.a; s2 <= x.b; s2 = shift(s2, 1)) hidden[s2] = (hidden[s2] || 0) + 1;
      });

      h += `<div class="week" style="grid-template-rows:30px repeat(${LANES},24px) minmax(0,1fr)">`;
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, w * 7 + i);
        const ds = ymd(d);
        const out = d.getMonth() !== first.getMonth();
        const past = ds < t;
        const dow = d.getDay();
        const hol = HOLIDAYS[ds];
        let tag = '';
        // 검토 표시는 오른쪽 목록과 같은 범위(7/14/30일) 안에서만
        if (!past && diff(t, ds) < range && isCandidate(ds)) {
          if (isDone(ds)) tag = '<div class="tag done">✓ 검토 완료</div>';
          else {
            const n = eveEvents(ds).length;
            tag = `<div class="tag">${n ? '전날 숙박' + (n > 1 ? ' · ' + n + '건' : '') : '숙박 검토'}</div>`;
          }
        }
        const cls = ['day', out ? 'out' : '', past ? 'past' : '', ds === selected ? 'sel' : ''].join(' ');
        h += `<div class="${cls}" data-d="${ds}" style="grid-column:${i + 1}">` +
          `<div class="dtop"><span class="dn ${ds === t ? 'today' : hol || dow === 0 || dow >= 5 ? 'sun' : ''}">${d.getDate()}</span>` +
          (hol ? `<span class="hol">${esc(hol)}</span>` : '') +
          (hidden[ds] ? `<span class="more">+${hidden[ds]}</span>` : '') + '</div>' +
          tag + '</div>';
      }
      placed.forEach(x => {
        const c1 = diff(ws, x.a) + 1, c2 = diff(ws, x.b) + 2;
        const cont = (x.a !== x.e.start ? ' contL' : '') + (x.b !== x.e.end ? ' contR' : '');
        h += `<div class="bar b-${cat(x.e)}${cont}${showPast && x.b < t ? ' pastbar' : ''}" data-d="${x.a}" ` +
          `style="grid-column:${c1}/${c2};grid-row:${x.L + 2}" title="${esc(x.e.name)}">${esc(shortName(x.e.name))}</div>`;
      });
      h += '</div>';
    }
    h += '</div>';
    const cal = $('cal');
    cal.innerHTML = h;
    cal.querySelectorAll('.day').forEach(el => { el.onclick = () => select(el.dataset.d); });
    cal.querySelectorAll('.bar').forEach(el => { el.onclick = ev => { ev.stopPropagation(); select(shift(el.dataset.d, -1)); }; });
  }

  // ---------- 목록 보기 ----------
  function renderList() {
    const t = todayStr();
    const list = EVENTS.filter(e => e.end >= t).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 11);
    let h = '<div class="erow h"><span>D-day</span><span>행사</span><span>기간</span><span>장소</span><span>숙박하는 밤</span><span>할 일</span></div>';
    h += list.map(e => {
      const dn = diff(t, e.start);
      const ongoing = e.start <= t;
      let peak = 0;
      for (let s = shift(e.start, -1); s <= shift(e.end, -1); s = shift(s, 1)) peak = Math.max(peak, nightLevel(s));
      const chips = [];
      if (e.b2b && dn >= 21 && dn <= 30) chips.push('<span class="chip sales">단체 영업 타이밍</span>');
      if ((e.weight || 1) >= 2 && dn >= 10 && dn <= 16) chips.push('<span class="chip blog">블로그 글 올릴 때</span>');
      return `<div class="erow">` +
        `<span class="edd ${ongoing ? 'now' : peak >= 2 ? 'hot' : ''}">${ongoing ? '진행중' : 'D-' + dn}</span>` +
        `<span class="ename"><i class="dot c-${cat(e)}"></i>${esc(shortName(e.name))}</span>` +
        `<span class="emeta">${md(e.start)}${e.end !== e.start ? ' – ' + md(e.end) : ''}</span>` +
        `<span class="emeta">${esc(VENUE_NAME[e.venue] || e.place)}</span>` +
        `<span class="emeta">${md(shift(e.start, -1))} – ${md(shift(e.end, -1))} 밤</span>` +
        `<span>${chips.join('') || '<span class="emeta">-</span>'}</span></div>`;
    }).join('');
    $('elist').innerHTML = h;
  }

  // ---------- 오른쪽: 검토 목록 ----------
  function renderQueue() {
    const t = todayStr();
    const q = queueList(t, range);
    if (!q.length) { $('queue').innerHTML = `<div class="qempty">${range}일 안에 검토할 숙박일이 없어요.</div>`; return; }
    const show = q.slice(0, 4);
    $('queue').innerHTML = show.map(s => {
      const dn = diff(t, s);
      const done = isDone(s);
      return `<div class="qrow ${s === selected ? 'sel' : ''}" data-d="${s}">` +
        `<div><div class="qd">${md(s)}<small>${WD[parse(s).getDay()]}</small></div>` +
        `<div class="qdd ${dn === 0 ? 'today' : ''}">${dn === 0 ? '오늘' : 'D-' + dn}</div></div>` +
        `<div><div class="qr">${esc(reason(s))}</div><div class="qs ${done ? 'done' : ''}">${done ? '검토 완료' : '검토 대기'}</div></div>` +
        `<div class="cb ${done ? 'on' : ''}">${done ? '✓' : ''}</div></div>`;
    }).join('') + (q.length > 4 ? `<div class="qmore">+ ${q.length - 4}박 더 · 달력에서 날짜를 누르면 볼 수 있어요</div>` : '');
    $('queue').querySelectorAll('.qrow').forEach(el => { el.onclick = () => select(el.dataset.d); });
  }

  // ---------- 오른쪽: 선택한 밤 검토 ----------
  function renderDetail() {
    const s = selected;
    const d = parse(s);
    const evs = nightEvents(s);
    const eve = eveEvents(s);
    const rec = REV[s] || {};
    const tag = eve.length ? '<span class="dtag">행사 전날</span>' : evs.length ? '<span class="dtag mid">행사 기간</span>' : '';
    const list = evs.length
      ? evs.map(e => `<div class="dev"><b><i class="dot c-${cat(e)}"></i>${esc(shortName(e.name))}</b>` +
          `<span>${md(e.start)}${e.end !== e.start ? ' – ' + md(e.end) : ''} · ${esc(VENUE_NAME[e.venue] || e.place)}</span>` +
          (e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">공식 일정 ↗</a>` : '') + '</div>').join('')
      : '<div class="dnone">다음 날 열리는 행사가 없어요.</div>';
    $('detail').innerHTML =
      `<div class="dhead"><h3>${d.getMonth() + 1}월 ${d.getDate()}일(${WD[d.getDay()]}) 숙박 검토</h3>${tag}</div>` +
      `<div class="dbox">${list}</div>` +
      `<div class="mlabel">검토 메모</div>` +
      `<textarea id="memo" placeholder="예약 추이와 주변 요금 확인">${esc(rec.memo || '')}</textarea>` +
      (rec.done
        ? `<button class="okbtn undo" id="okBtn">검토 완료됨 · 다시 열기</button><div class="dmeta">완료 ${esc(rec.at || '')}</div>`
        : `<button class="okbtn" id="okBtn">✓ 검토 완료</button>`);
    $('memo').oninput = e => { REV[s] = Object.assign({}, REV[s], { memo: e.target.value }); saveRev(); };
    $('okBtn').onclick = () => {
      const now = new Date();
      const r = Object.assign({}, REV[s]);
      r.done = !r.done;
      r.at = r.done ? `${now.getMonth() + 1}/${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}` : '';
      REV[s] = r; saveRev();
      renderAll(false);
    };
  }

  function select(s) {
    selected = s;
    renderCalendar(); renderQueue(); renderDetail();
  }

  // ---------- 전체 ----------
  let lastDay = '';
  function renderAll(resetSel) {
    const t = todayStr();
    lastDay = t;
    if (resetSel || !selected) {
      const q = queueList(t, range);
      selected = q.find(s => !isDone(s)) || q[0] || t;
    }
    renderTop(); renderCalendar(); renderList(); renderQueue(); renderDetail(); tickClock();
    $('footL').textContent = `행사 데이터: 2026.09.12 엑셀 기준 · 검토 기록은 이 PC에 저장 (2단계에서 서버 저장)`;
  }

  // ---------- 조작 ----------
  function moveMonth(n) {
    monthOffset = n === 0 ? 0 : monthOffset + n;
    renderCalendar();
    clearTimeout(backTimer);
    if (monthOffset) backTimer = setTimeout(() => moveMonth(0), 60 * 1000);
  }
  $('calPrev').onclick = () => moveMonth(-1);
  $('calNext').onclick = () => moveMonth(1);
  $('calToday').onclick = () => moveMonth(0);
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight') moveMonth(1);
    if (e.key === 'ArrowLeft') moveMonth(-1);
    if (e.key === 'Home' || e.key === 'Escape') moveMonth(0);
  });
  function setView(v) {
    view = v;
    $('calView').classList.toggle('hidden', v !== 'cal');
    $('listView').classList.toggle('hidden', v !== 'list');
    $('vCal').classList.toggle('on', v === 'cal');
    $('vList').classList.toggle('on', v === 'list');
  }
  $('vCal').onclick = () => setView('cal');
  $('vList').onclick = () => setView('list');
  $('range').onchange = e => { range = Number(e.target.value); renderTop(); renderQueue(); renderCalendar(); };
  $('addBtn').onclick = () => {
    const el = $('toast');
    el.textContent = '행사 등록은 2단계(서버 연결)에서 열려요. 지금은 data/events.js에 추가해요.';
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 3000);
  };

  // 창 크기 맞춤: 높이 1080 기준, 남는 가로는 달력이 채움
  function fit() {
    const W = window.innerWidth, H = window.innerHeight;
    let k = H / 1080;
    if (W / k < 1600) k = W / 1600;
    document.body.style.width = `${W / k}px`;
    document.body.style.height = `${H / k}px`;
    document.body.style.transform = `scale(${k})`;
  }
  window.addEventListener('resize', fit);
  fit();

  renderAll(true);
  setInterval(() => {
    tickClock();
    if (todayStr() !== lastDay) renderAll(true);   // 자정이 지나면 다시 계산
  }, 15000);
  // 30분마다 새로 불러오기 (메모 입력 중이면 미룸)
  setInterval(() => {
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    location.reload();
  }, 30 * 60 * 1000);
})();
