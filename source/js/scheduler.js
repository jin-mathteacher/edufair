/* ============================================================
   scheduler.js — ★스케줄러 + 달력 + 투두리스트 (STEP 04)
   ------------------------------------------------------------
   ▶ 달력 (FullCalendar v6, 월/주/일)
     - 🔵 교사 발송 일정 : 학생 삭제 불가 (isFromTeacher)
     - 🟠 과제 마감     : 과제방 자동 연동(이후 STEP) — 읽기전용
     - ⚪ 개인 일정     : 본인만 보임 · 추가/삭제 가능
   ▶ 교사 → 학생 일정 공유
     교사 일정 등록 시 [학생에게 보내기] → 선택 반 학생 전원 달력에 자동 저장
     교사가 발송 일정을 삭제하면 받은 학생들에게서도 회수(동반 삭제)
   ▶ 투두리스트 (달력 우측 패널)
     - 날짜 클릭 → 해당 날짜 할 일 · 체크 시 저장(기기 간 동기화)
     - source: manual(직접) | homework(과제연동) | teacher(교사발송)

   ▶ Firebase 구조
     /schedules/{userId}/events/{eventId}
       title, date, time, color, memo, isFromTeacher, classId, groupKey, createdAt
     /todos/{userId}/{date}/{todoId}
       text, done, priority, source, createdAt

   ※ Firebase 연결 시 onValue 로 실시간 동기화, 미연결(데모)은 localStorage.
   ※ 블라인드 규칙: 학교명·성명·지역명을 코드에 포함하지 않습니다.
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     0) 데이터 계층 (Firebase / localStorage 공통)
  ============================================================ */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);
  const genId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const lsRoot = () => JSON.parse(localStorage.getItem(LS_DATA) || '{}');
  const lsSave = (r) => localStorage.setItem(LS_DATA, JSON.stringify(r));

  const DB = {
    async read(path) {
      if (useFB()) {
        const snap = await window.FB.db.ref(path).once('value');
        return snap.exists() ? snap.val() : null;
      }
      return path.split('/').reduce((o, k) => (o == null ? null : o[k]), lsRoot()) ?? null;
    },
    async write(path, val) {
      if (useFB()) { await window.FB.db.ref(path).set(val); return; }
      const root = lsRoot();
      const ks = path.split('/');
      let o = root;
      for (let i = 0; i < ks.length - 1; i++) { o[ks[i]] = o[ks[i]] || {}; o = o[ks[i]]; }
      o[ks[ks.length - 1]] = val;
      lsSave(root);
    },
    async remove(path) {
      if (useFB()) { await window.FB.db.ref(path).remove(); return; }
      const root = lsRoot();
      const ks = path.split('/');
      let o = root;
      for (let i = 0; i < ks.length - 1; i++) { if (o == null) return; o = o[ks[i]]; }
      if (o) delete o[ks[ks.length - 1]];
      lsSave(root);
    },
    // 실시간 구독 (FB 전용) → 해제 함수 반환 / 데모는 null
    subscribe(path, cb) {
      if (!useFB()) return null;
      const ref = window.FB.db.ref(path);
      const handler = ref.on('value', (snap) => cb(snap.val() || {}));
      return () => ref.off('value', handler);
    }
  };

  /* ============================================================
     1) 상수 · 유틸
  ============================================================ */
  const EVENT_TYPES = {
    teacher:  { label: '교사 발송', color: '#2563eb', dot: '🔵' },
    homework: { label: '과제 마감', color: '#f59e0b', dot: '🟠' },
    personal: { label: '개인 일정', color: '#94a3b8', dot: '⚪' }
  };
  const TODO_SOURCE = {
    manual:   { label: '직접', cls: 'src-manual' },
    homework: { label: '과제', cls: 'src-homework' },
    teacher:  { label: '선생님', cls: 'src-teacher' }
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayKey = () => fmtDate(new Date());
  const classLabel = (grade, classNo) => `${grade}학년 ${parseInt(classNo, 10)}반`;
  function prettyDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
    return `${m}월 ${d}일 (${wd})`;
  }

  /* ============================================================
     2) 모듈 상태
  ============================================================ */
  let user = null;
  let calendar = null;
  let selectedDate = todayKey();
  let unsubs = [];            // 실시간 구독 해제 함수들
  let rootEl = null;          // 현재 렌더 컨테이너

  function cleanup() {
    unsubs.forEach((fn) => { try { fn && fn(); } catch (e) {} });
    unsubs = [];
    if (calendar) { try { calendar.destroy(); } catch (e) {} calendar = null; }
  }

  /* ============================================================
     3) 진입점
  ============================================================ */
  async function render(container, currentUser) {
    cleanup();
    user = currentUser;
    rootEl = container;
    selectedDate = todayKey();

    const isTeacher = user.role === 'teacher';
    container.innerHTML = `
      <div class="sched-wrap">
        <!-- 달력 영역 -->
        <div class="sched-cal-col card">
          <div class="sched-toolbar">
            <div class="sched-legend">
              <span><i style="background:${EVENT_TYPES.teacher.color}"></i>교사 발송</span>
              <span><i style="background:${EVENT_TYPES.homework.color}"></i>과제 마감</span>
              <span><i style="background:${EVENT_TYPES.personal.color}"></i>개인 일정</span>
            </div>
            <button id="add-event" class="btn-primary">＋ 일정 추가</button>
          </div>
          <div id="cal-el"></div>
        </div>

        <!-- 투두 패널 -->
        <aside class="sched-todo-col card">
          <div class="todo-head">
            <h3 class="dash-title" style="margin:0">🗒️ 할 일</h3>
            <span id="todo-date" class="todo-date">${prettyDate(selectedDate)}</span>
          </div>
          <form id="todo-form" class="todo-form" autocomplete="off">
            <input id="todo-input" class="form-input" placeholder="할 일을 입력하고 Enter" maxlength="80">
            <button type="submit" class="btn-primary todo-add">추가</button>
          </form>
          <div id="todo-list" class="todo-list"></div>
        </aside>
      </div>
    `;

    // 달력 초기화
    initCalendar(container.querySelector('#cal-el'), isTeacher);

    // 일정 추가 버튼
    container.querySelector('#add-event').addEventListener('click', () => openEventModal());

    // 투두 추가
    const todoForm = container.querySelector('#todo-form');
    todoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = container.querySelector('#todo-input');
      const text = input.value.trim();
      if (!text) return;
      await addTodo(text);
      input.value = '';
    });

    // 데이터 로드 + 실시간 구독
    await reloadEvents();
    await renderTodos();
    subscribeRealtime();
  }

  /* ============================================================
     4) 달력
  ============================================================ */
  function initCalendar(el, isTeacher) {
    calendar = new FullCalendar.Calendar(el, {
      locale: 'ko',
      initialView: 'dayGridMonth',
      initialDate: selectedDate,
      height: 'auto',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      },
      buttonText: { today: '오늘', month: '월', week: '주', day: '일' },
      dayMaxEvents: 3,
      selectable: true,
      // 날짜 클릭 → 투두 패널을 해당 날짜로 전환
      dateClick: (info) => {
        setSelectedDate(info.dateStr);
        highlightSelected();
      },
      // 일정 클릭 → 상세/삭제
      eventClick: (info) => openEventDetail(info.event),
      events: []
    });
    calendar.render();
  }

  // 내 달력에 표시할 이벤트 로드
  async function reloadEvents() {
    const obj = (await DB.read(`schedules/${user.uid}/events`)) || {};
    const events = Object.values(obj).map(toFcEvent);
    if (!calendar) return;
    calendar.removeAllEvents();
    events.forEach((e) => calendar.addEvent(e));
  }

  function toFcEvent(ev) {
    const type = ev.type || (ev.isFromTeacher ? 'teacher' : 'personal');
    const color = EVENT_TYPES[type] ? EVENT_TYPES[type].color : EVENT_TYPES.personal.color;
    return {
      id: ev.id,
      title: ev.title,
      start: ev.time ? `${ev.date}T${ev.time}` : ev.date,
      allDay: !ev.time,
      backgroundColor: color,
      borderColor: color,
      extendedProps: {
        type, memo: ev.memo || '', isFromTeacher: !!ev.isFromTeacher,
        classId: ev.classId || '', date: ev.date, time: ev.time || '',
        groupKey: ev.groupKey || '', recipients: ev.recipients || null
      }
    };
  }

  function setSelectedDate(dateStr) {
    selectedDate = dateStr;
    if (rootEl) rootEl.querySelector('#todo-date').textContent = prettyDate(selectedDate);
    renderTodos();
  }

  // 선택 날짜 셀 강조
  function highlightSelected() {
    if (!rootEl) return;
    rootEl.querySelectorAll('.fc-daygrid-day.sel-day').forEach((c) => c.classList.remove('sel-day'));
    const cell = rootEl.querySelector(`.fc-daygrid-day[data-date="${selectedDate}"]`);
    if (cell) cell.classList.add('sel-day');
  }

  /* ============================================================
     5) 일정 추가/수정 모달
  ============================================================ */
  async function openEventModal() {
    const isTeacher = user.role === 'teacher';
    let classes = [];
    if (isTeacher) classes = await getClasses();

    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-4">일정 추가</h3>
      <form id="ev-form" class="space-y-3" autocomplete="off">
        <div>
          <label class="form-label">제목</label>
          <input id="ev-title" class="form-input" placeholder="예) 단원 평가, 준비물 안내" required>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="form-label">날짜</label>
            <input id="ev-date" type="date" class="form-input" value="${selectedDate}" required>
          </div>
          <div>
            <label class="form-label">시간 <span class="text-slate-400 font-normal">(선택)</span></label>
            <input id="ev-time" type="time" class="form-input">
          </div>
        </div>
        <div>
          <label class="form-label">메모 <span class="text-slate-400 font-normal">(선택)</span></label>
          <textarea id="ev-memo" class="form-input" rows="2" placeholder="세부 내용"></textarea>
        </div>

        ${isTeacher ? `
          <div class="ev-type-row">
            <label class="ev-radio"><input type="radio" name="ev-type" value="personal" checked> ⚪ 개인 일정</label>
            <label class="ev-radio"><input type="radio" name="ev-type" value="teacher"> 🔵 학생에게 보내기</label>
          </div>
          <div id="ev-classes" class="ev-classes hidden">
            ${classes.length ? `
              <p class="text-xs text-slate-500 mb-2">보낼 반을 선택하세요 (다중 선택 가능)</p>
              <div class="ev-class-grid">
                ${classes.map((c) => `
                  <label class="ev-class-chk">
                    <input type="checkbox" value="${c.classId}">
                    ${esc(classLabel(c.grade, c.classNo))}
                    <span class="ev-class-cnt">${c.students.length}명</span>
                  </label>`).join('')}
              </div>
            ` : `<p class="text-sm text-amber-600">등록된 학생이 없습니다. ⚙️ 설정에서 학생을 먼저 등록하세요.</p>`}
          </div>
        ` : `
          <p class="text-xs text-slate-400">⚪ 개인 일정으로 저장됩니다 (본인만 볼 수 있어요).</p>
        `}

        <p id="ev-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
        <div class="flex gap-2 justify-end">
          <button type="button" class="btn-ghost modal-close">취소</button>
          <button type="submit" class="btn-primary">저장</button>
        </div>
      </form>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);

    // 교사: 유형 라디오 → 반 선택 토글
    if (isTeacher) {
      const classesBox = box.querySelector('#ev-classes');
      box.querySelectorAll('input[name="ev-type"]').forEach((r) =>
        r.addEventListener('change', () =>
          classesBox.classList.toggle('hidden', box.querySelector('input[name="ev-type"]:checked').value !== 'teacher')));
    }

    box.querySelector('#ev-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = box.querySelector('#ev-error');
      const title = box.querySelector('#ev-title').value.trim();
      const date = box.querySelector('#ev-date').value;
      const time = box.querySelector('#ev-time').value;
      const memo = box.querySelector('#ev-memo').value.trim();
      if (!title || !date) { err.textContent = '제목과 날짜를 입력하세요.'; return; }

      const type = isTeacher
        ? box.querySelector('input[name="ev-type"]:checked').value
        : 'personal';

      try {
        if (type === 'teacher') {
          const classIds = [...box.querySelectorAll('#ev-classes input[type="checkbox"]:checked')].map((c) => c.value);
          if (!classIds.length) { err.textContent = '보낼 반을 1개 이상 선택하세요.'; return; }
          const n = await sendEventToClasses({ title, date, time, memo }, classIds);
          closeModal();
          toast(`🔵 ${n}명의 학생에게 일정을 보냈습니다.`);
        } else {
          await saveEvent({ title, date, time, memo, type: 'personal', isFromTeacher: false });
          closeModal();
          toast('일정이 추가되었습니다.');
        }
        await reloadEvents();
        setSelectedDate(date);
      } catch (ex) {
        console.error(ex);
        err.textContent = '저장 중 오류가 발생했습니다: ' + ex.message;
      }
    });
  }

  // 본인 달력에 일정 저장
  async function saveEvent(ev) {
    const id = genId();
    const rec = Object.assign({ id, createdAt: Date.now() }, ev);
    await DB.write(`schedules/${user.uid}/events/${id}`, rec);
    return id;
  }

  // 교사 → 선택 반 학생 전원에게 발송 (+ 교사 본인 달력에도 표시, 회수용 recipients 기록)
  async function sendEventToClasses(base, classIds) {
    const all = await Auth.listStudents();
    const targets = all.filter((s) => classIds.includes(s.classId));
    const groupKey = genId();
    const recipients = {};   // { studentUid: eventId }

    for (const s of targets) {
      const id = genId();
      recipients[s.uid] = id;
      await DB.write(`schedules/${s.uid}/events/${id}`, {
        id, groupKey,
        title: base.title, date: base.date, time: base.time || '', memo: base.memo || '',
        type: 'teacher', isFromTeacher: true, classId: s.classId,
        createdAt: Date.now()
      });
    }
    // 교사 본인 달력 사본 (회수 기준)
    const tId = genId();
    await DB.write(`schedules/${user.uid}/events/${tId}`, {
      id: tId, groupKey,
      title: base.title, date: base.date, time: base.time || '', memo: base.memo || '',
      type: 'teacher', isFromTeacher: false, classId: classIds.join(','),
      recipients, createdAt: Date.now()
    });
    return targets.length;
  }

  // 반 목록 (학생 그룹화)
  async function getClasses() {
    const students = await Auth.listStudents();
    const map = new Map();
    students.forEach((s) => {
      const id = s.classId || `${s.grade}${pad2(s.classNo)}`;
      if (!map.has(id)) map.set(id, { classId: id, grade: s.grade, classNo: s.classNo, students: [] });
      map.get(id).students.push(s);
    });
    return [...map.values()].sort((a, b) => a.classId.localeCompare(b.classId));
  }

  /* ============================================================
     6) 일정 상세 / 삭제
  ============================================================ */
  function openEventDetail(fcEvent) {
    const p = fcEvent.extendedProps;
    const typeInfo = EVENT_TYPES[p.type] || EVENT_TYPES.personal;
    const isTeacher = user.role === 'teacher';

    // 삭제 권한:
    //  - 학생: 개인 일정만 삭제 가능 (교사 발송/과제는 불가)
    //  - 교사: 자신의 모든 일정 삭제 가능 (발송 일정은 학생들에게서도 회수)
    const sharedByMe = isTeacher && p.type === 'teacher' && p.recipients;
    const canDelete = isTeacher ? true : (p.type === 'personal');

    const box = openModal(`
      <div class="flex items-center gap-2 mb-1">
        <span class="ev-type-badge" style="background:${typeInfo.color}">${typeInfo.label}</span>
      </div>
      <h3 class="text-lg font-bold text-slate-800 mb-2">${esc(fcEvent.title)}</h3>
      <div class="ev-detail">
        <p>📅 ${esc(prettyDate(p.date))}${p.time ? ` · ⏰ ${esc(p.time)}` : ''}</p>
        ${(isTeacher && p.type === 'teacher' && p.classId)
          ? `<p>🏫 발송 반: ${esc(p.classId.split(',').map(cidLabel).join(', '))}</p>` : ''}
        ${(!isTeacher && p.type === 'teacher') ? `<p>👩‍🏫 선생님이 보낸 일정</p>` : ''}
        ${p.memo ? `<p class="ev-memo">📝 ${esc(p.memo)}</p>` : ''}
      </div>
      ${!canDelete ? `<p class="text-xs text-slate-400 mt-3">🔒 선생님이 보낸 일정은 삭제할 수 없습니다.</p>` : ''}
      <div class="flex gap-2 justify-end mt-4">
        <button type="button" class="btn-ghost modal-close">닫기</button>
        ${canDelete ? `<button id="ev-del" class="btn-danger">${sharedByMe ? '회수(삭제)' : '삭제'}</button>` : ''}
      </div>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);

    const delBtn = box.querySelector('#ev-del');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (sharedByMe && !confirm('이 일정을 학생들에게서도 회수하고 삭제할까요?')) return;
      if (!sharedByMe && !confirm('이 일정을 삭제할까요?')) return;
      try {
        await deleteEvent(fcEvent.id, p);
        closeModal();
        await reloadEvents();
        toast(sharedByMe ? '일정을 회수했습니다.' : '일정이 삭제되었습니다.');
      } catch (ex) { alert('삭제 실패: ' + ex.message); }
    });
  }

  // classId(예 107) → 라벨
  function cidLabel(cid) {
    cid = String(cid);
    const grade = cid.slice(0, cid.length - 2);
    const classNo = cid.slice(-2);
    return `${grade}학년 ${parseInt(classNo, 10)}반`;
  }

  async function deleteEvent(eventId, p) {
    // 교사가 발송한 일정이면 받은 학생들 사본도 제거 (회수)
    if (user.role === 'teacher' && p.type === 'teacher' && p.recipients) {
      for (const [uid, evId] of Object.entries(p.recipients)) {
        await DB.remove(`schedules/${uid}/events/${evId}`);
      }
    }
    await DB.remove(`schedules/${user.uid}/events/${eventId}`);
  }

  /* ============================================================
     7) 투두리스트
  ============================================================ */
  async function renderTodos() {
    if (!rootEl) return;
    const listEl = rootEl.querySelector('#todo-list');
    if (!listEl) return;
    const obj = (await DB.read(`todos/${user.uid}/${selectedDate}`)) || {};
    const todos = Object.values(obj).sort((a, b) =>
      (b.priority === 'high') - (a.priority === 'high') || (a.createdAt || 0) - (b.createdAt || 0));

    if (!todos.length) {
      listEl.innerHTML = `<div class="todo-empty">이 날짜에 등록된 할 일이 없어요.<br>위에 입력해 추가해 보세요.</div>`;
      return;
    }
    const done = todos.filter((t) => t.done).length;
    listEl.innerHTML = `
      <div class="todo-progress">
        <div class="pbar"><div class="pbar-fill" style="width:${Math.round(done / todos.length * 100)}%"></div>
          <span class="pbar-txt">${done}/${todos.length}</span></div>
      </div>
      ${todos.map((t) => {
        const src = TODO_SOURCE[t.source] || TODO_SOURCE.manual;
        const canDel = t.source === 'manual';
        return `
        <div class="todo-item ${t.done ? 'done' : ''} ${t.priority === 'high' ? 'high' : ''}" data-id="${t.id}">
          <button class="todo-check" title="완료 토글">${t.done ? '☑' : '☐'}</button>
          <span class="todo-text">${esc(t.text)}</span>
          <span class="todo-src ${src.cls}">${src.label}</span>
          <button class="todo-star" title="중요 표시">${t.priority === 'high' ? '⭐' : '☆'}</button>
          ${canDel ? `<button class="todo-del" title="삭제">✕</button>` : `<span class="todo-lock" title="자동 추가 항목">🔒</span>`}
        </div>`;
      }).join('')}
    `;

    listEl.querySelectorAll('.todo-item').forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('.todo-check').addEventListener('click', () => toggleTodo(id));
      row.querySelector('.todo-star').addEventListener('click', () => togglePriority(id));
      const del = row.querySelector('.todo-del');
      if (del) del.addEventListener('click', () => removeTodo(id));
    });
  }

  async function addTodo(text) {
    const id = genId();
    await DB.write(`todos/${user.uid}/${selectedDate}/${id}`, {
      id, text, done: false, priority: 'normal', source: 'manual', createdAt: Date.now()
    });
    await renderTodos();
  }
  async function toggleTodo(id) {
    const t = await DB.read(`todos/${user.uid}/${selectedDate}/${id}`);
    if (!t) return;
    t.done = !t.done;
    await DB.write(`todos/${user.uid}/${selectedDate}/${id}`, t);
    await renderTodos();
  }
  async function togglePriority(id) {
    const t = await DB.read(`todos/${user.uid}/${selectedDate}/${id}`);
    if (!t) return;
    t.priority = t.priority === 'high' ? 'normal' : 'high';
    await DB.write(`todos/${user.uid}/${selectedDate}/${id}`, t);
    await renderTodos();
  }
  async function removeTodo(id) {
    await DB.remove(`todos/${user.uid}/${selectedDate}/${id}`);
    await renderTodos();
  }

  /* ============================================================
     8) 실시간 동기화 (Firebase) — 다른 기기/교사 발송 즉시 반영
  ============================================================ */
  function subscribeRealtime() {
    const u1 = DB.subscribe(`schedules/${user.uid}/events`, () => reloadEvents());
    const u2 = DB.subscribe(`todos/${user.uid}`, () => renderTodos());
    if (u1) unsubs.push(u1);
    if (u2) unsubs.push(u2);
  }

  /* ============================================================
     9) 모달 · 토스트 (자체 구현 — app.js와 독립)
  ============================================================ */
  function openModal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-overlay"><div class="modal-box">${html}</div></div>`;
    return root.querySelector('.modal-box');
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

  function toast(msg) {
    let el = document.getElementById('app-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-toast';
      el.className = 'app-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* 전역 노출 */
  window.Scheduler = { render };
  console.log('[scheduler] STEP 04 로드 완료 — 달력/투두/교사발송 준비됨');
})();
