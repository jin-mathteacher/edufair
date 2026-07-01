/* ============================================================
   assessment.js — 평가 (STEP 08)  · window.Assess
   ------------------------------------------------------------
   ▶ 교과수업의 'assessment' 페이지에서 사용 (lesson.js가 호출)
     - Assess.openEditor(page, onDone)     : 교사 문항 편집
     - Assess.mountViewer(host, page, ctx) : 학생 응시·자동채점 / 교사 미리보기+결과
     - Assess.openResults(lesson, page)    : 교사 결과·통계(실시간)
   ▶ 문항 유형: 객관식·다중선택·참/거짓·단답·수식(math.js)·그래프(canvas)
                ·순서(드래그)·서술형(AI 선택)·즉답통계(막대/워드클라우드)
   ▶ 자동채점 → 학생 competency(5대 핵심역량) 가중 반영 → 대시보드 레이더
   ※ 데이터: /assessmentResults/{lessonId}/{pageId}/{studentUid}
   ※ 블라인드 규칙: 학교/성명/지역명 코드 미포함.
============================================================ */

(function () {
  'use strict';

  /* ── 데이터 계층 (Firebase / localStorage) ── */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);
  const genId = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const lsRoot = () => JSON.parse(localStorage.getItem(LS_DATA) || '{}');
  const lsSave = (r) => localStorage.setItem(LS_DATA, JSON.stringify(r));
  const DB = {
    async read(path) {
      if (useFB()) { const s = await window.FB.db.ref(path).once('value'); return s.exists() ? s.val() : null; }
      return path.split('/').reduce((o, k) => (o == null ? null : o[k]), lsRoot()) ?? null;
    },
    async write(path, val) {
      if (useFB()) { await window.FB.db.ref(path).set(val); return; }
      const root = lsRoot(); const ks = path.split('/'); let o = root;
      for (let i = 0; i < ks.length - 1; i++) { o[ks[i]] = o[ks[i]] || {}; o = o[ks[i]]; }
      o[ks[ks.length - 1]] = val; lsSave(root);
    },
    subscribe(path, cb) {
      if (!useFB()) return null;
      const ref = window.FB.db.ref(path);
      const h = ref.on('value', (s) => cb(s.val() || {}));
      return () => ref.off('value', h);
    }
  };

  /* ── 상수·유틸 ── */
  const COMP = [
    { key: 'problem', label: '문제해결' }, { key: 'reason', label: '추론' },
    { key: 'comm', label: '의사소통' }, { key: 'connect', label: '연결' }, { key: 'info', label: '정보처리' }
  ];
  const COMP_LABEL = COMP.reduce((o, c) => ((o[c.key] = c.label), o), {});
  const QTYPES = {
    single: { label: '객관식', icon: '⬜' }, multi: { label: '다중선택', icon: '☑️' },
    tf: { label: '참/거짓', icon: '✔️' }, short: { label: '단답', icon: '✏️' },
    math: { label: '수식', icon: '🧮' }, graph: { label: '그래프', icon: '📈' },
    order: { label: '순서(드래그)', icon: '🔀' }, essay: { label: '서술형', icon: '📝' },
    poll: { label: '즉답통계', icon: '📊' }
  };
  const LEVELS = { easy: '하', mid: '중', hard: '상' };
  const GRADED = ['single', 'multi', 'tf', 'short', 'math', 'graph', 'order', 'essay'];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const normalize = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, '').toLowerCase();
  const cidLabel = (cid) => { cid = String(cid || ''); const g = cid.slice(0, cid.length - 2), c = cid.slice(-2); return g ? `${g}학년 ${parseInt(c, 10)}반` : ''; };
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const setEq = (a, b) => { a = (a || []).slice().sort(); b = (b || []).slice().sort(); return a.length === b.length && a.every((v, i) => v === b[i]); };
  const arrEq = (a, b) => (a || []).length === (b || []).length && (a || []).every((v, i) => normalize(v) === normalize(b[i]));

  // 수식 동치 판정 (math.js)
  function mathEqual(stuStr, ansStr, varsStr, tol) {
    tol = tol || 1e-6;
    if (!window.math) return normalize(stuStr) === normalize(ansStr);
    let scopes = [];
    if (varsStr && String(varsStr).trim()) {
      const sc = {};
      String(varsStr).split(',').forEach((p) => { const [k, val] = p.split('='); if (k && val != null) sc[k.trim()] = Number(val); });
      scopes = [sc];
    } else { scopes = [{ x: 2, y: 3 }, { x: -1, y: 0.5 }, { x: 3.3, y: -2 }]; }
    try {
      for (const sc of scopes) {
        const va = window.math.evaluate(String(stuStr), sc);
        const vb = window.math.evaluate(String(ansStr), sc);
        const na = Number(va), nb = Number(vb);
        if (isFinite(na) && isFinite(nb)) { if (Math.abs(na - nb) > tol + 1e-9) return false; }
        else if (String(va) !== String(vb)) return false;
      }
      return true;
    } catch (e) { return normalize(stuStr) === normalize(ansStr); }
  }

  // 함수 그래프 렌더 (canvas)
  function plotFx(canvas, fx, xmin, xmax) {
    const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    xmin = Number(xmin); xmax = Number(xmax); if (!(xmax > xmin)) { xmin = -5; xmax = 5; }
    const N = 240, xs = [], ys = []; let compiled = null;
    try { compiled = window.math ? window.math.compile(fx) : null; } catch (e) { compiled = null; }
    for (let i = 0; i <= N; i++) {
      const x = xmin + (xmax - xmin) * i / N; let y;
      try { y = compiled ? compiled.evaluate({ x }) : NaN; } catch (e) { y = NaN; }
      xs.push(x); ys.push(Number(y));
    }
    const fin = ys.filter((v) => isFinite(v));
    let ymin = fin.length ? Math.min(...fin) : -5, ymax = fin.length ? Math.max(...fin) : 5;
    if (!isFinite(ymin) || !isFinite(ymax) || ymin === ymax) { ymin = -5; ymax = 5; }
    const pad = (ymax - ymin) * 0.1 || 1; ymin -= pad; ymax += pad;
    const X = (x) => (x - xmin) / (xmax - xmin) * w;
    const Y = (y) => h - (y - ymin) / (ymax - ymin) * h;
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    if (xmin < 0 && xmax > 0) { ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), h); ctx.stroke(); }
    if (ymin < 0 && ymax > 0) { ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke(); }
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.beginPath(); let started = false;
    for (let i = 0; i <= N; i++) {
      const y = ys[i]; if (!isFinite(y)) { started = false; continue; }
      const px = X(xs[i]), py = Y(y);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /* ── 모달·토스트 ── */
  function openModal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-overlay"><div class="modal-box">${html}</div></div>`;
    return root.querySelector('.modal-box');
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
  function toast(msg) {
    let el = document.getElementById('app-toast');
    if (!el) { el = document.createElement('div'); el.id = 'app-toast'; el.className = 'app-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show'); clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ── 문항 기본값 ── */
  function newQuestion(type) {
    const b = { id: genId(), type, comp: 'problem', level: 'mid', points: 1, prompt: '' };
    switch (type) {
      case 'single': return Object.assign(b, { choices: ['', '', '', '', ''], answer: 0 }); // 기본 5지선다
      case 'multi': return Object.assign(b, { choices: ['', '', '', ''], answers: [] });
      case 'tf': return Object.assign(b, { answer: true });
      case 'short': return Object.assign(b, { accept: [''] });
      case 'math': return Object.assign(b, { answer: '', vars: '', tol: 0.001 });
      case 'graph': return Object.assign(b, { fx: 'x^2', xmin: -5, xmax: 5, answer: '', vars: '', tol: 0.001 });
      case 'order': return Object.assign(b, { items: ['', '', ''] });
      case 'essay': return Object.assign(b, { keywords: [''], guide: '' });
      case 'poll': return Object.assign(b, { points: 0, mode: 'choice', display: 'bar', choices: ['', ''] });
      default: return b;
    }
  }

  /* ============================================================
     교사 편집기
  ============================================================ */
  function openEditor(page, onDone, opts) {
    opts = opts || {};
    const editTitle = opts.title || '✅ 평가 편집';
    const saveLabel = opts.saveLabel || '저장';
    const addTypes = opts.types || Object.keys(QTYPES);
    page.questions = Array.isArray(page.questions) ? page.questions : [];
    const qs = page.questions;
    let editorKey = '';

    // PDF → 문항 자동 생성
    async function importFromPdf(file, box) {
      const msg = box.querySelector('#as-pdf-msg');
      page.title = box.querySelector('#as-ptitle').value;
      msg.className = 'text-xs text-violet-600 min-h-[1rem] mt-1';
      msg.textContent = 'AI가 PDF를 분석해 문항·그림을 만드는 중… (최대 1분)';
      try {
        const arr = await aiGenerateQuestionsFromFile(file, editorKey);
        if (!arr.length) { msg.className = 'text-xs text-red-500 mt-1'; msg.textContent = '인식된 문항이 없습니다. PDF를 확인하세요.'; return; }
        arr.forEach((q) => qs.push(q));
        toast(`${arr.length}개 문항을 생성했습니다. 검토 후 저장하세요.`);
        paintE();
      } catch (ex) { msg.className = 'text-xs text-red-500 mt-1'; msg.textContent = '실패: ' + ex.message; }
    }

    function paintE() {
      const box = openModal(`
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-bold text-slate-800">${esc(editTitle)}</h3>
          <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>
        <input id="as-ptitle" class="form-input mb-3" value="${esc(page.title || '평가')}" placeholder="평가 제목">
        <div class="as-qlist">
          ${qs.length ? qs.map((q, i) => `
            <div class="as-qrow" data-i="${i}">
              <span class="as-qrow-icon">${(QTYPES[q.type] || {}).icon || '❓'}</span>
              <span class="as-qrow-main">
                <b>${i + 1}.</b> ${q.image ? '🖼 ' : ''}${esc(q.prompt || '(발문 없음)')}
                <span class="as-qtag">${(QTYPES[q.type] || {}).label || q.type}</span>
                <span class="as-qtag comp">${COMP_LABEL[q.comp] || ''}</span>
                <span class="as-qtag">${LEVELS[q.level] || ''} · ${q.points}점</span>
              </span>
              <span class="as-qrow-act">
                <button class="btn-mini as-up">▲</button><button class="btn-mini as-down">▼</button>
                <button class="btn-mini as-edit">편집</button><button class="btn-mini as-del text-red-500">삭제</button>
              </span>
            </div>`).join('') : `<p class="mat-empty">문항을 추가하세요.</p>`}
        </div>
        <div class="as-addbar">
          <span class="text-xs text-slate-500 mr-1">＋ 문항:</span>
          ${addTypes.map((t) => `<button class="btn-mini as-add" data-type="${t}">${QTYPES[t].icon} ${QTYPES[t].label}</button>`).join('')}
          ${editorKey ? `<label class="btn-mini as-pdf-btn cursor-pointer">📄 PDF→문항 생성<input id="as-pdf" type="file" accept="application/pdf" class="hidden"></label>` : `<span class="text-xs text-slate-400">PDF 자동생성: 설정에서 AI 키 등록 시</span>`}
        </div>
        <p id="as-pdf-msg" class="text-xs min-h-[1rem] mt-1"></p>
        <div class="flex gap-2 justify-end mt-4">
          <button class="btn-ghost modal-close">닫기</button>
          <button id="as-save" class="btn-primary">${esc(saveLabel)}</button>
        </div>
      `);
      box.querySelectorAll('.modal-close').forEach((b) => b.addEventListener('click', closeModal));
      box.querySelectorAll('.as-add').forEach((b) =>
        b.addEventListener('click', () => { page.title = box.querySelector('#as-ptitle').value; const q = newQuestion(b.dataset.type); qs.push(q); editQuestion(qs.length - 1); }));
      box.querySelectorAll('.as-qrow').forEach((row) => {
        const i = +row.dataset.i;
        row.querySelector('.as-up').addEventListener('click', () => { if (i > 0) { [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; paintE(); } });
        row.querySelector('.as-down').addEventListener('click', () => { if (i < qs.length - 1) { [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]; paintE(); } });
        row.querySelector('.as-edit').addEventListener('click', () => { page.title = box.querySelector('#as-ptitle').value; editQuestion(i); });
        row.querySelector('.as-del').addEventListener('click', () => { if (confirm('이 문항을 삭제할까요?')) { qs.splice(i, 1); paintE(); } });
      });
      const pdfIn = box.querySelector('#as-pdf');
      if (pdfIn) pdfIn.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFromPdf(f, box); });
      box.querySelector('#as-save').addEventListener('click', () => {
        page.title = box.querySelector('#as-ptitle').value.trim() || '평가';
        // 외부 모듈(배움 대전 등)에서 저장 전 유효성 검사 가능 — 문자열 반환 시 중단
        if (typeof opts.onSaveValidate === 'function') {
          const err = opts.onSaveValidate(page);
          if (err) { toast(err); return; }
        }
        closeModal();
        if (opts.saveToast !== '') toast(opts.saveToast || '평가가 적용되었습니다. 하단 "저장"으로 수업에 반영하세요.');
        if (typeof onDone === 'function') onDone();
      });
    }

    function fieldsFor(q) {
      const choiceList = (arr, name) => `
        <div class="as-choices">${arr.map((c, i) => `
          <div class="as-choice-edit">
            <input type="${name === 'single' ? 'radio' : 'checkbox'}" name="as-ans" data-i="${i}" ${name === 'single' ? (q.answer === i ? 'checked' : '') : ((q.answers || []).includes(i) ? 'checked' : '')}>
            <input class="form-input as-choice-txt" data-i="${i}" value="${esc(c)}" placeholder="보기 ${i + 1}">
            <button type="button" class="btn-mini as-choice-del" data-i="${i}">✕</button>
          </div>`).join('')}</div>
        <button type="button" class="btn-mini as-choice-add">＋ 보기 추가</button>
        <p class="text-xs text-slate-400 mt-1">${name === 'single' ? '정답 보기 1개를 선택하세요.' : '정답 보기를 모두 선택하세요.'}</p>`;
      switch (q.type) {
        case 'single': return choiceList(q.choices, 'single');
        case 'multi': return choiceList(q.choices, 'multi');
        case 'poll': return `
          <div class="grid grid-cols-2 gap-2 mb-2">
            <label class="form-label">응답 방식
              <select id="q-mode" class="form-input"><option value="choice" ${q.mode === 'choice' ? 'selected' : ''}>보기 선택</option><option value="free" ${q.mode === 'free' ? 'selected' : ''}>자유 입력</option></select></label>
            <label class="form-label">집계 표시
              <select id="q-display" class="form-input"><option value="bar" ${q.display === 'bar' ? 'selected' : ''}>막대그래프</option><option value="wordcloud" ${q.display === 'wordcloud' ? 'selected' : ''}>워드클라우드</option></select></label>
          </div>
          <div id="q-poll-choices" class="${q.mode === 'free' ? 'hidden' : ''}">${choiceList(q.choices, 'poll')}</div>`;
        case 'tf': return `
          <div class="ev-type-row">
            <label class="ev-radio"><input type="radio" name="q-tf" value="true" ${q.answer ? 'checked' : ''}> 참 (O)</label>
            <label class="ev-radio"><input type="radio" name="q-tf" value="false" ${!q.answer ? 'checked' : ''}> 거짓 (X)</label>
          </div>`;
        case 'short': return `<label class="form-label">정답(여러 개면 쉼표로 구분)</label>
          <input id="q-accept" class="form-input" value="${esc((q.accept || []).join(', '))}" placeholder="예: 3, 三, three">`;
        case 'math': return `
          <label class="form-label">정답 수식</label><input id="q-answer" class="form-input" value="${esc(q.answer)}" placeholder="예: 2*x+1">
          <div class="grid grid-cols-2 gap-2 mt-2">
            <label class="form-label">변수값(선택)<input id="q-vars" class="form-input" value="${esc(q.vars)}" placeholder="예: x=3"></label>
            <label class="form-label">허용오차<input id="q-tol" class="form-input" value="${esc(q.tol)}" inputmode="decimal"></label>
          </div>
          <p class="text-xs text-slate-400 mt-1">변수값을 비우면 여러 값으로 동치(예: 2x+1 = 1+2x)를 검사합니다.</p>`;
        case 'graph': return `
          <label class="form-label">표시할 함수 f(x)</label><input id="q-fx" class="form-input" value="${esc(q.fx)}" placeholder="예: x^2-2">
          <div class="grid grid-cols-2 gap-2 mt-2">
            <label class="form-label">x 최소<input id="q-xmin" class="form-input" value="${esc(q.xmin)}" inputmode="decimal"></label>
            <label class="form-label">x 최대<input id="q-xmax" class="form-input" value="${esc(q.xmax)}" inputmode="decimal"></label>
          </div>
          <label class="form-label mt-2">정답(숫자/수식)</label><input id="q-answer" class="form-input" value="${esc(q.answer)}" placeholder="예: 0">
          <label class="form-label mt-1">변수값(선택)<input id="q-vars" class="form-input" value="${esc(q.vars)}" placeholder="예: x=2"></label>
          <div id="q-graph-prev" class="as-graph-prev"></div>`;
        case 'order': return `<label class="form-label">올바른 순서대로 입력(위 → 아래)</label>
          <div class="as-choices">${(q.items || []).map((it, i) => `
            <div class="as-choice-edit"><span class="as-ord-n">${i + 1}</span>
              <input class="form-input as-item-txt" data-i="${i}" value="${esc(it)}" placeholder="${i + 1}번 항목">
              <button type="button" class="btn-mini as-item-del" data-i="${i}">✕</button></div>`).join('')}</div>
          <button type="button" class="btn-mini as-item-add">＋ 항목 추가</button>`;
        case 'essay': return `<label class="form-label">핵심 키워드(쉼표, AI 채점 참고)</label>
          <input id="q-keywords" class="form-input" value="${esc((q.keywords || []).join(', '))}" placeholder="예: 함수, 정의역, 대응">
          <label class="form-label mt-2">채점 안내(선택)</label><textarea id="q-guide" class="form-input" rows="2" placeholder="무엇을 평가하는지">${esc(q.guide || '')}</textarea>
          <p class="text-xs text-slate-400 mt-1">교사 AI 키가 있으면 0~100점 자동 채점·피드백, 없으면 ‘교사 확인’으로 표시됩니다.</p>`;
        default: return '';
      }
    }

    function editQuestion(idx) {
      const q = qs[idx];
      const box = openModal(`
        <h3 class="text-lg font-bold text-slate-800 mb-3">${(QTYPES[q.type] || {}).icon} ${(QTYPES[q.type] || {}).label} 문항</h3>
        <form id="q-form" class="space-y-3" autocomplete="off">
          <div><label class="form-label">문항 유형 <span class="text-slate-400 font-normal">(바꾸면 정답 등 유형별 설정은 초기화됩니다)</span></label>
            <select id="q-type" class="form-input">${addTypes.map((t) => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${QTYPES[t].icon} ${QTYPES[t].label}</option>`).join('')}</select></div>
          <div><label class="form-label">발문</label><textarea id="q-prompt" class="form-input" rows="2" placeholder="질문을 입력하세요">${esc(q.prompt)}</textarea></div>
          ${imageFieldHtml(q)}
          <div class="grid grid-cols-3 gap-2">
            <label class="form-label">핵심역량<select id="q-comp" class="form-input">${COMP.map((c) => `<option value="${c.key}" ${q.comp === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
            <label class="form-label">난이도<select id="q-level" class="form-input">${Object.keys(LEVELS).map((k) => `<option value="${k}" ${q.level === k ? 'selected' : ''}>${LEVELS[k]}</option>`).join('')}</select></label>
            <label class="form-label">배점<input id="q-points" class="form-input" value="${esc(q.points)}" inputmode="numeric"></label>
          </div>
          <div id="q-fields">${fieldsFor(q)}</div>
          <div class="flex gap-2 justify-end">
            <button type="button" class="btn-ghost q-cancel">취소</button>
            <button type="submit" class="btn-primary">적용</button>
          </div>
        </form>
      `);
      box.classList.add('modal-wide');
      box.querySelector('.q-cancel').addEventListener('click', paintE);
      // 유형 변경 — 공통 필드(발문·이미지·역량·난이도·배점)는 유지, 유형별 필드는 새로 초기화
      box.querySelector('#q-type').addEventListener('change', (e) => {
        const newType = e.target.value;
        if (newType === q.type) return;
        collectQuestion(box, q);
        const keep = { id: q.id, prompt: q.prompt, image: q.image || null, comp: q.comp, level: q.level, points: q.points };
        qs[idx] = Object.assign(newQuestion(newType), keep);
        editQuestion(idx);
      });
      bindFieldEvents(box, q, idx);
      bindImageField(box, q);
      box.querySelector('#q-form').addEventListener('submit', (e) => {
        e.preventDefault();
        collectQuestion(box, q);
        paintE();
      });
    }

    // 동적 보기/항목 추가·삭제, 그래프 미리보기
    function bindFieldEvents(box, q, idx) {
      const rebind = () => { editQuestion(idx); };
      const ca = box.querySelector('.as-choice-add');
      if (ca) ca.addEventListener('click', () => { collectQuestion(box, q); (q.choices = q.choices || []).push(''); rebind(); });
      box.querySelectorAll('.as-choice-del').forEach((b) => b.addEventListener('click', () => {
        collectQuestion(box, q); q.choices.splice(+b.dataset.i, 1);
        if (q.type === 'single' && q.answer >= q.choices.length) q.answer = 0; rebind();
      }));
      const ia = box.querySelector('.as-item-add');
      if (ia) ia.addEventListener('click', () => { collectQuestion(box, q); (q.items = q.items || []).push(''); rebind(); });
      box.querySelectorAll('.as-item-del').forEach((b) => b.addEventListener('click', () => { collectQuestion(box, q); q.items.splice(+b.dataset.i, 1); rebind(); }));
      const mode = box.querySelector('#q-mode');
      if (mode) mode.addEventListener('change', () => { collectQuestion(box, q); rebind(); });
      if (q.type === 'graph') {
        const prev = box.querySelector('#q-graph-prev');
        const draw = () => {
          if (!prev) return; prev.innerHTML = '<canvas width="360" height="220" class="as-graph-canvas"></canvas>';
          plotFx(prev.querySelector('canvas'), box.querySelector('#q-fx').value, box.querySelector('#q-xmin').value, box.querySelector('#q-xmax').value);
        };
        ['#q-fx', '#q-xmin', '#q-xmax'].forEach((s) => box.querySelector(s).addEventListener('input', draw));
        draw();
      }
    }

    // 폼 → 문항 객체
    function collectQuestion(box, q) {
      const v = (s) => { const el = box.querySelector(s); return el ? el.value : undefined; };
      q.prompt = (v('#q-prompt') || '').trim();
      q.comp = v('#q-comp') || q.comp; q.level = v('#q-level') || q.level;
      q.points = Math.max(0, parseInt(v('#q-points'), 10) || 0);
      if (q.type === 'single' || q.type === 'multi' || (q.type === 'poll')) {
        const txts = [...box.querySelectorAll('.as-choice-txt')];
        if (txts.length) q.choices = txts.sort((a, b) => +a.dataset.i - +b.dataset.i).map((t) => t.value);
        if (q.type === 'single') { const r = box.querySelector('input[name="as-ans"]:checked'); if (r) q.answer = +r.dataset.i; }
        if (q.type === 'multi') q.answers = [...box.querySelectorAll('input[name="as-ans"]:checked')].map((r) => +r.dataset.i);
      }
      if (q.type === 'poll') { q.mode = v('#q-mode') || 'choice'; q.display = v('#q-display') || 'bar'; }
      if (q.type === 'tf') { const r = box.querySelector('input[name="q-tf"]:checked'); if (r) q.answer = r.value === 'true'; }
      if (q.type === 'short') q.accept = (v('#q-accept') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (q.type === 'math' || q.type === 'graph') { q.answer = (v('#q-answer') || '').trim(); q.vars = (v('#q-vars') || '').trim(); }
      if (q.type === 'math') q.tol = parseFloat(v('#q-tol')) || 0.001;
      if (q.type === 'graph') { q.fx = (v('#q-fx') || 'x').trim(); q.xmin = parseFloat(v('#q-xmin')); q.xmax = parseFloat(v('#q-xmax')); if (!isFinite(q.xmin)) q.xmin = -5; if (!isFinite(q.xmax)) q.xmax = 5; }
      if (q.type === 'order') { const txts = [...box.querySelectorAll('.as-item-txt')]; if (txts.length) q.items = txts.sort((a, b) => +a.dataset.i - +b.dataset.i).map((t) => t.value); }
      if (q.type === 'essay') { q.keywords = (v('#q-keywords') || '').split(',').map((s) => s.trim()).filter(Boolean); q.guide = (v('#q-guide') || '').trim(); }
    }

    (async () => { try { editorKey = await Auth.getApiKey(); } catch (e) {} paintE(); })();
  }

  /* ============================================================
     학생 응시 / 교사 미리보기
  ============================================================ */
  async function mountViewer(host, page, ctx) {
    if (!host) return;
    const user = ctx.user, lesson = ctx.lesson;
    page.questions = Array.isArray(page.questions) ? page.questions : [];
    const isTeacher = user.role === 'teacher';

    // 한 문제 = 한 페이지 (학생·교사 공통) — 좌: 문제·그림·답 / 우: 필기 노트
    const total = page.questions.length;
    const orderState = {};
    const noteStores = {};   // 문항별 필기 노트(페이지 이동해도 유지)
    let curIdx = 0;
    let liveAnswers = {};

    const prev = isTeacher ? null : await DB.read(`assessmentResults/${lesson.id}/${page.id}/${user.uid}`);
    if (prev && prev.answers) liveAnswers = Object.assign({}, prev.answers);
    page.questions.forEach((q) => { if (q.type === 'order') orderState[q.id] = (prev && prev.answers && prev.answers[q.id]) ? prev.answers[q.id].slice() : shuffle(q.items || []); });

    if (!total) {
      host.innerHTML = `<p class="mat-empty">아직 문항이 없습니다.</p>${isTeacher ? '<div class="text-center mt-3"><button id="as-results" class="btn-primary">📊 결과 보기</button></div>' : ''}`;
      const rb = host.querySelector('#as-results'); if (rb) rb.addEventListener('click', () => openResults(lesson, page));
      return;
    }

    renderPage();

    function captureCurrent() {
      const left = host.querySelector('#as-qpage'); if (!left) return;
      const q = page.questions[curIdx];
      const a = collectAnswers(left, { questions: [q] }, orderState);
      Object.assign(liveAnswers, a);
      if (q.type === 'order' && a[q.id]) orderState[q.id] = a[q.id]; // 재배열 보존
    }

    function goTo(i) {
      if (!isTeacher) captureCurrent();
      curIdx = Math.max(0, Math.min(total - 1, i));
      renderPage();
    }

    function renderPage() {
      const q = page.questions[curIdx];
      const prevLike = { answers: liveAnswers };
      host.innerHTML = `
        <div class="as-pager">
          <div class="as-pager-head">
            <span class="as-pager-count">문제 ${curIdx + 1} / ${total}${isTeacher ? ' · 교사 미리보기(정답 표시)' : ''}</span>
            <div class="as-pager-dots">${page.questions.map((qq, i) => {
              const ans = liveAnswers[qq.id];
              const done = ans != null && ans !== '' && !(Array.isArray(ans) && !ans.length);
              return `<button class="as-dot ${i === curIdx ? 'on' : ''} ${(!isTeacher && done) ? 'done' : ''}" data-i="${i}" title="${i + 1}번"></button>`;
            }).join('')}</div>
            ${isTeacher ? '<button id="as-results" class="btn-mini">📊 결과 보기</button>' : ''}
          </div>
          <div class="as-solve">
            <div class="as-solve-left"><div class="as-form" id="as-qpage"></div></div>
            <div class="as-solve-right" id="as-note"></div>
          </div>
          <div class="as-pager-nav">
            <button id="as-prev" class="btn-ghost" ${curIdx === 0 ? 'disabled' : ''}>← 이전</button>
            <span class="as-pager-mid">${(!isTeacher && prev) ? `이전 응시 ${prev.score}점` : ''}</span>
            ${isTeacher
              ? `<button id="as-next" class="btn-primary" ${curIdx >= total - 1 ? 'disabled' : ''}>다음 →</button>`
              : (curIdx >= total - 1 ? '<button id="as-submit" class="btn-primary">제출하기</button>' : '<button id="as-next" class="btn-primary">다음 →</button>')}
          </div>
        </div>`;

      const left = host.querySelector('#as-qpage');
      if (isTeacher) left.innerHTML = teacherQuestionHtml(q, curIdx);
      else {
        left.innerHTML = questionInputHtml(q, curIdx, prevLike, orderState);
        if (q.type === 'order') bindOrder(left.querySelector(`.as-order[data-qid="${q.id}"]`));
      }
      const gcv = left.querySelector('canvas[data-fx]');
      if (gcv) plotFx(gcv, gcv.dataset.fx, gcv.dataset.xmin, gcv.dataset.xmax);

      noteStores[curIdx] = noteStores[curIdx] || { strokes: [] };
      mountNotePad(host.querySelector('#as-note'), { store: noteStores[curIdx] });

      const pb = host.querySelector('#as-prev'); if (pb) pb.addEventListener('click', () => { if (curIdx > 0) goTo(curIdx - 1); });
      const nb = host.querySelector('#as-next'); if (nb) nb.addEventListener('click', () => { if (curIdx < total - 1) goTo(curIdx + 1); });
      const sb = host.querySelector('#as-submit'); if (sb) sb.addEventListener('click', () => { captureCurrent(); doSubmit(); });
      host.querySelectorAll('.as-dot').forEach((d) => d.addEventListener('click', () => goTo(+d.dataset.i)));
      const rb = host.querySelector('#as-results'); if (rb) rb.addEventListener('click', () => openResults(lesson, page));
    }

    // 교사 미리보기용 문항 HTML (정답 표시, 입력 비활성)
    function teacherQuestionHtml(q, i) {
      const head = `<div class="as-q"><p class="as-q-prompt"><b>${i + 1}.</b> ${esc(q.prompt || '')} <span class="as-qtag">${(QTYPES[q.type] || {}).label || q.type}</span> <span class="as-qtag comp">${COMP_LABEL[q.comp] || ''}</span></p>${q.image ? `<div class="as-q-imgwrap"><img class="as-q-img" src="${esc(q.image)}" alt="문항 이미지"></div>` : ''}`;
      let body = '';
      if (q.type === 'single' || q.type === 'multi' || q.type === 'poll') {
        body = `<div class="as-opts">${(q.choices || []).map((c, k) => {
          const correct = q.type === 'multi' ? (q.answers || []).includes(k) : (q.type === 'single' && k === q.answer);
          return `<div class="as-opt ${correct ? 'as-opt-correct' : ''}">${correct ? '✔ ' : ''}${esc(c)}</div>`;
        }).join('')}</div>${q.type === 'poll' ? '<p class="as-tans text-slate-400">즉답통계 — 정답 없음</p>' : ''}`;
      } else if (q.type === 'tf') body = `<p class="as-tans">정답: <b>${q.answer ? '참 (O)' : '거짓 (X)'}</b></p>`;
      else if (q.type === 'order') body = `<ol class="as-tans-list">${(q.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}</ol>`;
      else if (q.type === 'graph') body = `<div class="as-graph"><canvas width="420" height="240" data-fx="${esc(q.fx)}" data-xmin="${esc(q.xmin)}" data-xmax="${esc(q.xmax)}"></canvas></div><p class="as-tans">정답: <b>${esc(q.answer || '')}</b></p>`;
      else if (q.type === 'essay') body = `<p class="as-tans">서술형 · 핵심 키워드: ${esc((q.keywords || []).join(', ') || '-')}</p>`;
      else body = `<p class="as-tans">정답: <b>${esc(answerText(q))}</b></p>`;
      return head + body + '</div>';
    }

    async function doSubmit() {
      const answers = liveAnswers;
      const btn = host.querySelector('#as-submit'); if (btn) { btn.disabled = true; btn.textContent = '채점 중…'; }
      const graded = gradeObjective(page, answers);
      // 서술형 AI 채점
      let key = ''; try { key = await Auth.getApiKey(); } catch (e) {}
      for (const q of page.questions.filter((x) => x.type === 'essay')) {
        const ans = (answers[q.id] || '').trim();
        let earned = 0, fb = '', pct = null;
        if (ans && key) {
          try { const g = await aiGradeEssay(q, ans, key); pct = Math.max(0, Math.min(100, g.score)); earned = q.points * pct / 100; fb = g.feedback || ''; }
          catch (e) { fb = 'AI 채점 실패 — 교사 확인 필요'; }
        } else if (ans) { fb = '교사 확인 필요'; }
        if (pct != null) { graded.possible += q.points; graded.earned += earned; addComp(graded.perComp, q.comp, earned, q.points); }
        graded.detail.push({ qid: q.id, type: 'essay', correct: pct != null ? pct >= 60 : null, earned, points: q.points, feedback: fb, pct });
      }
      const score = graded.possible > 0 ? Math.round(graded.earned / graded.possible * 100) : 0;
      const perComp = {};
      Object.keys(graded.perComp).forEach((k) => { const o = graded.perComp[k]; if (o.possible > 0) perComp[k] = Math.round(o.earned / o.possible * 100); });

      const result = { answers, score, perComp, detail: graded.detail, studentName: user.name || user.loginId, classId: user.classId || '', gradedAt: Date.now() };
      try {
        await DB.write(`assessmentResults/${lesson.id}/${page.id}/${user.uid}`, result);
        // 역량 반영
        const me = (await Auth.getMyData()) || user;
        const prevC = me.competency || {};
        const nextC = Object.assign({}, prevC);
        Object.keys(perComp).forEach((k) => { nextC[k] = prevC[k] ? Math.round(prevC[k] * 0.5 + perComp[k] * 0.5) : perComp[k]; });
        await Auth.saveMyData({ competency: nextC, reviewQuiz: { lastDate: dateStr(), lastScore: score, lastAt: Date.now() } });
      } catch (e) { console.error('[assess] 저장 실패', e); }
      renderResult(result);
    }

    function renderResult(result) {
      const byId = {}; result.detail.forEach((d) => { byId[d.qid] = d; });
      host.innerHTML = `
        <div class="as-result">
          <div class="quiz-score-ring" style="--p:${result.score}"><span>${result.score}<small>점</small></span></div>
          <p class="quiz-result-msg">${result.score >= 80 ? '훌륭해요! 🎉' : result.score >= 50 ? '좋아요, 조금만 더! 💪' : '차근차근 다시 봐요 🌱'}</p>
          <div class="as-result-list">
            ${page.questions.map((q, i) => {
              const d = byId[q.id];
              if (q.type === 'poll') return `<div class="as-ritem"><span class="as-mark poll">·</span> ${i + 1}. ${esc(q.prompt)} <span class="text-xs text-slate-400">(응답 완료)</span></div>`;
              if (!d) return '';
              const mark = d.correct === true ? '<span class="as-mark ok">○</span>' : d.correct === false ? '<span class="as-mark no">✕</span>' : '<span class="as-mark pend">—</span>';
              return `<div class="as-ritem">${mark} ${i + 1}. ${esc(q.prompt)}
                ${d.type === 'essay' && d.feedback ? `<div class="as-essay-fb">🤖 ${esc(d.feedback)}${d.pct != null ? ` <b>(${d.pct}점)</b>` : ''}</div>` : ''}</div>`;
            }).join('')}
          </div>
          <button id="as-retry" class="btn-ghost mt-3">다시 풀기</button>
        </div>`;
      host.querySelector('#as-retry').addEventListener('click', () => { curIdx = 0; renderPage(); });
    }
  }

  // 문항 입력 UI
  function questionInputHtml(q, i, prevResult, orderState) {
    const pa = prevResult && prevResult.answers ? prevResult.answers[q.id] : undefined;
    const head = `<div class="as-q" data-qid="${q.id}" data-type="${q.type}">
      <p class="as-q-prompt"><b>${i + 1}.</b> ${esc(q.prompt || '')}
        <span class="as-qtag comp">${COMP_LABEL[q.comp] || ''}</span>${q.type !== 'poll' ? `<span class="as-qtag">${q.points}점</span>` : ''}</p>
      ${q.image ? `<div class="as-q-imgwrap"><img class="as-q-img" src="${esc(q.image)}" alt="문항 이미지"></div>` : ''}`;
    let body = '';
    if (q.type === 'single') body = `<div class="as-opts">${(q.choices || []).map((c, k) => `<label class="as-opt"><input type="radio" name="r-${q.id}" value="${k}" ${pa === k ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>`;
    else if (q.type === 'multi') body = `<div class="as-opts">${(q.choices || []).map((c, k) => `<label class="as-opt"><input type="checkbox" name="c-${q.id}" value="${k}" ${(pa || []).includes(k) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>`;
    else if (q.type === 'tf') body = `<div class="as-opts"><label class="as-opt"><input type="radio" name="r-${q.id}" value="true" ${pa === true ? 'checked' : ''}> 참 (O)</label><label class="as-opt"><input type="radio" name="r-${q.id}" value="false" ${pa === false ? 'checked' : ''}> 거짓 (X)</label></div>`;
    else if (q.type === 'short') body = `<input class="form-input as-input" value="${esc(pa || '')}" placeholder="정답 입력">`;
    else if (q.type === 'math') body = `<input class="form-input as-input" value="${esc(pa || '')}" placeholder="수식/숫자 입력 (예: 2*x+1)">`;
    else if (q.type === 'graph') body = `<div class="as-graph"><canvas width="420" height="240" data-fx="${esc(q.fx)}" data-xmin="${esc(q.xmin)}" data-xmax="${esc(q.xmax)}"></canvas></div><input class="form-input as-input" value="${esc(pa || '')}" placeholder="답(숫자/수식)">`;
    else if (q.type === 'order') {
      const items = (orderState && orderState[q.id]) || shuffle(q.items || []);
      body = `<div class="as-order" data-qid="${q.id}">${items.map((it) => `<div class="as-order-item" draggable="true"><span class="as-drag">⠿</span><span class="as-order-txt">${esc(it)}</span><span class="as-order-btns"><button type="button" class="as-omove up">▲</button><button type="button" class="as-omove down">▼</button></span></div>`).join('')}</div>`;
    } else if (q.type === 'essay') body = `<textarea class="form-input as-input" rows="4" placeholder="서술하세요">${esc(pa || '')}</textarea>`;
    else if (q.type === 'poll') {
      if (q.mode === 'free') body = `<input class="form-input as-input" value="${esc(pa || '')}" placeholder="자유롭게 입력">`;
      else body = `<div class="as-opts">${(q.choices || []).map((c, k) => `<label class="as-opt"><input type="radio" name="r-${q.id}" value="${k}" ${pa === k ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>`;
    }
    return head + body + '</div>';
  }

  function bindOrder(box) {
    if (!box) return;
    let dragEl = null;
    box.querySelectorAll('.as-order-item').forEach((it) => {
      it.addEventListener('dragstart', () => { dragEl = it; it.classList.add('dragging'); });
      it.addEventListener('dragend', () => { it.classList.remove('dragging'); dragEl = null; });
      it.addEventListener('dragover', (e) => {
        e.preventDefault(); if (!dragEl || dragEl === it) return;
        const r = it.getBoundingClientRect(); const after = (e.clientY - r.top) > r.height / 2;
        box.insertBefore(dragEl, after ? it.nextSibling : it);
      });
      it.querySelector('.up').addEventListener('click', () => { const p = it.previousElementSibling; if (p) box.insertBefore(it, p); });
      it.querySelector('.down').addEventListener('click', () => { const n = it.nextElementSibling; if (n) box.insertBefore(n, it); });
    });
  }

  // DOM → 답안
  function collectAnswers(host, page, orderState) {
    const out = {};
    page.questions.forEach((q) => {
      const node = host.querySelector(`.as-q[data-qid="${q.id}"]`); if (!node) return;
      if (q.type === 'single' || (q.type === 'poll' && q.mode !== 'free')) { const r = node.querySelector(`input[name="r-${q.id}"]:checked`); out[q.id] = r ? +r.value : null; }
      else if (q.type === 'tf') { const r = node.querySelector(`input[name="r-${q.id}"]:checked`); out[q.id] = r ? (r.value === 'true') : null; }
      else if (q.type === 'multi') out[q.id] = [...node.querySelectorAll(`input[name="c-${q.id}"]:checked`)].map((c) => +c.value);
      else if (q.type === 'order') out[q.id] = [...node.querySelectorAll('.as-order-txt')].map((t) => t.textContent);
      else { const inp = node.querySelector('.as-input'); out[q.id] = inp ? inp.value : ''; }
    });
    return out;
  }

  function addComp(perComp, comp, earned, possible) {
    const o = perComp[comp] = perComp[comp] || { earned: 0, possible: 0 };
    o.earned += earned; o.possible += possible;
  }

  // 객관·규칙 채점
  function gradeObjective(page, answers) {
    const res = { earned: 0, possible: 0, perComp: {}, detail: [] };
    page.questions.forEach((q) => {
      if (q.type === 'poll' || q.type === 'essay') return;
      const a = answers[q.id]; let correct = false;
      if (q.type === 'single') correct = a === q.answer;
      else if (q.type === 'multi') correct = setEq(a, q.answers);
      else if (q.type === 'tf') correct = a === q.answer;
      else if (q.type === 'short') correct = (q.accept || []).some((x) => normalize(x) === normalize(a));
      else if (q.type === 'math' || q.type === 'graph') correct = !!a && mathEqual(a, q.answer, q.vars, q.tol);
      else if (q.type === 'order') correct = arrEq(a, q.items);
      const earned = correct ? q.points : 0;
      res.earned += earned; res.possible += q.points;
      addComp(res.perComp, q.comp, earned, q.points);
      res.detail.push({ qid: q.id, type: q.type, correct, earned, points: q.points });
    });
    return res;
  }

  /* ── 외부 모듈(배움 대전) 재사용용 단일 문항 헬퍼 ──
     자동채점 가능한 유형: single·multi·tf·short·math·graph·order (essay·poll 제외) */
  const GRADABLE_TYPES = ['single', 'multi', 'tf', 'short', 'math', 'graph', 'order'];

  // host 안에 한 문항의 입력 UI를 렌더(그래프/순서 후처리 포함)
  function renderQuestionInput(host, q) {
    if (!host || !q) return;
    const orderState = {};
    if (q.type === 'order') orderState[q.id] = shuffle(q.items || []);
    host.innerHTML = questionInputHtml(q, 0, null, orderState);
    if (q.type === 'graph') { const cv = host.querySelector('.as-graph canvas'); if (cv) plotFx(cv, q.fx, q.xmin, q.xmax); }
    if (q.type === 'order') bindOrder(host.querySelector(`.as-order[data-qid="${q.id}"]`));
    host.__orderState = orderState;
  }
  // 렌더된 입력에서 답안 읽기
  function readAnswer(host, q) {
    if (!host || !q) return null;
    return collectAnswers(host, { questions: [q] }, host.__orderState || {})[q.id];
  }
  // 단일 문항 정오 판정 (true/false, 채점불가는 null)
  function gradeOne(q, a) {
    if (!q || q.type === 'poll' || q.type === 'essay') return null;
    if (q.type === 'single') return a === q.answer;
    if (q.type === 'multi') return setEq(a, q.answers);
    if (q.type === 'tf') return a === q.answer;
    if (q.type === 'short') return (q.accept || []).some((x) => normalize(x) === normalize(a));
    if (q.type === 'math' || q.type === 'graph') return !!a && mathEqual(a, q.answer, q.vars, q.tol);
    if (q.type === 'order') return arrEq(a, q.items);
    return null;
  }
  // 정답을 사람이 읽는 텍스트로
  function answerText(q) {
    if (!q) return '';
    if (q.type === 'single') { const c = (q.choices || [])[q.answer]; return c == null ? '' : String(c); }
    if (q.type === 'multi') return (q.answers || []).map((i) => (q.choices || [])[i]).filter((v) => v != null).join(', ');
    if (q.type === 'tf') return q.answer ? '참 (O)' : '거짓 (X)';
    if (q.type === 'short') return (q.accept || []).filter(Boolean).join(' / ');
    if (q.type === 'math' || q.type === 'graph') return String(q.answer || '');
    if (q.type === 'order') return (q.items || []).join(' → ');
    return '';
  }
  // Uint8Array → base64 (PDF 바이트를 AI 전송용으로 변환)
  function uint8ToB64(bytes) {
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  // PDF 파일 → 평가 문항 자동 생성 (그림 캡처 포함 · 배움 대전에서도 사용)
  async function aiGenerateQuestionsFromFile(file, key) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const b64 = uint8ToB64(bytes);
    return aiGenerateQuestions(b64, key, bytes.slice()); // pdf.js가 바이트를 가져가므로 복사본 전달
  }

  /* ── 태블릿 필기 노트(스크래치) — 평가·배움 대전 풀이 화면 오른쪽에 사용
        opts.store({strokes}) 전달 시 페이지 이동 후에도 필기 유지 ── */
  function mountNotePad(host, opts) {
    if (!host) return null;
    opts = opts || {};
    host.innerHTML = `
      <div class="np-pad">
        <div class="np-bar">
          <span class="np-title">✏️ 필기 노트</span>
          <span class="np-tools">
            <button type="button" class="np-tool on" data-t="pen">펜</button>
            <button type="button" class="np-tool" data-t="eraser">지우개</button>
            ${['#1e293b', '#dc2626', '#2563eb', '#16a34a'].map((c, i) => `<button type="button" class="np-color ${i === 0 ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}
            <button type="button" class="np-clear">전체 지움</button>
          </span>
        </div>
        <div class="np-canvas-wrap"><canvas class="np-canvas"></canvas></div>
      </div>`;
    const wrap = host.querySelector('.np-canvas-wrap');
    const canvas = host.querySelector('.np-canvas');
    const ctx = canvas.getContext('2d');
    let tool = 'pen', color = '#1e293b', width = 2.5, drawing = false, live = null;
    let strokes = (opts.store && Array.isArray(opts.store.strokes)) ? opts.store.strokes : [];
    let cssW = 1, cssH = 1;
    const persist = () => { if (opts.store) opts.store.strokes = strokes; };
    function fit() {
      const w = wrap.clientWidth || 320, h = wrap.clientHeight || 440;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cssW = w; cssH = h; redraw();
    }
    function drawStroke(s) {
      const p = s.pts; if (!p.length) return;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
      ctx.lineWidth = (s.width || 2.5) * (s.tool === 'eraser' ? 9 : 1);
      ctx.beginPath(); ctx.moveTo(p[0].x * cssW, p[0].y * cssH);
      if (p.length === 1) ctx.lineTo(p[0].x * cssW + 0.1, p[0].y * cssH + 0.1);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x * cssW, p[i].y * cssH);
      ctx.stroke();
    }
    function redraw() { ctx.clearRect(0, 0, cssW, cssH); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cssW, cssH); strokes.forEach(drawStroke); if (live) drawStroke(live); }
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
    const down = (e) => { e.preventDefault(); drawing = true; live = { tool, color, width, pts: [pos(e)] }; if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); };
    const move = (e) => { if (!drawing) return; e.preventDefault(); live.pts.push(pos(e)); redraw(); };
    const up = () => { if (!drawing) return; drawing = false; if (live && live.pts.length) { strokes.push(live); persist(); } live = null; redraw(); };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('pointerleave', up);
    host.querySelectorAll('.np-tool').forEach((b) => b.addEventListener('click', () => { tool = b.dataset.t; host.querySelectorAll('.np-tool').forEach((x) => x.classList.toggle('on', x === b)); }));
    host.querySelectorAll('.np-color').forEach((b) => b.addEventListener('click', () => {
      color = b.dataset.c; tool = 'pen';
      host.querySelectorAll('.np-color').forEach((x) => x.classList.toggle('on', x === b));
      host.querySelectorAll('.np-tool').forEach((x) => x.classList.toggle('on', x.dataset.t === 'pen'));
    }));
    host.querySelector('.np-clear').addEventListener('click', () => { strokes = []; persist(); redraw(); });
    const onResize = () => { if (!document.body.contains(canvas)) { window.removeEventListener('resize', onResize); return; } fit(); };
    window.addEventListener('resize', onResize);
    fit(); setTimeout(fit, 30); // 레이아웃 확정 후 한 번 더 맞춤
    return { fit, clear: () => { strokes = []; redraw(); } };
  }

  // 서술형 AI 채점 (Claude 직접호출)
  async function aiGradeEssay(q, answer, key) {
    const sys = '너는 한국 교사를 돕는 채점 보조자다. 학생 서술형 답안을 0~100점으로 채점하고 1~2문장의 건설적 피드백을 한국어로 준다. 반드시 JSON만 출력: {"score":0~100,"feedback":"..."}';
    const userText = `[문항] ${q.prompt}\n[핵심 키워드] ${(q.keywords || []).join(', ')}\n[채점 안내] ${q.guide || '(없음)'}\n[학생 답안] ${answer}\nJSON만 출력.`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 500, system: sys, messages: [{ role: 'user', content: userText }] })
    });
    if (!res.ok) throw new Error('AI 채점 실패');
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return { score: Number(parsed.score) || 0, feedback: String(parsed.feedback || '') };
  }

  const dateStr = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  /* ── PDF → 문항 자동 생성 (Claude document 블록) ── */
  const fileToB64 = (file) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej; fr.readAsDataURL(file);
  });

  /* ── 캡처 이미지 첨부 헬퍼 (붙여넣기/파일 → 축소 dataURL) ── */
  const readFileAsDataURL = (file) => new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file);
  });
  function downscale(dataUrl, maxDim, quality) {
    maxDim = maxDim || 1100; quality = quality || 0.85;
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height; const sc = Math.min(1, maxDim / Math.max(w, h));
        w = Math.round(w * sc); h = Math.round(h * sc);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        try { res(c.toDataURL('image/jpeg', quality)); } catch (e) { res(dataUrl); }
      };
      img.onerror = () => res(dataUrl);
      img.src = dataUrl;
    });
  }
  // 편집 모달에 '이미지(캡처 붙여넣기)' 필드를 장착 — 여러 문항 유형/모듈에서 재사용
  function bindImageField(box, obj) {
    const drop = box.querySelector('#q-img-drop');
    if (!drop) return;
    const del = box.querySelector('.as-img-del');
    const file = box.querySelector('#q-img-file');
    const paint = () => {
      drop.innerHTML = obj.image
        ? `<img src="${esc(obj.image)}" class="as-img-prev" alt="문항 이미지">`
        : '<span class="as-img-hint">📋 이 영역을 클릭한 뒤 캡처 이미지를 <b>Ctrl+V</b> 로 붙여넣으세요</span>';
      if (del) del.classList.toggle('hidden', !obj.image);
    };
    const setImg = async (f) => {
      if (!f) return;
      try { obj.image = await downscale(await readFileAsDataURL(f), 1100, 0.85); paint(); }
      catch (e) { toast('이미지를 불러오지 못했습니다.'); }
    };
    drop.setAttribute('tabindex', '0');
    drop.addEventListener('click', () => drop.focus());
    box.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.indexOf('image') === 0) { const f = it.getAsFile(); if (f) { e.preventDefault(); setImg(f); break; } }
      }
    });
    if (file) file.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; setImg(f); });
    if (del) del.addEventListener('click', () => { obj.image = null; paint(); });
  }
  // 편집 모달용 이미지 필드 HTML (id 고정)
  function imageFieldHtml(obj) {
    return `
      <div class="as-img-field">
        <label class="form-label">이미지 (선택) — 화면 캡처 후 <b>Ctrl+V</b> 붙여넣기 또는 파일 선택</label>
        <div id="q-img-drop" class="as-img-drop">${obj.image
          ? `<img src="${esc(obj.image)}" class="as-img-prev" alt="문항 이미지">`
          : '<span class="as-img-hint">📋 이 영역을 클릭한 뒤 캡처 이미지를 <b>Ctrl+V</b> 로 붙여넣으세요</span>'}</div>
        <div class="as-img-acts">
          <label class="btn-mini cursor-pointer">📁 파일 선택<input type="file" accept="image/*" id="q-img-file" class="hidden"></label>
          <button type="button" class="btn-mini as-img-del ${obj.image ? '' : 'hidden'}">✕ 이미지 제거</button>
        </div>
      </div>`;
  }
  function sanitizeImportedQ(raw) {
    const types = ['single', 'multi', 'tf', 'short', 'math', 'graph', 'order', 'essay', 'poll'];
    const t = types.includes(raw && raw.type) ? raw.type : 'short';
    const q = newQuestion(t);
    q.prompt = String((raw && raw.prompt) || '').trim();
    if (raw && COMP.some((c) => c.key === raw.comp)) q.comp = raw.comp;
    if (raw && LEVELS[raw.level]) q.level = raw.level;
    if (raw && Number(raw.points) > 0) q.points = Math.min(100, Math.round(Number(raw.points)));
    if (t === 'single') {
      if (Array.isArray(raw.choices) && raw.choices.length) { q.choices = raw.choices.map(String); q.answer = Math.min(Math.max(0, parseInt(raw.answer, 10) || 0), q.choices.length - 1); }
    } else if (t === 'multi') {
      if (Array.isArray(raw.choices) && raw.choices.length) q.choices = raw.choices.map(String);
      q.answers = Array.isArray(raw.answers) ? raw.answers.map((n) => parseInt(n, 10)).filter((n) => n >= 0 && n < q.choices.length) : [];
    } else if (t === 'tf') { q.answer = raw.answer === true || raw.answer === 'true';
    } else if (t === 'short') { q.accept = Array.isArray(raw.accept) ? raw.accept.map(String).filter(Boolean) : (raw.answer != null && raw.answer !== '' ? [String(raw.answer)] : []); if (!q.accept.length) q.accept = [''];
    } else if (t === 'math') { q.answer = String(raw.answer || ''); q.vars = String(raw.vars || '');
    } else if (t === 'essay') { q.keywords = Array.isArray(raw.keywords) ? raw.keywords.map(String).filter(Boolean) : []; q.guide = String(raw.guide || ''); }
    return q;
  }
  async function aiGenerateQuestions(b64, key, bytes) {
    const sys = `너는 한국 교사를 돕는 평가 문항 생성기다. 주어진 PDF의 문제들을 인식해 자동채점 가능한 형태로 변환한다. 반드시 JSON 배열만 출력(코드블록·설명 금지). 각 원소:
{"type":"single|multi|tf|short|math|essay","prompt":"발문","comp":"problem|reason|comm|connect|info","level":"easy|mid|hard","points":1, "figure": null 또는 {"page":쪽번호(1부터),"bbox":[x0,y0,x1,y1]}, ...유형필드}
유형필드: single→"choices":["..."],"answer":정답index(0부터,모르면0) · multi→"choices":[...],"answers":[index...] · tf→"answer":true|false · short→"accept":["정답","대체정답"] · math→"answer":"수식/숫자","vars":"예 x=3(없으면 빈문자)" · essay→"keywords":["핵심어"],"guide":"채점안내".
figure 규칙: 문항에 그림·표·도표·그래프·그림자료가 함께 제시되면 그 자료의 위치를 figure로 알려준다. page는 PDF 쪽번호(1부터), bbox는 그 쪽 안에서 자료가 차지하는 영역의 [왼쪽,위,오른쪽,아래] 좌표(각각 0~1 비율, 왼쪽위가 0,0). 자료가 없으면 figure는 null. 자료에 포함된 글자/수치까지 넉넉히 감싸도록 bbox를 약간 크게 잡아라.
규칙: 보기가 있으면 single/multi, 숫자·수식 답이면 math, 짧은 답이면 short, 길게 서술이면 essay, 참/거짓이면 tf. PDF에서 정답을 확신할 수 없으면 short 또는 essay로 만들고 정답은 비운다. comp는 문제 성격에 맞게 추정. 최대 20문항.`;
    const content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: '이 PDF의 문제들을 위 규칙대로 JSON 배열로 변환해줘. 그림/표/도표가 있는 문항은 figure도 채워줘. JSON 배열만 출력.' }
    ];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 4096, system: sys, messages: [{ role: 'user', content }] })
    });
    if (!res.ok) throw new Error('AI 호출 실패 (' + res.status + ')');
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('AI가 요청을 거절했습니다.');
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let arr;
    try { arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch (e) { throw new Error('AI 응답을 해석하지 못했습니다.'); }
    if (!Array.isArray(arr)) throw new Error('문항 배열을 받지 못했습니다.');
    const qs = arr.slice(0, 20).map((raw) => {
      const q = sanitizeImportedQ(raw);
      if (raw && raw.figure && raw.figure.bbox) q.__fig = raw.figure; // 자료 위치(후처리로 이미지 캡처)
      return q;
    }).filter((q) => q.prompt);
    try { await capturePdfFigures(qs, bytes); } catch (e) { console.warn('[assess] PDF 그림 캡처 실패', e); }
    return qs;
  }

  // PDF에서 figure(page,bbox) 영역을 렌더·크롭해 문항 이미지로 첨부 (PDF.js)
  async function capturePdfFigures(questions, bytes) {
    const needs = questions.filter((q) => q.__fig);
    if (!needs.length || !bytes || !window.pdfjsLib) { questions.forEach((q) => delete q.__fig); return; }
    let pdf = null;
    try { pdf = await pdfjsLib.getDocument({ data: bytes }).promise; } catch (e) { questions.forEach((q) => delete q.__fig); return; }
    const pageCanvas = {};
    const renderPage = async (n) => {
      if (pageCanvas[n]) return pageCanvas[n];
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas'); c.width = viewport.width; c.height = viewport.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
      return (pageCanvas[n] = c);
    };
    for (const q of needs) {
      const fig = q.__fig; delete q.__fig;
      try {
        const n = parseInt(fig.page, 10);
        if (!n || n < 1 || n > pdf.numPages) continue;
        let [x0, y0, x1, y1] = fig.bbox.map(Number);
        x0 = Math.max(0, Math.min(1, x0)); y0 = Math.max(0, Math.min(1, y0));
        x1 = Math.max(0, Math.min(1, x1)); y1 = Math.max(0, Math.min(1, y1));
        if (!(x1 > x0) || !(y1 > y0)) continue;
        const base = await renderPage(n);
        const sx = x0 * base.width, sy = y0 * base.height, sw = (x1 - x0) * base.width, sh = (y1 - y0) * base.height;
        if (sw < 10 || sh < 10) continue;
        const crop = document.createElement('canvas'); crop.width = sw; crop.height = sh;
        crop.getContext('2d').drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh);
        q.image = await downscale(crop.toDataURL('image/jpeg', 0.9), 1100, 0.88);
      } catch (e) { /* 개별 실패는 건너뜀 */ }
    }
    questions.forEach((q) => delete q.__fig);
    try { if (pdf && pdf.destroy) pdf.destroy(); } catch (e) {}
  }

  /* ============================================================
     교사 결과·통계 (실시간)
  ============================================================ */
  // 결과를 엑셀(.xlsx)로 — 이름·반·문항별 정오(O/X)·점수
  function exportResultsXlsx(page, obj) {
    if (!window.XLSX) { toast('엑셀 라이브러리를 불러오지 못했습니다.'); return; }
    const entries = Object.values(obj || {});
    if (!entries.length) { toast('내보낼 응시 결과가 없습니다.'); return; }
    const gq = page.questions.filter((q) => GRADED.includes(q.type));
    const header = ['이름', '반', ...gq.map((q, i) => `${i + 1}번`), '점수'];
    const cell = (d) => !d ? '·' : d.correct === true ? 'O' : d.correct === false ? 'X' : '–';
    const rows = entries.sort((a, b) => (b.gradedAt || 0) - (a.gradedAt || 0)).map((e) => {
      const by = {}; (e.detail || []).forEach((d) => { by[d.qid] = d; });
      return [e.studentName || '학생', cidLabel(e.classId), ...gq.map((q) => cell(by[q.id])), e.score];
    });
    // 문항별 정답률 행
    const pctRow = ['정답률(%)', '', ...gq.map((q) => {
      let ok = 0, cnt = 0; entries.forEach((e) => { const d = (e.detail || []).find((x) => x.qid === q.id); if (d && d.correct != null) { cnt++; if (d.correct === true) ok++; } });
      return cnt ? Math.round(ok / cnt * 100) : '';
    }), ''];
    const aoa = [header, ...rows, [], pctRow];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '평가결과');
    XLSX.writeFile(wb, `평가결과_${(page.title || 'assessment').replace(/[\\/:*?"<>|]/g, '_')}.xlsx`);
  }

  function openResults(lesson, page) {
    let unsub = null;
    const box = openModal(`
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-lg font-bold text-slate-800">📊 평가 결과 — ${esc(page.title || '평가')}</h3>
        <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
      </div>
      <div class="flex items-center justify-between mb-3">
        <p class="text-xs text-slate-400">학생 응시에 따라 실시간 갱신됩니다.</p>
        <button id="as-xlsx" class="btn-mini">📥 엑셀(.xlsx) 저장</button>
      </div>
      <div id="as-res-body"></div>
    `);
    box.classList.add('modal-wide');
    const bodyEl = box.querySelector('#as-res-body');
    let lastObj = {};
    box.querySelector('#as-xlsx').addEventListener('click', () => exportResultsXlsx(page, lastObj));
    const paint = (obj) => {
      lastObj = obj || {};
      const entries = Object.values(obj || {});
      const n = entries.length;
      const gq = page.questions.filter((q) => GRADED.includes(q.type));
      // 문항별 정답률
      const itemPct = gq.map((q) => {
        let ok = 0, cnt = 0;
        entries.forEach((e) => { const d = (e.detail || []).find((x) => x.qid === q.id); if (d && d.correct !== null && d.correct !== undefined) { cnt++; if (d.correct === true) ok++; } });
        return { q, pct: cnt ? Math.round(ok / cnt * 100) : null, cnt };
      });
      const polls = page.questions.filter((q) => q.type === 'poll');
      const mark = (d) => !d ? '<span class="as-gx none">·</span>'
        : d.correct === true ? '<span class="as-gx ok">○</span>'
        : d.correct === false ? '<span class="as-gx no">✕</span>'
        : '<span class="as-gx pend">–</span>';
      bodyEl.innerHTML = `
        <div class="text-xs text-slate-500 mb-2">응시 ${n}명${n ? ` · 평균 ${Math.round(entries.reduce((a, e) => a + (e.score || 0), 0) / n)}점` : ''} ${gq.length ? '· 학생별 정오: ○ 정답 / ✕ 오답 / – 미채점' : ''}</div>
        ${n ? `<div class="as-scroll"><table class="dash-table as-grid"><thead><tr><th>이름</th><th>반</th>${gq.map((q, i) => `<th class="num" title="${esc(q.prompt || '')}">${i + 1}</th>`).join('')}<th class="num">점수</th></tr></thead><tbody>
          ${entries.sort((a, b) => (b.gradedAt || 0) - (a.gradedAt || 0)).map((e) => {
            const by = {}; (e.detail || []).forEach((d) => { by[d.qid] = d; });
            return `<tr><td>${esc(e.studentName || '학생')}</td><td>${esc(cidLabel(e.classId))}</td>${gq.map((q) => `<td class="num">${mark(by[q.id])}</td>`).join('')}<td class="num"><b>${e.score}</b></td></tr>`;
          }).join('')}
        </tbody></table></div>` : '<p class="mat-empty">아직 응시한 학생이 없습니다.</p>'}
        ${itemPct.length ? `<h4 class="dash-title" style="margin:16px 0 8px">문항별 정답률</h4>
          ${itemPct.map((it, i) => `<div class="as-item-bar"><span class="as-item-q">${i + 1}. ${esc(it.q.prompt || '')}</span>
            <span class="pbar"><span class="pbar-fill" style="width:${it.pct || 0}%"></span><span class="pbar-txt">${it.pct == null ? '–' : it.pct + '%'}</span></span></div>`).join('')}` : ''}
        ${polls.map((q) => `<div class="as-poll-box"><h4 class="dash-title" style="margin:16px 0 8px">📊 ${esc(q.prompt || '즉답')}</h4>${pollHtml(q, entries)}</div>`).join('')}
      `;
    };
    const close = () => { if (unsub) { try { unsub(); } catch (e) {} } closeModal(); };
    box.querySelector('.modal-close').addEventListener('click', close);
    DB.read(`assessmentResults/${lesson.id}/${page.id}`).then((o) => paint(o || {}));
    unsub = DB.subscribe(`assessmentResults/${lesson.id}/${page.id}`, (o) => paint(o || {}));
  }

  function pollHtml(q, entries) {
    const vals = entries.map((e) => e.answers && e.answers[q.id]).filter((v) => v !== undefined && v !== null && v !== '');
    if (!vals.length) return '<p class="text-xs text-slate-400">응답 없음</p>';
    if (q.mode === 'free' || q.display === 'wordcloud') {
      const freq = {};
      vals.forEach((v) => String(v).split(/\s+/).forEach((w) => { w = w.trim(); if (w) freq[w] = (freq[w] || 0) + 1; }));
      const max = Math.max(...Object.values(freq));
      return `<div class="as-wordcloud">${Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 40).map((w) =>
        `<span class="as-word" style="font-size:${13 + Math.round(freq[w] / max * 26)}px;opacity:${0.55 + freq[w] / max * 0.45}">${esc(w)}</span>`).join(' ')}</div>`;
    }
    const counts = (q.choices || []).map((c, k) => vals.filter((v) => v === k).length);
    const max = Math.max(1, ...counts);
    return `<div class="as-barchart">${(q.choices || []).map((c, k) => `
      <div class="as-bar-row"><span class="as-bar-label">${esc(c)}</span>
        <span class="as-bar"><span class="as-bar-fill" style="width:${Math.round(counts[k] / max * 100)}%"></span></span>
        <span class="as-bar-n">${counts[k]}</span></div>`).join('')}</div>`;
  }

  // 배움 대전(collab.js)에서 문항 편집기·렌더·채점을 그대로 재사용
  window.Assess = {
    openEditor, mountViewer, openResults,
    imageFieldHtml, bindImageField, downscale, readFileAsDataURL,
    renderQuestionInput, readAnswer, gradeOne, answerText, mountNotePad,
    aiGenerateQuestionsFromFile, GRADABLE_TYPES, QTYPES
  };
  console.log('[assessment] STEP 08 로드 완료 — 평가 편집/응시/자동채점/역량연동/결과통계');
})();
