/* ============================================================
   app.js — 앱 진입점 / 라우터 / 레이아웃 · 인증 흐름 제어
   STEP 01: 시작화면 전환, 사이드바 토글, 메뉴 라우팅
   STEP 02: 로그인 분기 · 비밀번호 변경 강제 · 교사 설정(학생관리/AI키)
============================================================ */

(function () {
  'use strict';

  /* ───── 메뉴 정의 (roles: 표시 권한) ───── */
  const VIEWS = {
    dashboard: { title: '대시보드', icon: '🏠', desc: '반별 현황 · 접속 상태 · 학습 분석', roles: ['teacher', 'student'] },
    scheduler: { title: '스케줄러', icon: '📅', desc: '달력 · 일정 · 투두리스트 (교사 → 학생 일정 공유)', roles: ['teacher', 'student'] },
    messenger: { title: '메신저',   icon: '💬', desc: '교사 ↔ 학생 실시간 1:1 채팅', roles: ['teacher', 'student'] },
    lesson:    { title: '학습실',   icon: '📚', desc: '교과 수업 / 협업의 장 / 과제방 / 자료방', roles: ['teacher', 'student'] },
    chatbot:   { title: '질문방',   icon: '🤖', desc: 'AI 수학 멘토 (소크라테스식 문답)', roles: ['teacher', 'student'] },
    etc:       { title: '기타',     icon: '🛠️', desc: '바이브코딩 / 수학그림 작성기', roles: ['teacher', 'student'] },
    portfolio: { title: '포트폴리오', icon: '🏆', desc: '학습 현황 · 뱃지 · AI 관찰 기록', roles: ['teacher', 'student'] }
  };

  /* ───── DOM 참조 ───── */
  const $ = (id) => document.getElementById(id);
  const startScreen   = $('start-screen');
  const loginScreen   = $('login-screen');
  const appShell      = $('app-shell');
  const enterBtn      = $('enter-btn');
  const toggleBtn     = $('toggle-sidebar');
  const navMenu       = $('nav-menu');
  const viewTitle     = $('view-title');
  const viewContainer = $('view-container');
  const modalRoot     = $('modal-root');
  // 로그인 화면 요소
  const roleTabs      = $('role-tabs');
  const loginForm     = $('login-form');
  const loginIdInput  = $('login-id');
  const loginPwInput  = $('login-pw');
  const loginIdLabel  = $('login-id-label');
  const loginError    = $('login-error');
  const loginHint     = $('login-hint');
  const signupRow     = $('signup-row');
  const signupLink    = $('signup-link');
  // 헤더/사이드바 사용자 요소
  const adminBtn      = $('admin-btn');
  const settingsBtn   = $('settings-btn');
  const logoutBtn     = $('logout-btn');
  const userNameEl    = $('user-name');
  const userRoleEl    = $('user-role');
  const userAvatarEl  = $('user-avatar');
  const sidebarUserEl = $('sidebar-user');

  let selectedRole = 'student';

  /* ============================================================
     초기화
  ============================================================ */
  Auth.onLogin  = (user) => start(user);
  Auth.onLogout = () => showLogin();

  Auth.init().then(() => {
    console.log('[app] 인증 초기화 완료', Auth.user ? `(세션: ${Auth.user.loginId})` : '(비로그인)');
  });

  /* ───── 시작화면 → 로그인(또는 세션 복원 시 바로 입장) ───── */
  enterBtn.addEventListener('click', () => {
    startScreen.classList.add('hidden');
    if (Auth.isLoggedIn()) start(Auth.user);
    else showLogin();
  });

  /* ============================================================
     로그인 화면
  ============================================================ */
  function showLogin() {
    if (window.Messenger) Messenger.teardown(); // 알림 구독·배지 정리
    if (window.Chatbot) Chatbot.teardown();      // 질문방 구독 정리
    startScreen.classList.add('hidden');
    appShell.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginForm.reset();
    loginError.textContent = '';
    applyRoleUI();
    loginIdInput.focus();
  }

  // 역할 탭 전환
  roleTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.role-tab');
    if (!tab) return;
    selectedRole = tab.dataset.role;
    roleTabs.querySelectorAll('.role-tab').forEach((t) =>
      t.classList.toggle('active', t === tab));
    applyRoleUI();
  });

  function applyRoleUI() {
    loginError.textContent = '';
    const cfg = {
      student: {
        label: '학년반번호', ph: '예) 10701 (1학년 7반 1번)', mode: 'numeric', signup: false,
        hint: '학생: 아이디=학년반번호, 초기 비밀번호=아이디 · 첫 로그인 시 비밀번호 변경'
      },
      teacher: {
        label: '교사 아이디', ph: '교사 아이디', mode: 'text', signup: true,
        hint: '신규 교사는 회원가입 후 관리자 승인이 완료되어야 로그인할 수 있습니다.'
      },
      admin: {
        label: '관리자 아이디', ph: '관리자 아이디', mode: 'text', signup: false,
        hint: '기본 관리자 — 아이디: Admin01 / 비밀번호: admin123'
      }
    }[selectedRole];
    loginIdLabel.textContent = cfg.label;
    loginIdInput.placeholder = cfg.ph;
    loginIdInput.inputMode = cfg.mode;
    loginHint.textContent = cfg.hint;
    signupRow.classList.toggle('hidden', !cfg.signup);
  }

  /* ── 교사 회원가입 모달 ── */
  signupLink.addEventListener('click', openSignupModal);
  function openSignupModal() {
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-1">교사 회원가입</h3>
      <p class="text-sm text-slate-500 mb-4">가입 신청 후 <b>관리자 승인</b>이 완료되면 로그인할 수 있습니다.</p>
      <form id="signup-form" class="space-y-3" autocomplete="off">
        <input id="su-name" class="form-input" placeholder="이름 (표시용)">
        <input id="su-id" class="form-input" placeholder="아이디 (4자 이상)" required>
        <input id="su-pw" type="password" class="form-input" placeholder="비밀번호 (4자 이상)" required>
        <input id="su-pw2" type="password" class="form-input" placeholder="비밀번호 확인" required>
        <p id="su-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
        <div class="flex gap-2 justify-end">
          <button type="button" class="btn-ghost modal-close">취소</button>
          <button type="submit" class="btn-primary">가입 신청</button>
        </div>
      </form>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);
    box.querySelector('#signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = box.querySelector('#su-error');
      const pw = box.querySelector('#su-pw').value;
      const pw2 = box.querySelector('#su-pw2').value;
      if (pw !== pw2) { err.textContent = '두 비밀번호가 일치하지 않습니다.'; return; }
      try {
        await Auth.signupTeacher(box.querySelector('#su-id').value, pw, box.querySelector('#su-name').value);
        closeModal();
        alert('가입 신청이 완료되었습니다.\n관리자 승인 후 로그인할 수 있습니다.');
      } catch (ex) { err.textContent = ex.message; }
    });
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    try {
      // 성공 시 Auth.onLogin → start() 자동 호출 (첫 로그인이면 start에서 PW변경 모달 표시)
      await Auth.login(selectedRole, loginIdInput.value, loginPwInput.value);
    } catch (err) {
      loginError.textContent = err.message || '로그인에 실패했습니다.';
    }
  });

  /* ============================================================
     메인 앱 진입 / 사용자 정보 표시
  ============================================================ */
  function start(user) {
    loginScreen.classList.add('hidden');
    startScreen.classList.add('hidden');
    appShell.classList.remove('hidden');

    renderUserInfo(user);
    buildMenu(user.role);
    settingsBtn.classList.toggle('hidden', user.role !== 'teacher');
    adminBtn.classList.toggle('hidden', !user.isAdmin);

    // 메신저 알림 배지 구독 시작 (화면 이동과 무관하게 동작)
    if (window.Messenger) Messenger.initNotifications(user);

    navigate('dashboard');

    // 첫 로그인이면 즉시 비밀번호 변경 유도, 아니면 학생 복습 퀴즈 팝업
    if (user.mustChangePw) openPasswordModal(true);
    else if (window.Dashboard) Dashboard.maybeShowReviewQuiz(user);
  }

  function renderUserInfo(user) {
    const roleLabel = user.isAdmin ? '관리자' : (user.role === 'teacher' ? '교사' : '학생');
    userNameEl.textContent = user.name || user.loginId;
    userRoleEl.textContent = `${roleLabel} · ${user.loginId}`;
    userAvatarEl.textContent = (user.name || user.loginId).charAt(0);
    sidebarUserEl.textContent = `${user.name || user.loginId} (${roleLabel})`;
  }

  // 역할에 맞는 메뉴만 표시
  function buildMenu(role) {
    navMenu.querySelectorAll('.nav-item').forEach((btn) => {
      const v = VIEWS[btn.dataset.view];
      const allowed = !v || v.roles.includes(role);
      btn.classList.toggle('hidden', !allowed);
    });
  }

  logoutBtn.addEventListener('click', () => {
    if (confirm('로그아웃 하시겠습니까?')) Auth.logout();
  });

  /* ============================================================
     사이드바 토글 (펼침 → 아이콘 → 전체화면 순환)
  ============================================================ */
  toggleBtn.addEventListener('click', () => {
    const grid = appShell;
    if (!grid.classList.contains('collapsed') && !grid.classList.contains('full')) {
      grid.classList.add('collapsed');
    } else if (grid.classList.contains('collapsed')) {
      grid.classList.remove('collapsed');
      grid.classList.add('full');
    } else {
      grid.classList.remove('full');
    }
  });

  /* ============================================================
     메뉴 라우팅
  ============================================================ */
  navMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn || btn.classList.contains('hidden')) return;
    navigate(btn.dataset.view);
  });

  function navigate(viewKey) {
    const view = VIEWS[viewKey];
    if (!view) return;
    // 권한 체크
    if (Auth.user && !view.roles.includes(Auth.user.role)) return;

    navMenu.querySelectorAll('.nav-item').forEach((el) =>
      el.classList.toggle('active', el.dataset.view === viewKey));
    viewTitle.textContent = view.title;

    // STEP 03부터: 구현된 화면은 전용 렌더러 호출, 미구현은 플레이스홀더
    if (viewKey === 'dashboard' && window.Dashboard) {
      Dashboard.render(viewContainer, Auth.user);
    } else if (viewKey === 'scheduler' && window.Scheduler) {
      Scheduler.render(viewContainer, Auth.user);
    } else if (viewKey === 'messenger' && window.Messenger) {
      Messenger.render(viewContainer, Auth.user);
    } else if (viewKey === 'lesson' && window.Lesson) {
      Lesson.render(viewContainer, Auth.user);
    } else if (viewKey === 'chatbot' && window.Chatbot) {
      Chatbot.render(viewContainer, Auth.user);
    } else {
      viewContainer.innerHTML = renderPlaceholder(viewKey, view);
    }
  }

  function renderPlaceholder(key, view) {
    return `
      <div class="max-w-3xl mx-auto">
        <div class="card text-center py-16">
          <div class="text-6xl mb-4">${view.icon}</div>
          <h3 class="text-2xl font-bold text-slate-800 mb-2">${view.title}</h3>
          <p class="text-slate-500 mb-6">${view.desc}</p>
          <span class="inline-block bg-slate-100 text-slate-500 text-sm px-4 py-1.5 rounded-full">
            이 화면은 다음 단계에서 구현됩니다
          </span>
        </div>
      </div>`;
  }

  /* ============================================================
     모달 공통
  ============================================================ */
  function openModal(html) {
    modalRoot.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-box">${html}</div>
      </div>`;
    // 오버레이 클릭(닫기 허용 모달만) 처리는 각 모달에서 .modal-close 로 제어
    return modalRoot.querySelector('.modal-box');
  }
  function closeModal() { modalRoot.innerHTML = ''; }
  window.__closeModal = closeModal;

  /* ============================================================
     비밀번호 변경 모달 (forced = 첫 로그인 강제)
  ============================================================ */
  function openPasswordModal(forced) {
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-1">비밀번호 변경</h3>
      <p class="text-sm text-slate-500 mb-4">
        ${forced ? '첫 로그인입니다. 안전을 위해 비밀번호를 변경하세요.' : '새 비밀번호를 입력하세요.'}
      </p>
      <form id="pw-form" class="space-y-3" autocomplete="off">
        <input id="pw-new" type="password" class="form-input" placeholder="새 비밀번호 (4자 이상)" required>
        <input id="pw-confirm" type="password" class="form-input" placeholder="새 비밀번호 확인" required>
        <p id="pw-error" class="text-red-500 text-sm min-h-[1.25rem]"></p>
        <div class="flex gap-2 justify-end">
          ${forced ? '' : '<button type="button" class="btn-ghost modal-close">취소</button>'}
          <button type="submit" class="btn-primary">변경</button>
        </div>
      </form>
    `);

    if (!forced) box.querySelector('.modal-close').addEventListener('click', closeModal);

    box.querySelector('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const np = box.querySelector('#pw-new').value;
      const cf = box.querySelector('#pw-confirm').value;
      const err = box.querySelector('#pw-error');
      if (np !== cf) { err.textContent = '두 비밀번호가 일치하지 않습니다.'; return; }
      try {
        const user = await Auth.changePassword(np);
        closeModal();
        renderUserInfo(user);
        alert('비밀번호가 변경되었습니다.');
        // 첫 로그인 강제변경이었던 학생은 이어서 복습 퀴즈 안내
        if (forced && window.Dashboard) Dashboard.maybeShowReviewQuiz(user);
      } catch (ex) { err.textContent = ex.message; }
    });
  }

  /* ============================================================
     교사 설정 모달 (학생 등록 / 학생 관리 / AI 키)
  ============================================================ */
  settingsBtn.addEventListener('click', () => openSettingsModal('register'));

  function openSettingsModal(tab) {
    const box = openModal(`
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-slate-800">설정</h3>
        <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
      </div>
      <div class="settings-tabs" id="settings-tabs">
        <button class="settings-tab" data-tab="register">학생 일괄등록</button>
        <button class="settings-tab" data-tab="manage">학생 관리</button>
        <button class="settings-tab" data-tab="ai">AI 키 설정</button>
      </div>
      <div id="settings-body" class="mt-4 min-h-[220px]"></div>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);

    const tabsEl = box.querySelector('#settings-tabs');
    const bodyEl = box.querySelector('#settings-body');
    tabsEl.addEventListener('click', (e) => {
      const t = e.target.closest('.settings-tab');
      if (!t) return;
      selectTab(t.dataset.tab);
    });
    function selectTab(name) {
      tabsEl.querySelectorAll('.settings-tab').forEach((t) =>
        t.classList.toggle('active', t.dataset.tab === name));
      if (name === 'register') renderRegisterTab(bodyEl);
      else if (name === 'manage') renderManageTab(bodyEl);
      else renderAiTab(bodyEl);
    }
    selectTab(tab || 'register');
  }

  /* ── 탭1: 학생 일괄등록 ── */
  function renderRegisterTab(body) {
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">
        엑셀 양식(<b>학년 · 반 · 번호 · 이름</b>)을 업로드하면 학생 계정이 일괄 생성됩니다.<br>
        아이디 = 학년반번호(예: 1학년 7반 1번 → <b>10701</b>) · 초기 비밀번호 = 아이디
      </p>
      <div class="flex flex-wrap gap-2 mb-3">
        <button id="dl-template" class="btn-ghost">📄 엑셀 양식 다운로드</button>
        <label class="btn-primary cursor-pointer">
          📤 엑셀 업로드
          <input id="xlsx-file" type="file" accept=".xlsx,.xls,.csv" class="hidden">
        </label>
      </div>
      <div id="register-result" class="text-sm"></div>
    `;
    body.querySelector('#dl-template').addEventListener('click', downloadTemplate);
    body.querySelector('#xlsx-file').addEventListener('change', (e) =>
      handleXlsxUpload(e.target.files[0], body.querySelector('#register-result')));
  }

  function downloadTemplate() {
    const aoa = [
      ['학년', '반', '번호', '이름'],
      [1, 7, 1, ''],
      [1, 7, 2, ''],
      [1, 7, 3, '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '학생명단');
    XLSX.writeFile(wb, '학생등록_양식.xlsx');
  }

  async function handleXlsxUpload(file, resultEl) {
    if (!file) return;
    resultEl.innerHTML = '<span class="text-slate-400">처리 중…</span>';
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' });

      // 헤더 유연 매핑 (학년/반/번호/이름)
      const rows = json.map((r) => ({
        grade:     r['학년'] ?? r['grade'],
        classNo:   r['반']   ?? r['class'] ?? r['반번호'],
        studentNo: r['번호'] ?? r['no'] ?? r['number'],
        name:      r['이름'] ?? r['name'] ?? ''
      })).filter((r) => r.grade !== '' && r.classNo !== '' && r.studentNo !== '');

      if (!rows.length) { resultEl.innerHTML = '<span class="text-red-500">유효한 데이터가 없습니다. 양식을 확인하세요.</span>'; return; }

      const res = await Auth.registerStudents(rows);
      resultEl.innerHTML = `
        <div class="rounded-lg bg-slate-50 border border-slate-200 p-3">
          ✅ 등록 <b class="text-brand">${res.added}</b>명 ·
          중복건너뜀 <b>${res.skipped}</b>명
          ${res.errors.length ? `· 오류 <b class="text-red-500">${res.errors.length}</b>건` : ''}
          ${res.errors.length ? `<ul class="mt-2 text-xs text-red-500 list-disc pl-5">${res.errors.map((e) => `<li>${e}</li>`).join('')}</ul>` : ''}
        </div>`;
    } catch (ex) {
      console.error(ex);
      resultEl.innerHTML = `<span class="text-red-500">파일 처리 실패: ${ex.message}</span>`;
    }
  }

  /* ── 탭2: 학생 관리 (즉시 등록 / 목록 / 이름수정 / PW초기화 / 삭제) ── */
  async function renderManageTab(body) {
    body.innerHTML = '<p class="text-slate-400 text-sm">불러오는 중…</p>';
    const students = await Auth.listStudents();

    const addForm = `
      <form id="add-student-form" class="add-student" autocomplete="off">
        <div class="add-student-row">
          <input id="as-grade" class="form-input" inputmode="numeric" placeholder="학년" required>
          <input id="as-class" class="form-input" inputmode="numeric" placeholder="반" required>
          <input id="as-no" class="form-input" inputmode="numeric" placeholder="번호" required>
          <input id="as-name" class="form-input" placeholder="이름">
          <button type="submit" class="btn-primary whitespace-nowrap">＋ 등록</button>
        </div>
        <p class="text-xs text-slate-400 mt-1">아이디=학년반번호(예: 1학년 7반 1번 → 10701) · 초기 비밀번호=아이디</p>
        <p id="as-msg" class="text-sm min-h-[1.1rem] mt-1"></p>
      </form>`;

    const listHtml = !students.length
      ? '<p class="text-slate-400 text-sm py-6 text-center">아직 등록된 학생이 없습니다. 위에서 한 명씩 추가하거나 ‘학생 일괄등록’ 탭을 이용하세요.</p>'
      : `
        <div class="text-xs text-slate-500 mb-2">총 ${students.length}명</div>
        <div class="student-list">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-slate-400 border-b">
                <th class="py-2">아이디</th><th>이름</th><th>반</th><th class="text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              ${students.map((s) => `
                <tr class="border-b border-slate-100" data-uid="${s.uid}">
                  <td class="py-2 font-mono">${s.loginId}</td>
                  <td>${s.name ? s.name : '<span class="text-amber-600">이름없음</span>'} ${s.mustChangePw ? '<span class="badge-warn">초기PW</span>' : ''}</td>
                  <td>${s.grade}-${s.classNo}</td>
                  <td class="text-right whitespace-nowrap">
                    <button class="btn-mini edit-name">이름수정</button>
                    <button class="btn-mini reset-pw">PW초기화</button>
                    <button class="btn-mini del-student text-red-500">삭제</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

    body.innerHTML = addForm + listHtml;

    // 단건 등록
    const form = body.querySelector('#add-student-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = body.querySelector('#as-msg');
      try {
        const loginId = await Auth.addStudent({
          grade: body.querySelector('#as-grade').value,
          classNo: body.querySelector('#as-class').value,
          studentNo: body.querySelector('#as-no').value,
          name: body.querySelector('#as-name').value
        });
        msg.className = 'text-sm text-green-600 mt-1';
        msg.textContent = `✅ 등록되었습니다 (아이디: ${loginId}).`;
        renderManageTab(body);
      } catch (ex) {
        msg.className = 'text-sm text-red-500 mt-1';
        msg.textContent = ex.message;
      }
    });

    body.querySelectorAll('.edit-name').forEach((b) =>
      b.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr');
        const cur = tr.querySelector('td:nth-child(2)').textContent.replace('초기PW', '').trim();
        const name = prompt('학생 이름을 입력하세요.', cur === '이름없음' ? '' : cur);
        if (name === null) return;
        await Auth.setStudentName(tr.dataset.uid, name);
        renderManageTab(body);
      }));
    body.querySelectorAll('.reset-pw').forEach((b) =>
      b.addEventListener('click', async (e) => {
        const uid = e.target.closest('tr').dataset.uid;
        await Auth.resetStudentPassword(uid);
        alert('비밀번호가 아이디로 초기화되었습니다.');
        renderManageTab(body);
      }));
    body.querySelectorAll('.del-student').forEach((b) =>
      b.addEventListener('click', async (e) => {
        const uid = e.target.closest('tr').dataset.uid;
        if (!confirm('이 학생 계정을 삭제할까요?')) return;
        await Auth.deleteStudent(uid);
        renderManageTab(body);
      }));
  }

  /* ── 탭3: AI(Claude) 키 설정 — 교사 계정에 저장, 소스 미포함 ── */
  async function renderAiTab(body) {
    const key = await Auth.getApiKey();
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">
        Claude API 키는 <b>소스에 포함되지 않으며</b> 교사 계정에만 저장됩니다.
        AI 챗봇·서술형 채점·사진 분석 등에 사용됩니다.
      </p>
      <label class="form-label">Claude API Key</label>
      <input id="api-key" type="password" class="form-input" placeholder="sk-ant-..." value="${key ? key.replace(/./g, '•') : ''}">
      <p class="text-xs text-slate-400 mt-1">${key ? '저장된 키가 있습니다. 변경하려면 새로 입력하세요.' : '아직 등록된 키가 없습니다.'}</p>
      <div class="flex justify-end mt-4">
        <button id="save-key" class="btn-primary">저장</button>
      </div>
      <p id="api-msg" class="text-sm text-green-600 text-right mt-2"></p>
    `;
    const input = body.querySelector('#api-key');
    let touched = false;
    input.addEventListener('input', () => { touched = true; });
    body.querySelector('#save-key').addEventListener('click', async () => {
      if (!touched) { body.querySelector('#api-msg').textContent = '변경된 내용이 없습니다.'; return; }
      await Auth.setApiKey(input.value);
      body.querySelector('#api-msg').textContent = '✅ 저장되었습니다.';
      touched = false;
    });
  }

  /* ============================================================
     관리자 모달 (교사 승인 / 복수 관리자 지정)
  ============================================================ */
  adminBtn.addEventListener('click', () => openAdminModal('pending'));

  function openAdminModal(tab) {
    const box = openModal(`
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-slate-800">관리자</h3>
        <button class="modal-close text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
      </div>
      <div class="settings-tabs" id="admin-tabs">
        <button class="settings-tab" data-tab="pending">가입 승인 <span id="pending-count" class="badge-warn"></span></button>
        <button class="settings-tab" data-tab="manage">교사 · 관리자 관리</button>
      </div>
      <div id="admin-body" class="mt-4 min-h-[220px]"></div>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);
    const tabsEl = box.querySelector('#admin-tabs');
    const bodyEl = box.querySelector('#admin-body');
    tabsEl.addEventListener('click', (e) => {
      const t = e.target.closest('.settings-tab');
      if (t) selectTab(t.dataset.tab);
    });
    function selectTab(name) {
      tabsEl.querySelectorAll('.settings-tab').forEach((t) =>
        t.classList.toggle('active', t.dataset.tab === name));
      if (name === 'pending') renderPendingTab(bodyEl);
      else renderTeacherAdminTab(bodyEl);
    }
    selectTab(tab || 'pending');
  }

  /* ── 가입 승인 대기 목록 ── */
  async function renderPendingTab(body) {
    body.innerHTML = '<p class="text-slate-400 text-sm">불러오는 중…</p>';
    const teachers = await Auth.listTeachers();
    const pending = teachers.filter((t) => t.status === 'pending');
    // 탭 배지 갱신
    const badge = document.getElementById('pending-count');
    if (badge) badge.textContent = pending.length ? pending.length : '';

    if (!pending.length) {
      body.innerHTML = '<p class="text-slate-400 text-sm py-8 text-center">승인 대기 중인 교사가 없습니다.</p>';
      return;
    }
    body.innerHTML = `
      <div class="student-list">
        ${pending.map((t) => `
          <div class="flex items-center justify-between py-2 border-b border-slate-100" data-uid="${t.uid}">
            <div>
              <p class="font-semibold text-slate-700">${t.name || '-'}</p>
              <p class="text-xs text-slate-400 font-mono">${t.loginId}</p>
            </div>
            <div class="whitespace-nowrap">
              <button class="btn-mini approve text-green-600">승인</button>
              <button class="btn-mini reject text-red-500">거절</button>
            </div>
          </div>`).join('')}
      </div>`;
    body.querySelectorAll('.approve').forEach((b) =>
      b.addEventListener('click', async (e) => {
        await Auth.approveTeacher(e.target.closest('[data-uid]').dataset.uid);
        renderPendingTab(body);
      }));
    body.querySelectorAll('.reject').forEach((b) =>
      b.addEventListener('click', async (e) => {
        if (!confirm('이 가입 신청을 거절할까요?')) return;
        await Auth.rejectTeacher(e.target.closest('[data-uid]').dataset.uid);
        renderPendingTab(body);
      }));
  }

  /* ── 교사·관리자 관리 (복수 관리자 지정) ── */
  async function renderTeacherAdminTab(body) {
    body.innerHTML = '<p class="text-slate-400 text-sm">불러오는 중…</p>';
    const teachers = (await Auth.listTeachers()).filter((t) => t.status !== 'rejected');
    if (!teachers.length) {
      body.innerHTML = '<p class="text-slate-400 text-sm py-8 text-center">등록된 교사가 없습니다.</p>';
      return;
    }
    const statusBadge = (s) =>
      s === 'pending' ? '<span class="badge-warn">승인대기</span>' : '';
    body.innerHTML = `
      <p class="text-xs text-slate-500 mb-2">‘관리자’를 체크하면 공동 관리자로 지정됩니다. (자동 승인)</p>
      <div class="student-list">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-slate-400 border-b">
              <th class="py-2">이름</th><th>아이디</th><th class="text-center">관리자</th><th class="text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            ${teachers.map((t) => `
              <tr class="border-b border-slate-100" data-uid="${t.uid}">
                <td class="py-2">${t.name || '-'} ${t.isRootAdmin ? '<span class="badge-root">기본</span>' : ''} ${statusBadge(t.status)}</td>
                <td class="font-mono">${t.loginId}</td>
                <td class="text-center">
                  <input type="checkbox" class="chk-admin w-4 h-4 align-middle"
                    ${t.isAdmin ? 'checked' : ''} ${t.isRootAdmin ? 'disabled' : ''}>
                </td>
                <td class="text-right whitespace-nowrap">
                  ${t.isRootAdmin ? '<span class="text-xs text-slate-300">🔒</span>'
                    : '<button class="btn-mini del-teacher text-red-500">삭제</button>'}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    body.querySelectorAll('.chk-admin').forEach((c) =>
      c.addEventListener('change', async (e) => {
        const uid = e.target.closest('tr').dataset.uid;
        try {
          await Auth.setTeacherAdmin(uid, e.target.checked);
          renderTeacherAdminTab(body);
        } catch (ex) { alert(ex.message); e.target.checked = !e.target.checked; }
      }));
    body.querySelectorAll('.del-teacher').forEach((b) =>
      b.addEventListener('click', async (e) => {
        if (!confirm('이 교직원 계정을 삭제할까요?')) return;
        await Auth.deleteTeacher(e.target.closest('tr').dataset.uid);
        renderTeacherAdminTab(body);
      }));
  }

  /* 전역 노출 */
  window.App = { navigate, VIEWS, start, showLogin };

  console.log('[app] STEP 05 로드 완료 — 메신저/스케줄러/대시보드 라우팅 연결됨');
})();
