/* ============================================================
   auth.js — 인증 · 권한 · 학생 일괄등록 (STEP 02)
   ------------------------------------------------------------
   ▶ 로그인 분기
     - 교사  : 아이디 + 비밀번호  (기본 데모계정: teacher / teacher123)
     - 학생  : 학년반번호(예 10701) + 비밀번호 (초기 PW = 아이디)
   ▶ 첫 로그인 시 비밀번호 변경 강제
   ▶ 교사: 학생 엑셀 일괄등록 / 비밀번호 초기화 / 삭제
   ▶ Claude API 키: 교사 설정화면 입력 → 교사 계정에 저장 (소스 미포함)

   ※ 데이터 백엔드 추상화
     - Firebase 연결 시 → Realtime Database (/users)
     - 미연결(데모)    → localStorage  ← index.html 직접 실행 검증용
   ※ 데모 비밀번호는 경량 해시로만 저장합니다. 실제 운영 배포 시에는
     Firebase Authentication 정식 사용을 권장합니다(주석으로 명시).
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     0) 유틸
  ============================================================ */
  const pad2 = (n) => String(n).padStart(2, '0');

  // RTDB 키로 안전한 문자열 (. # $ / [ ] 금지문자 치환)
  const sanitize = (s) => String(s).trim().replace(/[.#$/[\]]/g, '_');

  // 데모용 경량 해시 (djb2) — 운영에서는 Firebase Auth 사용 권장
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  // 로그인 네임스페이스: 학생(s_) / 교직원=교사·관리자(t_)
  // ※ 관리자는 role='teacher' + isAdmin=true 로 표현 → 교사와 동일 네임스페이스
  const nsOf = (role) => (role === 'student' ? 's' : 't');
  const makeUid = (role, loginId) => `${nsOf(role)}_${sanitize(loginId)}`;

  /* ============================================================
     1) Store — local / Firebase 공통 데이터 계층
  ============================================================ */
  const LS_DB = 'mathapp.db.v1';        // 사용자 DB (데모)
  const LS_SESSION = 'mathapp.session'; // 현재 로그인 세션 uid

  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);

  function localRead() {
    try { return JSON.parse(localStorage.getItem(LS_DB)) || { users: {} }; }
    catch (e) { return { users: {} }; }
  }
  function localWrite(db) { localStorage.setItem(LS_DB, JSON.stringify(db)); }

  const Store = {
    async getUser(uid) {
      if (useFB()) {
        const snap = await window.FB.db.ref('users/' + uid).once('value');
        return snap.exists() ? snap.val() : null;
      }
      return localRead().users[uid] || null;
    },
    async getAllUsers() {
      if (useFB()) {
        const snap = await window.FB.db.ref('users').once('value');
        return snap.exists() ? Object.values(snap.val()) : [];
      }
      return Object.values(localRead().users);
    },
    async saveUser(user) {
      if (useFB()) {
        await window.FB.db.ref('users/' + user.uid).set(user);
      } else {
        const db = localRead();
        db.users[user.uid] = user;
        localWrite(db);
      }
      return user;
    },
    async deleteUser(uid) {
      if (useFB()) await window.FB.db.ref('users/' + uid).remove();
      else {
        const db = localRead();
        delete db.users[uid];
        localWrite(db);
      }
    }
  };

  /* ============================================================
     2) Auth 본체
  ============================================================ */
  const Auth = {
    user: null,           // 로그인된 사용자(비밀번호 해시 제외 사본)
    onLogin: null,        // 로그인 완료 콜백 (app.js가 주입)
    onLogout: null,

    /* ── 초기화: 기본 관리자/교사 시드 + 세션 복원 ── */
    async init() {
      await seedDefaults();
      const uid = localStorage.getItem(LS_SESSION);
      if (uid) {
        const u = await Store.getUser(uid);
        if (u) this.user = stripPw(u);
      }
      return this.user;
    },

    isLoggedIn() { return !!this.user; },
    isTeacher()  { return this.user && this.user.role === 'teacher'; },
    isStudent()  { return this.user && this.user.role === 'student'; },
    isAdmin()    { return !!(this.user && this.user.isAdmin); },

    /* ── 로그인 (role: student | teacher | admin) ── */
    async login(role, loginId, password) {
      loginId = String(loginId || '').trim();
      if (!loginId || !password) throw new Error('아이디와 비밀번호를 입력하세요.');

      const uid = makeUid(role, loginId);
      const u = await Store.getUser(uid);

      if (role === 'student') {
        if (!u || u.role !== 'student')
          throw new Error('등록되지 않은 학생 번호입니다. 선생님께 문의하세요.');
      } else {
        // 교사/관리자 (동일 네임스페이스)
        if (!u || u.role !== 'teacher')
          throw new Error(role === 'admin'
            ? '관리자 계정을 찾을 수 없습니다.'
            : '교사 계정을 찾을 수 없습니다.');
        if (role === 'admin' && !u.isAdmin)
          throw new Error('관리자 권한이 없는 계정입니다.');
        if (u.status === 'pending')
          throw new Error('가입 승인 대기 중입니다. 관리자 승인 후 이용할 수 있습니다.');
        if (u.status === 'rejected')
          throw new Error('가입이 거절된 계정입니다. 관리자에게 문의하세요.');
      }
      if (u.pwHash !== hash(password)) throw new Error('비밀번호가 올바르지 않습니다.');

      // 접속 활동 기록 (STEP 03 대시보드 접속 현황용)
      u.lastSeenAt = Date.now();
      u.visits = (u.visits || 0) + 1;
      await Store.saveUser(u);

      localStorage.setItem(LS_SESSION, uid);
      this.user = stripPw(u);
      if (typeof this.onLogin === 'function') this.onLogin(this.user);
      return this.user;
    },

    /* ── 교사 회원가입 (승인 대기 상태로 생성) ── */
    async signupTeacher(loginId, password, name) {
      loginId = String(loginId || '').trim();
      if (loginId.length < 4) throw new Error('아이디는 4자 이상이어야 합니다.');
      if (!password || password.length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다.');

      const uid = makeUid('teacher', loginId);
      if (await Store.getUser(uid)) throw new Error('이미 사용 중인 아이디입니다.');

      await Store.saveUser({
        uid, role: 'teacher', loginId,
        name: String(name || '').trim() || loginId,
        isAdmin: false,
        status: 'pending',        // 관리자 승인 전에는 로그인 불가
        pwHash: hash(password),
        mustChangePw: false,
        createdAt: Date.now()
      });
    },

    /* ── 로그아웃 ── */
    logout() {
      localStorage.removeItem(LS_SESSION);
      this.user = null;
      if (typeof this.onLogout === 'function') this.onLogout();
    },

    /* ── 비밀번호 변경 (첫 로그인 강제 포함) ── */
    async changePassword(newPw) {
      if (!this.user) throw new Error('로그인이 필요합니다.');
      if (!newPw || newPw.length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다.');
      const u = await Store.getUser(this.user.uid);
      u.pwHash = hash(newPw);
      u.mustChangePw = false;
      await Store.saveUser(u);
      this.user = stripPw(u);
      return this.user;
    },

    /* ── 교사 전용: 학생 비밀번호 초기화(=아이디) ── */
    async resetStudentPassword(studentUid) {
      requireTeacher();
      const u = await Store.getUser(studentUid);
      if (!u || u.role !== 'student') throw new Error('학생을 찾을 수 없습니다.');
      u.pwHash = hash(u.loginId);   // 초기 PW = 아이디
      u.mustChangePw = true;
      await Store.saveUser(u);
      return u;
    },

    /* ── 교사 전용: 학생 삭제 ── */
    async deleteStudent(studentUid) {
      requireTeacher();
      await Store.deleteUser(studentUid);
    },

    /* ── STEP 05(메신저): 대화 상대 목록 ──
       - 교사 → 본인이 가르치는 학생 전원
       - 학생 → 승인된 교사 (기본 관리자 계정 제외)
       ※ listStudents/listTeachers 는 권한 제한이 있어 학생이 호출할 수 없으므로
         메신저 상대 조회는 이 메서드를 사용한다. */
    async listContacts() {
      if (!this.user) throw new Error('로그인이 필요합니다.');
      const all = await Store.getAllUsers();
      if (this.user.role === 'teacher') {
        return all
          .filter((u) => u.role === 'student')
          .sort((a, b) => a.loginId.localeCompare(b.loginId))
          .map(stripPw);
      }
      // 학생: 승인된 교사만 (관리자 본 계정은 제외)
      return all
        .filter((u) => u.role === 'teacher' && u.status === 'approved' && !u.isRootAdmin)
        .sort((a, b) => (a.name || a.loginId).localeCompare(b.name || b.loginId))
        .map(stripPw);
    },

    /* ── 교사 전용: 학생 목록 ── */
    async listStudents() {
      requireTeacher();
      const all = await Store.getAllUsers();
      return all
        .filter((u) => u.role === 'student')
        .sort((a, b) => a.loginId.localeCompare(b.loginId))
        .map(stripPw);
    },

    /* ── 교사 전용: 학생 일괄등록 ──
       rows: [{ grade, classNo, studentNo, name }]
       반환: { added, skipped, errors[] } */
    async registerStudents(rows) {
      requireTeacher();
      const result = { added: 0, skipped: 0, errors: [] };
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        const grade = parseInt(r.grade, 10);
        const classNo = parseInt(r.classNo, 10);
        const studentNo = parseInt(r.studentNo, 10);
        const name = String(r.name || '').trim();

        if (!grade || !classNo || !studentNo) {
          result.errors.push(`${i + 1}행: 학년/반/번호 형식 오류`);
          continue;
        }
        // 학년반번호 = 학년 + 반(2자리) + 번호(2자리)  예) 1학년 7반 1번 → 10701
        const loginId = `${grade}${pad2(classNo)}${pad2(studentNo)}`;
        const classId = `${grade}${pad2(classNo)}`;
        const uid = makeUid('student', loginId);

        const exists = await Store.getUser(uid);
        if (exists) { result.skipped++; continue; }

        await Store.saveUser({
          uid,
          role: 'student',
          loginId,
          name,                  // 표시용(런타임 데이터) — 소스에는 미포함
          grade, classNo, studentNo, classId,
          pwHash: hash(loginId), // 초기 PW = 아이디
          mustChangePw: true,
          createdAt: Date.now()
        });
        result.added++;
      }
      return result;
    },

    /* ── 관리자 전용: 교직원(교사/관리자) 목록 ── */
    async listTeachers() {
      requireAdmin();
      const all = await Store.getAllUsers();
      const order = { pending: 0, approved: 1, rejected: 2 };
      return all
        .filter((u) => u.role === 'teacher')
        .sort((a, b) =>
          (order[a.status] ?? 1) - (order[b.status] ?? 1) ||
          a.loginId.localeCompare(b.loginId))
        .map(stripPw);
    },

    /* ── 관리자 전용: 교사 가입 승인 / 거절 ── */
    async approveTeacher(uid) {
      requireAdmin();
      const u = await Store.getUser(uid);
      if (!u || u.role !== 'teacher') throw new Error('교사를 찾을 수 없습니다.');
      u.status = 'approved';
      await Store.saveUser(u);
    },
    async rejectTeacher(uid) {
      requireAdmin();
      const u = await Store.getUser(uid);
      if (!u || u.role !== 'teacher') throw new Error('교사를 찾을 수 없습니다.');
      if (u.isRootAdmin) throw new Error('기본 관리자는 거절할 수 없습니다.');
      u.status = 'rejected';
      u.isAdmin = false;
      await Store.saveUser(u);
    },

    /* ── 관리자 전용: 복수 관리자 지정/해제 ── */
    async setTeacherAdmin(uid, isAdmin) {
      requireAdmin();
      const u = await Store.getUser(uid);
      if (!u || u.role !== 'teacher') throw new Error('교사를 찾을 수 없습니다.');
      if (u.isRootAdmin) throw new Error('기본 관리자 권한은 변경할 수 없습니다.');
      u.isAdmin = !!isAdmin;
      if (isAdmin && u.status !== 'approved') u.status = 'approved'; // 관리자는 자동 승인
      await Store.saveUser(u);
    },

    /* ── 관리자 전용: 교직원 계정 삭제 ── */
    async deleteTeacher(uid) {
      requireAdmin();
      const u = await Store.getUser(uid);
      if (u && u.isRootAdmin) throw new Error('기본 관리자는 삭제할 수 없습니다.');
      await Store.deleteUser(uid);
    },

    /* ── Claude API 키 (교사 계정 저장) ── */
    async setApiKey(key) {
      requireTeacher();
      const u = await Store.getUser(this.user.uid);
      u.apiKey = String(key || '').trim();
      await Store.saveUser(u);
      this.user = stripPw(u);
    },
    async getApiKey() {
      // 교사: 본인 키 / 학생: 담당 교사 키 탐색 (간이 — 첫 교사)
      if (this.isTeacher()) {
        const u = await Store.getUser(this.user.uid);
        return (u && u.apiKey) || '';
      }
      const teacher = (await Store.getAllUsers()).find((u) => u.role === 'teacher' && u.apiKey);
      return teacher ? teacher.apiKey : '';
    },

    /* ── STEP 03: 현재 사용자 레코드 조회 (비밀번호 제외) ── */
    async getMyData() {
      if (!this.user) return null;
      const u = await Store.getUser(this.user.uid);
      return u ? stripPw(u) : null;
    },

    /* ── STEP 03: 현재 사용자 일부 필드 갱신 (역량·복습 기록 등) ──
       patch 예) { competency: {...}, reviewQuiz: {...} } */
    async saveMyData(patch) {
      if (!this.user) throw new Error('로그인이 필요합니다.');
      const u = await Store.getUser(this.user.uid);
      if (!u) throw new Error('사용자를 찾을 수 없습니다.');
      Object.assign(u, patch || {});
      await Store.saveUser(u);
      this.user = stripPw(u);
      return this.user;
    }
  };

  /* ============================================================
     3) 내부 헬퍼
  ============================================================ */
  function stripPw(u) { const c = Object.assign({}, u); delete c.pwHash; return c; }

  function requireTeacher() {
    if (!Auth.user || Auth.user.role !== 'teacher') throw new Error('교사 권한이 필요합니다.');
  }
  function requireAdmin() {
    if (!Auth.user || !Auth.user.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  }

  async function seedDefaults() {
    // 기본 관리자 (Admin01 / admin123) — 변경·삭제 불가
    const aUid = makeUid('teacher', 'Admin01');
    if (!(await Store.getUser(aUid))) {
      await Store.saveUser({
        uid: aUid, role: 'teacher', loginId: 'Admin01',
        name: '관리자',
        isAdmin: true, isRootAdmin: true, status: 'approved',
        pwHash: hash('admin123'),
        mustChangePw: false,
        createdAt: Date.now()
      });
    }
    // 데모용 승인된 교사 (teacher / teacher123)
    const tUid = makeUid('teacher', 'teacher');
    if (!(await Store.getUser(tUid))) {
      await Store.saveUser({
        uid: tUid, role: 'teacher', loginId: 'teacher',
        name: '선생님',
        isAdmin: false, status: 'approved',
        pwHash: hash('teacher123'),
        mustChangePw: false,
        createdAt: Date.now()
      });
    }
  }

  // 전역 노출
  window.Auth = Auth;
  console.log('[auth] STEP 02 로드 완료 — 백엔드:', useFB() ? 'Firebase' : 'localStorage(데모)');
})();
