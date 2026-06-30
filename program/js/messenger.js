/* ============================================================
   messenger.js — 메신저 (STEP 05)
   ------------------------------------------------------------
   ▶ 교사 ↔ 학생 실시간 1:1 채팅 (Firebase onValue 실시간 동기화)
   ▶ 사진 전송: 갤러리 업로드 + 카메라 촬영(getUserMedia)
       - Firebase Storage 연결 시 업로드 후 URL 저장
       - 미연결(데모)은 캔버스로 리사이즈한 데이터URL 인라인 저장
   ▶ 읽음 표시: 상대가 대화방을 열면 read=true → 보낸 쪽에 '읽음' 표시
   ▶ 알림 배지: 사이드바 '메신저' 메뉴에 안읽은 메시지 수 실시간 표시
   ▶ 푸시 알림(Level A): 앱이 켜져 있는 동안 새 메시지를 OS 알림으로 표시
       - Web Notifications API(페이지 컨텍스트). 서버·서비스워커 불필요
       - HTTPS/localhost 에서만 동작(file:// 차단), Firebase 연결 시 실시간 발화
       - 앱을 완전히 닫은 상태의 푸시는 FCM+Cloud Functions(Blaze) 필요 → 향후 확장
   ▶ 교사 전용: 학생 질문을 '유의미 질문'으로 표시(🔖) — 학생에게는 비공개

   ▶ Firebase 구조
     /messages/{threadId}/{messageId}
       id, from, to, text, image, kind('text'|'image'), createdAt, read, flagged
     /inbox/{userId}/{threadId}
       withUid, lastText, lastAt, lastFrom, unread

     threadId = `${teacherUid}__${studentUid}`  (역할과 무관하게 항상 동일)

   ※ Firebase 연결 시 onValue 로 실시간 동기화, 미연결(데모)은 localStorage.
   ※ 블라인드 규칙: 학교명·성명·지역명을 코드에 포함하지 않습니다.
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     0) 데이터 계층 (Firebase / localStorage 공통) — 다른 모듈과 동일 패턴
  ============================================================ */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);
  const useStorage = () => !!(window.FB && window.FB.ready && window.FB.storage);
  const genId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
    // 실시간 구독 (FB 전용) → 해제 함수 반환 / 데모는 null
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

  function timeShort(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date();
    const sameDay = d.toDateString() === n.toDateString();
    if (sameDay) {
      const h = d.getHours(), m = pad2(d.getMinutes());
      const ap = h < 12 ? '오전' : '오후';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${ap} ${h12}:${m}`;
    }
    const days = Math.floor((n.setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 1) return '어제';
    if (days < 7) return `${days}일 전`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function dayLabel(ts) {
    const d = new Date(ts);
    const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${wd})`;
  }
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // 항상 동일한 threadId 생성 (역할 기준 정렬)
  function threadIdFor(me, contactUid, contactRole) {
    const meIsTeacher = me.role === 'teacher';
    const teacherUid = meIsTeacher ? me.uid : contactUid;
    const studentUid = meIsTeacher ? contactUid : me.uid;
    return `${teacherUid}__${studentUid}`;
  }

  /* ============================================================
     2) 모듈 상태
  ============================================================ */
  let user = null;
  let contacts = [];          // 대화 상대 목록 (역할 반대편)
  let inbox = {};             // 내 inbox: { threadId: {withUid,lastText,lastAt,lastFrom,unread} }
  let prevInbox = {};         // 직전 inbox 스냅샷 (푸시 알림 델타 비교용)
  let messages = {};          // 현재 열린 대화방 메시지
  let activeContact = null;   // 현재 대화 상대
  let pendingOpenUid = null;  // 알림 클릭 등으로 열어야 할 상대 uid
  let showFlaggedOnly = false;// 교사: 유의미 질문만 보기
  let searchTerm = '';

  let rootEl = null;          // 메신저 화면 컨테이너 (열려 있을 때만)
  let inboxUnsub = null;      // inbox 실시간 구독 해제
  let threadUnsub = null;     // 현재 대화방 실시간 구독 해제
  let camStream = null;       // 카메라 스트림

  /* ============================================================
     3) 알림(배지) — 로그인 직후 app.js 가 호출, 화면과 무관하게 동작
  ============================================================ */
  async function initNotifications(currentUser) {
    teardown();
    user = currentUser;
    try {
      contacts = await Auth.listContacts();
    } catch (e) { contacts = []; }
    await refreshInbox();
    prevInbox = inbox;        // 로그인 시점의 누적분은 알림하지 않음 (기준점)
    updateBadge();
    inboxUnsub = DB.subscribe(`inbox/${user.uid}`, (val) => {
      const next = val || {};
      maybeNotify(prevInbox, next);   // 새 수신 메시지 → OS 알림
      inbox = next;
      prevInbox = next;
      updateBadge();
      if (rootEl) renderContactList();
    });
  }

  // 로그아웃 시 정리
  function teardown() {
    stopCamera();
    if (inboxUnsub) { try { inboxUnsub(); } catch (e) {} inboxUnsub = null; }
    if (threadUnsub) { try { threadUnsub(); } catch (e) {} threadUnsub = null; }
    user = null; contacts = []; inbox = {}; prevInbox = {}; messages = {};
    activeContact = null; pendingOpenUid = null;
    rootEl = null; showFlaggedOnly = false; searchTerm = '';
    updateBadge();
  }

  async function refreshInbox() {
    if (!user) return;
    inbox = (await DB.read(`inbox/${user.uid}`)) || {};
  }

  function totalUnread() {
    return Object.values(inbox).reduce((a, e) => a + (e && e.unread ? e.unread : 0), 0);
  }

  function updateBadge() {
    const el = document.getElementById('msg-badge');
    if (!el) return;
    const n = totalUnread();
    el.textContent = n > 99 ? '99+' : (n || '');
    el.classList.toggle('hidden', !n);
  }

  /* ============================================================
     3-B) 푸시 알림 (Level A — 앱이 켜져 있는 동안 OS 알림)
     ------------------------------------------------------------
     ※ 페이지 컨텍스트의 Web Notifications API만 사용 (서버·서비스워커 불필요).
       HTTPS 또는 localhost 에서만 동작하며 file:// 에서는 차단됩니다.
     ※ 데모(localStorage) 모드는 실시간 구독이 없어 알림이 발화하지 않습니다.
       Firebase 연결 시에만 의미가 있습니다.
  ============================================================ */
  const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;

  // 권한 상태: 'unsupported' | 'default' | 'granted' | 'denied'
  function notifyState() {
    if (!notifySupported()) return 'unsupported';
    return Notification.permission;
  }

  // 사용자 클릭으로만 권한 요청 (자동 프롬프트 금지)
  async function requestNotifyPermission() {
    if (!notifySupported()) { toast('이 브라우저는 알림을 지원하지 않습니다.'); return; }
    if (Notification.permission === 'denied') {
      toast('브라우저 설정에서 이 사이트의 알림을 허용해 주세요.');
      return;
    }
    try {
      const p = await Notification.requestPermission();
      if (p === 'granted') toast('🔔 알림이 켜졌습니다.');
      else if (p === 'denied') toast('알림이 차단되었습니다. 브라우저 설정에서 허용할 수 있어요.');
    } catch (e) { console.warn('[messenger] 알림 권한 요청 실패', e); }
    renderBell();
  }

  // inbox 델타 비교 → 새로 수신한 스레드에 대해 알림
  function maybeNotify(prev, next) {
    if (notifyState() !== 'granted' || !user) return;
    Object.keys(next).forEach((tid) => {
      const cur = next[tid] || {};
      const old = prev[tid] || {};
      const incoming = (cur.unread || 0) > (old.unread || 0);   // 안읽음 증가 = 새 수신
      const fromOther = cur.lastFrom && cur.lastFrom !== user.uid;
      if (!incoming || !fromOther) return;

      // 지금 그 대화를 화면에서 보고 있으면 알림하지 않음
      const viewingThis = activeContact && activeContact.uid === cur.withUid &&
                          rootEl && rootEl.querySelector('#msg-stream') && !document.hidden;
      if (viewingThis) return;

      const contact = contacts.find((c) => c.uid === cur.withUid);
      const title = contact ? (contact.name || contact.loginId) : '새 메시지';
      const body = cur.lastText || '새 메시지가 도착했습니다.';
      try {
        const n = new Notification(title, { body, tag: tid });
        n.onclick = () => {
          window.focus();
          openFromNotification(cur.withUid);
          n.close();
        };
      } catch (e) { console.warn('[messenger] 알림 표시 실패', e); }
    });
  }

  // 알림 클릭 → 메신저로 이동 후 해당 대화 열기
  function openFromNotification(uid) {
    pendingOpenUid = uid;
    if (rootEl && rootEl.querySelector('#msg-contacts')) {
      // 이미 메신저 화면이면 바로 열기
      const c = contacts.find((x) => x.uid === uid);
      if (c) { pendingOpenUid = null; openThread(c); }
    } else if (window.App && typeof App.navigate === 'function') {
      App.navigate('messenger'); // render() 말미에서 pendingOpenUid 처리
    }
  }

  // 알림 권한 토글(벨) 버튼 갱신
  function renderBell() {
    if (!rootEl) return;
    const bell = rootEl.querySelector('#msg-bell');
    if (!bell) return;
    const st = notifyState();
    const cfg = {
      unsupported: { txt: '🔕 알림 미지원', cls: '', title: '이 브라우저는 알림을 지원하지 않습니다' },
      default:     { txt: '🔔 알림 켜기',  cls: '',        title: '새 메시지 OS 알림 받기' },
      granted:     { txt: '🔔 알림 켜짐',  cls: 'on',      title: '알림이 켜져 있습니다' },
      denied:      { txt: '🔕 알림 차단됨', cls: 'denied', title: '브라우저 설정에서 허용 필요' }
    }[st];
    bell.textContent = cfg.txt;
    bell.title = cfg.title;
    bell.className = `msg-bell ${cfg.cls}`;
    bell.disabled = st === 'unsupported';
  }

  /* ============================================================
     4) 진입점 — 라우터(app.js)가 호출
  ============================================================ */
  async function render(container, currentUser) {
    // 알림 구독이 아직 없으면(직접 진입 등) 초기화
    if (!user) await initNotifications(currentUser);
    else { user = currentUser; await refreshInbox(); }

    rootEl = container;
    showFlaggedOnly = false;
    if (threadUnsub) { try { threadUnsub(); } catch (e) {} threadUnsub = null; }

    // 상대 목록 최신화 (학생 추가/교사 승인 반영)
    try { contacts = await Auth.listContacts(); } catch (e) {}

    container.innerHTML = `
      <div class="msg-wrap card">
        <!-- 대화 상대 목록 -->
        <aside class="msg-side">
          <div class="msg-side-head">
            <div class="msg-side-title">
              <h3 class="dash-title" style="margin:0">💬 대화 상대</h3>
              <button id="msg-bell" class="msg-bell" type="button">🔔 알림 켜기</button>
            </div>
            <input id="msg-search" class="form-input msg-search"
                   placeholder="${user.role === 'teacher' ? '학생 이름·번호 검색' : '선생님 검색'}">
          </div>
          <div id="msg-contacts" class="msg-contacts"></div>
        </aside>

        <!-- 대화창 -->
        <section id="msg-main" class="msg-main">
          <div class="msg-empty">
            <div class="msg-empty-icon">💬</div>
            <p>왼쪽에서 대화 상대를 선택하세요.</p>
            <p class="msg-empty-sub">${user.role === 'teacher'
              ? '학생과 1:1로 대화하고 사진을 주고받을 수 있어요.'
              : '선생님께 질문하고 사진을 보낼 수 있어요.'}</p>
          </div>
        </section>
      </div>
    `;

    const search = container.querySelector('#msg-search');
    search.addEventListener('input', () => { searchTerm = search.value.trim(); renderContactList(); });

    // 알림 권한 토글(벨)
    const bell = container.querySelector('#msg-bell');
    bell.addEventListener('click', requestNotifyPermission);
    renderBell();

    renderContactList();

    // 알림 클릭으로 지정된 상대가 있으면 우선 열기
    if (pendingOpenUid) {
      const target = contacts.find((c) => c.uid === pendingOpenUid);
      pendingOpenUid = null;
      if (target) { openThread(target); return; }
    }

    // 직전에 보던 상대가 있으면 자동 재개
    if (activeContact && contacts.some((c) => c.uid === activeContact.uid)) {
      openThread(activeContact);
    } else {
      activeContact = null;
    }
  }

  /* ============================================================
     5) 대화 상대 목록
  ============================================================ */
  function renderContactList() {
    if (!rootEl) return;
    const listEl = rootEl.querySelector('#msg-contacts');
    if (!listEl) return;

    const term = searchTerm.toLowerCase();
    const filtered = contacts.filter((c) => {
      if (!term) return true;
      return (c.name || '').toLowerCase().includes(term) ||
             (c.loginId || '').toLowerCase().includes(term);
    });

    if (!contacts.length) {
      listEl.innerHTML = `<div class="msg-side-empty">${user.role === 'teacher'
        ? '등록된 학생이 없습니다.<br>⚙️ 설정에서 학생을 먼저 등록하세요.'
        : '대화할 수 있는 선생님이 아직 없습니다.'}</div>`;
      return;
    }
    if (!filtered.length) {
      listEl.innerHTML = `<div class="msg-side-empty">검색 결과가 없습니다.</div>`;
      return;
    }

    // inbox 의 lastAt 기준 최근 대화가 위로, 대화 없는 상대는 이름순(원래 정렬) 아래로
    const withMeta = filtered.map((c) => {
      const tid = threadIdFor(user, c.uid, c.role);
      return { c, meta: inbox[tid] || null };
    });
    withMeta.sort((a, b) => (b.meta?.lastAt || 0) - (a.meta?.lastAt || 0));

    listEl.innerHTML = withMeta.map(({ c, meta }) => {
      const unread = meta && meta.unread ? meta.unread : 0;
      const preview = meta ? meta.lastText : (user.role === 'teacher' ? '대화를 시작해 보세요' : '질문을 남겨보세요');
      const sub = user.role === 'teacher' ? `${esc(classLabel(c.grade, c.classNo))} · ${esc(c.loginId)}` : '선생님';
      const active = activeContact && activeContact.uid === c.uid;
      return `
        <button class="msg-contact ${active ? 'active' : ''} ${unread ? 'has-unread' : ''}" data-uid="${esc(c.uid)}">
          <span class="msg-avatar">${esc((c.name || c.loginId || '?').charAt(0))}</span>
          <span class="msg-contact-body">
            <span class="msg-contact-top">
              <span class="msg-contact-name">${esc(c.name || c.loginId)}</span>
              ${meta && meta.lastAt ? `<span class="msg-contact-time">${esc(timeShort(meta.lastAt))}</span>` : ''}
            </span>
            <span class="msg-contact-bottom">
              <span class="msg-contact-preview">${esc(preview)}</span>
              ${unread ? `<span class="msg-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
            </span>
            <span class="msg-contact-sub">${sub}</span>
          </span>
        </button>`;
    }).join('');

    listEl.querySelectorAll('.msg-contact').forEach((b) =>
      b.addEventListener('click', () => {
        const uid = b.dataset.uid;
        const c = contacts.find((x) => x.uid === uid);
        if (c) openThread(c);
      }));
  }

  /* ============================================================
     6) 대화방 열기
  ============================================================ */
  async function openThread(contact) {
    activeContact = contact;
    showFlaggedOnly = false;
    const wrap = rootEl && rootEl.querySelector('.msg-wrap');
    if (wrap) wrap.classList.add('chatting'); // 모바일: 대화창 단독 표시
    renderContactList();          // 활성 표시 갱신
    renderChatShell(contact);

    const tid = threadIdFor(user, contact.uid, contact.role);
    await loadMessages(tid);
    await markRead(tid);

    // 실시간 구독 (FB)
    if (threadUnsub) { try { threadUnsub(); } catch (e) {} threadUnsub = null; }
    threadUnsub = DB.subscribe(`messages/${tid}`, (val) => {
      messages = val || {};
      // 메신저 화면을 떠났거나 다른 대화방으로 이동했으면 자동 읽음 처리하지 않음
      // (그래야 안읽음 배지가 정상 동작)
      if (!isViewingThread(contact)) return;
      renderStream();
      markRead(tid);
    });
  }

  // 현재 이 대화방을 화면에 띄우고 있는가?
  function isViewingThread(contact) {
    return !!(rootEl && rootEl.querySelector('#msg-stream') &&
              activeContact && activeContact.uid === contact.uid);
  }

  function renderChatShell(contact) {
    if (!rootEl) return;
    const main = rootEl.querySelector('#msg-main');
    const isTeacher = user.role === 'teacher';
    const sub = isTeacher ? `${esc(classLabel(contact.grade, contact.classNo))} · ${esc(contact.loginId)}` : '선생님';

    main.innerHTML = `
      <header class="msg-chat-head">
        <button class="msg-back" title="목록">←</button>
        <span class="msg-avatar lg">${esc((contact.name || contact.loginId || '?').charAt(0))}</span>
        <div class="msg-chat-who">
          <p class="msg-chat-name">${esc(contact.name || contact.loginId)}</p>
          <p class="msg-chat-sub">${sub}</p>
        </div>
        ${isTeacher ? `
          <button id="msg-flag-filter" class="msg-flag-filter" title="유의미 질문만 보기">
            🔖 <span id="msg-flag-count">0</span>
          </button>` : ''}
      </header>

      <div id="msg-stream" class="msg-stream"></div>

      <div class="msg-composer">
        <input id="msg-photo-input" type="file" accept="image/*" class="hidden">
        <button id="msg-photo" class="msg-tool" title="사진 보내기">🖼️</button>
        <button id="msg-cam" class="msg-tool" title="카메라로 촬영">📷</button>
        <textarea id="msg-input" class="msg-text" rows="1" placeholder="메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"></textarea>
        <button id="msg-send" class="msg-send" title="전송">전송</button>
      </div>
    `;

    main.querySelector('.msg-back').addEventListener('click', () => {
      activeContact = null;
      if (threadUnsub) { try { threadUnsub(); } catch (e) {} threadUnsub = null; }
      render(rootEl, user); // 목록 화면으로 (모바일에서 유용)
    });

    const input = main.querySelector('#msg-input');
    const sendBtn = main.querySelector('#msg-send');
    const doSend = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      autoGrow(input);
      await sendMessage(text, null);
    };
    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    input.addEventListener('input', () => autoGrow(input));

    // 사진(갤러리)
    const fileInput = main.querySelector('#msg-photo-input');
    main.querySelector('#msg-photo').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await handlePhotoFile(file);
    });

    // 카메라
    main.querySelector('#msg-cam').addEventListener('click', openCameraModal);

    // 교사: 유의미 질문 필터
    if (isTeacher) {
      main.querySelector('#msg-flag-filter').addEventListener('click', () => {
        showFlaggedOnly = !showFlaggedOnly;
        renderStream();
      });
    }
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  /* ============================================================
     7) 메시지 로드 / 렌더
  ============================================================ */
  async function loadMessages(tid) {
    messages = (await DB.read(`messages/${tid}`)) || {};
    renderStream();
  }

  function renderStream() {
    if (!rootEl) return;
    const streamEl = rootEl.querySelector('#msg-stream');
    if (!streamEl) return;
    const isTeacher = user.role === 'teacher';

    let list = Object.values(messages).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    // 교사 유의미 질문 카운트/필터
    const flaggedCount = list.filter((m) => m.flagged).length;
    const fc = rootEl.querySelector('#msg-flag-count');
    if (fc) fc.textContent = flaggedCount;
    const filterBtn = rootEl.querySelector('#msg-flag-filter');
    if (filterBtn) filterBtn.classList.toggle('active', showFlaggedOnly);
    if (isTeacher && showFlaggedOnly) list = list.filter((m) => m.flagged);

    // 위험 알림(kind:'alert')은 교사 전용 — 학생에게는 비표시
    if (!isTeacher) list = list.filter((m) => m.kind !== 'alert');

    if (!list.length) {
      streamEl.innerHTML = `<div class="msg-stream-empty">${showFlaggedOnly
        ? '표시한 유의미 질문이 없습니다.'
        : '아직 주고받은 메시지가 없어요.<br>첫 메시지를 보내보세요!'}</div>`;
      return;
    }

    let lastDay = '';
    streamEl.innerHTML = list.map((m) => {
      const mine = m.from === user.uid;
      let dayDivider = '';
      const dk = dayKey(m.createdAt);
      if (dk !== lastDay) { lastDay = dk; dayDivider = `<div class="msg-day"><span>${esc(dayLabel(m.createdAt))}</span></div>`; }

      // 위험 알림 (자기성찰일지 위기 신호) — 교사 전용 빨간 경고
      if (m.kind === 'alert') {
        return `
        ${dayDivider}
        <div class="msg-row theirs" data-id="${esc(m.id)}">
          <div class="msg-bubble alert"><span class="msg-bubble-text">${esc(m.text).replace(/\n/g, '<br>')}</span></div>
          <div class="msg-meta"><span class="msg-time">${esc(timeShort(m.createdAt))}</span></div>
        </div>`;
      }

      // 유의미 질문 표시: 교사에게만 보임 (학생 비공개)
      const showFlag = isTeacher && !mine; // 학생이 보낸 메시지에만 표시 가능
      const flaggedCls = (isTeacher && m.flagged) ? 'flagged' : '';

      const body = m.kind === 'image' && m.image
        ? `<img src="${esc(m.image)}" class="msg-img" alt="사진" data-img="${esc(m.image)}">`
        : `<span class="msg-bubble-text">${esc(m.text).replace(/\n/g, '<br>')}</span>`;

      const meta = `
        <span class="msg-time">${esc(timeShort(m.createdAt))}</span>
        ${mine && m.read ? '<span class="msg-read">읽음</span>' : ''}`;

      return `
        ${dayDivider}
        <div class="msg-row ${mine ? 'mine' : 'theirs'}" data-id="${esc(m.id)}">
          <div class="msg-bubble ${flaggedCls}">
            ${body}
            ${showFlag ? `<button class="msg-flag-btn ${m.flagged ? 'on' : ''}" title="유의미 질문 표시 (학생 비공개)">${m.flagged ? '🔖' : '🏷️'}</button>` : ''}
          </div>
          <div class="msg-meta">${meta}</div>
        </div>`;
    }).join('');

    // 이미지 확대
    streamEl.querySelectorAll('.msg-img').forEach((img) =>
      img.addEventListener('click', () => openImageViewer(img.dataset.img)));

    // 교사: 유의미 질문 토글
    if (isTeacher) {
      streamEl.querySelectorAll('.msg-flag-btn').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = b.closest('.msg-row').dataset.id;
          toggleFlag(id);
        }));
    }

    // 맨 아래로 스크롤
    streamEl.scrollTop = streamEl.scrollHeight;
  }

  /* ============================================================
     8) 전송 / 읽음 / 유의미 표시
  ============================================================ */
  async function sendMessage(text, image) {
    if (!activeContact) return;
    const contact = activeContact;
    const tid = threadIdFor(user, contact.uid, contact.role);
    const id = genId();
    const msg = {
      id, from: user.uid, to: contact.uid,
      text: text || '', kind: image ? 'image' : 'text',
      createdAt: Date.now(), read: false, flagged: false
    };
    if (image) msg.image = image;

    try {
      await DB.write(`messages/${tid}/${id}`, msg);
      await bumpInbox(tid, contact, msg);
    } catch (ex) {
      console.error('[messenger] 전송 실패', ex);
      toast('전송에 실패했습니다: ' + ex.message);
      return;
    }

    // 데모(미연결)는 구독이 없으므로 수동 갱신
    if (!useFB()) {
      await loadMessages(tid);
      await refreshInbox();
      updateBadge();
      renderContactList();
    }
  }

  // 양쪽 inbox 요약 갱신 (보낸 사람 unread=0, 받는 사람 unread+1)
  async function bumpInbox(tid, contact, msg) {
    const preview = msg.kind === 'image' ? '📷 사진' : msg.text;
    // 내 inbox
    await DB.write(`inbox/${user.uid}/${tid}`, {
      withUid: contact.uid, lastText: preview, lastAt: msg.createdAt, lastFrom: user.uid, unread: 0
    });
    // 상대 inbox (안읽음 +1)
    const rPath = `inbox/${contact.uid}/${tid}`;
    const cur = (await DB.read(rPath)) || { unread: 0 };
    await DB.write(rPath, {
      withUid: user.uid, lastText: preview, lastAt: msg.createdAt, lastFrom: user.uid,
      unread: (cur.unread || 0) + 1
    });
  }

  /* ── 위험 알림 전송 (외부 모듈용: 자기성찰일지 위기 신호 등) ──
     현재 사용자(학생)→교사 스레드에 kind:'alert' 메시지 기록 + 교사 inbox 만 증가.
     학생 본인 inbox/스트림에는 노출하지 않음(renderStream에서 학생은 alert 필터). */
  async function sendAlertTo(toUid, text) {
    if (!user || !toUid) return false;
    const tid = threadIdFor(user, toUid);
    const id = genId();
    const msg = {
      id, from: user.uid, to: toUid,
      text: text || '', kind: 'alert',
      createdAt: Date.now(), read: false, flagged: false
    };
    try {
      await DB.write(`messages/${tid}/${id}`, msg);
      // 교사 inbox 만 갱신(학생 본인 inbox 미변경 → 학생에게 비노출)
      const rPath = `inbox/${toUid}/${tid}`;
      const cur = (await DB.read(rPath)) || { unread: 0 };
      await DB.write(rPath, {
        withUid: user.uid, lastText: msg.text, lastAt: msg.createdAt, lastFrom: user.uid,
        unread: (cur.unread || 0) + 1
      });
      return true;
    } catch (ex) { console.error('[messenger] 위험 알림 전송 실패', ex); return false; }
  }

  // 대화방 열람 → 내 안읽음 0, 상대가 보낸 메시지 read=true
  async function markRead(tid) {
    // inbox unread 초기화
    const path = `inbox/${user.uid}/${tid}`;
    const cur = await DB.read(path);
    if (cur && cur.unread) { cur.unread = 0; await DB.write(path, cur); if (!useFB()) updateBadge(); }

    // 상대가 보낸 안읽은 메시지 read 처리
    const unreadIncoming = Object.values(messages).filter((m) => m.to === user.uid && !m.read);
    for (const m of unreadIncoming) {
      await DB.write(`messages/${tid}/${m.id}/read`, true);
      if (messages[m.id]) messages[m.id].read = true;
    }
  }

  // 교사: 학생 질문을 유의미 질문으로 표시/해제 (학생에게는 비공개)
  async function toggleFlag(msgId) {
    if (user.role !== 'teacher' || !activeContact) return;
    const m = messages[msgId];
    if (!m) return;
    const tid = threadIdFor(user, activeContact.uid, activeContact.role);
    const next = !m.flagged;
    m.flagged = next;
    await DB.write(`messages/${tid}/${msgId}/flagged`, next);
    renderStream();
  }

  /* ============================================================
     9) 사진 — 리사이즈 후 전송 (Storage 또는 인라인)
  ============================================================ */
  function resizeToDataUrl(source, maxDim, quality) {
    const w0 = source.naturalWidth || source.videoWidth;
    const h0 = source.naturalHeight || source.videoHeight;
    let w = w0, h = h0;
    if (Math.max(w, h) > maxDim) {
      if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
      else { w = Math.round(w * maxDim / h); h = maxDim; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(source, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality || 0.7);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function handlePhotoFile(file) {
    if (!/^image\//.test(file.type)) { toast('이미지 파일만 보낼 수 있어요.'); return; }
    try {
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const img = await loadImage(dataUrl);
      const resized = resizeToDataUrl(img, 1024, 0.7);
      await sendPhoto(resized);
    } catch (ex) {
      console.error(ex);
      toast('사진 처리에 실패했습니다.');
    }
  }

  async function sendPhoto(dataUrl) {
    let stored = dataUrl;
    if (useStorage() && activeContact) {
      try {
        const tid = threadIdFor(user, activeContact.uid, activeContact.role);
        const ref = window.FB.storage.ref(`chat/${tid}/${genId()}.jpg`);
        await ref.putString(dataUrl, 'data_url');
        stored = await ref.getDownloadURL();
      } catch (ex) {
        console.warn('[messenger] Storage 업로드 실패 → 인라인 저장으로 대체', ex);
      }
    }
    await sendMessage('', stored);
  }

  /* ── 카메라 촬영 모달 (getUserMedia) ── */
  async function openCameraModal() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('이 환경에서는 카메라를 사용할 수 없습니다. 사진 보내기(🖼️)를 이용하세요.');
      return;
    }
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-3">📷 카메라</h3>
      <div class="cam-stage"><video id="cam-video" autoplay playsinline></video></div>
      <p id="cam-msg" class="text-sm text-slate-500 min-h-[1.25rem] mt-2"></p>
      <div class="flex gap-2 justify-end mt-2">
        <button type="button" class="btn-ghost modal-close">취소</button>
        <button id="cam-shot" class="btn-primary" disabled>촬영하여 전송</button>
      </div>
    `);
    const video = box.querySelector('#cam-video');
    const shot = box.querySelector('#cam-shot');
    const msg = box.querySelector('#cam-msg');
    box.querySelector('.modal-close').addEventListener('click', () => { stopCamera(); closeModal(); });

    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false
      });
      video.srcObject = camStream;
      shot.disabled = false;
    } catch (ex) {
      console.error(ex);
      msg.textContent = '카메라를 시작할 수 없습니다. 권한을 확인하거나 사진 보내기를 이용하세요.';
      msg.className = 'text-sm text-red-500 mt-2';
      return;
    }

    shot.addEventListener('click', async () => {
      try {
        const dataUrl = resizeToDataUrl(video, 1024, 0.7);
        stopCamera();
        closeModal();
        await sendPhoto(dataUrl);
      } catch (ex) {
        console.error(ex);
        toast('촬영에 실패했습니다.');
      }
    });
  }

  function stopCamera() {
    if (camStream) {
      camStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
      camStream = null;
    }
  }

  /* ── 이미지 확대 보기 ── */
  function openImageViewer(src) {
    const box = openModal(`
      <div class="img-viewer"><img src="${esc(src)}" alt="사진"></div>
      <div class="flex justify-end mt-3">
        <button type="button" class="btn-ghost modal-close">닫기</button>
      </div>
    `);
    box.querySelector('.modal-close').addEventListener('click', closeModal);
  }

  /* ============================================================
     10) 모달 · 토스트 (app.js 와 독립)
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
  window.Messenger = { render, initNotifications, teardown, sendAlertTo };
  console.log('[messenger] STEP 05 로드 완료 — 실시간 채팅/사진/카메라/읽음/배지/푸시알림 준비됨');
})();
