/* ============================================================
   collab.js — 학습실 ▸ 협업의 장 (STEP 11)
   ------------------------------------------------------------
   두 가지 하위 기능:
     1) 🤝 협업 화이트보드  — 실시간 동시편집(여러 학생이 한 보드에 함께 필기)
     2) ⚔️ 배움 대전        — 실시간 스피드 퀴즈 대전 + 포인트/뱃지 게이미피케이션

   ▶ 실시간 동기화는 Firebase 연결 시 onValue 로 동작.
     미연결(데모) 모드에서는 같은 브라우저 안에서만 즉시 반영(로컬 저장).

   ▶ Firebase 구조
     /collabBoards/{boardId}
       title, host, hostName, scope('all'|'class'), classIds{cid:true}, createdAt, closed
     /collabBoards/{boardId}/strokes/{strokeId}
       tool('pen'|'eraser'), color, width, pts:[{x,y}](0~1 정규화), uid, name, at
     /battles/{battleId}
       title, host, hostName, scope, classIds{}, status('waiting'|'live'|'ended'),
       qIndex, qStartAt, perQSec, createdAt,
       questions:[평가(assessment)와 동일한 문항 객체] — single·multi·tf·short·math·graph·order (자동채점 가능 유형)
     /battles/{battleId}/players/{uid}
       name, score, correctCount, lastAnswered, joinedAt

   ▶ 포인트/뱃지는 chatbot/포트폴리오와 공유되는 Auth.saveMyData({points,badges}) 사용.
============================================================ */

window.Collab = (function () {
  'use strict';

  /* ============================================================
     0) 저장소 헬퍼 (scheduler/lesson 과 동일 패턴 · FB + localStorage)
  ============================================================ */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);
  const genId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    async update(path, patch) {
      if (useFB()) { await window.FB.db.ref(path).update(patch); return; }
      const cur = (await DB.read(path)) || {};
      await DB.write(path, Object.assign(cur, patch));
    },
    async push(path, val) {
      const id = useFB() ? window.FB.db.ref(path).push().key : genId();
      await DB.write(`${path}/${id}`, val);
      return id;
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
    // 실시간 구독 (FB 전용) → 해제 함수 / 데모는 null
    subscribe(path, cb) {
      if (!useFB()) return null;
      const ref = window.FB.db.ref(path);
      const handler = ref.on('value', (snap) => cb(snap.val() || {}));
      return () => ref.off('value', handler);
    }
  };

  /* ============================================================
     1) 유틸
  ============================================================ */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const classLabel = (grade, classNo) => `${grade}학년 ${parseInt(classNo, 10)}반`;
  const cidLabel = (cid) => {
    const g = String(cid).slice(0, -2), c = String(cid).slice(-2);
    return `${parseInt(g, 10)}학년 ${parseInt(c, 10)}반`;
  };
  const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const USER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#ca8a04', '#4f46e5', '#0d9488'];
  function colorFor(uid) {
    let h = 0; const s = String(uid || 'x');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return USER_COLORS[h % USER_COLORS.length];
  }

  function toast(msg) {
    let el = document.getElementById('app-toast');
    if (!el) { el = document.createElement('div'); el.id = 'app-toast'; el.className = 'app-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

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

  // 학생에게 보일 범위인가 (전체 또는 내 반)
  function visibleToUser(item) {
    if (user.role === 'teacher') return true;
    if (!item || item.scope === 'all' || !item.scope) return true;
    return !!(item.classIds && user.classId && item.classIds[user.classId]);
  }

  /* 포인트/뱃지 — chatbot 과 공유 필드 */
  const BADGES = [
    { p: 0, icon: '🌱', name: '새싹' }, { p: 20, icon: '✨', name: '탐구러' },
    { p: 50, icon: '🔥', name: '질문왕' }, { p: 100, icon: '🏅', name: '수학멘토' }, { p: 200, icon: '👑', name: '수학마스터' }
  ];
  const badgeFor = (p) => BADGES.filter((b) => (p || 0) >= b.p).slice(-1)[0] || BADGES[0];
  async function addPoints(n) {
    if (!n) return;
    try {
      const me = (await Auth.getMyData()) || user;
      const before = me.points || 0; const after = before + n;
      const newBadges = (me.badges || []).slice();
      const nb = badgeFor(after);
      if (!newBadges.includes(nb.name)) newBadges.push(nb.name);
      await Auth.saveMyData({ points: after, badges: newBadges });
      if (badgeFor(before).name !== nb.name) toast(`뱃지 획득: ${nb.icon} ${nb.name}!`);
    } catch (e) {}
  }

  /* ============================================================
     2) 모듈 상태
  ============================================================ */
  let user = null;
  let rootEl = null;
  let subTab = 'board';           // 'board' | 'battle'
  let unsubs = [];                // 실시간 구독 해제 함수
  let timers = [];                // setInterval id

  function clearSubs() { unsubs.forEach((fn) => { try { fn && fn(); } catch (e) {} }); unsubs = []; }
  function clearTimers() { timers.forEach((t) => clearInterval(t)); timers = []; }

  function teardown() {
    clearSubs(); clearTimers();
    board.active = null; battle.active = null;
  }

  /* ============================================================
     3) 진입점 · 하위 탭
  ============================================================ */
  function render(container, currentUser) {
    teardown();
    user = currentUser;
    rootEl = container;

    container.innerHTML = `
      <div class="collab-wrap">
        <div class="collab-subtabs" id="collab-subtabs">
          <button class="collab-subtab ${subTab === 'board' ? 'active' : ''}" data-sub="board">🤝 협업 화이트보드</button>
          <button class="collab-subtab ${subTab === 'battle' ? 'active' : ''}" data-sub="battle">⚔️ 배움 대전</button>
        </div>
        <div id="collab-body" class="collab-body"></div>
      </div>`;

    container.querySelector('#collab-subtabs').addEventListener('click', (e) => {
      const b = e.target.closest('.collab-subtab');
      if (!b) return;
      selectSub(b.dataset.sub);
    });
    selectSub(subTab);
  }

  function selectSub(key) {
    subTab = key;
    clearSubs(); clearTimers();
    board.active = null; battle.active = null;
    if (!rootEl) return;
    rootEl.querySelectorAll('.collab-subtab').forEach((t) =>
      t.classList.toggle('active', t.dataset.sub === key));
    const body = rootEl.querySelector('#collab-body');
    if (key === 'board') board.renderList(body);
    else battle.renderList(body);
  }

  /* ============================================================
     4) 🤝 협업 화이트보드
  ============================================================ */
  const board = {
    active: null,   // 현재 열린 보드 { id, meta }
    strokes: {},    // 현재 보드 strokes
    tool: 'pen', color: '#1e293b', width: 4,
    drawing: false, livePts: null,
    canvas: null, ctx: null,

    async renderList(body) {
      const isTeacher = user.role === 'teacher';
      body.innerHTML = `
        <div class="card">
          <div class="collab-head">
            <div>
              <h3 class="dash-title" style="margin:0">🤝 협업 화이트보드</h3>
              <p class="collab-sub">${isTeacher
                ? '학생들이 함께 그리고 풀이를 공유하는 실시간 보드를 만들어 보세요.'
                : '선생님이 연 보드에 들어가 친구들과 함께 풀이를 작성해요.'}</p>
            </div>
            ${isTeacher ? '<button id="cb-new-board" class="btn-primary">＋ 보드 만들기</button>' : ''}
          </div>
          ${!useFB() ? '<p class="collab-note">⚠ 실시간 동시편집은 <b>Firebase 연결 시</b> 여러 기기에서 함께 동작합니다. (현재 데모 모드: 이 기기에서만 반영)</p>' : ''}
          <div id="cb-board-list" class="collab-list"><p class="collab-loading">불러오는 중…</p></div>
        </div>`;

      if (isTeacher) body.querySelector('#cb-new-board').addEventListener('click', () => board.openCreate());

      const listEl = body.querySelector('#cb-board-list');
      const renderList = (map) => {
        const boards = Object.entries(map || {})
          .map(([id, b]) => ({ id, ...b }))
          .filter((b) => !b.closed && visibleToUser(b))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (!boards.length) {
          listEl.innerHTML = `<p class="collab-empty">${isTeacher ? '아직 만든 보드가 없습니다. ＋ 보드 만들기로 시작하세요.' : '아직 열린 보드가 없습니다. 선생님이 보드를 열면 여기에 표시됩니다.'}</p>`;
          return;
        }
        listEl.innerHTML = boards.map((b) => `
          <div class="collab-card" data-id="${b.id}">
            <div class="collab-card-icon">🧑‍🤝‍🧑</div>
            <div class="collab-card-info">
              <p class="collab-card-title">${esc(b.title)}</p>
              <p class="collab-card-meta">${esc(b.hostName || '교사')} · ${b.scope === 'class'
                ? esc(Object.keys(b.classIds || {}).map(cidLabel).join(', ') || '특정 반') : '전체 학생'}</p>
            </div>
            <div class="collab-card-actions">
              <button class="btn-primary cb-open">들어가기</button>
              ${user.role === 'teacher' && b.host === user.uid ? '<button class="btn-mini cb-del text-red-500">삭제</button>' : ''}
            </div>
          </div>`).join('');
        listEl.querySelectorAll('.collab-card').forEach((card) => {
          const id = card.dataset.id;
          card.querySelector('.cb-open').addEventListener('click', () => board.open(id, map[id]));
          const del = card.querySelector('.cb-del');
          if (del) del.addEventListener('click', async () => {
            if (!confirm('이 보드를 삭제할까요? 필기 내용도 함께 사라집니다.')) return;
            await DB.remove(`collabBoards/${id}`);
            if (!useFB()) renderList((await DB.read('collabBoards')) || {});
          });
        });
      };

      const un = DB.subscribe('collabBoards', renderList);
      if (un) unsubs.push(un); else renderList((await DB.read('collabBoards')) || {});
    },

    async openCreate() {
      const classes = await getClasses();
      const box = openModal(`
        <h3 class="text-lg font-bold text-slate-800 mb-3">협업 화이트보드 만들기</h3>
        <form id="cbb-form" class="space-y-3" autocomplete="off">
          <div>
            <label class="form-label">보드 제목</label>
            <input id="cbb-title" class="form-input" placeholder="예) 2단원 도형 함께 풀기" required>
          </div>
          <div class="mat-scope-row">
            <label class="ev-radio"><input type="radio" name="cbb-scope" value="all" checked> ⚪ 전체 학생</label>
            <label class="ev-radio"><input type="radio" name="cbb-scope" value="class"> 🔵 특정 반</label>
          </div>
          <div id="cbb-classes" class="ev-classes hidden">
            ${classes.length ? `
              <p class="text-xs text-slate-500 mb-2">참여할 반을 선택하세요 (다중 선택 가능)</p>
              <div class="ev-class-grid">
                ${classes.map((c) => `
                  <label class="ev-class-chk">
                    <input type="checkbox" value="${c.classId}">
                    ${esc(classLabel(c.grade, c.classNo))}
                    <span class="ev-class-cnt">${c.students.length}명</span>
                  </label>`).join('')}
              </div>` : '<p class="text-sm text-amber-600">등록된 학생이 없습니다. ⚙️ 설정에서 학생을 먼저 등록하세요.</p>'}
          </div>
          <p id="cbb-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-ghost modal-close">취소</button>
            <button type="submit" class="btn-primary">만들기</button>
          </div>
        </form>`);
      box.querySelector('.modal-close').addEventListener('click', closeModal);
      const classesBox = box.querySelector('#cbb-classes');
      box.querySelectorAll('input[name="cbb-scope"]').forEach((r) =>
        r.addEventListener('change', () =>
          classesBox.classList.toggle('hidden',
            box.querySelector('input[name="cbb-scope"]:checked').value !== 'class')));

      box.querySelector('#cbb-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = box.querySelector('#cbb-error');
        const title = box.querySelector('#cbb-title').value.trim();
        if (!title) { err.textContent = '제목을 입력하세요.'; return; }
        const scope = box.querySelector('input[name="cbb-scope"]:checked').value;
        let classIds = null;
        if (scope === 'class') {
          const picked = [...box.querySelectorAll('#cbb-classes input:checked')].map((c) => c.value);
          if (!picked.length) { err.textContent = '참여할 반을 1개 이상 선택하세요.'; return; }
          classIds = picked.reduce((o, c) => ((o[c] = true), o), {});
        }
        await DB.push('collabBoards', {
          title, host: user.uid, hostName: user.name || user.loginId,
          scope, classIds, closed: false, createdAt: Date.now()
        });
        closeModal();
        toast('보드를 만들었습니다.');
        if (!useFB()) selectSub('board');
      });
    },

    async open(id, meta) {
      clearSubs();
      this.active = { id, meta };
      this.strokes = {};
      const isTeacher = user.role === 'teacher';
      const body = rootEl.querySelector('#collab-body');
      body.innerHTML = `
        <div class="card collab-stage">
          <div class="collab-board-bar">
            <button id="cb-back" class="btn-ghost">← 목록</button>
            <span class="collab-board-name">${esc(meta.title)}</span>
            <div class="collab-tools">
              <button class="cb-tool ${this.tool === 'pen' ? 'on' : ''}" data-tool="pen" title="펜">✏️</button>
              <button class="cb-tool ${this.tool === 'eraser' ? 'on' : ''}" data-tool="eraser" title="지우개">🧽</button>
              <span class="cb-swatches">
                ${['#1e293b', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c'].map((c) =>
                  `<button class="cb-swatch ${c === this.color ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
              </span>
              <input id="cb-width" type="range" min="2" max="16" value="${this.width}" title="굵기">
              <button id="cb-undo" class="btn-mini" title="내 마지막 획 취소">↩ 되돌리기</button>
              <button id="cb-clear-mine" class="btn-mini">내 필기 지우기</button>
              ${isTeacher ? '<button id="cb-clear-all" class="btn-mini text-red-500">전체 지우기</button>' : ''}
            </div>
          </div>
          <div id="cb-canvas-wrap" class="collab-canvas-wrap">
            <canvas id="cb-canvas"></canvas>
          </div>
          <div id="cb-participants" class="collab-participants"></div>
        </div>`;

      body.querySelector('#cb-back').addEventListener('click', () => selectSub('board'));
      this.canvas = body.querySelector('#cb-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.bindTools(body);
      this.bindPointer();

      const onResize = () => { this.fitCanvas(); this.redraw(); };
      this._onResize = onResize;
      window.addEventListener('resize', onResize);
      unsubs.push(() => window.removeEventListener('resize', onResize));
      this.fitCanvas();

      const onStrokes = (map) => {
        this.strokes = map || {};
        this.redraw();
        this.renderParticipants();
      };
      const un = DB.subscribe(`collabBoards/${id}/strokes`, onStrokes);
      if (un) unsubs.push(un); else onStrokes((await DB.read(`collabBoards/${id}/strokes`)) || {});
    },

    bindTools(body) {
      body.querySelectorAll('.cb-tool').forEach((b) =>
        b.addEventListener('click', () => {
          this.tool = b.dataset.tool;
          body.querySelectorAll('.cb-tool').forEach((x) => x.classList.toggle('on', x === b));
        }));
      body.querySelectorAll('.cb-swatch').forEach((b) =>
        b.addEventListener('click', () => {
          this.color = b.dataset.color; this.tool = 'pen';
          body.querySelectorAll('.cb-swatch').forEach((x) => x.classList.toggle('on', x === b));
          body.querySelectorAll('.cb-tool').forEach((x) => x.classList.toggle('on', x.dataset.tool === 'pen'));
        }));
      body.querySelector('#cb-width').addEventListener('input', (e) => { this.width = +e.target.value; });
      body.querySelector('#cb-undo').addEventListener('click', () => this.undoMine());
      body.querySelector('#cb-clear-mine').addEventListener('click', () => this.clearMine());
      const ca = body.querySelector('#cb-clear-all');
      if (ca) ca.addEventListener('click', () => this.clearAll());
    },

    fitCanvas() {
      const wrap = this.canvas.parentElement;
      const cssW = wrap.clientWidth;
      const cssH = Math.round(cssW * 0.6);   // 5:3 비율
      const dpr = window.devicePixelRatio || 1;
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._cssW = cssW; this._cssH = cssH;
    },

    // 정규화 좌표(0~1) → CSS 픽셀
    toPx(p) { return { x: p.x * this._cssW, y: p.y * this._cssH }; },
    fromEvent(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    },

    drawStroke(s) {
      const pts = s.pts || [];
      if (!pts.length) return;
      const ctx = this.ctx;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : (s.color || '#1e293b');
      ctx.lineWidth = (s.width || 4) * (s.tool === 'eraser' ? 3 : 1);
      ctx.beginPath();
      const a = this.toPx(pts[0]);
      ctx.moveTo(a.x, a.y);
      if (pts.length === 1) ctx.lineTo(a.x + 0.1, a.y + 0.1);
      for (let i = 1; i < pts.length; i++) { const p = this.toPx(pts[i]); ctx.lineTo(p.x, p.y); }
      ctx.stroke();
    },

    redraw() {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, this._cssW, this._cssH);
      const all = Object.values(this.strokes || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
      all.forEach((s) => this.drawStroke(s));
      if (this.livePts) this.drawStroke({ tool: this.tool, color: this.color, width: this.width, pts: this.livePts });
    },

    bindPointer() {
      const c = this.canvas;
      const down = (e) => {
        e.preventDefault();
        this.drawing = true;
        this.livePts = [this.fromEvent(e)];
        c.setPointerCapture && c.setPointerCapture(e.pointerId);
      };
      const move = (e) => {
        if (!this.drawing) return;
        e.preventDefault();
        this.livePts.push(this.fromEvent(e));
        this.redraw();
      };
      const up = async (e) => {
        if (!this.drawing) return;
        this.drawing = false;
        const pts = this.livePts; this.livePts = null;
        if (!pts || pts.length < 1) { this.redraw(); return; }
        // 좌표 소수 4자리로 압축
        const slim = pts.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) }));
        const stroke = { tool: this.tool, color: this.color, width: this.width, pts: slim, uid: user.uid, name: user.name || user.loginId, at: Date.now() };
        const id = this.active.id;
        const sid = await DB.push(`collabBoards/${id}/strokes`, stroke);
        if (!useFB()) { this.strokes[sid] = stroke; this.redraw(); this.renderParticipants(); }
      };
      c.addEventListener('pointerdown', down);
      c.addEventListener('pointermove', move);
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('pointerleave', up);
    },

    async undoMine() {
      const mine = Object.entries(this.strokes || {})
        .filter(([, s]) => s.uid === user.uid)
        .sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      if (!mine.length) return;
      const [sid] = mine[0];
      await DB.remove(`collabBoards/${this.active.id}/strokes/${sid}`);
      if (!useFB()) { delete this.strokes[sid]; this.redraw(); this.renderParticipants(); }
    },

    async clearMine() {
      const mine = Object.entries(this.strokes || {}).filter(([, s]) => s.uid === user.uid);
      if (!mine.length) return;
      if (!confirm('내가 그린 필기를 모두 지울까요?')) return;
      for (const [sid] of mine) await DB.remove(`collabBoards/${this.active.id}/strokes/${sid}`);
      if (!useFB()) { mine.forEach(([sid]) => delete this.strokes[sid]); this.redraw(); this.renderParticipants(); }
    },

    async clearAll() {
      if (!confirm('보드 전체 필기를 지울까요? (모든 학생)')) return;
      await DB.remove(`collabBoards/${this.active.id}/strokes`);
      if (!useFB()) { this.strokes = {}; this.redraw(); this.renderParticipants(); }
    },

    renderParticipants() {
      const el = rootEl && rootEl.querySelector('#cb-participants');
      if (!el) return;
      const seen = new Map();
      Object.values(this.strokes || {}).forEach((s) => {
        if (s.uid && !seen.has(s.uid)) seen.set(s.uid, s.name || '참여자');
      });
      if (!seen.size) { el.innerHTML = '<span class="collab-part-empty">아직 참여한 친구가 없어요. 먼저 그려보세요!</span>'; return; }
      el.innerHTML = '<span class="collab-part-label">참여:</span>' +
        [...seen.entries()].map(([uid, name]) =>
          `<span class="collab-chip" style="border-color:${colorFor(uid)};color:${colorFor(uid)}">${esc(name)}</span>`).join('');
    }
  };

  /* ============================================================
     5) ⚔️ 배움 대전 (스피드 퀴즈)
  ============================================================ */
  const QGEN = {
    easy() {
      const t = rint(0, 2);
      let q, ans;
      if (t === 0) { const a = rint(11, 49), b = rint(11, 49); q = `${a} + ${b}`; ans = a + b; }
      else if (t === 1) { const a = rint(30, 80), b = rint(5, 29); q = `${a} − ${b}`; ans = a - b; }
      else { const a = rint(3, 12), b = rint(3, 9); q = `${a} × ${b}`; ans = a * b; }
      return { q, ans };
    },
    medium() {
      const t = rint(0, 2);
      let q, ans;
      if (t === 0) { const x = rint(2, 12), a = rint(2, 6), b = rint(1, 20); q = `${a}x + ${b} = ${a * x + b} 일 때 x`; ans = x; }
      else if (t === 1) { const p = [10, 20, 25, 50][rint(0, 3)], ans1 = rint(3, 30); const base = Math.round(ans1 * 100 / p); q = `${base} 의 ${p}%`; ans = ans1; }
      else { const a = rint(2, 9); q = `${a}² (제곱)`; ans = a * a; }
      return { q, ans };
    },
    hard() {
      const t = rint(0, 2);
      let q, ans;
      if (t === 0) { const r = rint(2, 9), s = rint(1, 8); q = `x² − ${r + s}x + ${r * s} = 0 의 두 근의 합`; ans = r + s; }
      else if (t === 1) { const a = rint(2, 6); q = `2의 ${a}제곱 (2^${a})`; ans = Math.pow(2, a); }
      else { const x = rint(2, 9), y = rint(2, 9); q = `x+y=${x + y}, x−y=${x - y} 일 때 x`; ans = x; }
      return { q, ans };
    }
  };

  const LEVELS = { easy: '쉬움 (덧셈·뺄셈·곱셈)', medium: '보통 (일차방정식·제곱·%)', hard: '어려움 (이차식·지수·연립)' };

  // 배움 대전은 평가(assessment)와 동일한 문항 포맷을 사용한다.
  // 자동채점 가능한 유형만 대전에 사용(서술형·즉답통계 제외).
  const GRADABLE = (window.Assess && Assess.GRADABLE_TYPES) || ['single', 'multi', 'tf', 'short', 'math', 'graph', 'order'];
  const qid = () => 'bq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const LEVEL_MAP = { easy: 'easy', medium: 'mid', hard: 'hard' };

  // 자동 생성 — 평가 'single'(5지선다) 포맷으로
  function makeQuestions(level, n) {
    const gen = QGEN[level] || QGEN.easy;
    const out = [];
    const seen = new Set();
    let guard = 0;
    while (out.length < n && guard++ < n * 12) {
      const { q, ans } = gen();
      if (seen.has(q) || !isFinite(ans)) continue;
      seen.add(q);
      // 보기 5개 (정답 + 근접 오답) — 기본 5지선다
      const opts = new Set([ans]);
      let g2 = 0;
      while (opts.size < 5 && g2++ < 60) {
        const delta = rint(1, Math.max(3, Math.abs(Math.round(ans * 0.25)) + 4)) * (Math.random() < 0.5 ? -1 : 1);
        const cand = ans + delta;
        if (cand !== ans) opts.add(cand);
      }
      const choices = shuffle([...opts]).map(String);
      out.push({
        id: qid(), type: 'single', prompt: q, image: null,
        choices, answer: choices.indexOf(String(ans)),
        comp: 'problem', level: LEVEL_MAP[level] || 'mid', points: 1
      });
    }
    return out;
  }

  // 평가 문항을 대전용으로 복제(새 id 부여)
  function cloneForBattle(aq) {
    const c = JSON.parse(JSON.stringify(aq || {}));
    c.id = qid();
    return c;
  }

  // 대전에서 쓸 수 있는 문항인가 (자동채점 가능 유형 + 최소 요건)
  function usableBattleQ(q) {
    if (!q || GRADABLE.indexOf(q.type) < 0) return false;
    if (!String(q.prompt || '').trim() && !q.image) return false;
    if (q.type === 'single') return Array.isArray(q.choices) && q.choices.filter((c) => String(c).trim()).length >= 2 && q.answer >= 0 && q.answer < q.choices.length && !!String(q.choices[q.answer] || '').trim();
    if (q.type === 'multi') return Array.isArray(q.choices) && q.choices.filter((c) => String(c).trim()).length >= 2 && (q.answers || []).length >= 1;
    if (q.type === 'tf') return q.answer === true || q.answer === false;
    if (q.type === 'short') return (q.accept || []).some((x) => String(x).trim());
    if (q.type === 'math' || q.type === 'graph') return !!String(q.answer || '').trim();
    if (q.type === 'order') return (q.items || []).filter((x) => String(x).trim()).length >= 2;
    return false;
  }

  // 문항 발문 + 이미지 표시 (진행자/응시 공용)
  function stemHtml(q) {
    const stem = String(q.prompt || '').trim();
    return `${stem ? `<div class="bt-question">${esc(stem)}</div>` : ''}${q.image ? `<div class="bt-qimg-wrap"><img class="bt-qimg" src="${esc(q.image)}" alt="문항 이미지"></div>` : ''}`;
  }

  const battle = {
    active: null,   // { id, meta }
    players: {},
    answeredIndex: -1,
    tick: null,

    async renderList(body) {
      const isTeacher = user.role === 'teacher';
      body.innerHTML = `
        <div class="card">
          <div class="collab-head">
            <div>
              <h3 class="dash-title" style="margin:0">⚔️ 배움 대전</h3>
              <p class="collab-sub">${isTeacher
                ? '스피드 퀴즈 대전방을 열고 학생들과 실시간 순위 경쟁을 진행하세요.'
                : '대전방에 입장해 빠르고 정확하게 풀고 포인트를 획득하세요!'}</p>
            </div>
            ${isTeacher ? '<button id="bt-new" class="btn-primary">＋ 대전방 만들기</button>' : ''}
          </div>
          ${!useFB() ? '<p class="collab-note">⚠ 실시간 대전은 <b>Firebase 연결 시</b> 여러 기기에서 함께 동작합니다. (현재 데모 모드)</p>' : ''}
          <div id="bt-list" class="collab-list"><p class="collab-loading">불러오는 중…</p></div>
        </div>`;

      if (isTeacher) body.querySelector('#bt-new').addEventListener('click', () => battle.openCreate());

      const listEl = body.querySelector('#bt-list');
      const draw = (map) => {
        const rooms = Object.entries(map || {})
          .map(([id, b]) => ({ id, ...b }))
          .filter((b) => b.status !== 'ended' && visibleToUser(b))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (!rooms.length) {
          listEl.innerHTML = `<p class="collab-empty">${isTeacher ? '아직 만든 대전방이 없습니다. ＋ 대전방 만들기로 시작하세요.' : '진행 중인 대전방이 없습니다. 선생님이 방을 열면 표시됩니다.'}</p>`;
          return;
        }
        const stLabel = { waiting: '<span class="bt-st wait">대기 중</span>', live: '<span class="bt-st live">진행 중 🔴</span>' };
        listEl.innerHTML = rooms.map((b) => `
          <div class="collab-card" data-id="${b.id}">
            <div class="collab-card-icon">⚔️</div>
            <div class="collab-card-info">
              <p class="collab-card-title">${esc(b.title)} ${stLabel[b.status] || ''}</p>
              <p class="collab-card-meta">${esc(b.hostName || '교사')} · 문제 ${(b.questions || []).length}개 · ${LEVELS[b.level] || ''}</p>
            </div>
            <div class="collab-card-actions">
              <button class="btn-primary bt-enter">${isTeacher && b.host === user.uid ? '진행하기' : '입장'}</button>
              ${isTeacher && b.host === user.uid ? '<button class="btn-mini bt-del text-red-500">삭제</button>' : ''}
            </div>
          </div>`).join('');
        listEl.querySelectorAll('.collab-card').forEach((card) => {
          const id = card.dataset.id;
          card.querySelector('.bt-enter').addEventListener('click', () => battle.enter(id, map[id]));
          const del = card.querySelector('.bt-del');
          if (del) del.addEventListener('click', async () => {
            if (!confirm('이 대전방을 삭제할까요?')) return;
            await DB.remove(`battles/${id}`);
            if (!useFB()) draw((await DB.read('battles')) || {});
          });
        });
      };
      const un = DB.subscribe('battles', draw);
      if (un) unsubs.push(un); else draw((await DB.read('battles')) || {});
    },

    // 1단계: 대전방 기본 정보 + 문항 구성 방식 선택
    async openCreate() {
      const classes = await getClasses();
      let apiKey = ''; try { apiKey = await Auth.getApiKey(); } catch (e) {}
      const box = openModal(`
        <h3 class="text-lg font-bold text-slate-800 mb-3">배움 대전방 만들기</h3>
        <form id="btc-form" class="space-y-3" autocomplete="off">
          <div>
            <label class="form-label">대전방 제목</label>
            <input id="btc-title" class="form-input" placeholder="예) 3교시 연산 스피드 대전" required>
          </div>
          <div>
            <label class="form-label">문제당 제한시간</label>
            <select id="btc-sec" class="form-input">
              ${[15, 20, 30, 45].map((n) => `<option value="${n}" ${n === 20 ? 'selected' : ''}>${n}초</option>`).join('')}
            </select>
          </div>
          <div class="mat-scope-row">
            <label class="ev-radio"><input type="radio" name="btc-scope" value="all" checked> ⚪ 전체 학생</label>
            <label class="ev-radio"><input type="radio" name="btc-scope" value="class"> 🔵 특정 반</label>
          </div>
          <div id="btc-classes" class="ev-classes hidden">
            ${classes.length ? `
              <div class="ev-class-grid">
                ${classes.map((c) => `
                  <label class="ev-class-chk">
                    <input type="checkbox" value="${c.classId}">
                    ${esc(classLabel(c.grade, c.classNo))}
                    <span class="ev-class-cnt">${c.students.length}명</span>
                  </label>`).join('')}
              </div>` : '<p class="text-sm text-amber-600">등록된 학생이 없습니다.</p>'}
          </div>

          <label class="form-label">문항 구성 방식</label>
          <div class="bt-method-grid">
            <label class="bt-method"><input type="radio" name="btc-method" value="auto" checked>
              <span class="bt-method-ic">🎲</span><b>자동 생성</b><small>난이도·개수 선택, 연산 문제 자동</small></label>
            <label class="bt-method"><input type="radio" name="btc-method" value="import">
              <span class="bt-method-ic">📚</span><b>평가에서 가져오기</b><small>교과수업 평가의 다양한 유형 문항 선택</small></label>
            <label class="bt-method"><input type="radio" name="btc-method" value="pdf">
              <span class="bt-method-ic">📄</span><b>PDF에서 추출</b><small>AI가 PDF 문제를 자동 문항으로 변환${apiKey ? '' : ' (AI 키 필요)'}</small></label>
            <label class="bt-method"><input type="radio" name="btc-method" value="manual">
              <span class="bt-method-ic">✍️</span><b>직접 만들기</b><small>객관식·단답·수식 등 자유 제작 · 캡처 붙여넣기</small></label>
          </div>

          <div id="btc-auto" class="grid grid-cols-2 gap-3">
            <div>
              <label class="form-label">난이도</label>
              <select id="btc-level" class="form-input">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
            </div>
            <div>
              <label class="form-label">문제 수</label>
              <select id="btc-count" class="form-input">${[5, 8, 10, 15].map((n) => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n}문제</option>`).join('')}</select>
            </div>
          </div>
          <p id="btc-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-ghost modal-close">취소</button>
            <button type="submit" class="btn-primary">다음 → 문항 검토</button>
          </div>
        </form>`);
      box.querySelector('.modal-close').addEventListener('click', closeModal);
      const cbox = box.querySelector('#btc-classes');
      box.querySelectorAll('input[name="btc-scope"]').forEach((r) =>
        r.addEventListener('change', () =>
          cbox.classList.toggle('hidden', box.querySelector('input[name="btc-scope"]:checked').value !== 'class')));
      const autoBox = box.querySelector('#btc-auto');
      box.querySelectorAll('input[name="btc-method"]').forEach((r) =>
        r.addEventListener('change', () =>
          autoBox.classList.toggle('hidden', box.querySelector('input[name="btc-method"]:checked').value !== 'auto')));

      box.querySelector('#btc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = box.querySelector('#btc-error');
        const title = box.querySelector('#btc-title').value.trim();
        if (!title) { err.textContent = '제목을 입력하세요.'; return; }
        const perQSec = +box.querySelector('#btc-sec').value;
        const scope = box.querySelector('input[name="btc-scope"]:checked').value;
        let classIds = null;
        if (scope === 'class') {
          const picked = [...box.querySelectorAll('#btc-classes input:checked')].map((c) => c.value);
          if (!picked.length) { err.textContent = '참여할 반을 1개 이상 선택하세요.'; return; }
          classIds = picked.reduce((o, c) => ((o[c] = true), o), {});
        }
        const method = box.querySelector('input[name="btc-method"]:checked').value;
        const level = box.querySelector('#btc-level').value;
        const meta = { title, scope, classIds, level, perQSec };

        if (method === 'auto') {
          const count = +box.querySelector('#btc-count').value;
          battle.buildRoom(meta, makeQuestions(level, count));
        } else if (method === 'manual') {
          battle.buildRoom(meta, []);
        } else if (method === 'import') {
          battle.openImportPicker(meta);
        } else { // pdf
          if (!apiKey) { err.textContent = 'PDF 추출은 ⚙️ 설정에서 AI 키를 먼저 등록해야 합니다.'; return; }
          battle.openPdfImport(meta, apiKey);
        }
      });
    },

    // 평가 문항 가져오기 — 수업의 평가 페이지에서 자동채점 가능한 문항 선택
    async openImportPicker(meta) {
      const box = openModal(`
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-bold text-slate-800">📚 평가에서 문항 가져오기</h3>
          <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>
        <p class="text-xs text-slate-500 mb-3">교과수업 평가의 문항을 가져옵니다. (서술형·즉답통계는 자동채점이 안 돼 제외)</p>
        <div id="imp-body" class="bt-import-body"><p class="collab-loading">평가 문항을 찾는 중…</p></div>
        <div class="flex gap-2 justify-end mt-3">
          <button type="button" class="btn-ghost" id="imp-back">← 뒤로</button>
          <button type="button" class="btn-primary" id="imp-next">선택 문항 검토 →</button>
        </div>`);
      box.classList.add('modal-wide');
      box.querySelector('.modal-close').addEventListener('click', closeModal);
      box.querySelector('#imp-back').addEventListener('click', () => this.openCreate());

      const QT = (window.Assess && Assess.QTYPES) || {};
      const lessons = Object.values((await DB.read('lessons')) || {});
      const groups = [];
      lessons.forEach((l) => {
        (l.pages || []).forEach((p) => {
          if (p.type !== 'assessment') return;
          const items = (p.questions || []).map((aq, qi) => ({ aq, qi })).filter((x) => usableBattleQ(x.aq));
          if (items.length) groups.push({ lessonTitle: l.title, classId: l.classId, pageTitle: p.title || '평가', items });
        });
      });

      const bodyEl = box.querySelector('#imp-body');
      if (!groups.length) {
        bodyEl.innerHTML = '<p class="collab-empty">가져올 수 있는 문항이 없습니다. 교과수업 평가에서 먼저 문항을 만들어 주세요.</p>';
        return;
      }
      bodyEl.innerHTML = groups.map((g, gi) => `
        <div class="bt-import-group">
          <p class="bt-import-gtitle"><b>${esc(g.lessonTitle)}</b> <span class="text-xs text-slate-400">· ${esc(cidLabel(g.classId))} · ${esc(g.pageTitle)}</span></p>
          ${g.items.map((it) => `
            <label class="bt-import-q">
              <input type="checkbox" data-g="${gi}" data-q="${it.qi}">
              <span>${esc(it.aq.prompt || '(발문 없음)')} ${it.aq.image ? '🖼' : ''} <span class="bt-import-type">${esc((QT[it.aq.type] || {}).label || it.aq.type)}</span></span>
            </label>`).join('')}
        </div>`).join('');

      box.querySelector('#imp-next').addEventListener('click', () => {
        const picked = [...box.querySelectorAll('#imp-body input:checked')].map((c) => {
          const g = groups[+c.dataset.g]; const it = g.items.find((x) => x.qi === +c.dataset.q);
          return cloneForBattle(it.aq);
        });
        if (!picked.length) { toast('문항을 1개 이상 선택하세요.'); return; }
        this.buildRoom(meta, picked);
      });
    },

    // PDF → AI 추출(평가 모듈 재사용) → 문항 검토
    async openPdfImport(meta, apiKey) {
      const box = openModal(`
        <h3 class="text-lg font-bold text-slate-800 mb-2">📄 PDF에서 문항 추출</h3>
        <p class="text-xs text-slate-500 mb-3">PDF의 문제를 AI가 자동 문항으로 변환합니다. 변환 후 검토·수정할 수 있습니다.</p>
        <label class="btn-primary cursor-pointer inline-block">PDF 파일 선택<input id="pdf-file" type="file" accept="application/pdf" class="hidden"></label>
        <p id="pdf-msg" class="text-sm min-h-[1.25rem] mt-3"></p>
        <div class="flex gap-2 justify-end mt-2">
          <button type="button" class="btn-ghost" id="pdf-back">← 뒤로</button>
        </div>`);
      box.querySelector('#pdf-back').addEventListener('click', () => this.openCreate());
      box.querySelector('#pdf-file').addEventListener('change', async (e) => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        if (!(window.Assess && Assess.aiGenerateQuestionsFromFile)) { toast('평가 모듈을 불러오지 못했습니다.'); return; }
        const msg = box.querySelector('#pdf-msg');
        msg.className = 'text-sm text-violet-600 mt-3';
        msg.textContent = 'AI가 PDF를 분석해 문항을 만드는 중… (최대 1분)';
        try {
          const all = await Assess.aiGenerateQuestionsFromFile(f, apiKey);
          const qs = (all || []).filter(usableBattleQ);
          if (!qs.length) { msg.className = 'text-sm text-red-500 mt-3'; msg.textContent = '자동채점 가능한 문항을 만들지 못했습니다. 다른 PDF를 시도하세요.'; return; }
          toast(`${qs.length}개 문항을 추출했습니다. 검토 후 만드세요.`);
          this.buildRoom(meta, qs);
        } catch (ex) { msg.className = 'text-sm text-red-500 mt-3'; msg.textContent = '실패: ' + ex.message; }
      });
    },

    // 2단계: 평가 편집기를 재사용해 문항 검토·편집 → 저장 시 대전방 생성
    buildRoom(meta, seed) {
      if (!(window.Assess && Assess.openEditor)) { toast('평가 모듈을 불러오지 못했습니다.'); return; }
      const page = { title: meta.title, questions: (seed || []).slice() };
      Assess.openEditor(page, async () => {
        const questionsOut = (page.questions || []).filter(usableBattleQ);
        await DB.push('battles', {
          title: page.title || meta.title, host: user.uid, hostName: user.name || user.loginId,
          scope: meta.scope, classIds: meta.classIds, level: meta.level || 'custom', perQSec: meta.perQSec,
          questions: questionsOut, status: 'waiting', qIndex: -1, qStartAt: 0, createdAt: Date.now()
        });
        toast('대전방을 만들었습니다.');
        if (!useFB()) selectSub('battle');
      }, {
        title: `⚔️ 배움 대전 문항 — ${meta.title}`,
        saveLabel: '대전방 만들기',
        saveToast: '',
        types: GRADABLE,   // 서술형·즉답통계 제외(자동채점 불가)
        onSaveValidate: (pg) => {
          const ok = (pg.questions || []).filter(usableBattleQ).length;
          return ok < 1 ? '저장 전, 자동채점 가능한 문항을 1개 이상 완성해 주세요.' : null;
        }
      });
    },

    roundSig(b) { return `${b.status}|${b.qIndex}|${b.qStartAt}`; },

    async enter(id, meta) {
      clearSubs(); clearTimers();
      this.active = { id, meta };
      this.answeredIndex = -1;
      this._sig = null;
      const isHost = user.role === 'teacher' && meta.host === user.uid;

      // 학생은 입장 시 플레이어 등록
      if (!isHost) {
        await DB.update(`battles/${id}/players/${user.uid}`, {
          name: user.name || user.loginId, score: 0, correctCount: 0, lastAnswered: -1, joinedAt: Date.now()
        });
      }

      const body = rootEl.querySelector('#collab-body');
      body.innerHTML = `
        <div class="card collab-stage">
          <div class="collab-board-bar">
            <button id="bt-back" class="btn-ghost">← 목록</button>
            <span class="collab-board-name">⚔️ ${esc(meta.title)}</span>
            <span id="bt-status" class="bt-st wait">연결 중…</span>
          </div>
          <div id="bt-stage" class="bt-stage"></div>
          <div class="bt-board">
            <h4 class="bt-board-title">🏆 실시간 순위</h4>
            <div id="bt-leader" class="bt-leader"></div>
          </div>
        </div>`;
      body.querySelector('#bt-back').addEventListener('click', () => selectSub('battle'));

      const setBadge = (status) => {
        const st = body.querySelector('#bt-status');
        if (st) st.outerHTML = `<span id="bt-status" class="bt-st ${status === 'live' ? 'live' : 'wait'}">${status === 'live' ? '진행 중 🔴' : status === 'ended' ? '종료' : '대기 중'}</span>`;
      };

      // 상태(문제 진행) 구독 — /battles/{id} 값에는 players 변경도 섞여 오므로
      // 학생 화면은 '라운드(상태·문제·시작시각)'가 바뀔 때만 다시 그린다(입력 UI 보존).
      const onMeta = (b) => {
        if (!b || !b.status) { selectSub('battle'); return; }
        this.active.meta = b;
        setBadge(b.status);
        if (isHost) { this.renderHost(b); return; }
        const sig = this.roundSig(b);
        if (sig !== this._sig) { this._sig = sig; this.renderPlayer(b); }
      };
      const metaUn = DB.subscribe(`battles/${id}`, onMeta);
      if (metaUn) unsubs.push(metaUn); else onMeta(meta);

      // 플레이어(순위) 구독 — 순위판 갱신 + 진행자는 제출 인원수 실시간 반영
      const plUn = DB.subscribe(`battles/${id}/players`, (m) => {
        this.players = m || {};
        this.renderLeader();
        if (isHost && this.active.meta && this.active.meta.status === 'live') this.renderHost(this.active.meta);
      });
      if (plUn) unsubs.push(plUn);
      else { this.players = (await DB.read(`battles/${id}/players`)) || {}; this.renderLeader(); }
    },

    renderLeader() {
      const el = rootEl && rootEl.querySelector('#bt-leader');
      if (!el) return;
      const rows = Object.values(this.players || {}).sort((a, b) => (b.score || 0) - (a.score || 0));
      if (!rows.length) { el.innerHTML = '<p class="collab-part-empty">아직 입장한 학생이 없습니다.</p>'; return; }
      const medal = ['🥇', '🥈', '🥉'];
      el.innerHTML = rows.map((p, i) => `
        <div class="bt-rank ${i < 3 ? 'top' : ''}">
          <span class="bt-rank-no">${medal[i] || (i + 1)}</span>
          <span class="bt-rank-name">${esc(p.name || '학생')}</span>
          <span class="bt-rank-score">${p.score || 0}P</span>
        </div>`).join('');
    },

    // ── 교사(진행자) 화면 ──
    renderHost(b) {
      const stage = rootEl && rootEl.querySelector('#bt-stage');
      if (!stage) return;
      clearTimers();
      const total = (b.questions || []).length;
      if (b.status === 'waiting') {
        const cnt = Object.keys(this.players || {}).length;
        stage.innerHTML = `
          <div class="bt-host-panel">
            <p class="bt-big">대기방</p>
            <p class="bt-sub">학생들이 입장하면 순위판에 표시됩니다. 준비되면 시작하세요.</p>
            <p class="bt-info">난이도 <b>${LEVELS[b.level] || '맞춤형'}</b> · 문제 <b>${total}</b>개 · 제한 <b>${b.perQSec}초</b></p>
            <button id="bt-start" class="btn-primary bt-big-btn">▶ 대전 시작</button>
          </div>`;
        stage.querySelector('#bt-start').addEventListener('click', () => this.advance(0));
        return;
      }
      if (b.status === 'ended') { stage.innerHTML = this.endHtml(b, true); this.bindReopen(stage); return; }

      // live — 현재 문제 + 다음/종료 버튼
      const q = b.questions[b.qIndex];
      const playersArr = Object.values(this.players || {});
      const answered = playersArr.filter((p) => p.lastAnswered === b.qIndex).length;
      const total2 = playersArr.length;
      const aText = (window.Assess && Assess.answerText) ? Assess.answerText(q) : '';
      const isChoice = q.type === 'single' || q.type === 'multi';
      const correctN = playersArr.filter((p) => p.marks && p.marks[b.qIndex] === true).length;
      // 학생별 현재 문항 정오 (○ 정답 / ✕ 오답 / · 미제출)
      const markList = playersArr.slice().sort((a, c) => (a.name || '').localeCompare(c.name || '')).map((p) => {
        const m = p.marks ? p.marks[b.qIndex] : undefined;
        const cls = m === true ? 'ok' : (p.lastAnswered === b.qIndex ? 'no' : 'wait');
        const ic = m === true ? '○' : (p.lastAnswered === b.qIndex ? '✕' : '·');
        return `<span class="bt-pmark ${cls}">${esc(p.name || '학생')} ${ic}</span>`;
      }).join('');
      stage.innerHTML = `
        <div class="bt-host-live">
          <div class="bt-qhead">문제 ${b.qIndex + 1} / ${total} <span id="bt-timer" class="bt-timer"></span></div>
          ${stemHtml(q)}
          ${isChoice ? `<div class="bt-host-choices">${(q.choices || []).map((c, k) =>
            `<span class="bt-host-choice ${(q.type === 'multi' ? (q.answers || []).includes(k) : k === q.answer) ? 'correct' : ''}">${esc(String(c))}</span>`).join('')}</div>` : ''}
          <p class="bt-answered">제출 <b>${answered}</b> / ${total2}명 · 정답 <b class="text-green-600">${correctN}</b>명 · 정답: <b>${esc(aText)}</b></p>
          ${total2 ? `<div class="bt-pmarks">${markList}</div>` : ''}
          <div class="bt-host-actions">
            ${b.qIndex + 1 < total
              ? '<button id="bt-next" class="btn-primary">다음 문제 ▶</button>'
              : '<button id="bt-finish" class="btn-primary">결과 발표 🏁</button>'}
          </div>
        </div>`;
      this.startTimer(b);
      const next = stage.querySelector('#bt-next');
      if (next) next.addEventListener('click', () => this.advance(b.qIndex + 1));
      const fin = stage.querySelector('#bt-finish');
      if (fin) fin.addEventListener('click', () => this.finish());
    },

    async advance(idx) {
      const id = this.active.id;
      await DB.update(`battles/${id}`, { status: 'live', qIndex: idx, qStartAt: Date.now() });
      if (!useFB()) { const b = await DB.read(`battles/${id}`); this.renderHost(b); }
    },
    async finish() {
      const id = this.active.id;
      await DB.update(`battles/${id}`, { status: 'ended' });
      if (!useFB()) { const b = await DB.read(`battles/${id}`); this.renderHost(b); }
    },

    // ── 학생(참가자) 화면 ──
    renderPlayer(b) {
      const stage = rootEl && rootEl.querySelector('#bt-stage');
      if (!stage) return;
      clearTimers();
      const total = (b.questions || []).length;

      if (b.status === 'waiting') {
        stage.innerHTML = `
          <div class="bt-wait-panel">
            <div class="bt-spinner">⚔️</div>
            <p class="bt-big">곧 시작합니다!</p>
            <p class="bt-sub">선생님이 대전을 시작할 때까지 기다려 주세요.</p>
          </div>`;
        return;
      }
      if (b.status === 'ended') {
        // 포인트 1회 지급
        this.grantOnce(b);
        stage.innerHTML = this.endHtml(b, false);
        return;
      }

      // live — 평가 모듈의 문항 입력 UI를 그대로 재사용(객관식·단답·수식·순서 등)
      const q = b.questions[b.qIndex];
      const already = this.answeredIndex === b.qIndex ||
        ((this.players[user.uid] || {}).lastAnswered === b.qIndex);
      stage.innerHTML = `
        <div class="bt-play">
          <div class="bt-qhead">문제 ${b.qIndex + 1} / ${total} <span id="bt-timer" class="bt-timer"></span></div>
          <div class="bt-solve">
            <div class="bt-solve-left">
              <div class="bt-asq" id="bt-qhost"></div>
              <div class="bt-play-actions"><button id="bt-submit" class="btn-primary">제출</button></div>
              <p id="bt-feedback" class="bt-feedback"></p>
            </div>
            <div class="bt-solve-right" id="bt-note"></div>
          </div>
        </div>`;
      const host = stage.querySelector('#bt-qhost');
      if (window.Assess && Assess.renderQuestionInput) Assess.renderQuestionInput(host, q);
      else host.innerHTML = `<p class="text-red-500">문항을 표시할 수 없습니다.</p>`;
      // 오른쪽 태블릿 필기 노트
      if (window.Assess && Assess.mountNotePad) Assess.mountNotePad(stage.querySelector('#bt-note'));

      this.startTimer(b);

      const submitBtn = stage.querySelector('#bt-submit');
      if (already) { this.lockAnswered(stage, q); return; }
      submitBtn.addEventListener('click', () => this.submitAnswer(b, q, host, stage));
    },

    // 제출 완료 상태로 잠그고 정답 안내
    lockAnswered(stage, q, gainMsg) {
      const host = stage.querySelector('#bt-qhost');
      if (host) host.querySelectorAll('input, button, textarea, .as-order-item').forEach((el) => {
        el.disabled = true; el.setAttribute('draggable', 'false'); el.style.pointerEvents = 'none';
      });
      const submitBtn = stage.querySelector('#bt-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '제출 완료'; }
      const fb = stage.querySelector('#bt-feedback');
      if (fb && gainMsg) fb.innerHTML = gainMsg;
      else if (fb && !fb.textContent) fb.textContent = '제출 완료! 다음 문제를 기다리세요.';
    },

    async submitAnswer(b, q, host, stage) {
      if (this.answeredIndex === b.qIndex) return;
      const a = (window.Assess && Assess.readAnswer) ? Assess.readAnswer(host, q) : null;
      const isEmpty = a == null || a === '' || (Array.isArray(a) && a.length === 0);
      if (isEmpty && !confirm('답을 입력하지 않았습니다. 그대로 제출할까요?')) return;
      this.answeredIndex = b.qIndex;

      const elapsed = (Date.now() - (b.qStartAt || Date.now())) / 1000;
      const correct = (window.Assess && Assess.gradeOne) ? (Assess.gradeOne(q, a) === true) : false;
      // 속도 보너스: 빠를수록 ↑ (정답에 한해)
      const bonus = Math.max(0, Math.round((1 - Math.min(1, elapsed / (b.perQSec || 20))) * 100));
      const gain = correct ? 100 + bonus : 0;

      const me = this.players[user.uid] || { name: user.name || user.loginId, score: 0, correctCount: 0 };
      const marks = Object.assign({}, me.marks || {}); marks[b.qIndex] = correct; // 문항별 정오(교사 확인용)
      const patch = {
        name: user.name || user.loginId,
        score: (me.score || 0) + gain,
        correctCount: (me.correctCount || 0) + (correct ? 1 : 0),
        lastAnswered: b.qIndex,
        marks
      };
      await DB.update(`battles/${this.active.id}/players/${user.uid}`, patch);
      if (!useFB()) { this.players[user.uid] = Object.assign(me, patch); this.renderLeader(); }

      const ansText = (window.Assess && Assess.answerText) ? Assess.answerText(q) : '';
      const msg = correct
        ? `<span class="bt-feedback ok">정답! +${gain}점 (속도 보너스 ${bonus})</span>`
        : `<span class="bt-feedback no">아쉬워요. 정답: "${esc(ansText)}"</span>`;
      this.lockAnswered(stage, q, msg);
    },

    startTimer(b) {
      clearTimers();
      const tEl = () => rootEl && rootEl.querySelector('#bt-timer');
      const total = b.perQSec || 20;
      const upd = () => {
        const el = tEl(); if (!el) return;
        const left = Math.max(0, total - Math.floor((Date.now() - (b.qStartAt || Date.now())) / 1000));
        el.textContent = `⏱ ${left}s`;
        el.classList.toggle('danger', left <= 5);
      };
      upd();
      timers.push(setInterval(upd, 500));
    },

    async grantOnce(b) {
      const me = this.players[user.uid];
      if (!me || me.granted) return;
      const flagKey = `mathapp.battle.granted.${this.active.id}.${user.uid}`;
      if (localStorage.getItem(flagKey)) return;
      localStorage.setItem(flagKey, '1');
      // 대전에서 얻은 점수의 절반을 포트폴리오 포인트로 환산(과도한 인플레 방지)
      const pts = Math.round((me.score || 0) / 20);
      if (pts > 0) { await addPoints(pts); toast(`대전 보상 +${pts}P 획득!`); }
    },

    endHtml(b, isHost) {
      const ranked = Object.values(this.players || {}).sort((x, y) => (y.score || 0) - (x.score || 0));
      const medal = ['🥇', '🥈', '🥉'];
      const podium = ranked.slice(0, 3).map((p, i) =>
        `<div class="bt-podium p${i}"><div class="bt-medal">${medal[i]}</div><div class="bt-podium-name">${esc(p.name || '학생')}</div><div class="bt-podium-score">${p.score || 0}P</div></div>`).join('');
      const mine = this.players[user.uid];
      const qs = b.questions || [];
      // 교사: 학생별 문항 정오 표 (○ 정답 / ✕ 오답 / · 미제출)
      const grid = (isHost && ranked.length) ? `
        <h4 class="bt-board-title" style="margin:16px 0 8px">학생별 정오 (○ 정답 / ✕ 오답 / · 미제출)</h4>
        <div class="as-scroll"><table class="dash-table as-grid"><thead><tr><th>이름</th>${qs.map((q, i) => `<th class="num">${i + 1}</th>`).join('')}<th class="num">점수</th></tr></thead><tbody>
          ${ranked.map((p) => `<tr><td>${esc(p.name || '학생')}</td>${qs.map((q, i) => {
            const m = p.marks ? p.marks[i] : undefined;
            return `<td class="num">${m === true ? '<span class="as-gx ok">○</span>' : m === false ? '<span class="as-gx no">✕</span>' : '<span class="as-gx none">·</span>'}</td>`;
          }).join('')}<td class="num"><b>${p.score || 0}P</b></td></tr>`).join('')}
        </tbody></table></div>` : '';
      return `
        <div class="bt-end">
          <p class="bt-big">🏁 대전 종료!</p>
          <div class="bt-podiums">${podium || '<p class="bt-sub">참가자가 없습니다.</p>'}</div>
          ${!isHost && mine ? `<p class="bt-myresult">내 점수 <b>${mine.score || 0}P</b> · 맞힌 문제 <b>${mine.correctCount || 0}</b>개</p>` : ''}
          ${grid}
          <button class="btn-ghost" id="bt-end-back">목록으로</button>
        </div>`;
    },
    bindReopen(stage) {
      const back = stage.querySelector('#bt-end-back');
      if (back) back.addEventListener('click', () => selectSub('battle'));
    }
  };

  /* ============================================================
     6) 모달 헬퍼 (app.js 와 동일 동작)
  ============================================================ */
  function openModal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-overlay"><div class="modal-box">${html}</div></div>`;
    return root.querySelector('.modal-box');
  }
  function closeModal() { const root = document.getElementById('modal-root'); if (root) root.innerHTML = ''; }

  console.log('[collab] STEP 11 로드 완료 — 협업 화이트보드 + 배움 대전');
  return { render, teardown };
})();
