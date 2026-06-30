/* ============================================================
   lesson.js — 학습실 (셸 + 자료방)
   ------------------------------------------------------------
   ▶ 학습실은 하위 탭 컨테이너: 교과수업 | 협업의 장 | 과제방 | 자료방
     - 이번 단계는 '자료방'만 구현, 나머지는 다음 STEP 플레이스홀더
     - 자기성찰일지는 교과수업(STEP 06) 개설 시 마지막 페이지로 자동 생성 예정
   ▶ 자료방
     - 교사: 자료(파일) 업로드 → 학생에게 자동 노출 / 삭제 가능
       · 공개 범위: 전체 학생(기본) 또는 특정 반 선택
       · Firebase 연결 시 Storage 업로드(URL 저장), 미연결(데모)은 dataURL 인라인
     - 학생: 다운로드만 가능 (업로드·삭제 불가)

   ▶ Firebase 구조
     /materials/{materialId}
       id, title, desc, fileName, mime, size,
       scope('all'|'class'), classIds{cid:true}, url, storagePath, data,
       uploaderUid, uploaderName, createdAt

   ※ 권한은 UI/코드 가드 + Firebase 보안규칙(문서화)으로 이중 차단.
   ※ 블라인드 규칙: 학교명·성명·지역명을 코드에 포함하지 않습니다.
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     0) 데이터 계층 (Firebase / localStorage 공통)
  ============================================================ */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);
  const useStorage = () => !!(window.FB && window.FB.ready && window.FB.storage);
  const genId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
  const MAX_DEMO_BYTES = 4 * 1024 * 1024; // 데모(localStorage) 인라인 저장 상한

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  }
  // classId(예 107) → 라벨
  function cidLabel(cid) {
    cid = String(cid);
    const grade = cid.slice(0, cid.length - 2);
    const classNo = cid.slice(-2);
    return `${grade}학년 ${parseInt(classNo, 10)}반`;
  }
  // 확장자별 아이콘
  function fileIcon(name, mime) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (/pdf/.test(ext)) return '📕';
    if (/(ppt|pptx|key)/.test(ext)) return '📙';
    if (/(xls|xlsx|csv)/.test(ext)) return '📗';
    if (/(doc|docx|hwp|hwpx|txt)/.test(ext)) return '📄';
    if (/(zip|rar|7z)/.test(ext)) return '🗜️';
    if (/(mp4|mov|avi|mkv|webm)/.test(ext) || /^video\//.test(mime || '')) return '🎬';
    if (/(mp3|wav|m4a)/.test(ext) || /^audio\//.test(mime || '')) return '🎵';
    if (/(png|jpg|jpeg|gif|webp|svg)/.test(ext) || /^image\//.test(mime || '')) return '🖼️';
    return '📎';
  }

  /* ============================================================
     2) 학습실 셸 — 하위 탭 (자료방이 맨 마지막)
  ============================================================ */
  const TABS = [
    { key: 'class',   label: '교과수업', icon: '📖', step: 'STEP 06' },
    { key: 'collab',  label: '협업의 장', icon: '🤝', step: 'STEP 11' },
    { key: 'homework',label: '과제방',   icon: '✏️', step: 'STEP 09' },
    { key: 'material',label: '자료방',   icon: '📂', step: null }     // 구현됨
  ];

  let user = null;
  let activeTab = 'class';     // 기본 활성 탭 = 교과수업
  let rootEl = null;
  let matUnsub = null;         // 자료방 실시간 구독 해제
  let lessonsUnsub = null;     // 교과수업 목록 실시간 구독 해제

  function cleanup() {
    if (matUnsub) { try { matUnsub(); } catch (e) {} matUnsub = null; }
    if (lessonsUnsub) { try { lessonsUnsub(); } catch (e) {} lessonsUnsub = null; }
    closeViewer();             // 열려있던 슬라이드 뷰어 정리
  }

  async function render(container, currentUser) {
    cleanup();
    user = currentUser;
    rootEl = container;

    container.innerHTML = `
      <div class="lesson-wrap">
        <div class="lesson-tabs" id="lesson-tabs">
          ${TABS.map((t) => `
            <button class="lesson-tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">
              <span>${t.icon}</span> ${t.label}
            </button>`).join('')}
        </div>
        <div id="lesson-body" class="lesson-body"></div>
      </div>
    `;

    const tabsEl = container.querySelector('#lesson-tabs');
    tabsEl.addEventListener('click', (e) => {
      const t = e.target.closest('.lesson-tab');
      if (!t) return;
      selectTab(t.dataset.tab);
    });

    selectTab(activeTab);
  }

  function selectTab(key) {
    activeTab = key;
    // 탭 전환 시 이전 탭 구독 해제
    if (matUnsub) { try { matUnsub(); } catch (e) {} matUnsub = null; }
    if (lessonsUnsub) { try { lessonsUnsub(); } catch (e) {} lessonsUnsub = null; }
    if (!rootEl) return;
    rootEl.querySelectorAll('.lesson-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === key));
    const body = rootEl.querySelector('#lesson-body');
    if (key === 'material') renderMaterials(body);
    else if (key === 'class') renderClass(body);
    else renderPlaceholder(body, key);
  }

  function renderPlaceholder(body, key) {
    const t = TABS.find((x) => x.key === key);
    body.innerHTML = `
      <div class="card text-center py-16">
        <div class="text-6xl mb-4">${t.icon}</div>
        <h3 class="text-2xl font-bold text-slate-800 mb-2">${t.label}</h3>
        <p class="text-slate-500 mb-6">이 기능은 다음 단계에서 구현됩니다.</p>
        <span class="inline-block bg-slate-100 text-slate-500 text-sm px-4 py-1.5 rounded-full">${t.step}</span>
      </div>`;
  }

  /* ============================================================
     3) 자료방
  ============================================================ */
  async function renderMaterials(body) {
    const isTeacher = user.role === 'teacher';
    body.innerHTML = `
      <div class="card">
        <div class="mat-head">
          <div>
            <h3 class="dash-title" style="margin:0">📂 자료방</h3>
            <p class="mat-sub">${isTeacher
              ? '학생들에게 공유할 학습 자료를 올리고 관리하세요.'
              : '선생님이 올린 학습 자료를 내려받을 수 있어요.'}</p>
          </div>
          ${isTeacher ? `<button id="mat-add" class="btn-primary">＋ 자료 올리기</button>` : ''}
        </div>
        <div id="mat-list" class="mat-list"><p class="mat-loading">불러오는 중…</p></div>
      </div>
    `;
    if (isTeacher) body.querySelector('#mat-add').addEventListener('click', openUploadModal);

    await loadMaterials();
    matUnsub = DB.subscribe('materials', () => loadMaterials());
  }

  // 현재 사용자에게 보이는 자료만 필터 + 렌더
  async function loadMaterials() {
    if (!rootEl) return;
    const listEl = rootEl.querySelector('#mat-list');
    if (!listEl) return;

    const isTeacher = user.role === 'teacher';
    const obj = (await DB.read('materials')) || {};
    let items = Object.values(obj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 학생: 전체 공개 또는 본인 반 대상만
    if (!isTeacher) {
      items = items.filter((m) =>
        m.scope === 'all' || (m.classIds && user.classId && m.classIds[user.classId]));
    }

    if (!items.length) {
      listEl.innerHTML = `<div class="mat-empty">${isTeacher
        ? '아직 올린 자료가 없습니다. <b>＋ 자료 올리기</b>로 첫 자료를 공유해 보세요.'
        : '아직 공유된 자료가 없어요. 새 자료가 올라오면 자동으로 표시됩니다.'}</div>`;
      return;
    }

    listEl.innerHTML = items.map((m) => {
      const scopeBadge = m.scope === 'all'
        ? `<span class="mat-scope all">전체</span>`
        : `<span class="mat-scope class">${esc(Object.keys(m.classIds || {}).map(cidLabel).join(', ') || '특정 반')}</span>`;
      const href = m.url || m.data || '';
      return `
        <div class="mat-item" data-id="${esc(m.id)}">
          <div class="mat-icon">${fileIcon(m.fileName || '', m.mime)}</div>
          <div class="mat-info">
            <p class="mat-title">${esc(m.title || m.fileName)} ${scopeBadge}</p>
            ${m.desc ? `<p class="mat-desc">${esc(m.desc)}</p>` : ''}
            <p class="mat-meta">
              <span>${esc(m.fileName || '')}</span>
              ${m.size ? `<span>· ${fmtSize(m.size)}</span>` : ''}
              <span>· ${esc(m.uploaderName || '선생님')}</span>
              <span>· ${fmtDate(m.createdAt)}</span>
            </p>
          </div>
          <div class="mat-actions">
            ${href
              ? `<a class="btn-mini mat-dl" href="${esc(href)}" download="${esc(m.fileName || 'download')}" target="_blank" rel="noopener">⬇ 다운로드</a>`
              : `<span class="text-xs text-slate-400">파일 없음</span>`}
            ${isTeacher ? `<button class="btn-mini mat-del text-red-500">삭제</button>` : ''}
          </div>
        </div>`;
    }).join('');

    if (isTeacher) {
      listEl.querySelectorAll('.mat-del').forEach((b) =>
        b.addEventListener('click', (e) => {
          const id = e.target.closest('.mat-item').dataset.id;
          deleteMaterial(id, obj[id]);
        }));
    }
  }

  /* ── 업로드 모달 (교사 전용) ── */
  async function openUploadModal() {
    if (user.role !== 'teacher') return;
    const classes = await getClasses();

    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-4">자료 올리기</h3>
      <form id="mat-form" class="space-y-3" autocomplete="off">
        <div>
          <label class="form-label">파일</label>
          <input id="mat-file" type="file" class="form-input" required>
        </div>
        <div>
          <label class="form-label">제목 <span class="text-slate-400 font-normal">(비우면 파일명)</span></label>
          <input id="mat-title" class="form-input" placeholder="예) 1단원 개념 정리 PDF">
        </div>
        <div>
          <label class="form-label">설명 <span class="text-slate-400 font-normal">(선택)</span></label>
          <textarea id="mat-desc" class="form-input" rows="2" placeholder="자료에 대한 간단한 안내"></textarea>
        </div>
        <div class="mat-scope-row">
          <label class="ev-radio"><input type="radio" name="mat-scope" value="all" checked> ⚪ 전체 학생</label>
          <label class="ev-radio"><input type="radio" name="mat-scope" value="class"> 🔵 특정 반</label>
        </div>
        <div id="mat-classes" class="ev-classes hidden">
          ${classes.length ? `
            <p class="text-xs text-slate-500 mb-2">공개할 반을 선택하세요 (다중 선택 가능)</p>
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
        <p id="mat-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
        <div class="flex gap-2 justify-end">
          <button type="button" class="btn-ghost modal-close">취소</button>
          <button type="submit" class="btn-primary" id="mat-submit">올리기</button>
        </div>
      </form>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);

    const classesBox = box.querySelector('#mat-classes');
    box.querySelectorAll('input[name="mat-scope"]').forEach((r) =>
      r.addEventListener('change', () =>
        classesBox.classList.toggle('hidden',
          box.querySelector('input[name="mat-scope"]:checked').value !== 'class')));

    box.querySelector('#mat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = box.querySelector('#mat-error');
      const file = box.querySelector('#mat-file').files[0];
      if (!file) { err.textContent = '파일을 선택하세요.'; return; }

      const scope = box.querySelector('input[name="mat-scope"]:checked').value;
      let classIds = null;
      if (scope === 'class') {
        const picked = [...box.querySelectorAll('#mat-classes input[type="checkbox"]:checked')].map((c) => c.value);
        if (!picked.length) { err.textContent = '공개할 반을 1개 이상 선택하세요.'; return; }
        classIds = picked.reduce((o, cid) => ((o[cid] = true), o), {});
      }
      if (!useStorage() && file.size > MAX_DEMO_BYTES) {
        err.textContent = `데모(미연결) 모드에서는 ${fmtSize(MAX_DEMO_BYTES)} 이하만 올릴 수 있어요. Firebase 연결 시 대용량 가능.`;
        return;
      }

      const submit = box.querySelector('#mat-submit');
      submit.disabled = true; submit.textContent = '올리는 중…';
      try {
        await uploadMaterial({
          file,
          title: box.querySelector('#mat-title').value.trim(),
          desc: box.querySelector('#mat-desc').value.trim(),
          scope, classIds
        });
        closeModal();
        toast('자료가 등록되었습니다.');
        await loadMaterials();
      } catch (ex) {
        console.error(ex);
        err.textContent = '업로드 실패: ' + ex.message;
        submit.disabled = false; submit.textContent = '올리기';
      }
    });
  }

  async function uploadMaterial({ file, title, desc, scope, classIds }) {
    if (user.role !== 'teacher') throw new Error('교사만 자료를 올릴 수 있습니다.');
    const id = genId();
    const rec = {
      id,
      title: title || file.name,
      desc: desc || '',
      fileName: file.name,
      mime: file.type || '',
      size: file.size || 0,
      scope: scope === 'class' ? 'class' : 'all',
      classIds: scope === 'class' ? (classIds || {}) : null,
      uploaderUid: user.uid,
      uploaderName: user.name || user.loginId,
      createdAt: Date.now()
    };

    if (useStorage()) {
      const path = `materials/${id}/${file.name}`;
      const ref = window.FB.storage.ref(path);
      await ref.put(file);
      rec.url = await ref.getDownloadURL();
      rec.storagePath = path;
    } else {
      // 데모(미연결): dataURL 인라인 저장
      rec.data = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
    }
    await DB.write(`materials/${id}`, rec);
  }

  async function deleteMaterial(id, m) {
    if (user.role !== 'teacher') return;
    if (!confirm('이 자료를 삭제할까요? 학생들도 더 이상 볼 수 없습니다.')) return;
    try {
      if (m && m.storagePath && useStorage()) {
        try { await window.FB.storage.ref(m.storagePath).delete(); } catch (e) { /* 이미 없거나 권한 */ }
      }
      await DB.remove(`materials/${id}`);
      toast('자료가 삭제되었습니다.');
      await loadMaterials();
    } catch (ex) { alert('삭제 실패: ' + ex.message); }
  }

  // 반 목록 (학생 그룹화) — scheduler 와 동일 로직
  async function getClasses() {
    let students = [];
    try { students = await Auth.listStudents(); } catch (e) { return []; }
    const map = new Map();
    students.forEach((s) => {
      const id = s.classId || `${s.grade}${pad2(s.classNo)}`;
      if (!map.has(id)) map.set(id, { classId: id, grade: s.grade, classNo: s.classNo, students: [] });
      map.get(id).students.push(s);
    });
    return [...map.values()].sort((a, b) => a.classId.localeCompare(b.classId));
  }

  /* ============================================================
     3-B) 교과수업 (생성·편집·복사·열람·발표동기화 + 자기성찰일지)
  ============================================================ */
  const PAGE_TYPES = {
    concept:    { label: '개념 설명',   icon: '💡' },
    note:       { label: '수업노트',     icon: '📝' },
    youtube:    { label: '유튜브',       icon: '▶️' },
    embed:      { label: '웹 자료',      icon: '🌐' },
    assessment: { label: '평가',         icon: '✅' },
    reflection: { label: '자기성찰일지', icon: '🪞' }
  };

  // 위험 키워드 — 조기경보 보조(오탐/미탐 가능, 전문상담 대체 아님)
  const RISK_TERMS = {
    high: ['자살', '죽고싶', '죽고 싶', '자해', '사라지고싶', '사라지고 싶',
           '없어지고싶', '없어지고 싶', '살기싫', '살기 싫', '죽어버', '죽을래', '뛰어내'],
    mid:  ['불안', '좌절', '우울', '무기력', '절망', '외롭', '외로워', '포기하고싶',
           '포기하고 싶', '괴롭', '두렵', '눈물', '힘들어죽']
  };
  function scanRisk(text) {
    const raw = String(text || '');
    const norm = raw.replace(/\s+/g, '');
    const hi = RISK_TERMS.high.filter((t) => norm.includes(t.replace(/\s+/g, '')));
    const mi = RISK_TERMS.mid.filter((t) => norm.includes(t.replace(/\s+/g, '')));
    return {
      hit: hi.length > 0 || mi.length > 0,
      level: hi.length ? 'high' : (mi.length ? 'mid' : null),
      terms: [...hi, ...mi],
      excerpt: raw.trim().slice(0, 60)
    };
  }
  const dateStr = (ts) => {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const newReflectionPage = () => ({ id: genId(), type: 'reflection', title: '자기성찰일지' });
  function ensureReflectionLast(pages) {
    const i = pages.findIndex((p) => p.type === 'reflection');
    const refl = i >= 0 ? pages.splice(i, 1)[0] : newReflectionPage();
    pages.push(refl);
    return pages;
  }
  function youtubeId(url) {
    const s = String(url || '').trim();
    const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
    return m ? m[1] : (/^[\w-]{11}$/.test(s) ? s : '');
  }

  /* ── 목록 ── */
  async function renderClass(body) {
    const isTeacher = user.role === 'teacher';
    body.innerHTML = `
      <div class="card">
        <div class="mat-head">
          <div>
            <h3 class="dash-title" style="margin:0">📖 교과수업</h3>
            <p class="mat-sub">${isTeacher
              ? '슬라이드 수업을 만들어 반에 배정하고, 발표 모드로 학생 화면을 동기화하세요.'
              : '우리 반 수업을 열어 학습하고, 마지막 페이지에서 자기성찰일지를 작성하세요.'}</p>
          </div>
          ${isTeacher ? `<button id="lsn-add" class="btn-primary">＋ 새 수업 만들기</button>` : ''}
        </div>
        <div id="lsn-list" class="lsn-list"><p class="mat-loading">불러오는 중…</p></div>
      </div>
    `;
    if (isTeacher) body.querySelector('#lsn-add').addEventListener('click', openCreateModal);
    await loadLessons();
    lessonsUnsub = DB.subscribe('lessons', () => loadLessons());
  }

  async function loadLessons() {
    if (!rootEl) return;
    const listEl = rootEl.querySelector('#lsn-list');
    if (!listEl) return;
    const isTeacher = user.role === 'teacher';
    const obj = (await DB.read('lessons')) || {};
    let items = Object.values(obj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!isTeacher) items = items.filter((l) => l.classId === user.classId);

    if (!items.length) {
      listEl.innerHTML = `<div class="mat-empty">${isTeacher
        ? '아직 만든 수업이 없습니다. <b>＋ 새 수업 만들기</b>로 시작하세요.'
        : '아직 우리 반에 등록된 수업이 없어요. 새 수업이 열리면 자동으로 표시됩니다.'}</div>`;
      return;
    }

    listEl.innerHTML = items.map((l) => {
      const pageCount = (l.pages || []).length;
      const live = l.live && l.live.active;
      return `
        <div class="lsn-item" data-id="${esc(l.id)}">
          <div class="lsn-main">
            <p class="lsn-title">${esc(l.title)} ${live ? '<span class="lsn-live">🔴 발표중</span>' : ''}</p>
            <p class="lsn-meta">${esc(cidLabel(l.classId))} · ${pageCount}페이지${l.date ? ` · ${esc(l.date)}` : ''} · ${esc(l.createdByName || '교사')}</p>
          </div>
          <div class="lsn-actions">
            ${isTeacher ? `
              <button class="btn-mini lsn-edit">편집</button>
              <button class="btn-mini lsn-present">발표</button>
              <button class="btn-mini lsn-copy">복사</button>
              <button class="btn-mini lsn-refl">성찰일지</button>
              <button class="btn-mini lsn-del text-red-500">삭제</button>
            ` : `<button class="btn-primary btn-mini lsn-open">${live ? '▶ 수업 참여' : '열기'}</button>`}
          </div>
        </div>`;
    }).join('');

    const idOf = (e) => e.target.closest('.lsn-item').dataset.id;
    listEl.querySelectorAll('.lsn-open, .lsn-present').forEach((b) =>
      b.addEventListener('click', (e) => openViewer(obj[idOf(e)])));
    if (isTeacher) {
      listEl.querySelectorAll('.lsn-edit').forEach((b) => b.addEventListener('click', (e) => openEditor(obj[idOf(e)])));
      listEl.querySelectorAll('.lsn-copy').forEach((b) => b.addEventListener('click', (e) => openCopyModal(obj[idOf(e)])));
      listEl.querySelectorAll('.lsn-refl').forEach((b) => b.addEventListener('click', (e) => openReflections(obj[idOf(e)])));
      listEl.querySelectorAll('.lsn-del').forEach((b) => b.addEventListener('click', (e) => deleteLesson(obj[idOf(e)])));
    }
  }

  /* ── 새 수업 만들기 ── */
  async function openCreateModal() {
    if (user.role !== 'teacher') return;
    const classes = await getClasses();
    if (!classes.length) { alert('먼저 ⚙️ 설정에서 학생을 등록해 반을 만들어 주세요.'); return; }
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-4">새 수업 만들기</h3>
      <form id="lsn-form" class="space-y-3" autocomplete="off">
        <div>
          <label class="form-label">수업 제목</label>
          <input id="lsn-title" class="form-input" placeholder="예) 1단원 - 일차방정식" required>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="form-label">대상 반</label>
            <select id="lsn-class" class="form-input">
              ${classes.map((c) => `<option value="${c.classId}">${esc(classLabel(c.grade, c.classNo))} (${c.students.length}명)</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">날짜 <span class="text-slate-400 font-normal">(선택)</span></label>
            <input id="lsn-date" type="date" class="form-input">
          </div>
        </div>
        <p class="text-xs text-slate-400">수업을 만들면 맨 끝에 <b>자기성찰일지</b> 페이지가 자동으로 추가됩니다.</p>
        <p id="lsn-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
        <div class="flex gap-2 justify-end">
          <button type="button" class="btn-ghost modal-close">취소</button>
          <button type="submit" class="btn-primary">만들기</button>
        </div>
      </form>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);
    box.querySelector('#lsn-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = box.querySelector('#lsn-title').value.trim();
      const classId = box.querySelector('#lsn-class').value;
      const date = box.querySelector('#lsn-date').value || null;
      if (!title) { box.querySelector('#lsn-error').textContent = '제목을 입력하세요.'; return; }
      const id = genId();
      const rec = {
        id, title, classId, date,
        createdBy: user.uid, createdByName: user.name || user.loginId,
        createdAt: Date.now(), updatedAt: Date.now(),
        pages: [newReflectionPage()],
        live: { active: false, page: 0 }
      };
      await DB.write(`lessons/${id}`, rec);
      closeModal();
      toast('수업이 생성되었습니다. 페이지를 추가해 보세요.');
      if (!useFB()) await loadLessons();
      openEditor(rec);
    });
  }

  /* ── 수업 편집 ── */
  function openEditor(lesson) {
    if (!lesson || user.role !== 'teacher') return;
    let title = lesson.title;
    let date = lesson.date || '';
    const pages = ensureReflectionLast((lesson.pages || []).slice());

    function syncMeta(box) {
      const t = box.querySelector('#ed-title'); if (t) title = t.value;
      const d = box.querySelector('#ed-date'); if (d) date = d.value;
    }
    function pageRow(p, idx) {
      const t = PAGE_TYPES[p.type] || { icon: '📄', label: p.type };
      const locked = p.type === 'reflection';
      return `
        <div class="ed-page" data-idx="${idx}">
          <span class="ed-page-icon">${t.icon}</span>
          <span class="ed-page-title">${idx + 1}. ${esc(p.title || t.label)} <span class="ed-page-type">${t.label}</span>${locked ? ' 🔒' : ''}</span>
          <span class="ed-page-actions">
            ${locked ? `<span class="text-xs text-slate-400">학생 작성용 · 고정</span>` : `
              <button class="btn-mini ed-up" title="위로">▲</button>
              <button class="btn-mini ed-down" title="아래로">▼</button>
              <button class="btn-mini ed-edit">편집</button>
              <button class="btn-mini ed-del text-red-500">삭제</button>`}
          </span>
        </div>`;
    }
    function paint() {
      const box = openModal(`
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-bold text-slate-800">수업 편집</h3>
          <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>
        <input id="ed-title" class="form-input mb-2" value="${esc(title)}" placeholder="수업 제목">
        <div class="grid grid-cols-2 gap-2 mb-3 items-center">
          <div class="text-sm text-slate-500">대상: <b>${esc(cidLabel(lesson.classId))}</b></div>
          <input id="ed-date" type="date" class="form-input" value="${esc(date)}">
        </div>
        <div class="ed-pages">${pages.map(pageRow).join('')}</div>
        <div class="ed-addbar">
          <span class="text-xs text-slate-500 mr-1">＋ 페이지:</span>
          ${['concept', 'note', 'youtube', 'embed', 'assessment'].map((t) =>
            `<button class="btn-mini ed-add" data-type="${t}">${PAGE_TYPES[t].icon} ${PAGE_TYPES[t].label}</button>`).join('')}
        </div>
        <div class="flex gap-2 justify-end mt-4">
          <button class="btn-ghost modal-close">닫기</button>
          <button id="ed-save" class="btn-primary">저장</button>
        </div>
      `);
      box.querySelectorAll('.modal-close').forEach((b) => b.addEventListener('click', closeModal));
      box.querySelectorAll('.ed-add').forEach((b) =>
        b.addEventListener('click', () => { syncMeta(box); addPage(b.dataset.type); }));
      box.querySelectorAll('.ed-page').forEach((row) => {
        const idx = +row.dataset.idx;
        const up = row.querySelector('.ed-up'); if (up) up.addEventListener('click', () => { syncMeta(box); movePage(idx, -1); });
        const dn = row.querySelector('.ed-down'); if (dn) dn.addEventListener('click', () => { syncMeta(box); movePage(idx, 1); });
        const ed = row.querySelector('.ed-edit'); if (ed) ed.addEventListener('click', () => { syncMeta(box); editPage(idx); });
        const dl = row.querySelector('.ed-del'); if (dl) dl.addEventListener('click', () => { syncMeta(box); if (confirm('이 페이지를 삭제할까요?')) { pages.splice(idx, 1); paint(); } });
      });
      box.querySelector('#ed-save').addEventListener('click', () => { syncMeta(box); saveLesson(); });
    }
    function addPage(type) {
      const np = { id: genId(), type, title: PAGE_TYPES[type].label };
      // reflection 앞(마지막에서 두번째)에 삽입
      const ri = pages.findIndex((p) => p.type === 'reflection');
      pages.splice(ri < 0 ? pages.length : ri, 0, np);
      editPage(pages.indexOf(np));
    }
    function movePage(idx, dir) {
      const j = idx + dir;
      if (j < 0 || j >= pages.length) return;
      if (pages[idx].type === 'reflection' || pages[j].type === 'reflection') return; // 고정
      [pages[idx], pages[j]] = [pages[j], pages[idx]];
      paint();
    }
    function pageFields(p) {
      if (p.type === 'concept' || p.type === 'note')
        return `<div><label class="form-label">내용</label><textarea id="pg-body" class="form-input" rows="6" placeholder="학습 내용을 입력하세요">${esc(p.body || '')}</textarea></div>`;
      if (p.type === 'youtube')
        return `<div><label class="form-label">유튜브 링크 또는 영상 ID</label><input id="pg-url" class="form-input" value="${esc(p.url || '')}" placeholder="https://youtu.be/..."></div>`;
      if (p.type === 'embed')
        return `<div><label class="form-label">웹 주소(URL)</label><input id="pg-url" class="form-input" value="${esc(p.url || '')}" placeholder="https://..."></div>
                <p class="text-xs text-slate-400 mt-1">사이트가 임베드를 막으면 '새 창에서 열기'로 표시됩니다.</p>`;
      if (p.type === 'assessment')
        return `<div><label class="form-label">평가 안내</label><textarea id="pg-body" class="form-input" rows="3" placeholder="평가 안내 (자동채점 평가 기능은 STEP 08에서 제공)">${esc(p.body || '')}</textarea></div>`;
      return '';
    }
    function editPage(idx) {
      const p = pages[idx];
      const box = openModal(`
        <h3 class="text-lg font-bold text-slate-800 mb-4">${PAGE_TYPES[p.type].icon} ${PAGE_TYPES[p.type].label} 편집</h3>
        <form id="pg-form" class="space-y-3" autocomplete="off">
          <div><label class="form-label">페이지 제목</label><input id="pg-title" class="form-input" value="${esc(p.title || '')}" placeholder="페이지 제목"></div>
          ${pageFields(p)}
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-ghost pg-cancel">취소</button>
            <button type="submit" class="btn-primary">적용</button>
          </div>
        </form>
      `);
      box.querySelector('.pg-cancel').addEventListener('click', paint);
      box.querySelector('#pg-form').addEventListener('submit', (e) => {
        e.preventDefault();
        p.title = box.querySelector('#pg-title').value.trim() || PAGE_TYPES[p.type].label;
        const bodyEl = box.querySelector('#pg-body'); if (bodyEl) p.body = bodyEl.value;
        const urlEl = box.querySelector('#pg-url'); if (urlEl) p.url = urlEl.value.trim();
        paint();
      });
    }
    async function saveLesson() {
      ensureReflectionLast(pages);
      const full = Object.assign({}, lesson, {
        title: (title || '').trim() || lesson.title,
        date: date || null,
        pages,
        updatedAt: Date.now()
      });
      await DB.write(`lessons/${lesson.id}`, full);
      closeModal();
      toast('수업이 저장되었습니다.');
      if (!useFB()) await loadLessons();
    }
    paint();
  }

  /* ── 수업 복사 (다른 반으로 복제) ── */
  async function openCopyModal(lesson) {
    if (!lesson || user.role !== 'teacher') return;
    const classes = await getClasses();
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-1">수업 복사</h3>
      <p class="text-sm text-slate-500 mb-3">"<b>${esc(lesson.title)}</b>"을(를) 선택한 반으로 복제합니다.</p>
      <div class="ev-classes" style="border:none;padding:0">
        ${classes.length ? `<div class="ev-class-grid">
          ${classes.map((c) => `<label class="ev-class-chk"><input type="checkbox" value="${c.classId}">
            ${esc(classLabel(c.grade, c.classNo))}<span class="ev-class-cnt">${c.students.length}명</span></label>`).join('')}
        </div>` : `<p class="text-sm text-amber-600">등록된 반이 없습니다.</p>`}
      </div>
      <p id="cp-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
      <div class="flex gap-2 justify-end">
        <button type="button" class="btn-ghost modal-close">취소</button>
        <button id="cp-go" class="btn-primary">복사</button>
      </div>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);
    box.querySelector('#cp-go').addEventListener('click', async () => {
      const cids = [...box.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
      if (!cids.length) { box.querySelector('#cp-error').textContent = '복사할 반을 1개 이상 선택하세요.'; return; }
      for (const cid of cids) {
        const id = genId();
        const pages = (lesson.pages || []).map((p) => Object.assign({}, p, { id: genId() }));
        ensureReflectionLast(pages);
        await DB.write(`lessons/${id}`, {
          id, title: lesson.title, classId: cid, date: lesson.date || null,
          createdBy: user.uid, createdByName: user.name || user.loginId,
          createdAt: Date.now(), updatedAt: Date.now(),
          pages, live: { active: false, page: 0 }
        });
      }
      closeModal();
      toast(`${cids.length}개 반으로 복사했습니다.`);
      if (!useFB()) await loadLessons();
    });
  }

  async function deleteLesson(lesson) {
    if (!lesson || user.role !== 'teacher') return;
    if (!confirm(`"${lesson.title}" 수업을 삭제할까요? 학생 자기성찰일지도 함께 삭제됩니다.`)) return;
    await DB.remove(`lessons/${lesson.id}`);
    await DB.remove(`reflections/${lesson.id}`);
    toast('수업이 삭제되었습니다.');
    if (!useFB()) await loadLessons();
  }

  /* ── 교사: 자기성찰일지 모아보기 ── */
  async function openReflections(lesson) {
    if (!lesson) return;
    let onlyRisk = false;
    async function paint() {
      const obj = (await DB.read(`reflections/${lesson.id}`)) || {};
      let entries = Object.values(obj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (onlyRisk) entries = entries.filter((e) => e.risk && e.risk.hit);
      const box = openModal(`
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-lg font-bold text-slate-800">🪞 자기성찰일지 — ${esc(lesson.title)}</h3>
          <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>
        <label class="text-sm text-slate-600 mb-3 inline-flex items-center gap-1">
          <input type="checkbox" id="rf-risk" ${onlyRisk ? 'checked' : ''}> 위험 신호만 보기
        </label>
        <div class="rf-list">
          ${entries.length ? entries.map((e) => {
            const lv = e.risk && e.risk.hit
              ? `<span class="rf-badge ${e.risk.level}">${e.risk.level === 'high' ? '🚨 위기' : '⚠️ 주의'}</span>` : '';
            return `<div class="rf-entry">
              <p class="rf-who">${esc(e.studentName || '학생')} <span class="rf-cls">${esc(cidLabel(e.classId))}</span> ${lv} <span class="rf-date">${esc(e.date || '')}</span></p>
              <p class="rf-content">${esc(e.content || '').replace(/\n/g, '<br>')}</p>
            </div>`;
          }).join('') : `<p class="mat-empty">${onlyRisk ? '위험 신호가 감지된 일지가 없습니다.' : '아직 작성된 자기성찰일지가 없습니다.'}</p>`}
        </div>
      `);
      box.querySelector('.modal-close').addEventListener('click', closeModal);
      box.querySelector('#rf-risk').addEventListener('change', (e) => { onlyRisk = e.target.checked; paint(); });
    }
    paint();
  }

  /* ============================================================
     3-C) 슬라이드 뷰어 (열람 / 발표동기화 / 이탈경고 / 성찰작성)
  ============================================================ */
  let viewer = null;

  function viewerRoot() {
    let el = document.getElementById('lesson-viewer-root');
    if (!el) { el = document.createElement('div'); el.id = 'lesson-viewer-root'; document.body.appendChild(el); }
    return el;
  }
  function closeViewer() {
    if (viewer) {
      if (viewer.presenting) { DB.write(`lessons/${viewer.lesson.id}/live`, { active: false, page: viewer.idx, startedAt: viewer.startedAt || Date.now() }); }
      if (viewer.liveUnsub) { try { viewer.liveUnsub(); } catch (e) {} }
      if (viewer.visHandler) { document.removeEventListener('visibilitychange', viewer.visHandler); }
      viewer = null;
    }
    const el = document.getElementById('lesson-viewer-root');
    if (el) el.innerHTML = '';
  }

  function openViewer(lesson) {
    if (!lesson) return;
    closeViewer();
    const isTeacher = user.role === 'teacher';
    viewer = { lesson, idx: 0, presenting: false, following: !isTeacher, hidden: false, lastLive: null, liveUnsub: null, visHandler: null, startedAt: 0 };

    viewerRoot().innerHTML = `
      <div class="viewer-overlay">
        <div class="viewer-box">
          <header class="viewer-head">
            <button class="viewer-close" title="닫기">✕</button>
            <span class="viewer-title">${esc(lesson.title)}</span>
            <span class="viewer-ind" id="vw-ind"></span>
            <span class="viewer-tools">
              ${isTeacher ? `<button id="vw-present" class="btn-mini">발표 시작</button>` : ''}
            </span>
          </header>
          <div id="vw-follow" class="viewer-follow hidden"></div>
          <div class="viewer-stage" id="vw-stage"></div>
          <footer class="viewer-nav">
            <button id="vw-prev" class="btn-ghost">← 이전</button>
            <button id="vw-next" class="btn-primary">다음 →</button>
          </footer>
        </div>
      </div>
      <div id="vw-leave" class="viewer-leave hidden">
        <div class="viewer-leave-box">
          <div class="text-4xl mb-2">👀</div>
          <p class="font-bold text-slate-800 mb-1">수업 화면을 벗어났어요</p>
          <p class="text-sm text-slate-500 mb-4">수업에 다시 집중해 주세요.</p>
          <button id="vw-leave-ok" class="btn-primary">수업으로 돌아가기</button>
        </div>
      </div>
    `;
    const root = viewerRoot();
    root.querySelector('.viewer-close').addEventListener('click', closeViewer);
    root.querySelector('#vw-prev').addEventListener('click', () => gotoPage(viewer.idx - 1, true));
    root.querySelector('#vw-next').addEventListener('click', () => gotoPage(viewer.idx + 1, true));
    const leaveOk = root.querySelector('#vw-leave-ok');
    if (leaveOk) leaveOk.addEventListener('click', () => root.querySelector('#vw-leave').classList.add('hidden'));

    if (isTeacher) {
      const pb = root.querySelector('#vw-present');
      pb.addEventListener('click', () => {
        if (!viewer.presenting) {
          viewer.presenting = true; viewer.startedAt = Date.now();
          pb.textContent = '발표 종료'; pb.classList.add('on');
          DB.write(`lessons/${viewer.lesson.id}/live`, { active: true, page: viewer.idx, startedAt: viewer.startedAt });
          toast('발표를 시작했습니다. 학생 화면이 동기화됩니다.');
        } else {
          viewer.presenting = false;
          pb.textContent = '발표 시작'; pb.classList.remove('on');
          DB.write(`lessons/${viewer.lesson.id}/live`, { active: false, page: viewer.idx, startedAt: viewer.startedAt });
          toast('발표를 종료했습니다.');
        }
      });
    } else {
      subscribeLive();
      attachVisibility();
    }
    paintPage();
  }

  function gotoPage(i, manual) {
    const v = viewer; if (!v) return;
    const n = (v.lesson.pages || []).length;
    v.idx = Math.max(0, Math.min(i, n - 1));
    if (v.presenting) DB.write(`lessons/${v.lesson.id}/live`, { active: true, page: v.idx, startedAt: v.startedAt || Date.now() });
    if (manual && user.role !== 'teacher' && v.following) { v.following = false; refreshFollowBanner(); }
    paintPage();
  }

  function subscribeLive() {
    const v = viewer;
    v.liveUnsub = DB.subscribe(`lessons/${v.lesson.id}/live`, (live) => {
      if (!viewer) return;
      v.lastLive = live || null;
      refreshFollowBanner();
      if (live && live.active && v.following && typeof live.page === 'number') {
        v.idx = Math.max(0, Math.min(live.page, (v.lesson.pages || []).length - 1));
        paintPage();
      }
    });
  }
  function refreshFollowBanner() {
    const root = document.getElementById('lesson-viewer-root'); if (!root) return;
    const banner = root.querySelector('#vw-follow'); if (!banner) return;
    const live = viewer && viewer.lastLive;
    if (!live || !live.active) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    banner.innerHTML = viewer.following
      ? `🔴 선생님 화면을 따라갑니다 <button class="vw-link" id="vw-unfollow">따라가기 해제</button>`
      : `🔴 발표 진행중 <button class="vw-link" id="vw-refollow">선생님 화면 따라가기</button>`;
    const un = banner.querySelector('#vw-unfollow');
    if (un) un.addEventListener('click', () => { viewer.following = false; refreshFollowBanner(); });
    const re = banner.querySelector('#vw-refollow');
    if (re) re.addEventListener('click', () => { viewer.following = true; if (typeof live.page === 'number') { viewer.idx = live.page; paintPage(); } refreshFollowBanner(); });
  }
  function attachVisibility() {
    const v = viewer;
    v.visHandler = () => {
      if (document.hidden) v.hidden = true;
      else if (v.hidden) { v.hidden = false; const el = document.getElementById('vw-leave'); if (el) el.classList.remove('hidden'); }
    };
    document.addEventListener('visibilitychange', v.visHandler);
  }

  async function paintPage() {
    const v = viewer; if (!v) return;
    const root = document.getElementById('lesson-viewer-root'); if (!root) return;
    const stage = root.querySelector('#vw-stage'); if (!stage) return;
    const pages = v.lesson.pages || [];
    v.idx = Math.max(0, Math.min(v.idx, pages.length - 1));
    const p = pages[v.idx] || {};
    root.querySelector('#vw-ind').textContent = `${v.idx + 1} / ${pages.length}`;
    const prev = root.querySelector('#vw-prev'), next = root.querySelector('#vw-next');
    prev.disabled = v.idx === 0; next.disabled = v.idx === pages.length - 1;
    stage.innerHTML = await pageHtml(p, v);
    if (p.type === 'reflection' && user.role !== 'teacher') bindReflection(stage, v);
    const rv = stage.querySelector('#vw-refl-view'); if (rv) rv.addEventListener('click', () => openReflections(v.lesson));
  }

  async function pageHtml(p, v) {
    const title = esc(p.title || (PAGE_TYPES[p.type] ? PAGE_TYPES[p.type].label : ''));
    if (p.type === 'concept' || p.type === 'note' || p.type === 'assessment') {
      const note = p.type === 'assessment' ? `<p class="slide-note">자동채점 평가 기능은 STEP 08에서 제공됩니다.</p>` : '';
      return `<div class="slide slide-text"><h2>${title}</h2>
        <div class="slide-body">${esc(p.body || '').replace(/\n/g, '<br>') || '<span class="text-slate-300">내용이 없습니다.</span>'}</div>${note}</div>`;
    }
    if (p.type === 'youtube') {
      const id = youtubeId(p.url);
      return `<div class="slide"><h2>${title}</h2>${id
        ? `<div class="slide-media"><iframe src="https://www.youtube.com/embed/${id}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
        : `<p class="slide-note">유효한 유튜브 링크가 아닙니다.</p>`}</div>`;
    }
    if (p.type === 'embed') {
      const url = String(p.url || '');
      return `<div class="slide"><h2>${title}</h2>${url
        ? `<div class="slide-media"><iframe src="${esc(url)}" referrerpolicy="no-referrer"></iframe></div>
           <div class="slide-fallback"><a href="${esc(url)}" target="_blank" rel="noopener" class="btn-ghost">↗ 새 창에서 열기</a></div>`
        : `<p class="slide-note">웹 주소가 비어 있습니다.</p>`}</div>`;
    }
    if (p.type === 'reflection') {
      if (user.role === 'teacher') {
        return `<div class="slide slide-text"><h2>🪞 자기성찰일지</h2>
          <p class="text-slate-500 mb-4">학생이 수업을 마치고 작성하는 페이지입니다.</p>
          <button id="vw-refl-view" class="btn-primary">📋 학생 성찰일지 모아보기</button></div>`;
      }
      const entry = await DB.read(`reflections/${v.lesson.id}/${user.uid}`);
      return `<div class="slide slide-text"><h2>🪞 자기성찰일지</h2>
        <p class="text-slate-500 mb-3">오늘 수업에서 배운 점, 느낀 점, 어려웠던 점을 자유롭게 적어보세요.</p>
        <textarea id="vw-refl" class="form-input" rows="7" placeholder="나의 생각을 적어요…">${esc(entry && entry.content || '')}</textarea>
        <div class="flex items-center gap-2 mt-3">
          <button id="vw-refl-save" class="btn-primary">저장</button>
          ${entry ? `<span class="text-xs text-slate-400">최근 저장: ${esc(entry.date || '')}</span>` : ''}
        </div></div>`;
    }
    return `<div class="slide slide-text"><h2>${title}</h2></div>`;
  }

  function bindReflection(stage, v) {
    const btn = stage.querySelector('#vw-refl-save');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const content = (stage.querySelector('#vw-refl').value || '').trim();
      if (!content) { toast('내용을 입력해 주세요.'); return; }
      const risk = scanRisk(content);
      const rec = {
        content, date: dateStr(), studentName: user.name || user.loginId,
        classId: user.classId || '', risk, createdAt: Date.now()
      };
      try {
        await DB.write(`reflections/${v.lesson.id}/${user.uid}`, rec);
        toast('자기성찰일지가 저장되었습니다. 수고했어요!');
        if (risk.hit) await fireRiskAlert(v.lesson, risk);
        if (risk.level === 'high') showSupportModal();
      } catch (ex) { toast('저장 실패: ' + ex.message); }
    });
  }

  // 위험 감지 시 담당 교사 전원에게 메신저 알림
  async function fireRiskAlert(lesson, risk) {
    if (!window.Messenger || typeof Messenger.sendAlertTo !== 'function') return;
    let teachers = [];
    try { teachers = await Auth.listContacts(); } catch (e) { return; }
    const who = `${user.name || user.loginId}(${cidLabel(user.classId)})`;
    const text = `🚨 자기성찰일지 위기 신호 감지\n학생: ${who}\n수업: ${lesson.title}\n발췌: "${risk.excerpt}"\n학생의 마음을 살펴봐 주세요.`;
    for (const t of teachers) { try { await Messenger.sendAlertTo(t.uid, text); } catch (e) {} }
  }

  // 고위험 시 학생에게 지지 메시지 + 상담 연락처 (전국 공통 번호 — 블라인드 안전)
  function showSupportModal() {
    const box = openModal(`
      <div class="text-center">
        <div class="text-4xl mb-2">💙</div>
        <h3 class="text-lg font-bold text-slate-800 mb-2">잠깐, 혼자 힘들어하지 말아요</h3>
        <p class="text-sm text-slate-600 leading-relaxed mb-4">
          많이 힘들었군요. 당신의 마음은 소중합니다.<br>
          언제든 아래로 연락하면 따뜻한 도움을 받을 수 있어요.
        </p>
        <div class="support-lines">
          <div>📞 자살예방 상담전화 <b>109</b> · <b>1393</b></div>
          <div>📞 청소년 전화 <b>1388</b></div>
        </div>
        <button class="btn-primary modal-close mt-4">알겠어요</button>
      </div>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);
  }

  /* ============================================================
     4) 모달 · 토스트 (app.js 와 독립)
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
  window.Lesson = { render };
  console.log('[lesson] STEP 06 로드 완료 — 학습실: 교과수업(생성·편집·복사·발표동기화·자기성찰일지) / 자료방');
})();
