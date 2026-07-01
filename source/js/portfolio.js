/* ============================================================
   portfolio.js — 포트폴리오 (STEP 12) · window.Portfolio
   ------------------------------------------------------------
   ▶ 학생: 본인 학습 포트폴리오(역량 레이더·포인트·뱃지·활동 통계·AI 관찰기록·PDF)
   ▶ 교사: 학생 선택 → 해당 학생 포트폴리오 열람 + AI 관찰기록 생성
   ▶ 데이터: 기존 수집분 재사용 — competency / points / badges / visits /
            reviewQuiz / assessmentResults / battles. 관찰기록: /observations/{uid}
   ※ 블라인드: 학교/성명/지역명 코드 미포함.
============================================================ */

window.Portfolio = (function () {
  'use strict';

  /* ── 데이터 계층 (Firebase / localStorage) ── */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);
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
    }
  };

  /* ── 상수·유틸 ── */
  const COMP = [
    { key: 'problem', label: '문제해결' }, { key: 'reason', label: '추론' },
    { key: 'comm', label: '의사소통' }, { key: 'connect', label: '연결' }, { key: 'info', label: '정보처리' }
  ];
  const COMP_LABEL = COMP.reduce((o, c) => ((o[c.key] = c.label), o), {});
  const BADGES = [
    { p: 0, icon: '🌱', name: '새싹' }, { p: 20, icon: '✨', name: '탐구러' },
    { p: 50, icon: '🔥', name: '질문왕' }, { p: 100, icon: '🏅', name: '수학멘토' }, { p: 200, icon: '👑', name: '수학마스터' }
  ];
  const badgeFor = (p) => BADGES.filter((b) => (p || 0) >= b.p).slice(-1)[0] || BADGES[0];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cidLabel = (cid) => { cid = String(cid || ''); const g = cid.slice(0, cid.length - 2), c = cid.slice(-2); return g ? `${g}학년 ${parseInt(c, 10)}반` : ''; };
  const fmtDate = (ts) => { if (!ts) return '-'; const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`; };

  let user = null, chart = null, rootEl = null;
  function destroyChart() { if (chart) { try { chart.destroy(); } catch (e) {} chart = null; } }

  /* ── Claude 호출 ── */
  async function callClaude(key, system, prompt, maxTokens) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: maxTokens || 600, system, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error('AI 호출 실패 (' + res.status + ')');
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('AI가 답변을 거절했습니다.');
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  /* ============================================================
     진입점
  ============================================================ */
  async function render(container, currentUser) {
    destroyChart();
    user = currentUser; rootEl = container;
    if (user.role === 'teacher') return renderTeacher(container);
    return renderStudent(container, await selfRecord(), true);
  }

  async function selfRecord() {
    const me = (await Auth.getMyData()) || user;
    return me;
  }

  /* ── 교사: 학생 선택 → 포트폴리오 ── */
  async function renderTeacher(container) {
    container.innerHTML = '<div class="card"><p class="collab-loading">불러오는 중…</p></div>';
    let students = [];
    try { students = await Auth.listStudents(); } catch (e) {}
    if (!students.length) {
      container.innerHTML = `<div class="card text-center py-12"><div class="text-5xl mb-3">🏆</div>
        <p class="text-slate-600">등록된 학생이 없습니다. ⚙️ 설정에서 학생을 먼저 등록하세요.</p></div>`;
      return;
    }
    // 반별 그룹
    const byClass = {};
    students.forEach((s) => { const c = s.classId || ''; (byClass[c] = byClass[c] || []).push(s); });

    container.innerHTML = `
      <div class="pf-wrap">
        <div class="card">
          <h3 class="dash-title">🏆 학생 포트폴리오</h3>
          <p class="text-sm text-slate-500 mb-3">학생을 선택하면 학습 현황·역량·뱃지와 AI 관찰기록을 볼 수 있습니다.</p>
          ${Object.keys(byClass).sort().map((c) => `
            <div class="pf-classgroup">
              <p class="pf-classname">${esc(cidLabel(c)) || '미지정'}</p>
              <div class="pf-studs">
                ${byClass[c].map((s) => {
                  const bd = badgeFor(s.points);
                  return `<button class="pf-stud" data-uid="${s.uid}">
                    <span class="pf-stud-ava">${esc((s.name || s.loginId).charAt(0))}</span>
                    <span class="pf-stud-main"><b>${esc(s.name || s.loginId)}</b><small>${esc(s.loginId)} · ${bd.icon} ${s.points || 0}P</small></span>
                  </button>`;
                }).join('')}
              </div>
            </div>`).join('')}
        </div>
        <div id="pf-detail"></div>
      </div>`;
    const stmap = {}; students.forEach((s) => { stmap[s.uid] = s; });
    container.querySelectorAll('.pf-stud').forEach((b) =>
      b.addEventListener('click', () => {
        container.querySelectorAll('.pf-stud').forEach((x) => x.classList.toggle('on', x === b));
        renderStudent(container.querySelector('#pf-detail'), stmap[b.dataset.uid], false);
      }));
  }

  /* ── 통계 집계 ── */
  async function gatherStats(uid) {
    const out = { assessCount: 0, assessAvg: null, battleCount: 0, battleScore: 0, recent: [] };
    try {
      const ar = (await DB.read('assessmentResults')) || {};
      let sum = 0, n = 0;
      Object.values(ar).forEach((byPage) => Object.values(byPage || {}).forEach((byUid) => {
        const r = byUid && byUid[uid];
        if (r) { n++; sum += (r.score || 0); out.recent.push({ score: r.score, at: r.gradedAt }); }
      }));
      out.assessCount = n; out.assessAvg = n ? Math.round(sum / n) : null;
    } catch (e) {}
    try {
      const battles = (await DB.read('battles')) || {};
      Object.values(battles).forEach((b) => { const p = b.players && b.players[uid]; if (p) { out.battleCount++; out.battleScore += (p.score || 0); } });
    } catch (e) {}
    out.recent.sort((a, b) => (b.at || 0) - (a.at || 0));
    out.recent = out.recent.slice(0, 6);
    return out;
  }

  /* ── 학생 1명 포트폴리오 카드 ── */
  async function renderStudent(host, rec, isSelf) {
    if (!host) return;
    destroyChart();
    host.innerHTML = '<div class="card"><p class="collab-loading">포트폴리오 구성 중…</p></div>';
    const comp = rec.competency || {};
    const hasComp = COMP.some((c) => (comp[c.key] || 0) > 0);
    const bd = badgeFor(rec.points);
    const stats = await gatherStats(rec.uid);
    const obs = (await DB.read(`observations/${rec.uid}`)) || null;
    const isTeacher = user.role === 'teacher';
    const earnedBadges = BADGES.filter((b) => (rec.badges || []).includes(b.name) || (rec.points || 0) >= b.p);

    host.innerHTML = `
      <div class="card pf-card" id="pf-card">
        <div class="pf-head">
          <div class="pf-ava-lg">${esc((rec.name || rec.loginId).charAt(0))}</div>
          <div class="pf-head-main">
            <h3 class="pf-name">${esc(rec.name || rec.loginId)} <span class="pf-badge-tag">${bd.icon} ${bd.name}</span></h3>
            <p class="pf-sub">${esc(cidLabel(rec.classId))} · ${esc(rec.loginId)} · 누적 <b>${rec.points || 0}P</b></p>
          </div>
        </div>

        <div class="pf-grid">
          <div class="pf-metric"><span class="pf-metric-n">${rec.visits || 0}</span><span class="pf-metric-l">접속 횟수</span></div>
          <div class="pf-metric"><span class="pf-metric-n">${stats.assessCount}</span><span class="pf-metric-l">평가 응시</span></div>
          <div class="pf-metric"><span class="pf-metric-n">${stats.assessAvg == null ? '–' : stats.assessAvg}</span><span class="pf-metric-l">평가 평균</span></div>
          <div class="pf-metric"><span class="pf-metric-n">${stats.battleCount}</span><span class="pf-metric-l">배움 대전</span></div>
          <div class="pf-metric"><span class="pf-metric-n">${rec.reviewQuiz && rec.reviewQuiz.lastScore != null ? rec.reviewQuiz.lastScore + '%' : '–'}</span><span class="pf-metric-l">최근 복습퀴즈</span></div>
          <div class="pf-metric"><span class="pf-metric-n">${(rec.badges || []).length || earnedBadges.length}</span><span class="pf-metric-l">획득 뱃지</span></div>
        </div>

        <div class="pf-two">
          <div class="pf-radar-box">
            <h4 class="pf-h4">🎯 수학 5대 핵심역량</h4>
            ${hasComp ? '<div class="pf-radar"><canvas id="pf-radar"></canvas></div>'
              : '<p class="pf-empty">아직 역량 데이터가 없습니다. 평가에 응시하면 채워집니다.</p>'}
          </div>
          <div class="pf-badges-box">
            <h4 class="pf-h4">🏅 뱃지</h4>
            <div class="pf-badges">
              ${BADGES.map((b) => {
                const got = (rec.points || 0) >= b.p || (rec.badges || []).includes(b.name);
                return `<div class="pf-badge ${got ? 'got' : ''}"><span class="pf-badge-ic">${b.icon}</span><span class="pf-badge-nm">${b.name}</span><span class="pf-badge-pt">${b.p}P</span></div>`;
              }).join('')}
            </div>
            <p class="pf-lastseen">마지막 접속: ${fmtDate(rec.lastSeenAt)}</p>
          </div>
        </div>

        <div class="pf-obs">
          <h4 class="pf-h4">🤖 AI 관찰기록</h4>
          <div id="pf-obs-body" class="pf-obs-body">${obs && obs.text
            ? esc(obs.text)
            : '<span class="pf-empty">아직 생성된 관찰기록이 없습니다.</span>'}</div>
          ${obs && obs.at ? `<p class="pf-obs-meta">생성: ${fmtDate(obs.at)}</p>` : ''}
        </div>

        ${isTeacher ? `
        <div class="pf-obs" id="pf-subdetail">
          <h4 class="pf-h4">📚 과목별 학생 세부사항 <span class="text-xs text-slate-400 font-normal">(교과세부능력특기사항 · 약 400자, 교사 전용)</span></h4>
          <p class="text-xs text-slate-500 mb-2">교과수업·협업의 장·과제방·자기평가·질문방 활동을 바탕으로 과목별 세부사항을 생성합니다.</p>
          <div class="pf-sd-row">
            <select id="pf-sd-subject" class="form-input"><option value="">과목 불러오는 중…</option></select>
            <button id="pf-sd-gen" class="btn-primary">생성</button>
          </div>
          <div id="pf-sd-body" class="pf-obs-body" style="margin-top:8px"><span class="pf-empty">과목을 선택하고 생성을 누르세요.</span></div>
          <p id="pf-sd-meta" class="pf-obs-meta"></p>
        </div>` : ''}
      </div>

      <div class="pf-actions">
        ${isTeacher || isSelf ? '<button id="pf-gen" class="btn-primary">🤖 AI 관찰기록 생성</button>' : ''}
        <button id="pf-pdf" class="btn-ghost">📄 PDF로 저장</button>
      </div>
      <p id="pf-msg" class="text-sm text-right mt-1 min-h-[1.1rem]"></p>`;

    if (hasComp) {
      const cv = host.querySelector('#pf-radar');
      if (cv && window.Chart) {
        chart = new Chart(cv.getContext('2d'), {
          type: 'radar',
          data: { labels: COMP.map((c) => c.label), datasets: [{ label: rec.name || '역량', data: COMP.map((c) => Math.round(comp[c.key] || 0)), fill: true, backgroundColor: 'rgba(124,58,237,.18)', borderColor: '#7c3aed', borderWidth: 2, pointBackgroundColor: '#7c3aed', pointRadius: 3 }] },
          options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, backdropColor: 'transparent' }, pointLabels: { font: { size: 12, weight: '600' } } } }, plugins: { legend: { display: false } } }
        });
      }
    }

    const gen = host.querySelector('#pf-gen');
    if (gen) gen.addEventListener('click', () => generateObservation(host, rec, stats, comp));
    host.querySelector('#pf-pdf').addEventListener('click', () => exportPdf(host, rec));

    if (isTeacher) setupSubjectDetail(host, rec, stats, comp);
  }

  /* ── 과목별 학생 세부사항 (교사 전용) ── */
  async function setupSubjectDetail(host, rec, stats, comp) {
    const sel = host.querySelector('#pf-sd-subject');
    if (!sel) return;
    const subs = Object.entries((await DB.read('subjects')) || {})
      .map(([id, s]) => ({ id, ...s })).filter((s) => s.classId === rec.classId)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    sel.innerHTML = subs.length ? subs.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') : '<option value="">과목 없음 (학습실에서 과목을 먼저 만드세요)</option>';
    const showSaved = async (sid) => {
      const body = host.querySelector('#pf-sd-body'); const meta = host.querySelector('#pf-sd-meta');
      const d = sid ? await DB.read(`subjectDetails/${rec.uid}/${sid}`) : null;
      if (d && d.text) { body.textContent = d.text; meta.textContent = '생성: ' + fmtDate(d.at); }
      else { body.innerHTML = '<span class="pf-empty">아직 생성된 세부사항이 없습니다. 생성을 눌러보세요.</span>'; meta.textContent = ''; }
    };
    sel.addEventListener('change', () => showSaved(sel.value));
    if (subs.length) showSaved(subs[0].id);
    host.querySelector('#pf-sd-gen').addEventListener('click', () =>
      generateSubjectDetail(host, rec, subs.find((s) => s.id === sel.value), comp));
  }

  // 학생의 과목 내 활동 수집
  async function gatherSubjectActivity(uid, subject) {
    const act = { assess: [], reflections: [], battles: 0, homework: 0, collab: 0, selfEval: null, publicQ: 0 };
    try {
      const lessons = Object.values((await DB.read('lessons')) || {})
        .filter((l) => l.subjectId === subject.id || (!l.subjectId && l.classId === subject.classId));
      const ar = (await DB.read('assessmentResults')) || {};
      for (const l of lessons) {
        (l.pages || []).forEach((p) => {
          if (p.type === 'assessment' && ar[l.id] && ar[l.id][p.id] && ar[l.id][p.id][uid]) act.assess.push({ title: l.title, score: ar[l.id][p.id][uid].score });
        });
        try { const refl = await DB.read(`reflections/${l.id}/${uid}`); if (refl && refl.text) act.reflections.push(String(refl.text).slice(0, 200)); } catch (e) {}
      }
    } catch (e) {}
    try { Object.values((await DB.read('battles')) || {}).forEach((b) => { if (b.players && b.players[uid]) act.battles++; }); } catch (e) {}
    try { Object.values((await DB.read('collabBoards')) || {}).forEach((b) => { const st = b.strokes || {}; if (Object.values(st).some((s) => s.uid === uid)) act.collab++; }); } catch (e) {}
    try { Object.values((await DB.read('homework')) || {}).forEach((h) => { const subm = h.submissions || h.submits || {}; if (subm[uid]) act.homework++; }); } catch (e) {}
    try { act.selfEval = await DB.read(`selfEvalSub/${subject.id}/${uid}`); } catch (e) {}
    try { const pq = (await DB.read('publicQ')) || {}; act.publicQ = Object.values(pq).filter((q) => q.uid === uid).length; } catch (e) {}
    return act;
  }

  async function generateSubjectDetail(host, rec, subject, comp) {
    const msg = host.querySelector('#pf-sd-meta');
    if (!subject) { toast('학습실에서 과목을 먼저 만들어 주세요.'); return; }
    let key = ''; try { key = await Auth.getApiKey(); } catch (e) {}
    if (!key) { msg.textContent = '⚙️ 설정에서 AI 키를 먼저 등록하세요.'; msg.className = 'pf-obs-meta text-amber-600'; return; }
    const bodyEl = host.querySelector('#pf-sd-body');
    bodyEl.innerHTML = '<span class="pf-empty">AI가 세부사항을 작성하는 중…</span>';
    msg.textContent = ''; msg.className = 'pf-obs-meta';
    const act = await gatherSubjectActivity(rec.uid, subject);
    const compLine = COMP.map((c) => `${c.label} ${Math.round(comp[c.key] || 0)}`).join(', ');
    const sv = act.selfEval;
    const svAvg = sv && sv.ratings ? (Object.values(sv.ratings).reduce((a, b) => a + (+b || 0), 0) / Math.max(1, Object.keys(sv.ratings).length)).toFixed(1) : null;
    const sys = `너는 한국 중·고등학교 교사의 '과목별 교과세부능력 및 특기사항(세특)' 작성을 돕는다. 주어진 활동 데이터로 해당 과목에서의 학생 역량·태도·성장·참여를 구체적 근거로 서술한다. 분량은 공백 포함 약 400자(±40자). 학생 이름·학교·지역은 쓰지 말고 "이 학생"으로 지칭. 생활기록부 문체(평서문, ~함/~을 보임). 과장·허위 금지, 데이터에 없는 사실 지어내지 말 것. 과목명을 자연스럽게 포함.`;
    const prompt = `[과목] ${subject.name}
[5대 핵심역량(0~100)] ${compLine}
[교과수업·평가] 응시 ${act.assess.length}회${act.assess.length ? ` (평균 ${Math.round(act.assess.reduce((a, b) => a + (b.score || 0), 0) / act.assess.length)}점)` : ''}
[자기성찰 일지] ${act.reflections.length ? act.reflections.slice(0, 2).join(' / ') : '기록 없음'}
[협업의 장] 참여 보드 ${act.collab}개
[배움 대전] 참여 ${act.battles}회
[과제방] 제출 ${act.homework}회
[질문방] 공개질문 ${act.publicQ}건, 누적 ${rec.points || 0}P
[자기평가 보고서] ${sv ? `자기평가 평균 ${svAvg}/5, 총평: ${(sv.overall || '').slice(0, 200) || '없음'}` : '미제출'}
위 데이터를 근거로 이 과목의 세특을 약 400자로 작성해줘. 세특 본문만 출력.`;
    try {
      const text = await callClaude(key, sys, prompt, 800);
      await DB.write(`subjectDetails/${rec.uid}/${subject.id}`, { text, subjectName: subject.name, at: Date.now(), by: user.uid });
      bodyEl.textContent = text;
      msg.textContent = `생성: ${fmtDate(Date.now())} · ${text.length}자`; msg.className = 'pf-obs-meta text-green-600';
    } catch (ex) { bodyEl.innerHTML = '<span class="text-red-500 text-sm">생성 실패</span>'; msg.textContent = '실패: ' + ex.message; msg.className = 'pf-obs-meta text-red-500'; }
  }

  function toast(m) { let el = document.getElementById('app-toast'); if (!el) { el = document.createElement('div'); el.id = 'app-toast'; el.className = 'app-toast'; document.body.appendChild(el); } el.textContent = m; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600); }

  /* ── AI 관찰기록 생성 ── */
  async function generateObservation(host, rec, stats, comp) {
    const msg = host.querySelector('#pf-msg');
    let key = ''; try { key = await Auth.getApiKey(); } catch (e) {}
    if (!key) { msg.className = 'text-sm text-right mt-1 text-amber-600'; msg.textContent = '⚙️ 설정에서 AI 키를 먼저 등록하세요.'; return; }
    msg.className = 'text-sm text-right mt-1 text-violet-600'; msg.textContent = 'AI가 관찰기록을 작성하는 중…';
    const compLine = COMP.map((c) => `${c.label} ${Math.round(comp[c.key] || 0)}`).join(', ');
    const sys = '너는 한국 중·고등학교 수학 교사의 학생 관찰기록(생활기록부 교과세부능력특기사항 톤)을 돕는다. 주어진 학습 데이터로 학생의 강점·성장·노력을 구체적이고 긍정적으로 4~6문장으로 서술한다. 과장 없이 데이터 근거로. 학생 이름·학교·지역은 쓰지 말고 "이 학생"으로 지칭. 한국어 평서문, 존댓말 아님(생기부 문체).';
    const prompt = `학습 데이터:\n- 5대 핵심역량(0~100): ${compLine}\n- 누적 포인트: ${rec.points || 0}P (${badgeFor(rec.points).name})\n- 접속 횟수: ${rec.visits || 0}\n- 평가 응시: ${stats.assessCount}회, 평균 ${stats.assessAvg == null ? '데이터 없음' : stats.assessAvg + '점'}\n- 배움 대전 참여: ${stats.battleCount}회\n- 최근 복습퀴즈: ${rec.reviewQuiz && rec.reviewQuiz.lastScore != null ? rec.reviewQuiz.lastScore + '%' : '없음'}\n위 데이터로 관찰기록을 작성해줘.`;
    try {
      const text = await callClaude(key, sys, prompt, 600);
      await DB.write(`observations/${rec.uid}`, { text, at: Date.now(), by: user.uid });
      const body = host.querySelector('#pf-obs-body'); if (body) body.textContent = text;
      msg.className = 'text-sm text-right mt-1 text-green-600'; msg.textContent = '✅ 관찰기록을 생성·저장했습니다.';
    } catch (ex) { msg.className = 'text-sm text-right mt-1 text-red-500'; msg.textContent = '실패: ' + ex.message; }
  }

  /* ── PDF 출력 (html2canvas → jsPDF, 한글 보존) ── */
  async function exportPdf(host, rec) {
    const msg = host.querySelector('#pf-msg');
    const card = host.querySelector('#pf-card');
    if (!card || !window.html2canvas || !(window.jspdf && window.jspdf.jsPDF)) {
      msg.className = 'text-sm text-right mt-1 text-red-500'; msg.textContent = 'PDF 라이브러리를 불러오지 못했습니다.'; return;
    }
    msg.className = 'text-sm text-right mt-1 text-violet-600'; msg.textContent = 'PDF 만드는 중…';
    try {
      const canvas = await html2canvas(card, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pw = 210, ph = 297, margin = 10;
      const iw = pw - margin * 2;
      const ih = canvas.height * iw / canvas.width;
      let y = margin, rest = ih;
      // 길면 여러 페이지로 분할
      if (ih <= ph - margin * 2) {
        pdf.addImage(img, 'JPEG', margin, y, iw, ih);
      } else {
        // 페이지 단위로 잘라 넣기
        const pageImgH = ph - margin * 2;
        const ratio = canvas.width / iw;
        let sY = 0;
        while (sY < canvas.height) {
          const sliceH = Math.min(canvas.height - sY, pageImgH * ratio);
          const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = sliceH;
          c2.getContext('2d').drawImage(canvas, 0, sY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          const part = c2.toDataURL('image/jpeg', 0.92);
          pdf.addImage(part, 'JPEG', margin, margin, iw, sliceH / ratio);
          sY += sliceH;
          if (sY < canvas.height) pdf.addPage();
        }
      }
      pdf.save(`portfolio_${rec.loginId || 'student'}.pdf`);
      msg.className = 'text-sm text-right mt-1 text-green-600'; msg.textContent = '✅ PDF를 저장했습니다.';
    } catch (ex) { msg.className = 'text-sm text-right mt-1 text-red-500'; msg.textContent = 'PDF 실패: ' + ex.message; }
  }

  function teardown() { destroyChart(); }

  console.log('[portfolio] STEP 12 로드 완료 — 포트폴리오/역량/뱃지/AI관찰/PDF');
  return { render, teardown };
})();
