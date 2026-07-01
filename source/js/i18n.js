/* ============================================================
   i18n.js — UI 다국어 (STEP 13) · window.I18N
   ------------------------------------------------------------
   사이드바 메뉴·헤더 제목 등 '화면 틀' 언어 전환(한국어/English/中文/Tiếng Việt).
   교사가 입력한 콘텐츠(문항·자료 등)는 번역하지 않고 원문 표시.
   - data-i18n 속성을 가진 요소를 사전으로 치환
   - #view-title(라우팅으로 바뀌는 제목)은 MutationObserver로 자동 번역
============================================================ */

window.I18N = (function () {
  'use strict';
  const LANGS = [
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' }
  ];
  const DICT = {
    'menu.dashboard': { ko: '대시보드', en: 'Dashboard', zh: '仪表板', vi: 'Bảng điều khiển' },
    'menu.scheduler': { ko: '스케줄러', en: 'Scheduler', zh: '日程表', vi: 'Lịch biểu' },
    'menu.messenger': { ko: '메신저', en: 'Messenger', zh: '消息', vi: 'Tin nhắn' },
    'menu.lesson': { ko: '학습실', en: 'Classroom', zh: '学习室', vi: 'Phòng học' },
    'menu.chatbot': { ko: '질문방', en: 'AI Q&A', zh: '提问室', vi: 'Hỏi đáp AI' },
    'menu.etc': { ko: '기타', en: 'More', zh: '其他', vi: 'Khác' },
    'menu.portfolio': { ko: '포트폴리오', en: 'Portfolio', zh: '档案册', vi: 'Hồ sơ' },
    'app.brand': { ko: '수학 플랫폼', en: 'Math Platform', zh: '数学平台', vi: 'Nền tảng Toán' },
    'app.logout': { ko: '로그아웃', en: 'Log out', zh: '登出', vi: 'Đăng xuất' }
  };

  let lang = localStorage.getItem('mathapp.lang') || 'ko';
  const t = (key) => { const e = DICT[key]; return e ? (e[lang] || e.ko) : key; };

  function translateTitle() {
    const el = document.getElementById('view-title');
    if (!el) return;
    const cur = el.textContent.trim();
    for (const k of Object.keys(DICT)) {
      const e = DICT[k];
      if (Object.values(e).indexOf(cur) >= 0) { const next = t(k); if (next !== cur) { el.__i18nLock = true; el.textContent = next; el.__i18nLock = false; } return; }
    }
  }

  function apply() {
    document.querySelectorAll('[data-i18n]').forEach((el) => { const k = el.getAttribute('data-i18n'); if (DICT[k]) el.textContent = t(k); });
    translateTitle();
    document.documentElement.lang = lang;
  }

  function set(l) {
    if (!LANGS.some((x) => x.code === l)) return;
    lang = l; localStorage.setItem('mathapp.lang', l); apply();
  }

  function initObserver() {
    const el = document.getElementById('view-title');
    if (!el || el.__i18nObs) return;
    const obs = new MutationObserver(() => { if (el.__i18nLock) return; translateTitle(); });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    el.__i18nObs = true;
  }

  const boot = () => { initObserver(); apply(); };
  if (document.readyState !== 'loading') setTimeout(boot, 0);
  document.addEventListener('DOMContentLoaded', boot);

  console.log('[i18n] 로드 완료 — 다국어 틀(ko/en/zh/vi)');
  return { LANGS, lang: () => lang, t, set, apply };
})();
