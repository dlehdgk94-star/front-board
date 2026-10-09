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
    let ov = 0;
    for (let i = 0; i < 14; i++) if (nightEvents(shift(t, i)).length >= 2) ov++;
    $('smOverlap').textContent = ov;

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

  // ---------- 달력 ----------
  function renderCalendar() {
    const t = todayStr();
    const now = parse(t);
    const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((first.getDay() + dim) / 7);
    const start = addDays(first, -first.getDay());
    $('calTitle').textContent = `${first.getFullYear()}년 ${first.getMonth() + 1}월`;

    let h = '';
    for (let i = 0; i < 7; i++) h += `<div class="wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${WD[i]}</div>`;
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i);
      const s = ymd(d);
      const out = d.getMonth() !== first.getMonth();
      const lv = nightLevel(s);
      const evs = eventsOn(s);
      const eve = showEve(s) ? eveEvents(s) : [];
      const hol = HOLIDAYS[s];
      const dow = d.getDay();
      let cap = weeks === 6 ? 2 : 3;
      if (eve.length) cap -= 1;
      const shown = evs.slice(0, evs.length > cap ? cap - 1 : cap);
      const cls = ['day', lv ? 'n' + lv : '', out ? 'out' : '', s < t && !out ? 'past' : '',
        s === t ? 'today' : '', s === selected ? 'sel' : ''].join(' ');
      h += `<div class="${cls}" data-d="${s}">` +
        `<div class="dtop"><span class="dn ${hol || dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}">${d.getDate()}</span>` +
        (s === t ? '<span class="ttag">오늘</span>' : '') +
        (hol ? `<span class="htag">${esc(hol)}</span>` : '') +
        (isDone(s) ? '<span class="okc">✓</span>' : '') + '</div>' +
        shown.map(e => `<div class="ev"><i class="dot c-${cat(e)}"></i>${esc(shortName(e.name))}</div>`).join('') +
        (evs.length > shown.length ? `<div class="ev more">+${evs.length - shown.length}개 더</div>` : '') +
        (eve.length ? `<div class="eve">전날 숙박${eve.length > 1 ? ' · ' + eve.length + '건' : ''}</div>` : '') +
        '</div>';
    }
    const cal = $('cal');
    cal.innerHTML = h;
    cal.querySelectorAll('.day').forEach(el => { el.onclick = () => select(el.dataset.d); });
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

  // ---------- 아래: 30일 숙박 흐름 ----------
  function renderFlow() {
    const t = todayStr();
    const days = [];
    for (let i = 0; i < 30; i++) { const s = shift(t, i); days.push({ s, sc: nightScore(s) }); }
    const max = Math.max(6, ...days.map(x => x.sc));
    $('flow').innerHTML = days.map((x, i) => {
      const d = parse(x.s), dow = d.getDay();
      const fd = HOLIDAYS[x.s] || dow === 0 ? 'sun' : dow === 5 || dow === 6 ? 'we' : '';
      return `<div class="fc n${nightLevel(x.s)} ${i === 0 ? 'today' : ''}" data-d="${x.s}">` +
        `<div class="fmk">${showEve(x.s) ? '<i class="tri"></i>' : ''}</div>` +
        `<div class="fbar"><i style="height:${Math.round(x.sc / max * 100)}%"></i></div>` +
        `<div class="fd ${fd}">${d.getDate()}<br>${WD[dow]}</div>` +
        `<div class="fok">${isDone(x.s) ? '<i></i>' : ''}</div></div>`;
    }).join('');
    $('flow').querySelectorAll('.fc').forEach(el => { el.onclick = () => select(el.dataset.d); });
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
    renderTop(); renderCalendar(); renderList(); renderQueue(); renderDetail(); renderFlow(); tickClock();
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
  $('range').onchange = e => { range = Number(e.target.value); renderTop(); renderQueue(); };
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
