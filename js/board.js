(function () {
  'use strict';

  let EVENTS = [];   // Supabase board_events 에서 불러옴
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
    if (e.category) return e.category;
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

  // ---------- Supabase 연결 ----------
  const CFG = window.BOARD_CONFIG;
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true } });
  let userEmail = '';
  let lastSync = null;

  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('on'), ms || 3000);
  }

  // ---------- 검토 기록 (Supabase board_reviews, 모든 PC 공유) ----------
  let REV = {};
  const isDone = s => !!(REV[s] && REV[s].done);
  const fmtAt = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  async function saveNight(s) {
    const r = REV[s] || {};
    const { error } = await sb.from('board_reviews').upsert({
      night: s, done: !!r.done, memo: r.memo || '',
      done_at: r.done ? (r.doneAt || new Date().toISOString()) : null,
      updated_at: new Date().toISOString()
    });
    if (error) toast('저장하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  const memoTimers = {};
  const saveMemoSoon = s => { clearTimeout(memoTimers[s]); memoTimers[s] = setTimeout(() => saveNight(s), 800); };

  // 예전에 이 PC 브라우저에만 저장했던 검토 기록이 있으면 서버로 옮김 (한 번만)
  async function migrateLocal() {
    let old = null;
    try { old = JSON.parse(localStorage.getItem('frontboard.reviews.v1') || 'null'); } catch (e) { old = null; }
    if (!old) return;
    const rows = Object.keys(old).filter(k => !REV[k]).map(k => ({
      night: k, done: !!old[k].done, memo: old[k].memo || '', done_at: old[k].done ? new Date().toISOString() : null
    }));
    if (rows.length) {
      const { error } = await sb.from('board_reviews').upsert(rows);
      if (error) return;
      rows.forEach(r => { REV[r.night] = { done: r.done, memo: r.memo, doneAt: r.done_at, at: fmtAt(r.done_at) }; });
    }
    try { localStorage.removeItem('frontboard.reviews.v1'); } catch (e) { /* 무시 */ }
  }

  // ---------- 데이터 불러오기 ----------
  async function loadData() {
    const [ev, rv] = await Promise.all([
      sb.from('board_events').select('*').eq('status', 'active').order('start_date'),
      sb.from('board_reviews').select('*')
    ]);
    if (ev.error || rv.error) {
      const err = ev.error || rv.error;
      if (err && /JWT|auth|permission|401/i.test(err.message + (err.code || ''))) { showLogin(); return false; }
      toast('데이터를 불러오지 못했어요. 1분 뒤 다시 시도해요.', 5000);
      setTimeout(refresh, 60 * 1000);
      return false;
    }
    EVENTS = ev.data.map(r => ({
      id: r.id, name: r.name, start: r.start_date, end: r.end_date, place: r.place || '',
      venue: r.venue || 'E', category: r.category, type: r.type || '', audience: r.audience || '',
      url: r.url || '', weight: r.weight || 1, b2b: !!r.b2b, keywords: r.keywords || [], source: r.source
    }));
    REV = {};
    rv.data.forEach(r => { REV[r.night] = { done: r.done, memo: r.memo || '', doneAt: r.done_at, at: fmtAt(r.done_at) }; });
    lastSync = new Date();
    return true;
  }

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
        h += `<div class="bar b-${cat(x.e)}${cont}${x.e.source === 'ai' ? ' ai' : ''}${showPast && x.b < t ? ' pastbar' : ''}" data-d="${x.a}" ` +
          `style="grid-column:${c1}/${c2};grid-row:${x.L + 2}" title="${esc(x.e.name)}">${x.e.source === 'ai' && x.a === x.e.start ? '<em>AI</em>' : ''}${esc(shortName(x.e.name))}</div>`;
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
        `<span class="ename"><i class="dot c-${cat(e)}"></i>${esc(shortName(e.name))}${e.source === 'ai' ? '<em class="aichip">AI</em>' : ''}</span>` +
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
      ? evs.map(e => `<div class="dev"><b><i class="dot c-${cat(e)}"></i>${esc(shortName(e.name))}${e.source === 'ai' ? '<em class="aichip">AI</em>' : ''}</b>` +
          `<span>${md(e.start)}${e.end !== e.start ? ' – ' + md(e.end) : ''} · ${esc(VENUE_NAME[e.venue] || e.place)}</span>` +
          (e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">공식 일정 ↗</a>` : '') +
          `<button class="hidebtn" data-id="${e.id}">숨기기</button></div>`).join('')
      : '<div class="dnone">다음 날 열리는 행사가 없어요.</div>';
    $('detail').innerHTML =
      `<div class="dhead"><h3>${d.getMonth() + 1}월 ${d.getDate()}일(${WD[d.getDay()]}) 숙박 검토</h3>${tag}</div>` +
      `<div class="dbox">${list}</div>` +
      `<div class="mlabel">검토 메모</div>` +
      `<textarea id="memo" placeholder="예약 추이와 주변 요금 확인">${esc(rec.memo || '')}</textarea>` +
      (rec.done
        ? `<button class="okbtn undo" id="okBtn">검토 완료됨 · 다시 열기</button><div class="dmeta">완료 ${esc(rec.at || '')}</div>`
        : `<button class="okbtn" id="okBtn">✓ 검토 완료</button>`);
    $('memo').oninput = e => { REV[s] = Object.assign({}, REV[s], { memo: e.target.value }); saveMemoSoon(s); };
    $('detail').querySelectorAll('.hidebtn').forEach(btn => {
      btn.onclick = async () => {
        if (!btn.classList.contains('arm')) {            // 실수 방지: 두 번 눌러야 숨김
          btn.classList.add('arm'); btn.textContent = '한 번 더 누르면 숨겨요';
          setTimeout(() => { btn.classList.remove('arm'); btn.textContent = '숨기기'; }, 4000);
          return;
        }
        const { error } = await sb.from('board_events').update({ status: 'hidden', updated_at: new Date().toISOString() }).eq('id', btn.dataset.id);
        if (error) { toast('숨기지 못했어요. 다시 시도해 주세요.'); return; }
        toast('행사를 숨겼어요. Supabase에서 status를 active로 바꾸면 다시 보여요.', 4000);
        await refresh();
      };
    });
    $('okBtn').onclick = () => {
      const r = Object.assign({}, REV[s]);
      r.memo = $('memo').value;
      r.done = !r.done;
      r.doneAt = r.done ? new Date().toISOString() : null;
      r.at = fmtAt(r.doneAt);
      REV[s] = r;
      clearTimeout(memoTimers[s]);
      saveNight(s);
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
    const ai = EVENTS.filter(e => e.source === 'ai').length;
    $('footL').textContent = `행사 ${EVENTS.length}건${ai ? ' (AI 추가 ' + ai + '건)' : ''} · 검토 기록은 모든 PC 공유` +
      (lastSync ? ` · 마지막 동기화 ${pad(lastSync.getHours())}:${pad(lastSync.getMinutes())}` : '');
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
    if (e.key === 'Escape' && !$('addModal').classList.contains('hidden')) { $('addModal').classList.add('hidden'); return; }
    if (['TEXTAREA', 'SELECT', 'INPUT'].includes(e.target.tagName)) return;
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
  // ---------- 행사 등록 창 ----------
  function openAdd() {
    $('addForm').reset();
    $('fErr').textContent = '';
    $('addModal').classList.remove('hidden');
    setTimeout(() => $('fName').focus(), 50);
  }
  const closeAdd = () => $('addModal').classList.add('hidden');
  $('addBtn').onclick = openAdd;
  $('fCancel').onclick = closeAdd;
  $('fStart').onchange = () => { if (!$('fEnd').value || $('fEnd').value < $('fStart').value) $('fEnd').value = $('fStart').value; };
  $('addForm').onsubmit = async ev => {
    ev.preventDefault();
    const name = $('fName').value.trim(), start = $('fStart').value, end = $('fEnd').value || start;
    const venue = $('fVenue').value, category = $('fCat').value;
    if (!name || !start) { $('fErr').textContent = '행사명과 시작일을 입력해 주세요.'; return; }
    if (end < start) { $('fErr').textContent = '종료일이 시작일보다 빨라요.'; return; }
    const row = {
      name, start_date: start, end_date: end, venue, category,
      place: $('fPlace').value.trim() || (venue === 'M' ? '수원메쎄' : venue === 'C' ? '수원컨벤션센터' : ''),
      url: $('fUrl').value.trim() || null, audience: $('fAud').value.trim() || null,
      type: { expo: '박람회·전시', conf: '학회·비즈니스', fest: '공연·축제' }[category],
      weight: venue === 'E' ? 1 : 2, b2b: category === 'conf', source: 'manual'
    };
    $('fSave').disabled = true;
    const { error } = await sb.from('board_events').insert(row);
    $('fSave').disabled = false;
    if (error) {
      $('fErr').textContent = /duplicate|unique/i.test(error.message) ? '같은 이름과 시작일의 행사가 이미 있어요.' : '저장하지 못했어요: ' + error.message;
      return;
    }
    closeAdd();
    toast('행사를 등록했어요.');
    await refresh();
  };

  // ---------- 로그인 ----------
  function showLogin() { $('login').classList.remove('hidden'); setTimeout(() => $('lEmail').focus(), 50); }
  function hideLogin() { $('login').classList.add('hidden'); }
  $('loginForm').onsubmit = async ev => {
    ev.preventDefault();
    $('lErr').textContent = '';
    $('lBtn').disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: $('lEmail').value.trim(), password: $('lPw').value });
    $('lBtn').disabled = false;
    if (error) { $('lErr').textContent = '이메일 또는 비밀번호가 맞지 않아요.'; return; }
    $('lPw').value = '';
    await startWith(data.session);
  };
  $('logoutBtn').onclick = async () => {
    if (!$('logoutBtn').classList.contains('arm')) {
      $('logoutBtn').classList.add('arm'); $('logoutBtn').textContent = '한 번 더 누르면 로그아웃';
      setTimeout(() => { $('logoutBtn').classList.remove('arm'); $('logoutBtn').textContent = '로그아웃'; }, 4000);
      return;
    }
    await sb.auth.signOut();
    location.reload();
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

  // ---------- 시작 ----------
  async function refresh() {
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;   // 메모 입력 중이면 미룸
    if (await loadData()) renderAll(false);
  }
  async function startWith(session) {
    userEmail = (session && session.user && session.user.email) || '';
    $('staffName').textContent = userEmail ? userEmail.split('@')[0] : '직원';
    hideLogin();
    if (await loadData()) { await migrateLocal(); renderAll(true); }
  }

  tickClock();
  sb.auth.getSession().then(({ data }) => { if (data.session) startWith(data.session); else showLogin(); });
  sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT') showLogin(); });

  setInterval(() => {
    tickClock();
    if (todayStr() !== lastDay && lastSync) renderAll(true);   // 자정이 지나면 다시 계산
  }, 15000);
  setInterval(refresh, 5 * 60 * 1000);                          // 5분마다 새 행사·검토 기록 반영
  // 하루 한 번 새로 불러오기 (코드 수정 반영, 메모 입력 중이면 미룸)
  setInterval(() => {
    if (document.activeElement && ['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;
    location.reload();
  }, 6 * 60 * 60 * 1000);
})();
