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
    closeViewer();   // 탭 전환 시 열려있던 뷰어/구독 정리
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

  /* ============================================================
     [수업노트] PDF.js · jsPDF · 필기 캔버스 공용
  ============================================================ */
  const fileToDataUrl = (file) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const loadImg = (src) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  });

  const _pdfDocCache = {};       // pdfId -> Promise<pdf>
  const _pdfImgCache = {};       // `${pdfId}:${page}` -> dataURL
  async function getPdfDoc(pdfId) {
    if (!window.pdfjsLib) throw new Error('PDF 라이브러리가 로드되지 않았습니다.');
    if (_pdfDocCache[pdfId]) return _pdfDocCache[pdfId];
    const meta = await DB.read(`lessonPdfs/${pdfId}`);
    if (!meta) throw new Error('PDF 정보를 찾을 수 없습니다.');
    _pdfDocCache[pdfId] = pdfjsLib.getDocument({ url: meta.url || meta.data }).promise;
    return _pdfDocCache[pdfId];
  }
  async function renderPdfToDataUrl(pdfId, pageNo, targetW) {
    const key = `${pdfId}:${pageNo}`;
    if (_pdfImgCache[key]) return _pdfImgCache[key];
    const pdf = await getPdfDoc(pdfId);
    const page = await pdf.getPage(pageNo);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = (targetW || 1000) / vp1.width;
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const url = c.toDataURL('image/jpeg', 0.85);
    _pdfImgCache[key] = url;
    return url;
  }

  // PDF 업로드 → 1회 저장 → {pdfId, numPages, over}
  async function importPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF 라이브러리가 로드되지 않았습니다.');
    const buf = await file.arrayBuffer();
    const counting = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const total = counting.numPages;
    const numPages = Math.min(total, 30);
    const pdfId = genId();
    const meta = { id: pdfId, name: file.name, numPages };
    if (useStorage()) {
      const path = `lessonPdfs/${pdfId}/${file.name}`;
      const ref = window.FB.storage.ref(path);
      await ref.put(file);
      meta.url = await ref.getDownloadURL(); meta.storagePath = path;
    } else {
      if (file.size > MAX_DEMO_BYTES) throw new Error(`데모 모드에서는 ${fmtSize(MAX_DEMO_BYTES)} 이하 PDF만 가능합니다. (Firebase 연결 시 대용량 가능)`);
      meta.data = await fileToDataUrl(file);
    }
    await DB.write(`lessonPdfs/${pdfId}`, meta);
    return { pdfId, numPages, over: total > 30 };
  }

  /* ── 필기 캔버스 컴포넌트 (편집기·뷰어 공용) ──
     opts: { bg:{pdfId,pdfPage}|null, staticStrokes:[](읽기전용), baseStrokes:[](편집), editable, onChange } */
  const NOTE_COLORS = ['#1e293b', '#2563eb', '#dc2626', '#16a34a', '#f59e0b'];
  const cloneStroke = (s) => ({ c: s.c, w: s.w, pts: (s.pts || []).map((p) => [p[0], p[1]]) });

  function mountNoteCanvas(stage, opts) {
    opts = opts || {};
    let strokes = (opts.baseStrokes || []).map(cloneStroke);
    const staticStrokes = (opts.staticStrokes || []).map(cloneStroke);
    let mode = 'pen', color = NOTE_COLORS[1], width = 0.004;
    let editable = !!opts.editable;
    let drawing = false, cur = null, dispW = 0, dispH = 0;

    stage.classList.add('note-stage');
    stage.innerHTML = `<div class="note-bg"></div><canvas class="note-ink"></canvas>`;
    const bgEl = stage.querySelector('.note-bg');
    const canvas = stage.querySelector('.note-ink');
    const ctx = canvas.getContext('2d');
    let ar = 0.7;

    function layout() {
      dispW = stage.clientWidth || 600;
      dispH = Math.round(dispW * ar);
      stage.style.height = dispH + 'px';
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(dispW * dpr); canvas.height = Math.floor(dispH * dpr);
      canvas.style.width = dispW + 'px'; canvas.style.height = dispH + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }
    function drawStroke(s) {
      if (!s.pts || !s.pts.length) return;
      ctx.strokeStyle = s.c; ctx.lineWidth = Math.max(1, s.w * dispW);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      s.pts.forEach((p, i) => { const x = p[0] * dispW, y = p[1] * dispH; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * dispW + 0.1, s.pts[0][1] * dispH);
      ctx.stroke();
    }
    function redraw() {
      ctx.clearRect(0, 0, dispW, dispH);
      staticStrokes.forEach(drawStroke);
      strokes.forEach(drawStroke);
      if (cur) drawStroke(cur);
    }
    function pos(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
    function eraseAt(p) {
      const before = strokes.length;
      strokes = strokes.filter((s) => !(s.pts || []).some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.025));
      if (strokes.length !== before) { redraw(); change(); }
    }
    function change() { if (typeof opts.onChange === 'function') opts.onChange(getStrokes()); }

    canvas.addEventListener('pointerdown', (e) => {
      if (!editable) return;
      e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      drawing = true;
      if (mode === 'eraser') { eraseAt(pos(e)); return; }
      cur = { c: color, w: width, pts: [pos(e)] }; redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !editable) return;
      const p = pos(e);
      if (mode === 'eraser') { eraseAt(p); return; }
      cur.pts.push(p); redraw();
    });
    const endDraw = () => {
      if (!drawing) return; drawing = false;
      if (mode === 'pen' && cur && cur.pts.length) { strokes.push(cur); cur = null; redraw(); change(); }
      else cur = null;
    };
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);
    canvas.addEventListener('pointerleave', endDraw);

    function getStrokes() { return strokes.map(cloneStroke); }
    window.addEventListener('resize', layout);

    // 배경 설정 후 레이아웃
    (async () => {
      if (opts.bg && opts.bg.pdfId) {
        try {
          const url = await renderPdfToDataUrl(opts.bg.pdfId, opts.bg.pdfPage || 1, 1200);
          const im = await loadImg(url);
          ar = im.height / im.width;
          bgEl.style.backgroundImage = `url(${url})`;
        } catch (e) { bgEl.classList.add('blank'); ar = 0.7; }
      } else { bgEl.classList.add('blank'); ar = 0.7; }
      layout();
    })();

    return {
      getStrokes,
      setTool: (m, c, w) => { if (m) mode = m; if (c) color = c; if (w) width = w; },
      setEditable: (v) => { editable = v; canvas.classList.toggle('drawing', v); },
      undo: () => { strokes.pop(); redraw(); change(); },
      clear: () => { strokes = []; redraw(); change(); },
      redraw, layout,
      destroy: () => { window.removeEventListener('resize', layout); }
    };
  }

  function noteToolbarHtml() {
    return `
      <button class="nt-tool active" data-mode="pen" title="펜">✏️</button>
      <button class="nt-tool" data-mode="eraser" title="지우개">🩹</button>
      <span class="nt-colors">${NOTE_COLORS.map((c, i) =>
        `<button class="nt-color ${i === 1 ? 'active' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</span>
      <input type="range" class="nt-width" min="1" max="8" value="2" title="굵기">
      <button class="nt-tool nt-undo" title="되돌리기">↶</button>
      <button class="nt-tool nt-clear" title="전체 지우기">🗑️</button>`;
  }
  function bindNoteToolbar(scope, nc) {
    const bar = scope.querySelector('.note-toolbar'); if (!bar) return;
    const activate = (sel, el) => { bar.querySelectorAll(sel).forEach((x) => x.classList.remove('active')); el.classList.add('active'); };
    bar.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => { activate('[data-mode]', b); nc.setTool(b.dataset.mode); }));
    bar.querySelectorAll('.nt-color').forEach((b) =>
      b.addEventListener('click', () => {
        activate('.nt-color', b);
        bar.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'pen'));
        nc.setTool('pen', b.dataset.color);
      }));
    const wr = bar.querySelector('.nt-width');
    if (wr) wr.addEventListener('input', () => nc.setTool(null, null, (+wr.value) * 0.002));
    const u = bar.querySelector('.nt-undo'); if (u) u.addEventListener('click', () => nc.undo());
    const cl = bar.querySelector('.nt-clear'); if (cl) cl.addEventListener('click', () => { if (confirm('필기를 모두 지울까요?')) nc.clear(); });
  }

  // 개인 필기 저장 (디바운스)
  let _annTimer = null;
  function saveAnnotation(lessonId, pageId, strokes) {
    clearTimeout(_annTimer);
    const payload = { lessonId, pageId, strokes };
    _annTimer = setTimeout(async () => {
      try { await DB.write(`noteAnnotations/${payload.lessonId}/${payload.pageId}/${user.uid}`, { strokes: payload.strokes }); }
      catch (e) { console.warn('[lesson] 개인 필기 저장 실패', e); }
    }, 600);
  }

  // 수업노트 → 합성 캔버스(배경+교사필기+내필기) → {dataUrl,w,h}
  async function composeNote(p, lessonId) {
    const W = 1000; let ar = 0.7, bgUrl = null;
    if (p.pdfId && window.pdfjsLib) {
      try { bgUrl = await renderPdfToDataUrl(p.pdfId, p.pdfPage || 1, W); const im = await loadImg(bgUrl); ar = im.height / im.width; }
      catch (e) { bgUrl = null; }
    }
    const w = W, h = Math.round(W * ar);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    if (bgUrl) { const im = await loadImg(bgUrl); ctx.drawImage(im, 0, 0, w, h); }
    const drawAll = (arr) => (arr || []).forEach((s) => {
      ctx.strokeStyle = s.c; ctx.lineWidth = Math.max(1, s.w * w); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); (s.pts || []).forEach((pt, i) => { const x = pt[0] * w, y = pt[1] * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    });
    drawAll(p.strokes);
    const my = await DB.read(`noteAnnotations/${lessonId}/${p.id}/${user.uid}`);
    if (my && my.strokes) drawAll(my.strokes);
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), w, h };
  }
  async function exportNotesPdf(lesson) {
    const pages = (lesson.pages || []).filter((p) => p.type === 'note' || p.type === 'concept');
    if (!pages.length) { toast('출력할 수업노트/개념 페이지가 없습니다.'); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) { toast('PDF 출력 라이브러리가 로드되지 않았습니다.'); return; }
    toast('PDF를 만드는 중…');
    let doc = null;
    for (const p of pages) {
      const { dataUrl, w, h } = p.type === 'note' ? await composeNote(p, lesson.id) : await composeConcept(p);
      const orient = w >= h ? 'l' : 'p';
      if (!doc) doc = new window.jspdf.jsPDF({ unit: 'px', format: [w, h], orientation: orient });
      else doc.addPage([w, h], orient);
      doc.addImage(dataUrl, 'JPEG', 0, 0, w, h);
    }
    doc.save(`${(lesson.title || '수업노트').replace(/[\\/:*?"<>|]/g, '_')}_노트.pdf`);
  }

  /* ============================================================
     [개념기반] 3단계 질문 템플릿 · 학생 답변 · AI 초안 · PDF
  ============================================================ */
  const CONCEPT_Q = [
    { kind: 'factual',    label: '사실적 질문', hint: '무엇·누가·언제·어디서 — 정답이 명확한 기초 지식', ex: '이 단원에서 새로 나온 핵심 용어와 그 정의는 무엇인가요?' },
    { kind: 'conceptual', label: '개념적 질문', hint: '어떻게·왜 — 사실을 연결해 더 큰 개념·패턴 이해',   ex: '이 개념은 이전에 배운 내용과 어떻게 연결되며, 왜 그렇게 되나요?' },
    { kind: 'debatable',  label: '토론적 질문', hint: '정답이 없는 가치판단·다양한 관점·비판적 사고',     ex: '이 개념(기술)은 실생활에서 어떻게 활용되거나 제한되어야 할까요? 근거를 들어 자신의 입장을 밝혀보세요.' }
  ];
  const QKINDS = { factual: '사실적 질문', conceptual: '개념적 질문', debatable: '토론적 질문' };
  const QORDER = ['factual', 'conceptual', 'debatable'];
  const defaultConceptQuestions = () => CONCEPT_Q.map((c) => ({ kind: c.kind, q: c.ex }));
  function ensureConceptQuestions(p) {
    if (!Array.isArray(p.questions) || p.questions.length !== 3) p.questions = defaultConceptQuestions();
    return p.questions;
  }

  // AI 초안 생성 (교사 API 키가 있을 때만) — 브라우저에서 Claude Messages API 직접 호출
  async function aiGenerateConcept(title, pdfId) {
    let key = '';
    try { key = await Auth.getApiKey(); } catch (e) {}
    if (!key) throw new Error('AI 키가 없습니다. 설정 → AI 키 설정에서 등록하세요.');
    const sys = '너는 한국 중·고등학교 교사를 돕는 보조교사다. 린 에릭슨의 개념기반 교육과정에 따라 (1) 간결하고 명확한 개념 설명과 (2) 사실적·개념적·토론적 3단계 탐구 질문을 만든다. 반드시 다음 JSON만 출력한다(설명·코드블록 금지): {"body":"개념 설명","questions":[{"kind":"factual","q":"..."},{"kind":"conceptual","q":"..."},{"kind":"debatable","q":"..."}]}';
    const content = [];
    const meta = pdfId ? await DB.read(`lessonPdfs/${pdfId}`) : null;
    let b64 = null;
    if (meta && meta.data && /^data:application\/pdf/.test(meta.data)) b64 = meta.data.split(',')[1];
    else if (meta && meta.url) {
      try {
        const blob = await fetch(meta.url).then((r) => r.blob());
        const durl = await fileToDataUrl(blob);
        b64 = String(durl).split(',')[1];
      } catch (e) {}
    }
    if (b64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    content.push({ type: 'text', text: `주제: ${title || '(제목 미정)'}\n위 자료(있으면)를 바탕으로 개념 설명과 3단계 질문을 만들어줘. JSON만 출력.` });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1500, system: sys, messages: [{ role: 'user', content }] })
    });
    if (!res.ok) throw new Error('AI 호출 실패 (' + res.status + ') — 키/네트워크를 확인하세요.');
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('AI가 요청을 거절했습니다.');
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let parsed;
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
    catch (e) { throw new Error('AI 응답을 해석하지 못했습니다.'); }
    return parsed;
  }

  // 학생 개념 답변 저장(디바운스)
  let _ansTimer = null;
  function saveConceptAnswers(lessonId, pageId, answers) {
    clearTimeout(_ansTimer);
    const payload = { lessonId, pageId, answers };
    _ansTimer = setTimeout(async () => {
      try {
        await DB.write(`conceptAnswers/${payload.lessonId}/${payload.pageId}/${user.uid}`, {
          answers: payload.answers, studentName: user.name || user.loginId,
          classId: user.classId || '', updatedAt: Date.now()
        });
      } catch (e) { console.warn('[lesson] 개념 답변 저장 실패', e); }
    }, 600);
  }

  // 뷰어 개념 페이지: 설명 + (PDF) + 3질문 (학생 작성 / 교사 안내+실시간보기)
  async function mountViewerConcept(host, page, v) {
    if (!host) return;
    ensureConceptQuestions(page);
    const isTeacher = user.role === 'teacher';
    const bodyHtml = esc(page.body || '').replace(/\n/g, '<br>') || '<span class="text-slate-300">개념 설명이 없습니다.</span>';
    const pdfSlot = page.pdfId ? `<div id="cc-pdf-view" class="cc-pdf-view"></div>` : '';

    if (isTeacher) {
      host.innerHTML = `
        <div class="slide-body">${bodyHtml}</div>${pdfSlot}
        <div class="cc-q-list">
          ${page.questions.map((q) => `<div class="cc-qview"><span class="cc-qbadge ${q.kind}">${QKINDS[q.kind]}</span> ${esc(q.q)}</div>`).join('')}
        </div>
        <button id="cc-answers" class="btn-primary" style="margin-top:14px">💬 학생 답변 실시간 보기</button>`;
      const b = host.querySelector('#cc-answers');
      if (b) b.addEventListener('click', () => openConceptAnswers(v.lesson, page));
    } else {
      const mine = await DB.read(`conceptAnswers/${v.lesson.id}/${page.id}/${user.uid}`);
      const a = (mine && mine.answers) || {};
      host.innerHTML = `
        <div class="slide-body">${bodyHtml}</div>${pdfSlot}
        <div class="cc-q-list">
          ${page.questions.map((q) => `
            <div class="cc-qa">
              <p class="cc-qview"><span class="cc-qbadge ${q.kind}">${QKINDS[q.kind]}</span> ${esc(q.q)}</p>
              <textarea class="form-input cc-ans" data-kind="${q.kind}" rows="2" placeholder="내 생각을 적어요…">${esc(a[q.kind] || '')}</textarea>
            </div>`).join('')}
        </div>
        <p class="text-xs text-slate-400 mt-1">작성하면 자동 저장됩니다.</p>`;
      host.querySelectorAll('.cc-ans').forEach((t) =>
        t.addEventListener('input', () => {
          const answers = {};
          host.querySelectorAll('.cc-ans').forEach((x) => { answers[x.dataset.kind] = x.value; });
          saveConceptAnswers(v.lesson.id, page.id, answers);
        }));
    }
    if (page.pdfId) {
      const el = host.querySelector('#cc-pdf-view');
      try { const url = await renderPdfToDataUrl(page.pdfId, page.pdfPage || 1, 900); if (el) el.innerHTML = `<img src="${esc(url)}" alt="참고자료" class="cc-pdf-img">`; }
      catch (e) { if (el) el.innerHTML = '<p class="text-xs text-slate-400">참고 PDF를 불러올 수 없습니다.</p>'; }
    }
  }

  // 교사: 학생 개념 답변 실시간 모아보기
  function openConceptAnswers(lesson, page) {
    let unsub = null;
    const box = openModal(`
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-lg font-bold text-slate-800">💬 학생 답변 — ${esc(page.title || '개념 설명')}</h3>
        <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
      </div>
      <p class="text-xs text-slate-400 mb-3">학생이 작성하는 대로 실시간 갱신됩니다.</p>
      <div id="cc-ans-list" class="rf-list"></div>
    `);
    const listEl = box.querySelector('#cc-ans-list');
    const paint = (obj) => {
      const entries = Object.values(obj || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      listEl.innerHTML = entries.length ? entries.map((e) => `
        <div class="rf-entry">
          <p class="rf-who">${esc(e.studentName || '학생')} <span class="rf-cls">${esc(cidLabel(e.classId))}</span></p>
          ${page.questions.map((q) => `<p class="cc-arow"><b>${QKINDS[q.kind]}:</b> ${esc((e.answers && e.answers[q.kind]) || '—')}</p>`).join('')}
        </div>`).join('') : `<p class="mat-empty">아직 작성한 학생이 없습니다.</p>`;
    };
    const close = () => { if (unsub) { try { unsub(); } catch (e) {} } closeModal(); };
    box.querySelector('.modal-close').addEventListener('click', close);
    DB.read(`conceptAnswers/${lesson.id}/${page.id}`).then((o) => paint(o || {}));
    unsub = DB.subscribe(`conceptAnswers/${lesson.id}/${page.id}`, (o) => paint(o || {}));
  }

  // 개념 페이지 → 캔버스 렌더(PDF 출력용)
  function _wrapLine(ctx, text, x, y, maxW, lh) {
    const words = String(text || '').split(/\s+/); let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; }
      else line = t;
    }
    if (line) { ctx.fillText(line, x, y); y += lh; }
    return y;
  }
  function _wrapPara(ctx, text, x, y, maxW, lh) {
    String(text || '').split('\n').forEach((p) => { y = _wrapLine(ctx, p, x, y, maxW, lh); });
    return y;
  }
  async function composeConcept(p) {
    const W = 1000, H = 1414;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    let y = 80;
    ctx.fillStyle = '#1e293b'; ctx.font = 'bold 34px sans-serif';
    ctx.fillText(p.title || '개념 설명', 60, y); y += 36;
    ctx.fillStyle = '#334155'; ctx.font = '20px sans-serif';
    y = _wrapPara(ctx, p.body || '', 60, y, W - 120, 30); y += 24;
    (p.questions || []).forEach((q) => {
      ctx.fillStyle = '#1e40af'; ctx.font = 'bold 18px sans-serif';
      ctx.fillText(QKINDS[q.kind] || '질문', 60, y); y += 28;
      ctx.fillStyle = '#334155'; ctx.font = '18px sans-serif';
      y = _wrapPara(ctx, q.q || '', 60, y, W - 120, 26); y += 16;
    });
    return { dataUrl: c.toDataURL('image/jpeg', 0.9), w: W, h: H };
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
        <div class="lsn-item ${isTeacher ? 'teacher' : ''}" data-id="${esc(l.id)}">
          <div class="lsn-main">
            <p class="lsn-title">${esc(l.title)} ${live ? '<span class="lsn-live">🔴 수업중</span>' : ''}</p>
            <p class="lsn-meta">${esc(cidLabel(l.classId))} · ${pageCount}페이지${l.date ? ` · ${esc(l.date)}` : ''} · ${esc(l.createdByName || '교사')}</p>
          </div>
          ${isTeacher ? `<button class="lsn-present lsn-enter">▶ 수업 들어가기</button>` : ''}
          <div class="lsn-actions">
            ${isTeacher ? `
              <button class="btn-mini lsn-edit">편집</button>
              <button class="btn-mini lsn-copy">복사</button>
              <button class="btn-mini lsn-refl">성찰일지</button>
              <button class="btn-mini lsn-del text-red-500">삭제</button>
            ` : `<button class="lsn-join lsn-open">${live ? '🔴 참여하기' : '▶ 참여하기'}</button>`}
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
    function insertBeforeReflection(np) {
      const ri = pages.findIndex((p) => p.type === 'reflection');
      pages.splice(ri < 0 ? pages.length : ri, 0, np);
    }
    function addPage(type) {
      if (type === 'note') { addNoteFlow(); return; }
      const np = { id: genId(), type, title: PAGE_TYPES[type].label };
      insertBeforeReflection(np);
      editPage(pages.indexOf(np));
    }
    // 수업노트 추가: 빈 페이지 또는 PDF 불러오기
    function addNoteFlow() {
      const box = openModal(`
        <h3 class="text-lg font-bold text-slate-800 mb-1">수업노트 추가</h3>
        <p class="text-sm text-slate-500 mb-4">빈 필기 페이지를 만들거나, PDF를 불러와 슬라이드로 추가합니다 (최대 30장).</p>
        <div class="flex gap-2">
          <button id="nf-blank" class="btn-ghost flex-1">📝 빈 필기 페이지</button>
          <label class="btn-primary flex-1 text-center cursor-pointer">📄 PDF 불러오기
            <input id="nf-pdf" type="file" accept="application/pdf" class="hidden"></label>
        </div>
        <p id="nf-msg" class="text-sm text-slate-500 mt-3 min-h-[1.25rem]"></p>
        <div class="flex justify-end mt-1"><button class="btn-ghost modal-close">취소</button></div>
      `);
      box.querySelector('.modal-close').addEventListener('click', paint);
      box.querySelector('#nf-blank').addEventListener('click', () => {
        const np = { id: genId(), type: 'note', title: '수업노트', strokes: [] };
        insertBeforeReflection(np);
        openNoteEditor(pages.indexOf(np));
      });
      box.querySelector('#nf-pdf').addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const msg = box.querySelector('#nf-msg'); msg.textContent = 'PDF 불러오는 중…';
        try {
          const { pdfId, numPages, over } = await importPdf(file);
          for (let i = 1; i <= numPages; i++)
            insertBeforeReflection({ id: genId(), type: 'note', title: `수업노트 ${i}`, pdfId, pdfPage: i, strokes: [] });
          toast(`${numPages}개 페이지를 추가했습니다.${over ? ' (30장 초과분 제외)' : ''}`);
          paint();
        } catch (ex) { msg.textContent = '실패: ' + ex.message; }
      });
    }
    // 수업노트 편집 캔버스
    function openNoteEditor(idx) {
      const p = pages[idx];
      const box = openModal(`
        <div class="flex items-center justify-between mb-2 gap-2">
          <input id="nte-title" class="form-input" style="max-width:280px" value="${esc(p.title || '수업노트')}">
          <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>
        <div class="note-toolbar">${noteToolbarHtml()}</div>
        <div id="nte-stage"></div>
        <div class="flex gap-2 justify-end mt-3">
          <button class="btn-ghost nte-cancel">취소</button>
          <button id="nte-save" class="btn-primary">확인</button>
        </div>
      `);
      box.classList.add('modal-wide');
      const nc = mountNoteCanvas(box.querySelector('#nte-stage'), {
        bg: p.pdfId ? { pdfId: p.pdfId, pdfPage: p.pdfPage } : null,
        baseStrokes: p.strokes || [], editable: true
      });
      nc.setEditable(true);
      bindNoteToolbar(box, nc);
      const back = () => { nc.destroy(); paint(); };
      box.querySelector('.modal-close').addEventListener('click', back);
      box.querySelector('.nte-cancel').addEventListener('click', back);
      box.querySelector('#nte-save').addEventListener('click', () => {
        p.title = box.querySelector('#nte-title').value.trim() || '수업노트';
        p.strokes = nc.getStrokes();
        nc.destroy(); paint();
        toast('적용되었습니다. 하단 "저장"을 눌러 수업에 반영하세요.');
      });
    }
    // 개념 설명 편집 (3질문 템플릿 + 참고 PDF + AI 초안)
    async function openConceptEditor(idx) {
      const p = pages[idx];
      ensureConceptQuestions(p);
      let apiKey = '';
      try { apiKey = await Auth.getApiKey(); } catch (e) {}
      function paintC() {
        const box = openModal(`
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-lg font-bold text-slate-800">💡 개념 설명 편집</h3>
            <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
          </div>
          <form id="cc-form" class="space-y-3" autocomplete="off">
            <div><label class="form-label">페이지 제목</label><input id="cc-title" class="form-input" value="${esc(p.title || '개념 설명')}"></div>
            <div><label class="form-label">개념 설명</label><textarea id="cc-body" class="form-input" rows="5" placeholder="핵심 개념을 설명하세요">${esc(p.body || '')}</textarea></div>
            <div class="cc-toolrow">
              <label class="btn-ghost btn-mini cursor-pointer">📎 참고 PDF ${p.pdfId ? '(첨부됨)' : '첨부'}<input id="cc-pdf" type="file" accept="application/pdf" class="hidden"></label>
              ${p.pdfId ? `<button type="button" id="cc-pdf-del" class="btn-mini text-red-500">PDF 제거</button>` : ''}
              ${apiKey ? `<button type="button" id="cc-ai" class="btn-mini cc-ai-btn">✨ AI 초안 생성</button>` : `<span class="text-xs text-slate-400">AI 초안: 설정에서 키 등록 시 사용 가능</span>`}
            </div>
            <div class="cc-edit-qs">
              <p class="text-xs text-slate-500">개념기반 3단계 질문 (학생이 작성) — 예시가 채워져 있으니 수정하세요</p>
              ${p.questions.map((q, i) => `
                <div>
                  <label class="form-label">${QKINDS[q.kind] || '질문'} <span class="text-slate-400 font-normal">${esc(CONCEPT_Q[i].hint)}</span></label>
                  <textarea class="form-input cc-q-input" data-i="${i}" rows="2">${esc(q.q || '')}</textarea>
                </div>`).join('')}
            </div>
            <p id="cc-msg" class="text-sm min-h-[1.1rem]"></p>
            <div class="flex gap-2 justify-end">
              <button type="button" class="btn-ghost cc-cancel">취소</button>
              <button type="submit" class="btn-primary">적용</button>
            </div>
          </form>
        `);
        box.classList.add('modal-wide');
        const back = () => paint();
        box.querySelector('.modal-close').addEventListener('click', back);
        box.querySelector('.cc-cancel').addEventListener('click', back);
        // 본문/질문 편집 내용 임시 보존(다시 그릴 때)
        const sync = () => {
          p.title = box.querySelector('#cc-title').value;
          p.body = box.querySelector('#cc-body').value;
          box.querySelectorAll('.cc-q-input').forEach((t) => { p.questions[+t.dataset.i].q = t.value; });
        };
        box.querySelector('#cc-pdf').addEventListener('change', async (e) => {
          const f = e.target.files[0]; if (!f) return;
          const msg = box.querySelector('#cc-msg'); msg.textContent = 'PDF 첨부 중…';
          sync();
          try { const r = await importPdf(f); p.pdfId = r.pdfId; toast('참고 PDF가 첨부되었습니다.'); paintC(); }
          catch (ex) { msg.textContent = '실패: ' + ex.message; }
        });
        const del = box.querySelector('#cc-pdf-del');
        if (del) del.addEventListener('click', () => { sync(); p.pdfId = null; paintC(); });
        const ai = box.querySelector('#cc-ai');
        if (ai) ai.addEventListener('click', async () => {
          sync();
          const msg = box.querySelector('#cc-msg');
          msg.className = 'text-sm text-violet-600 min-h-[1.1rem]'; msg.textContent = 'AI가 초안을 작성 중…';
          ai.disabled = true;
          try {
            const out = await aiGenerateConcept(p.title, p.pdfId);
            if (out.body != null) p.body = out.body;
            if (Array.isArray(out.questions)) {
              p.questions = QORDER.map((k, i) => {
                const found = out.questions.find((x) => x && x.kind === k) || out.questions[i] || {};
                return { kind: k, q: found.q || p.questions[i].q };
              });
            }
            toast('AI 초안을 채웠습니다. 검토 후 적용하세요.'); paintC();
          } catch (ex) { msg.className = 'text-sm text-red-500 min-h-[1.1rem]'; msg.textContent = ex.message; ai.disabled = false; }
        });
        box.querySelector('#cc-form').addEventListener('submit', (e) => {
          e.preventDefault();
          sync();
          p.title = (p.title || '').trim() || '개념 설명';
          p.questions.forEach((q) => { q.q = (q.q || '').trim(); });
          paint();
          toast('적용되었습니다. 하단 "저장"을 눌러 반영하세요.');
        });
      }
      paintC();
    }
    function movePage(idx, dir) {
      const j = idx + dir;
      if (j < 0 || j >= pages.length) return;
      if (pages[idx].type === 'reflection' || pages[j].type === 'reflection') return; // 고정
      [pages[idx], pages[j]] = [pages[j], pages[idx]];
      paint();
    }
    function pageFields(p) {
      if (p.type === 'note')
        return `<div><label class="form-label">내용</label><textarea id="pg-body" class="form-input" rows="6" placeholder="학습 내용을 입력하세요">${esc(p.body || '')}</textarea></div>`;
      if (p.type === 'youtube')
        return `<div><label class="form-label">유튜브 링크 또는 영상 ID</label><input id="pg-url" class="form-input" value="${esc(p.url || '')}" placeholder="https://youtu.be/..."></div>
                <div id="pg-preview" class="pg-preview"></div>`;
      if (p.type === 'embed')
        return `<div><label class="form-label">웹 주소(URL)</label><input id="pg-url" class="form-input" value="${esc(p.url || '')}" placeholder="https://..."></div>
                <p class="text-xs text-slate-400 mt-1">사이트가 임베드를 막으면 '새 창에서 열기'로 표시됩니다.</p>
                <div id="pg-preview" class="pg-preview"></div>`;
      if (p.type === 'assessment')
        return `<div><label class="form-label">평가 안내</label><textarea id="pg-body" class="form-input" rows="3" placeholder="평가 안내 (자동채점 평가 기능은 STEP 08에서 제공)">${esc(p.body || '')}</textarea></div>`;
      return '';
    }
    // 편집기 미리보기 (유튜브/임베드)
    function previewHtml(type, url) {
      url = String(url || '').trim();
      if (!url) return '<p class="text-xs text-slate-400">미리볼 주소를 입력하면 여기에 표시됩니다.</p>';
      if (type === 'youtube') {
        const id = youtubeId(url);
        return id
          ? `<div class="slide-media"><iframe src="https://www.youtube.com/embed/${id}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
          : '<p class="text-xs text-red-500">유효한 유튜브 링크가 아닙니다.</p>';
      }
      return `<div class="slide-media"><iframe src="${esc(url)}" referrerpolicy="no-referrer"></iframe></div>
              <div class="slide-fallback"><a href="${esc(url)}" target="_blank" rel="noopener" class="btn-ghost btn-mini">↗ 새 창에서 열기</a></div>`;
    }
    function editPage(idx) {
      const p = pages[idx];
      if (p.type === 'note') { openNoteEditor(idx); return; }
      if (p.type === 'concept') { openConceptEditor(idx); return; }
      if (p.type === 'assessment') { if (window.Assess) Assess.openEditor(p, () => paint()); else toast('평가 모듈을 불러오지 못했습니다.'); return; }
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
      const urlEl = box.querySelector('#pg-url');
      const prevEl = box.querySelector('#pg-preview');
      if (urlEl && prevEl) {
        const upd = () => { prevEl.innerHTML = previewHtml(p.type, urlEl.value); };
        urlEl.addEventListener('input', upd); upd();
      }
      box.querySelector('#pg-form').addEventListener('submit', (e) => {
        e.preventDefault();
        p.title = box.querySelector('#pg-title').value.trim() || PAGE_TYPES[p.type].label;
        const bodyEl = box.querySelector('#pg-body'); if (bodyEl) p.body = bodyEl.value;
        const u = box.querySelector('#pg-url'); if (u) p.url = u.value.trim();
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
    await DB.remove(`noteAnnotations/${lesson.id}`);
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

  // 뷰어는 학습실 본문(#lesson-body) 안에 임베드 (1:9 레이아웃 유지)
  function lessonBody() { return rootEl ? rootEl.querySelector('#lesson-body') : null; }

  function closeViewer(returnToList) {
    if (viewer) {
      if (viewer.syncing) { DB.write(`lessons/${viewer.lesson.id}/live`, { active: false, page: viewer.idx, startedAt: viewer.startedAt || Date.now() }); }
      if (viewer.liveUnsub) { try { viewer.liveUnsub(); } catch (e) {} }
      if (viewer.visHandler) { document.removeEventListener('visibilitychange', viewer.visHandler); }
      if (viewer.noteCanvas) { try { viewer.noteCanvas.destroy(); } catch (e) {} }
      viewer = null;
    }
    if (returnToList) { const b = lessonBody(); if (b) renderClass(b); }
  }

  function openViewer(lesson) {
    if (!lesson) return;
    closeViewer();
    const host = lessonBody(); if (!host) return;
    const isTeacher = user.role === 'teacher';
    viewer = { lesson, idx: 0, syncing: false, hidden: false, lastLive: null, liveUnsub: null, visHandler: null, startedAt: 0, noteCanvas: null };

    host.innerHTML = `
      <div class="viewer-panel">
        <header class="viewer-head">
          <button class="viewer-close btn-mini" title="목록으로">← 목록</button>
          <span class="viewer-title">${esc(lesson.title)}</span>
          <button id="vw-pen" class="vw-pen hidden">✍️ 필기</button>
          <span class="viewer-ind" id="vw-ind"></span>
          <span class="viewer-tools">
            ${isTeacher ? `<button id="vw-teach" class="vw-teach">▶ 수업하기</button>` : ''}
            <button id="vw-pdf" class="btn-mini" title="수업 자료를 PDF로 저장">📄 PDF로 저장</button>
          </span>
        </header>
        <div id="vw-follow" class="viewer-follow hidden"></div>
        <div class="viewer-stage" id="vw-stage"></div>
        <footer class="viewer-nav">
          <button id="vw-prev" class="btn-ghost">← 이전</button>
          <button id="vw-next" class="btn-primary">다음 →</button>
        </footer>
        <div id="vw-leave" class="viewer-leave hidden">
          <div class="viewer-leave-box">
            <div class="text-4xl mb-2">👀</div>
            <p class="font-bold text-slate-800 mb-1">수업 화면을 벗어났어요</p>
            <p class="text-sm text-slate-500 mb-4">수업에 다시 집중해 주세요.</p>
            <button id="vw-leave-ok" class="btn-primary">수업으로 돌아가기</button>
          </div>
        </div>
      </div>`;
    const q = (s) => host.querySelector(s);
    q('.viewer-close').addEventListener('click', () => closeViewer(true));
    q('#vw-prev').addEventListener('click', () => gotoPage(viewer.idx - 1, true));
    // #vw-next 동작은 paintPage에서 페이지 위치에 따라 설정(마지막=수업 종료)
    const leaveOk = q('#vw-leave-ok');
    if (leaveOk) leaveOk.addEventListener('click', () => q('#vw-leave').classList.add('hidden'));
    q('#vw-pdf').addEventListener('click', () => exportNotesPdf(viewer.lesson));

    if (isTeacher) {
      const tb = q('#vw-teach');
      const setTeach = (on) => {
        viewer.syncing = on;
        tb.textContent = on ? '⏹ 수업 종료' : '▶ 수업하기';
        tb.classList.toggle('on', on);
        viewer.startedAt = viewer.startedAt || Date.now();
        DB.write(`lessons/${viewer.lesson.id}/live`, { active: on, page: viewer.idx, startedAt: viewer.startedAt });
        toast(on ? '수업을 시작했습니다 — 학생 화면이 선생님을 따라옵니다.' : '수업을 종료했습니다 — 학생이 자유롭게 이동합니다.');
      };
      tb.addEventListener('click', () => setTeach(!viewer.syncing));
    } else {
      subscribeLive();
      attachVisibility();
    }
    paintPage();
  }

  function gotoPage(i, manual) {
    const v = viewer; if (!v) return;
    // 학생: 강제 동기화 중에는 이동 불가
    if (manual && user.role !== 'teacher' && v.lastLive && v.lastLive.active) return;
    const n = (v.lesson.pages || []).length;
    v.idx = Math.max(0, Math.min(i, n - 1));
    if (v.syncing) DB.write(`lessons/${v.lesson.id}/live`, { active: true, page: v.idx, startedAt: v.startedAt || Date.now() });
    paintPage();
  }

  function subscribeLive() {
    const v = viewer;
    v.liveUnsub = DB.subscribe(`lessons/${v.lesson.id}/live`, (live) => {
      if (!viewer) return;
      v.lastLive = live || null;
      refreshFollowBanner();
      if (live && live.active && typeof live.page === 'number') {
        v.idx = Math.max(0, Math.min(live.page, (v.lesson.pages || []).length - 1));
      }
      paintPage();
    });
  }
  function refreshFollowBanner() {
    const host = lessonBody(); if (!host) return;
    const banner = host.querySelector('#vw-follow'); if (!banner) return;
    const live = viewer && viewer.lastLive;
    if (user.role === 'teacher' || !live || !live.active) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    banner.innerHTML = '🔴 선생님 화면을 따라가는 중입니다 (수업 중에는 자유 이동이 잠깁니다)';
  }
  function attachVisibility() {
    const v = viewer;
    v.visHandler = () => {
      if (document.hidden) v.hidden = true;
      else if (v.hidden) { v.hidden = false; const el = lessonBody() && lessonBody().querySelector('#vw-leave'); if (el) el.classList.remove('hidden'); }
    };
    document.addEventListener('visibilitychange', v.visHandler);
  }

  async function paintPage() {
    const v = viewer; if (!v) return;
    const root = lessonBody(); if (!root) return;
    const stage = root.querySelector('#vw-stage'); if (!stage) return;
    if (v.noteCanvas) { try { v.noteCanvas.destroy(); } catch (e) {} v.noteCanvas = null; }
    const pages = v.lesson.pages || [];
    v.idx = Math.max(0, Math.min(v.idx, pages.length - 1));
    const p = pages[v.idx] || {};
    root.querySelector('#vw-ind').textContent = `${v.idx + 1} / ${pages.length}`;
    const forced = user.role !== 'teacher' && v.lastLive && v.lastLive.active;
    const prev = root.querySelector('#vw-prev'), next = root.querySelector('#vw-next');
    prev.disabled = forced || v.idx === 0;
    // 마지막 페이지: '수업 종료'(교사·학생 공통) → 목록으로. 그 외: '다음'
    if (v.idx === pages.length - 1) {
      next.textContent = '■ 수업 종료';
      next.classList.add('vw-end'); next.disabled = false;
      next.onclick = () => closeViewer(true);
    } else {
      next.textContent = '다음 →';
      next.classList.remove('vw-end'); next.disabled = forced;
      next.onclick = () => gotoPage(v.idx + 1, true);
    }
    const penBtn = root.querySelector('#vw-pen'); if (penBtn) { penBtn.classList.add('hidden'); penBtn.onclick = null; }
    stage.innerHTML = await pageHtml(p, v);
    if (p.type === 'note') await mountViewerNote(stage.querySelector('#note-host'), p, v);
    if (p.type === 'concept') await mountViewerConcept(stage.querySelector('#concept-host'), p, v);
    if (p.type === 'assessment' && window.Assess) await Assess.mountViewer(stage.querySelector('#assess-host'), p, { lesson: v.lesson, user });
    if (p.type === 'reflection' && user.role !== 'teacher') bindReflection(stage, v);
    const rv = stage.querySelector('#vw-refl-view'); if (rv) rv.addEventListener('click', () => openReflections(v.lesson));
  }

  // 뷰어 수업노트: 배경+교사필기(읽기전용) + 더블클릭 펜모드(개인필기)
  async function mountViewerNote(host, page, v) {
    if (!host) return;
    const my = await DB.read(`noteAnnotations/${v.lesson.id}/${page.id}/${user.uid}`);
    host.innerHTML = `
      <div class="note-toolbar hidden" id="nt-bar">${noteToolbarHtml()}</div>
      <div id="nt-stage"></div>
      <div class="note-penrow"><span class="note-hint">상단 ‘✍️ 필기’ 또는 더블클릭으로 켜요 · 내 화면에만 저장됩니다</span></div>`;
    const nc = mountNoteCanvas(host.querySelector('#nt-stage'), {
      bg: page.pdfId ? { pdfId: page.pdfId, pdfPage: page.pdfPage } : null,
      staticStrokes: page.strokes || [],
      baseStrokes: (my && my.strokes) || [],
      editable: false,
      onChange: (strokes) => saveAnnotation(v.lesson.id, page.id, strokes)
    });
    v.noteCanvas = nc;
    bindNoteToolbar(host, nc);
    let pen = false;
    const setPen = (on) => {
      pen = on;
      nc.setEditable(on);
      host.querySelector('#nt-bar').classList.toggle('hidden', !on);
      if (penBtn) { penBtn.classList.toggle('on', on); penBtn.textContent = on ? '✅ 필기 종료' : '✍️ 필기'; }
    };
    // 수업명 옆(헤더)의 필기 버튼을 활성화·연결
    const penBtn = (lessonBody() || document).querySelector('#vw-pen');
    if (penBtn) { penBtn.classList.remove('hidden'); penBtn.textContent = '✍️ 필기'; penBtn.classList.remove('on'); penBtn.onclick = () => setPen(!pen); }
    host.querySelector('#nt-stage').addEventListener('dblclick', () => setPen(!pen));
  }

  async function pageHtml(p, v) {
    const title = esc(p.title || (PAGE_TYPES[p.type] ? PAGE_TYPES[p.type].label : ''));
    if (p.type === 'concept') {
      return `<div class="slide slide-text"><h2>${title}</h2><div id="concept-host"></div></div>`;
    }
    if (p.type === 'assessment') {
      return `<div class="slide"><h2>${title}</h2><div id="assess-host"></div></div>`;
    }
    if (p.type === 'note') {
      return `<div class="slide"><h2>${title}</h2><div id="note-host" class="note-host"></div></div>`;
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
        ? `<div class="slide-media embed">
             <div class="embed-fallback">
               <p>이 자료가 화면에 보이지 않으면<br>아래 버튼으로 새 창에서 열어 주세요.</p>
               <a href="${esc(url)}" target="_blank" rel="noopener" class="btn-primary embed-open">↗ 새 창에서 열기</a>
             </div>
             <iframe src="${esc(url)}" referrerpolicy="no-referrer"></iframe>
           </div>
           <div class="embed-actions"><a href="${esc(url)}" target="_blank" rel="noopener" class="btn-primary embed-open">↗ 새 창에서 열기</a></div>`
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
