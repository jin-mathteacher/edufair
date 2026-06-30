/* ============================================================
   homework.js — 과제방 (STEP 09)  · window.Homework
   ------------------------------------------------------------
   ▶ 교사: 과제 등록 → 메신저 알림 + 학생 스케줄러 투두 자동추가 / 제출현황·교사확인
   ▶ 학생: 텍스트+사진 제출(사진은 키 있으면 Claude Vision 의심분석) / 기한초과 경고음·배너
   ▶ 데이터: /homework/{id} (대시보드 미제출 배너와 호환)
       { id,title,desc,classId(''|cid),dueDate,dueTime,createdBy,createdByName,createdAt,
         submissions:{ uid:{text,image,submittedAt,flagged,aiNote,checked,studentName,classId} } }
   ※ 블라인드 규칙: 학교/성명/지역명 코드 미포함.
============================================================ */

(function () {
  'use strict';

  /* ── 데이터 계층 ── */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);
  const useStorage = () => !!(window.FB && window.FB.ready && window.FB.storage);
  const genId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
    async remove(path) {
      if (useFB()) { await window.FB.db.ref(path).remove(); return; }
      const root = lsRoot(); const ks = path.split('/'); let o = root;
      for (let i = 0; i < ks.length - 1; i++) { if (o == null) return; o = o[ks[i]]; }
      if (o) delete o[ks[ks.length - 1]]; lsSave(root);
    },
    subscribe(path, cb) {
      if (!useFB()) return null;
      const ref = window.FB.db.ref(path);
      const h = ref.on('value', (s) => cb(s.val() || {}));
      return () => ref.off('value', h);
    }
  };

  /* ── 유틸 ── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const classLabel = (g, c) => `${g}학년 ${parseInt(c, 10)}반`;
  const cidLabel = (cid) => { cid = String(cid || ''); if (!cid) return '전체'; const g = cid.slice(0, cid.length - 2), c = cid.slice(-2); return `${g}학년 ${parseInt(c, 10)}반`; };
  const MAX_DEMO_BYTES = 3 * 1024 * 1024;
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  function dueMillis(hw) {
    if (!hw.dueDate) return Infinity;
    const t = hw.dueTime && /^\d{1,2}:\d{2}$/.test(hw.dueTime) ? hw.dueTime : '23:59';
    return new Date(`${hw.dueDate}T${t}:59`).getTime();
  }
  const isOverdue = (hw) => Date.now() > dueMillis(hw);
  function fmtDue(hw) { return `${hw.dueDate || '—'}${hw.dueTime ? ' ' + hw.dueTime : ''}`; }

  const fileToDataUrl = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function resizeImage(file, max, q) {
    const durl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    try {
      const img = await loadImage(durl);
      let w = img.naturalWidth, h = img.naturalHeight; max = max || 1024;
      if (Math.max(w, h) > max) { if (w >= h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', q || 0.7);
    } catch (e) { return durl; }
  }
  function beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = new AC(); const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.05;
      o.start(); setTimeout(() => { try { o.stop(); ctx.close(); } catch (e) {} }, 280);
    } catch (e) {}
  }
  async function getClasses() {
    let students = []; try { students = await Auth.listStudents(); } catch (e) { return { classes: [], students: [] }; }
    const map = new Map();
    students.forEach((s) => { const id = s.classId || `${s.grade}${pad2(s.classNo)}`; if (!map.has(id)) map.set(id, { classId: id, grade: s.grade, classNo: s.classNo, students: [] }); map.get(id).students.push(s); });
    return { classes: [...map.values()].sort((a, b) => a.classId.localeCompare(b.classId)), students };
  }

  /* ── 모달·토스트 ── */
  function openModal(html) { const r = document.getElementById('modal-root'); r.innerHTML = `<div class="modal-overlay"><div class="modal-box">${html}</div></div>`; return r.querySelector('.modal-box'); }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
  function toast(msg) {
    let el = document.getElementById('app-toast');
    if (!el) { el = document.createElement('div'); el.id = 'app-toast'; el.className = 'app-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ── 모듈 상태 ── */
  let user = null, rootEl = null, unsub = null, allStudents = [], beeped = false;

  function cleanup() { if (unsub) { try { unsub(); } catch (e) {} unsub = null; } }

  async function render(container, currentUser) {
    cleanup();
    user = currentUser; rootEl = container; beeped = false;
    const isTeacher = user.role === 'teacher';
    if (isTeacher) { try { const g = await getClasses(); allStudents = g.students; } catch (e) { allStudents = []; } }

    container.innerHTML = `
      <div class="card">
        <div class="mat-head">
          <div>
            <h3 class="dash-title" style="margin:0">✏️ 과제방</h3>
            <p class="mat-sub">${isTeacher ? '과제를 등록하면 학생에게 메신저 알림과 투두가 자동 전달됩니다.' : '제출할 과제를 확인하고 제출하세요. 마감을 지키면 좋아요!'}</p>
          </div>
          ${isTeacher ? `<button id="hw-add" class="btn-primary">＋ 과제 등록</button>` : ''}
        </div>
        ${isTeacher ? '' : `<div id="hw-banner"></div>`}
        <div id="hw-list" class="hw-list"><p class="mat-loading">불러오는 중…</p></div>
      </div>`;
    if (isTeacher) container.querySelector('#hw-add').addEventListener('click', openRegister);

    await loadList();
    unsub = DB.subscribe('homework', () => loadList());
  }

  async function loadList() {
    if (!rootEl) return;
    const listEl = rootEl.querySelector('#hw-list'); if (!listEl) return;
    const isTeacher = user.role === 'teacher';
    const obj = (await DB.read('homework')) || {};
    let items = Object.values(obj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!isTeacher) items = items.filter((h) => !h.classId || h.classId === user.classId);

    if (!items.length) {
      listEl.innerHTML = `<div class="mat-empty">${isTeacher ? '등록된 과제가 없습니다. <b>＋ 과제 등록</b>으로 시작하세요.' : '등록된 과제가 없어요. 새 과제가 올라오면 알려드릴게요.'}</div>`;
      return;
    }

    if (!isTeacher) {
      // 기한초과 미제출 경고
      const overdueUndone = items.filter((h) => isOverdue(h) && !(h.submissions && h.submissions[user.uid]));
      const banner = rootEl.querySelector('#hw-banner');
      if (banner) {
        if (overdueUndone.length) {
          banner.innerHTML = `<div class="hw-warn">⏰ 기한이 지난 미제출 과제가 <b>${overdueUndone.length}건</b> 있어요! 지금 제출해 주세요.</div>`;
          if (!beeped) { beep(); beeped = true; }
        } else banner.innerHTML = '';
      }
    }

    listEl.innerHTML = items.map((h) => {
      const subs = h.submissions || {};
      const over = isOverdue(h);
      if (isTeacher) {
        const total = allStudents.filter((s) => !h.classId || s.classId === h.classId).length;
        const cnt = Object.keys(subs).length;
        const flagged = Object.values(subs).filter((s) => s.flagged && !s.checked).length;
        return `<div class="hw-item" data-id="${esc(h.id)}">
          <div class="hw-main">
            <p class="hw-title">${esc(h.title)} ${over ? '<span class="hw-over">기한초과</span>' : ''} ${flagged ? `<span class="hw-flag">🚩 ${flagged}</span>` : ''}</p>
            <p class="hw-meta">${esc(cidLabel(h.classId))} · 마감 ${esc(fmtDue(h))} · 제출 ${cnt}/${total || '?'}${h.file ? ` · <a href="${esc(h.file.url || h.file.data)}" download="${esc(h.file.name)}" target="_blank" rel="noopener" class="hw-filelink">📎 ${esc(h.file.name)}</a>` : ''}</p>
          </div>
          <div class="hw-actions"><button class="btn-mini hw-subs">제출현황</button><button class="btn-mini hw-del text-red-500">삭제</button></div>
        </div>`;
      }
      const mine = subs[user.uid];
      const fileLink = h.file ? ` · <a href="${esc(h.file.url || h.file.data)}" download="${esc(h.file.name)}" target="_blank" rel="noopener" class="hw-filelink">📎 과제파일</a>` : '';
      return `<div class="hw-item" data-id="${esc(h.id)}">
        <div class="hw-main">
          <p class="hw-title">${esc(h.title)} ${mine ? '<span class="hw-done">제출완료</span>' : (over ? '<span class="hw-over">기한초과</span>' : '')}</p>
          <p class="hw-meta">마감 ${esc(fmtDue(h))}${h.desc ? ' · ' + esc(h.desc) : ''}${fileLink}</p>
        </div>
        <div class="hw-actions"><button class="hw-btn hw-submit">${mine ? '✏️ 다시 제출' : '✏️ 제출'}</button></div>
      </div>`;
    }).join('');

    const idOf = (e) => e.target.closest('.hw-item').dataset.id;
    if (isTeacher) {
      listEl.querySelectorAll('.hw-subs').forEach((b) => b.addEventListener('click', (e) => openSubmissions(obj[idOf(e)])));
      listEl.querySelectorAll('.hw-del').forEach((b) => b.addEventListener('click', (e) => deleteHw(obj[idOf(e)])));
    } else {
      listEl.querySelectorAll('.hw-submit').forEach((b) => b.addEventListener('click', (e) => openSubmit(obj[idOf(e)])));
    }
  }

  /* ── 교사: 과제 등록 ── */
  async function openRegister() {
    if (user.role !== 'teacher') return;
    const { classes } = await getClasses();
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-4">과제 등록</h3>
      <form id="hw-form" class="space-y-3" autocomplete="off">
        <div><label class="form-label">제목</label><input id="hw-title" class="form-input" placeholder="예) 1단원 연습문제 풀어오기" required></div>
        <div><label class="form-label">설명 <span class="text-slate-400 font-normal">(선택)</span></label><textarea id="hw-desc" class="form-input" rows="2"></textarea></div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="form-label">마감일</label><input id="hw-date" type="date" class="form-input" value="${todayStr()}" required></div>
          <div><label class="form-label">마감시간 <span class="text-slate-400 font-normal">(선택)</span></label><input id="hw-time" type="time" class="form-input"></div>
        </div>
        <div class="ev-type-row">
          <label class="ev-radio"><input type="radio" name="hw-scope" value="all" checked> ⚪ 전체 학생</label>
          <label class="ev-radio"><input type="radio" name="hw-scope" value="class"> 🔵 특정 반</label>
        </div>
        <div id="hw-classes" class="ev-classes hidden">
          ${classes.length ? `<div class="ev-class-grid">${classes.map((c) => `<label class="ev-class-chk"><input type="radio" name="hw-class" value="${c.classId}"> ${esc(classLabel(c.grade, c.classNo))}<span class="ev-class-cnt">${c.students.length}명</span></label>`).join('')}</div>`
            : `<p class="text-sm text-amber-600">등록된 학생이 없습니다.</p>`}
        </div>
        <div class="hw-filerow">
          <label class="btn-ghost btn-mini cursor-pointer">📎 과제 파일 첨부<input id="hw-file" type="file" accept="application/pdf,image/*,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xlsx,.zip" class="hidden"></label>
          <span id="hw-file-name" class="text-xs text-slate-500"></span>
        </div>
        <p id="hw-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
        <div class="flex gap-2 justify-end"><button type="button" class="btn-ghost modal-close">취소</button><button type="submit" class="btn-primary" id="hw-go">등록 & 알림 보내기</button></div>
      </form>`);
    box.querySelector('.modal-close').addEventListener('click', closeModal);
    const cbox = box.querySelector('#hw-classes');
    box.querySelectorAll('input[name="hw-scope"]').forEach((r) => r.addEventListener('change', () => cbox.classList.toggle('hidden', box.querySelector('input[name="hw-scope"]:checked').value !== 'class')));
    let hwFile = null;
    box.querySelector('#hw-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f && !useStorage() && f.size > MAX_DEMO_BYTES) { box.querySelector('#hw-error').textContent = `데모 모드에서는 ${(MAX_DEMO_BYTES / 1048576).toFixed(0)}MB 이하 파일만 첨부할 수 있어요.`; e.target.value = ''; return; }
      hwFile = f || null;
      box.querySelector('#hw-file-name').textContent = hwFile ? `첨부: ${hwFile.name}` : '';
    });
    box.querySelector('#hw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = box.querySelector('#hw-error');
      const title = box.querySelector('#hw-title').value.trim();
      const dueDate = box.querySelector('#hw-date').value;
      if (!title || !dueDate) { err.textContent = '제목과 마감일을 입력하세요.'; return; }
      let classId = '';
      if (box.querySelector('input[name="hw-scope"]:checked').value === 'class') {
        const r = box.querySelector('input[name="hw-class"]:checked');
        if (!r) { err.textContent = '대상 반을 선택하세요.'; return; }
        classId = r.value;
      }
      const go = box.querySelector('#hw-go'); go.disabled = true; go.textContent = '보내는 중…';
      try {
        await registerHw({ title, desc: box.querySelector('#hw-desc').value.trim(), classId, dueDate, dueTime: box.querySelector('#hw-time').value, file: hwFile });
        closeModal(); toast('과제를 등록하고 학생에게 알림을 보냈습니다.');
        await loadList();
      } catch (ex) { err.textContent = '실패: ' + ex.message; go.disabled = false; go.textContent = '등록 & 알림 보내기'; }
    });
  }

  async function registerHw({ title, desc, classId, dueDate, dueTime, file }) {
    const id = genId();
    let fileMeta = null;
    if (file) {
      fileMeta = { name: file.name, mime: file.type || '', size: file.size || 0 };
      if (useStorage()) { const ref = window.FB.storage.ref(`homeworkFiles/${id}/${file.name}`); await ref.put(file); fileMeta.url = await ref.getDownloadURL(); fileMeta.storagePath = `homeworkFiles/${id}/${file.name}`; }
      else fileMeta.data = await fileToDataUrl(file);
    }
    await DB.write(`homework/${id}`, { id, title, desc: desc || '', classId: classId || '', dueDate, dueTime: dueTime || '', file: fileMeta, createdBy: user.uid, createdByName: user.name || user.loginId, createdAt: Date.now(), submissions: {} });
    const targets = allStudents.filter((s) => !classId || s.classId === classId);
    for (const s of targets) {
      const tid = genId();
      await DB.write(`todos/${s.uid}/${dueDate}/${tid}`, { id: tid, text: `[과제] ${title}`, done: false, priority: 'high', source: 'homework', createdAt: Date.now() });
      if (window.Messenger && typeof Messenger.sendNotice === 'function') {
        try { await Messenger.sendNotice(s.uid, `📌 새 과제: ${title} (마감 ${dueDate}${dueTime ? ' ' + dueTime : ''})`); } catch (e) {}
      }
    }
  }

  async function deleteHw(hw) {
    if (!hw || user.role !== 'teacher') return;
    if (!confirm(`"${hw.title}" 과제를 삭제할까요?`)) return;
    await DB.remove(`homework/${hw.id}`);
    toast('과제가 삭제되었습니다.');
    await loadList();
  }

  /* ── 교사: 제출현황 (실시간) ── */
  function openSubmissions(hw) {
    if (!hw) return;
    let sub = null;
    const box = openModal(`
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-lg font-bold text-slate-800">📋 제출현황 — ${esc(hw.title)}</h3>
        <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
      </div>
      <p class="text-xs text-slate-400 mb-3">마감 ${esc(fmtDue(hw))} · 대상 ${esc(cidLabel(hw.classId))} · 실시간 갱신</p>
      <div id="hw-sub-list" class="rf-list"></div>
    `);
    box.classList.add('modal-wide');
    const listEl = box.querySelector('#hw-sub-list');
    const targets = allStudents.filter((s) => !hw.classId || s.classId === hw.classId);
    const paint = (subs) => {
      subs = subs || {};
      const submitted = Object.keys(subs).length;
      const notDone = targets.filter((s) => !subs[s.uid]);
      listEl.innerHTML = `
        <div class="text-xs text-slate-500 mb-2">제출 ${submitted}${targets.length ? '/' + targets.length : ''}명</div>
        ${Object.entries(subs).sort((a, b) => (b[1].submittedAt || 0) - (a[1].submittedAt || 0)).map(([uid, s]) => `
          <div class="rf-entry" data-uid="${esc(uid)}">
            <p class="rf-who">${esc(s.studentName || uid)} <span class="rf-cls">${esc(cidLabel(s.classId))}</span>
              ${s.flagged ? `<span class="hw-flag">🚩 의심${s.checked ? '(확인됨)' : ''}</span>` : ''}
              <span class="rf-date">${s.submittedAt ? new Date(s.submittedAt).toLocaleString('ko-KR') : ''}</span></p>
            ${s.text ? `<p class="rf-content">${esc(s.text).replace(/\n/g, '<br>')}</p>` : ''}
            ${Array.isArray(s.attachments) && s.attachments.length
              ? `<div class="hw-atts">${s.attachments.map((a) => a.type === 'image'
                  ? `<img src="${esc(a.url || a.data)}" class="hw-sub-img" alt="제출 사진">`
                  : `<a href="${esc(a.url || a.data)}" download="${esc(a.name || 'file.pdf')}" target="_blank" rel="noopener" class="hw-pdf-chip">📄 ${esc(a.name || 'PDF')}</a>`).join('')}</div>`
              : (s.image ? `<img src="${esc(s.image)}" class="hw-sub-img" alt="제출 사진">` : '')}
            ${s.aiNote ? `<p class="hw-ainote">🤖 ${esc(s.aiNote)}</p>` : ''}
            ${s.flagged ? `<button class="btn-mini hw-check" data-uid="${esc(uid)}">${s.checked ? '확인 해제' : '✔ 확인 완료'}</button>` : ''}
          </div>`).join('')}
        ${notDone.length ? `<p class="hw-notdone">미제출: ${notDone.map((s) => esc(s.name || s.loginId)).join(', ')}</p>` : (targets.length ? '<p class="text-xs text-green-600">전원 제출 완료 🎉</p>' : '')}
      `;
      listEl.querySelectorAll('.hw-sub-img').forEach((im) => im.addEventListener('click', () => { const b = openModal(`<div class="img-viewer"><img src="${im.src}"></div><div class="flex justify-end mt-3"><button class="btn-ghost modal-close">닫기</button></div>`); b.querySelector('.modal-close').addEventListener('click', () => openSubmissions(hw)); }));
      listEl.querySelectorAll('.hw-check').forEach((b) => b.addEventListener('click', async () => {
        const uid = b.dataset.uid; const cur = await DB.read(`homework/${hw.id}/submissions/${uid}`);
        if (cur) { cur.checked = !cur.checked; await DB.write(`homework/${hw.id}/submissions/${uid}`, cur); if (!useFB()) { const fresh = await DB.read(`homework/${hw.id}/submissions`); paint(fresh || {}); } }
      }));
    };
    const close = () => { if (sub) { try { sub(); } catch (e) {} } closeModal(); };
    box.querySelector('.modal-close').addEventListener('click', close);
    DB.read(`homework/${hw.id}/submissions`).then((o) => paint(o || {}));
    sub = DB.subscribe(`homework/${hw.id}/submissions`, (o) => paint(o || {}));
  }

  /* ── 학생: 제출 ── */
  function openSubmit(hw) {
    if (!hw) return;
    const mine = (hw.submissions && hw.submissions[user.uid]) || {};
    // 기존 제출물(이미지/PDF) 불러오기 (재제출 시 유지)
    let atts = [];
    if (Array.isArray(mine.attachments)) atts = mine.attachments.map((a) => Object.assign({}, a));
    else if (mine.image) atts = [{ type: 'image', url: /^data:/.test(mine.image) ? undefined : mine.image, data: /^data:/.test(mine.image) ? mine.image : undefined }];
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-1">${esc(hw.title)}</h3>
      <p class="text-xs text-slate-400 mb-2">마감 ${esc(fmtDue(hw))}${isOverdue(hw) ? ' · <span class="text-red-500">기한 초과</span>' : ''}</p>
      ${hw.desc ? `<p class="text-sm text-slate-600 mb-2">${esc(hw.desc)}</p>` : ''}
      ${hw.file ? `<p class="text-sm mb-3"><a href="${esc(hw.file.url || hw.file.data)}" download="${esc(hw.file.name)}" target="_blank" rel="noopener" class="hw-filelink">📎 과제 파일 내려받기 (${esc(hw.file.name)})</a></p>` : ''}
      <form id="hw-sform" class="space-y-3" autocomplete="off">
        <div><label class="form-label">제출 내용 <span class="text-slate-400 font-normal">(선택)</span></label><textarea id="hw-stext" class="form-input" rows="3" placeholder="풀이/답을 적거나 사진·PDF로 제출">${esc(mine.text || '')}</textarea></div>
        <div>
          <label class="btn-ghost cursor-pointer">📷 사진·PDF 첨부 (여러 개)<input id="hw-files" type="file" accept="image/*,application/pdf" capture="environment" multiple class="hidden"></label>
          <div id="hw-att-prev" class="hw-att-prev"></div>
        </div>
        <p id="hw-smsg" class="text-sm min-h-[1.1rem]"></p>
        <div class="flex gap-2 justify-end"><button type="button" class="btn-ghost modal-close">취소</button><button type="submit" class="btn-primary" id="hw-submit-go">제출하기</button></div>
      </form>`);
    box.querySelector('.modal-close').addEventListener('click', closeModal);
    const prevEl = box.querySelector('#hw-att-prev');
    const msg = box.querySelector('#hw-smsg');
    function renderPrev() {
      prevEl.innerHTML = atts.map((a, i) => a.type === 'image'
        ? `<span class="hw-att img"><img src="${esc(a.url || a.data)}"><button type="button" class="hw-att-del" data-i="${i}">✕</button></span>`
        : `<span class="hw-att pdf">📄 ${esc(a.name || 'PDF')}<button type="button" class="hw-att-del" data-i="${i}">✕</button></span>`).join('');
      prevEl.querySelectorAll('.hw-att-del').forEach((b) => b.addEventListener('click', () => { atts.splice(+b.dataset.i, 1); renderPrev(); }));
    }
    renderPrev();
    box.querySelector('#hw-files').addEventListener('change', async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        if (atts.length >= 8) { msg.textContent = '첨부는 최대 8개까지 가능합니다.'; break; }
        if (!useStorage() && f.size > MAX_DEMO_BYTES) { msg.textContent = `데모 모드에서는 파일당 ${(MAX_DEMO_BYTES / 1048576).toFixed(0)}MB 이하만 가능합니다.`; continue; }
        if (/^image\//.test(f.type)) atts.push({ type: 'image', data: await resizeImage(f, 1024, 0.7) });
        else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) atts.push({ type: 'pdf', name: f.name, data: await fileToDataUrl(f) });
        else msg.textContent = '사진 또는 PDF만 첨부할 수 있어요.';
      }
      renderPrev();
    });
    box.querySelector('#hw-sform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = box.querySelector('#hw-stext').value.trim();
      if (!text && !atts.length) { msg.textContent = '내용 또는 사진·PDF를 첨부하세요.'; return; }
      const go = box.querySelector('#hw-submit-go'); go.disabled = true; go.textContent = '제출 중…';
      try { await submitHw(hw, text, atts, msg); closeModal(); toast('과제를 제출했습니다. 수고했어요!'); await loadList(); }
      catch (ex) { msg.textContent = '실패: ' + ex.message; go.disabled = false; go.textContent = '제출하기'; }
    });
  }

  async function submitHw(hw, text, atts, msgEl) {
    let flagged = false, aiNote = '';
    // 새로 첨부된(dataURL) 항목으로 AI 의심분석 (이미지+PDF)
    const aiBlocks = atts.filter((a) => a.data).map((a) => a.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: (String(a.data).match(/^data:(.*?);/) || [])[1] || 'image/jpeg', data: String(a.data).split(',')[1] } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(a.data).split(',')[1] } });
    if (aiBlocks.length) {
      let key = ''; try { key = await Auth.getApiKey(); } catch (e) {}
      if (key) {
        if (msgEl) { msgEl.className = 'text-sm text-violet-600 min-h-[1.1rem]'; msgEl.textContent = '제출물을 확인하는 중…'; }
        try { const r = await analyzeSubmission(aiBlocks, key); flagged = !!r.suspicious; aiNote = r.note || ''; } catch (e) {}
      }
    }
    // 저장: Storage 업로드 또는 dataURL 유지
    const stored = [];
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      if (a.url && !a.data) { stored.push({ type: a.type, name: a.name || '', url: a.url }); continue; }
      if (useStorage() && a.data) {
        try {
          const ext = a.type === 'pdf' ? 'pdf' : 'jpg';
          const ref = window.FB.storage.ref(`homework/${hw.id}/${user.uid}/${Date.now()}_${i}.${ext}`);
          await ref.putString(a.data, 'data_url');
          stored.push({ type: a.type, name: a.name || '', url: await ref.getDownloadURL() });
        } catch (e) { stored.push({ type: a.type, name: a.name || '', data: a.data }); }
      } else stored.push({ type: a.type, name: a.name || '', data: a.data });
    }
    const sub = { text: text || '', attachments: stored, submittedAt: Date.now(), flagged, aiNote, checked: false, studentName: user.name || user.loginId, classId: user.classId || '' };
    await DB.write(`homework/${hw.id}/submissions/${user.uid}`, sub);
    // 해당 과제 투두 완료 처리(있으면)
    try {
      const todos = await DB.read(`todos/${user.uid}/${hw.dueDate}`);
      if (todos) for (const td of Object.values(todos)) {
        if (td.source === 'homework' && (td.text || '').includes(hw.title) && !td.done) { td.done = true; await DB.write(`todos/${user.uid}/${hw.dueDate}/${td.id}`, td); }
      }
    } catch (e) {}
  }

  // 제출물 의심분석 (Claude Vision/Doc) — 이미지+PDF 블록 배열을 받음
  async function analyzeSubmission(blocks, key) {
    const sys = '너는 교사를 돕는 보조자다. 학생이 제출한 과제(사진·PDF)를 보고, 학생이 직접 손으로 푼 흔적인지 아니면 인쇄물·해설지·타인 답안을 베끼거나 캡처한 정황이 있는지 간단히 판단한다. 반드시 JSON만 출력: {"suspicious":true|false,"note":"한 줄 사유(한국어)"}';
    const content = blocks.concat([{ type: 'text', text: '이 제출물을 평가해줘. JSON만 출력.' }]);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 300, system: sys, messages: [{ role: 'user', content }] })
    });
    if (!res.ok) throw new Error('AI 분석 실패');
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return { suspicious: !!parsed.suspicious, note: String(parsed.note || '') };
  }

  window.Homework = { render };
  console.log('[homework] STEP 09 로드 완료 — 과제 등록/알림/투두/제출/AI사진분석');
})();
