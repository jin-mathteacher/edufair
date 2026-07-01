/* ============================================================
   Firebase 초기화
   ------------------------------------------------------------
   ▶ 사용 방법
   1) https://console.firebase.google.com 에서 프로젝트 생성
   2) 프로젝트 설정 → 웹 앱 추가 → SDK 설정값을 아래 firebaseConfig 에 붙여넣기
   3) Authentication / Realtime Database / Storage 활성화

   ※ 이 파일에는 개인정보·학교명·성명을 절대 넣지 않습니다.
   ※ Claude API 키는 여기에 넣지 않습니다 (교사 설정 화면에서 직접 입력).
============================================================ */

const firebaseConfig = {
  apiKey:            "YOUR_FIREBASE_API_KEY",      // ← Firebase 콘솔 값으로 교체
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// 전역 핸들 (다른 모듈에서 사용)
window.FB = { app: null, auth: null, db: null, storage: null, ready: false };

(function initFirebase() {
  const statusEl = document.getElementById('fb-status');

  // 설정값이 아직 교체되지 않은 경우 → 데모(미연결) 모드로 동작
  const notConfigured = firebaseConfig.apiKey.startsWith('YOUR_');

  if (notConfigured) {
    console.warn('[Firebase] 설정값 미입력 → 미연결(데모) 모드로 실행됩니다.');
    if (statusEl) statusEl.textContent = '⚠ Firebase 미연결 (데모 모드) — js/firebase.js 설정 필요';
    window.FB.ready = false;
    return;
  }

  try {
    const app = firebase.initializeApp(firebaseConfig);
    window.FB.app     = app;
    window.FB.auth    = firebase.auth();
    window.FB.db      = firebase.database();
    window.FB.storage = firebase.storage();
    window.FB.ready   = true;
    console.log('[Firebase] 초기화 완료');
    if (statusEl) statusEl.textContent = '✅ Firebase 연결됨';
  } catch (err) {
    console.error('[Firebase] 초기화 실패:', err);
    if (statusEl) statusEl.textContent = '❌ Firebase 초기화 실패 (콘솔 확인)';
    window.FB.ready = false;
  }
})();
