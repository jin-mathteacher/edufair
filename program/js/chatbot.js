/* ============================================================
   chatbot.js — 질문방 (STEP 10)  · window.Chatbot
   ------------------------------------------------------------
   ▶ AI 멘토: 수학자 캐릭터(뉴턴·가우스·오일러) 소크라테스식 대화 + 그래프(math.js)
   ▶ 공개 질문: 익명 게시판 + 포인트·뱃지(게이미피케이션)
   ▶ 교사 Claude API 키 필요(브라우저 직접호출). math.js로 그래프.
   ※ 수학자 아바타는 외부 이미지가 아니라 코드 내 인라인 SVG로 직접 생성(저작권 무관, 출처 없음).
   ※ 블라인드 규칙: 학교/성명/지역명 코드 미포함.
============================================================ */

(function () {
  'use strict';

  /* ── 데이터 계층 ── */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);
  const genId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // LaTeX 수식($...$ / $$...$$ / \( \) / \[ \])을 KaTeX로 렌더 (로드 안 됐으면 원문 유지)
  function renderMath(el) {
    if (!el || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false, ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (e) {}
  }
  function timeAgo(ts) { if (!ts) return ''; const s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분 전'; if (s < 86400) return Math.floor(s / 3600) + '시간 전'; return new Date(ts).toLocaleDateString('ko-KR'); }

  /* ── 모달·토스트 ── */
  function openModal(html) { const r = document.getElementById('modal-root'); r.innerHTML = `<div class="modal-overlay"><div class="modal-box">${html}</div></div>`; return r.querySelector('.modal-box'); }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
  function toast(msg) { let el = document.getElementById('app-toast'); if (!el) { el = document.createElement('div'); el.id = 'app-toast'; el.className = 'app-toast'; document.body.appendChild(el); } el.textContent = msg; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600); }

  /* ── 그래프 (math.js + canvas) ── */
  function plotFx(canvas, fx, xmin, xmax) {
    const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    xmin = Number(xmin); xmax = Number(xmax); if (!(xmax > xmin)) { xmin = -5; xmax = 5; }
    const N = 220, xs = [], ys = []; let cp = null;
    try { cp = window.math ? window.math.compile(fx) : null; } catch (e) { cp = null; }
    for (let i = 0; i <= N; i++) { const x = xmin + (xmax - xmin) * i / N; let y; try { y = cp ? cp.evaluate({ x }) : NaN; } catch (e) { y = NaN; } xs.push(x); ys.push(Number(y)); }
    const fin = ys.filter((v) => isFinite(v));
    let ymin = fin.length ? Math.min(...fin) : -5, ymax = fin.length ? Math.max(...fin) : 5;
    if (!isFinite(ymin) || !isFinite(ymax) || ymin === ymax) { ymin = -5; ymax = 5; }
    const pad = (ymax - ymin) * 0.1 || 1; ymin -= pad; ymax += pad;
    const X = (x) => (x - xmin) / (xmax - xmin) * w, Y = (y) => h - (y - ymin) / (ymax - ymin) * h;
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    if (xmin < 0 && xmax > 0) { ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), h); ctx.stroke(); }
    if (ymin < 0 && ymax > 0) { ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke(); }
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.beginPath(); let st = false;
    for (let i = 0; i <= N; i++) { const y = ys[i]; if (!isFinite(y)) { st = false; continue; } const px = X(xs[i]), py = Y(y); if (!st) { ctx.moveTo(px, py); st = true; } else ctx.lineTo(px, py); }
    ctx.stroke();
  }

  /* ── 수학자 캐릭터 (인라인 SVG · 직접 생성) ── */
  function avatar(bg, hair, face, initial) {
    return `<svg viewBox="0 0 64 64" class="cb-svg" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="32" fill="${bg}"/>
      <ellipse cx="32" cy="58" rx="20" ry="12" fill="#ffffff" opacity=".25"/>
      <circle cx="32" cy="30" r="14" fill="${face}"/>
      <path d="M18 26 Q32 6 46 26 Q44 16 32 14 Q20 16 18 26Z" fill="${hair}"/>
      <circle cx="27" cy="30" r="1.8" fill="#1f2937"/><circle cx="37" cy="30" r="1.8" fill="#1f2937"/>
      <path d="M27 37 Q32 40 37 37" stroke="#1f2937" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <text x="32" y="60" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">${initial}</text>
    </svg>`;
  }
  const SOCRATIC = [
    '너는 한국 중·고등학생을 돕는 수학 멘토다. 절대 최종 정답이나 전체 풀이를 직접 알려주지 않는다.',
    '문답법(소크라테스식)으로 단 하나의 힌트만 한 번에 제시하고, 끝에는 학생이 스스로 해볼 수 있는 작은 질문을 하나 던진다.',
    '학생이 "모르겠어요", "힌트 주세요" 처럼 막히면, 직전보다 조금 더 구체적인 "다음 힌트"를 하나만 더 준다. 힌트는 단계적으로 점점 구체화하되 마지막 정답 숫자/식은 학생이 직접 말하도록 유도한다.',
    '학생이 한 단계를 풀면 칭찬하고 다음 단계 질문으로 이어간다. 따뜻하고 격려하는 말투, 한국어로 짧고 명확하게. 학생을 비난하지 않는다.',
    '모든 수식은 반드시 LaTeX로 작성한다. 인라인 수식은 $ ... $, 따로 보여줄 식은 $$ ... $$ 로 감싼다. 예: $x^2-1$, $$\\frac{1}{2}n(n+1)$$. 분수·지수·근호·적분은 \\frac, ^, \\sqrt, \\int 등 LaTeX 명령을 쓴다.',
    '함수 그래프가 도움이 되면 답변 끝에 "GRAPH: <식>" 한 줄을 추가한다(이 줄은 LaTeX가 아니라 x 변수의 일반식, 예: GRAPH: x^2-1).'
  ].join(' ');
  const CHARACTERS = [
    {
      id: 'mr', name: '남자 선생님', tagline: '차근차근 함께 풀어요',
      greeting: '안녕하세요! 남자 선생님이에요. 어떤 문제가 궁금한가요? 정답을 바로 알려주기보다 같이 차근차근 풀어볼게요.',
      persona: '너는 친절한 남자 수학 선생님이다. 정중하고 따뜻한 존댓말(~해요/~예요)을 쓰며 침착하게 단계적으로 설명을 이끈다.'
    },
    {
      id: 'ms', name: '여자 선생님', tagline: '천천히 같이 생각해요',
      greeting: '반가워요! 여자 선생님이에요. 무엇이 어려운지 편하게 말해줄래요? 천천히 같이 생각해 봐요.',
      persona: '너는 친절한 여자 수학 선생님이다. 다정하고 따뜻한 존댓말을 쓰며 학생을 세심하게 격려한다.'
    },
    {
      id: 'friend', name: '친구', tagline: '편하게 같이 고민하자!',
      greeting: '안녕! 나야, 네 친구. 무슨 문제 풀다 막혔어? 같이 한번 고민해 보자!',
      persona: '너는 학생과 같은 또래의 친한 친구다. 반말(~야/~해 보자/~지)로 편하고 다정하게 응원하며 함께 고민한다.'
    }
  ];

  /* ── 살아 움직이는 일러스트 캐릭터(SVG) ──
     부위(머리·눈꺼풀·눈동자·눈썹·입)가 분리되어 CSS로 각각 움직인다.
     말할 때 입이 열렸다 닫히고(립싱크), 평소 눈을 깜빡이며 고개를 끄덕인다. */
  const SKIN = '#f1c9a4', SKIN_SH = '#e3b48f', LINE = '#7a5536';
  const TOON = {
    // 남자 선생님: 단정한 짧은 머리, 안경, 파란 재킷·흰 셔츠·넥타이
    mr: {
      coat: '#3a5a8c', brow: '#3a2e25',
      collar: '<path d="M82 146 L100 170 L118 146 Q108 160 100 160 Q92 160 82 146 Z" fill="#f5f7fa"/><path d="M100 160 L93 182 L100 206 L107 182 Z" fill="#1f4e79"/>',
      face: 'M55 90 Q55 46 100 44 Q145 46 145 90 Q145 138 100 149 Q55 138 55 90 Z',
      back: '<path d="M42 100 Q34 22 100 20 Q166 22 158 100 Q156 60 138 56 Q152 36 100 34 Q48 36 62 56 Q44 60 42 100 Z" fill="#33291f"/>',
      front: '<path d="M50 82 Q48 40 100 38 Q152 40 150 82 Q146 54 112 58 Q104 46 88 56 Q64 54 50 82 Z" fill="#33291f"/><path d="M66 54 Q92 44 124 52" stroke="#5a4a3a" stroke-width="2.5" fill="none" opacity=".5" stroke-linecap="round"/>',
      over: '<g fill="none" stroke="#2b2b2b" stroke-width="2.4"><rect x="63" y="89" width="31" height="19" rx="7"/><rect x="106" y="89" width="31" height="19" rx="7"/><path d="M94 97 H106"/><path d="M63 95 L54 92"/><path d="M137 95 L146 92"/></g>',
      nose: 'M100 98 q-6 16 -2 21 q4 3 9 1'
    },
    // 여자 선생님: 어깨까지 오는 갈색 머리·앞머리, 귀걸이, 모브색 블라우스
    ms: {
      coat: '#c96a86', brow: '#5e4126',
      collar: '<path d="M84 146 Q100 164 116 146 Q116 156 100 158 Q84 156 84 146 Z" fill="#f2e6ea"/>',
      face: 'M56 91 Q56 48 100 46 Q144 48 144 91 Q144 136 100 147 Q56 136 56 91 Z',
      back: '<path d="M46 82 Q44 28 100 26 Q156 28 154 82 L157 198 Q157 205 149 204 L140 150 Q142 112 139 92 L61 92 Q58 112 60 150 L51 204 Q43 205 43 198 L46 82 Z" fill="#6b4a2e"/>',
      front: '<path d="M100 44 Q62 46 56 88 Q74 64 100 64 Q126 64 144 88 Q138 46 100 44 Z" fill="#6b4a2e"/><path d="M100 45 Q98 54 100 64" stroke="#4a3120" stroke-width="1.5" fill="none"/><path d="M68 100 L64 176" stroke="#8a6440" stroke-width="2.2" fill="none" opacity=".35"/><path d="M132 100 L136 176" stroke="#8a6440" stroke-width="2.2" fill="none" opacity=".35"/>',
      over: '<circle cx="52" cy="115" r="2.6" fill="#e6b422"/><circle cx="148" cy="115" r="2.6" fill="#e6b422"/>',
      nose: 'M100 99 q-5 14 -1 19 q4 3 8 1'
    },
    // 친구: 또래 학생, 짧은 검은 머리, 주근깨, 밝은 초록 후드티
    friend: {
      coat: '#2bb673', brow: '#241f1b',
      collar: '<path d="M80 146 Q100 158 120 146 Q118 138 100 138 Q82 138 80 146 Z" fill="#239e63"/><rect x="95" y="150" width="3" height="22" rx="1.5" fill="#e8f5ee"/><rect x="102" y="150" width="3" height="22" rx="1.5" fill="#e8f5ee"/>',
      face: 'M56 92 Q56 50 100 48 Q144 50 144 92 Q144 132 100 142 Q56 132 56 92 Z',
      back: '<path d="M48 96 Q44 34 100 32 Q156 34 152 96 Q151 66 140 60 Q147 46 100 44 Q53 46 60 60 Q49 66 48 96 Z" fill="#33271c"/>',
      front: '<path d="M53 80 Q55 46 100 44 Q145 46 147 80 Q140 62 124 66 Q116 58 104 64 Q100 60 96 64 Q84 58 76 66 Q60 62 53 80 Z" fill="#33271c"/><path d="M68 60 Q100 52 132 60" stroke="#5a4632" stroke-width="2.5" fill="none" opacity=".45" stroke-linecap="round"/>',
      over: '<circle cx="73" cy="113" r="1.5" fill="#d98a6a" opacity=".6"/><circle cx="78" cy="116" r="1.4" fill="#d98a6a" opacity=".55"/><circle cx="127" cy="113" r="1.5" fill="#d98a6a" opacity=".6"/><circle cx="122" cy="116" r="1.4" fill="#d98a6a" opacity=".55"/>',
      nose: 'M100 99 q-5 13 -1 18 q4 3 8 1'
    }
  };
  function toonSVG(id) {
    const P = TOON[id] || TOON.mr;
    return `<svg class="cb-toon" viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${id} 캐릭터">
      <path class="cb-coat" d="M16 210 Q18 158 72 148 L128 148 Q182 158 184 210 Z" fill="${P.coat}"/>
      ${P.collar || ''}
      <path d="M85 146 Q85 128 100 128 Q115 128 115 146 L115 156 Q100 165 85 156 Z" fill="${SKIN_SH}"/>
      ${P.back || ''}
      <g class="cb-head">
        <ellipse cx="54" cy="98" rx="8.5" ry="11.5" fill="${SKIN}"/>
        <ellipse cx="146" cy="98" rx="8.5" ry="11.5" fill="${SKIN}"/>
        <path d="${P.face}" fill="${SKIN}"/>
        ${P.extra || ''}
        ${P.front || ''}
        <g class="cb-brows" fill="${P.brow}">${P.brows || '<rect x="63" y="79" width="26" height="6" rx="3"/><rect x="111" y="79" width="26" height="6" rx="3"/>'}</g>
        <g class="cb-eyes">
          <ellipse cx="79" cy="97" rx="10.5" ry="8" fill="#fff"/>
          <ellipse cx="121" cy="97" rx="10.5" ry="8" fill="#fff"/>
          <circle class="cb-iris" cx="80" cy="98" r="4.4" fill="#43301f"/>
          <circle class="cb-iris" cx="120" cy="98" r="4.4" fill="#43301f"/>
          <circle cx="81.4" cy="96.6" r="1.3" fill="#fff"/><circle cx="121.4" cy="96.6" r="1.3" fill="#fff"/>
          <rect class="cb-lid" x="68" y="88" width="22" height="18" rx="9" fill="${SKIN}"/>
          <rect class="cb-lid" x="110" y="88" width="22" height="18" rx="9" fill="${SKIN}"/>
        </g>
        ${P.over || ''}
        <path d="${P.nose || 'M100 98 q-6 16 -2 21 q4 3 9 1'}" fill="none" stroke="${LINE}" stroke-width="3" stroke-linecap="round" opacity=".5"/>
        <circle cx="71" cy="116" r="6.5" fill="#f3a085" opacity=".34"/>
        <circle cx="129" cy="116" r="6.5" fill="#f3a085" opacity=".34"/>
        <g class="cb-mouth"><ellipse cx="100" cy="128" rx="13" ry="9" fill="#8d3a3f"/><path d="M90 126 Q100 122 110 126" stroke="#fff" stroke-width="2.3" fill="none" opacity=".5"/></g>
      </g>
    </svg>`;
  }

  /* ── 포인트·뱃지 ── */
  const BADGES = [
    { p: 0, icon: '🌱', name: '새싹' }, { p: 20, icon: '✨', name: '탐구러' },
    { p: 50, icon: '🔥', name: '질문왕' }, { p: 100, icon: '🏅', name: '수학멘토' }, { p: 200, icon: '👑', name: '수학마스터' }
  ];
  const badgeFor = (p) => BADGES.filter((b) => (p || 0) >= b.p).slice(-1)[0] || BADGES[0];
  const ADJ = ['빛나는', '용감한', '슬기로운', '호기심많은', '차분한', '반짝이는', '씩씩한', '깊이있는'];
  const NOUN = ['삼각형', '소수', '함수', '벡터', '원주율', '미분', '집합', '수열'];
  async function ensureAnon(me) {
    if (me.anonName) return me.anonName;
    const a = ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + NOUN[Math.floor(Math.random() * NOUN.length)];
    try { await Auth.saveMyData({ anonName: a }); } catch (e) {}
    return a;
  }
  async function addPoints(n) {
    try {
      const me = (await Auth.getMyData()) || user;
      const before = me.points || 0; const after = before + n;
      const newBadges = (me.badges || []).slice();
      const nb = badgeFor(after);
      if (!newBadges.includes(nb.name)) newBadges.push(nb.name);
      await Auth.saveMyData({ points: after, badges: newBadges });
      if (badgeFor(before).name !== nb.name) toast(`뱃지 획득: ${nb.icon} ${nb.name}!`);
    } catch (e) {}
  }

  /* ── Claude 호출 ── */
  async function callClaude(key, system, messages, maxTokens) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: maxTokens || 1024, system, messages })
    });
    if (!res.ok) throw new Error('AI 호출 실패 (' + res.status + ')');
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('AI가 답변을 거절했습니다.');
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  /* ── 이미지 첨부(붙여넣기 + 파일) ── */
  function readFileAsDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  // 캡처/사진을 적당한 크기로 줄여 저장·전송 부담을 낮춘다(최대 1280px, JPEG).
  function downscale(dataUrl, maxDim, quality) {
    maxDim = maxDim || 1280; quality = quality || 0.85;
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
  async function processImage(file) {
    if (!file || !/^image\//.test(file.type || '')) return null;
    if (file.size > 10 * 1024 * 1024) { toast('이미지는 10MB 이하만 첨부할 수 있어요.'); return null; }
    try { return await downscale(await readFileAsDataURL(file)); } catch (e) { return null; }
  }
  function dataUrlToBlock(dataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return null;
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  }
  // pasteTarget/fileBtn → store(배열) 에 dataURL 누적, preview 썸네일 렌더
  function bindImageAttach(opts) {
    const store = opts.store, preview = opts.preview;
    const render = () => {
      if (preview) {
        preview.innerHTML = store.map((src, i) => `<span class="cb-thumb"><img src="${src}" alt="첨부 이미지"><button type="button" class="cb-thumb-x" data-i="${i}" title="삭제">×</button></span>`).join('');
        preview.querySelectorAll('.cb-thumb-x').forEach((b) => b.addEventListener('click', () => { store.splice(+b.dataset.i, 1); render(); }));
      }
      if (opts.onChange) opts.onChange();
    };
    const add = async (file) => { const url = await processImage(file); if (url) { store.push(url); render(); } };
    if (opts.fileBtn) {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.style.display = 'none';
      opts.fileBtn.parentNode.appendChild(input);
      opts.fileBtn.addEventListener('click', (e) => { e.preventDefault(); input.click(); });
      input.addEventListener('change', async () => { const fs = Array.from(input.files || []); for (const f of fs) await add(f); input.value = ''; });
    }
    if (opts.pasteTarget) {
      opts.pasteTarget.addEventListener('paste', async (e) => {
        const items = (e.clipboardData && e.clipboardData.items) || []; let handled = false;
        for (const it of items) { if (it.type && it.type.indexOf('image') === 0) { const f = it.getAsFile(); if (f) { await add(f); handled = true; } } }
        if (handled) e.preventDefault();
      });
    }
    render();
    return { render };
  }

  /* ── 모듈 상태 ── */
  let user = null, rootEl = null, tab = 'mentor', pubUnsub = null;
  let activeChar = null, activeCharObj = null, chatMsgs = [];
  let activeThreadId = null, mentorKey = '';

  function cleanup() { if (pubUnsub) { try { pubUnsub(); } catch (e) {} pubUnsub = null; } }

  async function render(container, currentUser) {
    cleanup();
    user = currentUser; rootEl = container;
    const me = (await Auth.getMyData()) || user;
    const pts = me.points || 0; const bd = badgeFor(pts);
    container.innerHTML = `
      <div class="cb-wrap">
        <div class="cb-tabs">
          <button class="cb-tab ${tab === 'mentor' ? 'active' : ''}" data-tab="mentor">🤖 AI 멘토</button>
          <button class="cb-tab ${tab === 'public' ? 'active' : ''}" data-tab="public">🙋 공개 질문</button>
          <div class="cb-tabs-right">
            ${tab === 'mentor' ? '<button id="cb-newq" class="cb-newq">＋ 질문하기</button>' : ''}
            <span class="cb-points">${bd.icon} ${bd.name} · ${pts}P</span>
          </div>
        </div>
        <div id="cb-body" class="cb-body"></div>
      </div>`;
    container.querySelectorAll('.cb-tab').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; cleanup(); render(container, user); }));
    const newqBtn = container.querySelector('#cb-newq');
    if (newqBtn) newqBtn.addEventListener('click', () => newThread());
    // 첨부 이미지 클릭 시 크게 보기(라이트박스)
    if (!container.dataset.lightbox) {
      container.dataset.lightbox = '1';
      container.addEventListener('click', (e) => {
        const img = e.target.closest('.cb-msg-img, .pq-img'); if (!img) return;
        openModal(`<img src="${img.src}" alt="첨부 이미지" style="max-width:100%;max-height:78vh;border-radius:10px;display:block;margin:0 auto"><div class="flex justify-end mt-3"><button class="btn-ghost modal-close">닫기</button></div>`)
          .querySelector('.modal-close').addEventListener('click', closeModal);
      });
    }
    if (tab === 'mentor') renderMentor(container.querySelector('#cb-body'));
    else renderPublic(container.querySelector('#cb-body'));
  }

  /* ── AI 멘토 탭 ── */
  const charName = (id) => (CHARACTERS.find((c) => c.id === id) || {}).name || '멘토';
  function highlightChar() {
    if (!rootEl) return;
    rootEl.querySelectorAll('.cb-char').forEach((b) => b.classList.toggle('active', b.dataset.id === activeChar));
  }

  async function renderMentor(body) {
    let key = ''; try { key = await Auth.getApiKey(); } catch (e) {}
    mentorKey = key;
    if (!key) {
      body.innerHTML = `<div class="card text-center py-12"><div class="text-5xl mb-3">🧑‍🏫</div>
        <p class="text-slate-700 font-bold mb-1">AI 멘토를 준비 중이에요</p>
        <p class="text-slate-500 text-sm">선생님이 ⚙️ 설정 → AI 키 설정에서 Claude API 키를 등록하면 대화할 수 있어요.</p></div>`;
      return;
    }
    body.innerHTML = `
      <div class="cb-mentor">
        <aside class="cb-chars">
          <p class="cb-chars-title">멘토 선택</p>
          ${CHARACTERS.map((c) => `<button class="cb-char ${activeChar === c.id ? 'active' : ''}" data-id="${c.id}">
            <span class="cb-char-av">${toonSVG(c.id)}</span>
            <span class="cb-char-info"><b>${c.name}</b><small>${esc(c.tagline)}</small></span></button>`).join('')}
          <div class="cb-myq-box"><p class="cb-myq-title">📝 내 질문</p><div id="cb-myq" class="cb-myq"><p class="cb-myq-empty">＋ 질문하기로 새 질문을 시작해요.</p></div></div>
        </aside>
        <section class="cb-chat" id="cb-chat">
          <div class="cb-empty">멘토를 고르고 위의 <b>＋ 질문하기</b>를 눌러 질문을 시작하세요.<br>정답을 바로 알려주기보다 힌트로 같이 생각하도록 도와줄 거예요!</div>
        </section>
      </div>`;
    body.querySelectorAll('.cb-char').forEach((b) => b.addEventListener('click', () => selectChar(b.dataset.id)));
    renderThreadList();
    if (activeChar) { highlightChar(); renderChat(); }
  }

  /* ── 내 질문 목록(시간순) — 클릭 시 이어서 질문 ── */
  async function renderThreadList() {
    const box = rootEl && rootEl.querySelector('#cb-myq'); if (!box) return;
    const obj = (await DB.read(`questions/${user.uid}`)) || {};
    const items = Object.values(obj).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); // 오래된→최근 순
    if (!items.length) { box.innerHTML = `<p class="cb-myq-empty">＋ 질문하기로 새 질문을 시작해요.</p>`; return; }
    box.innerHTML = items.map((q) => `<button class="cb-myq-item ${q.id === activeThreadId ? 'active' : ''}" data-id="${esc(q.id)}">
      <span class="cb-myq-text">${esc(q.title || '질문')}</span>
      <span class="cb-myq-meta">${esc(charName(q.charId))} · ${timeAgo(q.createdAt)}${q.shared ? ' · 📨 공유됨' : ''}</span>
    </button>`).join('');
    box.querySelectorAll('.cb-myq-item').forEach((b) => b.addEventListener('click', () => loadThread(b.dataset.id)));
  }

  // ＋ 질문하기 : 선택된 멘토로 새 질문(빈 대화) 시작
  function newThread() {
    if (tab !== 'mentor') { tab = 'mentor'; render(rootEl, user); return; }
    if (!activeChar) { toast('먼저 멘토(남자·여자 선생님·친구)를 선택하세요.'); return; }
    activeThreadId = null; chatMsgs = [];
    highlightChar(); renderChat(); renderThreadList();
    const inp = rootEl.querySelector('#cb-input'); if (inp) inp.focus();
  }

  // 멘토 선택 → 새 대화 준비
  function selectChar(cid) {
    activeChar = cid; activeCharObj = CHARACTERS.find((c) => c.id === cid);
    activeThreadId = null; chatMsgs = [];
    highlightChar(); renderChat();
    const inp = rootEl.querySelector('#cb-input'); if (inp) inp.focus();
  }

  // 과거 질문 클릭 → 그 대화를 불러와 이어서 질문
  async function loadThread(tid) {
    const q = await DB.read(`questions/${user.uid}/${tid}`);
    if (!q) { toast('질문을 불러올 수 없어요.'); return; }
    activeThreadId = tid; activeChar = q.charId; activeCharObj = CHARACTERS.find((c) => c.id === q.charId) || CHARACTERS[0];
    chatMsgs = q.messages || [];
    highlightChar(); renderChat(); renderThreadList();
  }

  // 현재 활성 멘토/대화로 채팅 영역을 그린다
  function renderChat() {
    const ch = activeCharObj; if (!ch) return;
    const chat = rootEl && rootEl.querySelector('#cb-chat'); if (!chat) return;
    const key = mentorKey;
    chat.innerHTML = `
      <div class="cb-stage" id="cb-stage">
        <figure class="cb-figure" id="cb-figure">
          <div class="cb-speech" id="cb-speech"><span class="cb-speech-txt" id="cb-speech-txt"></span></div>
          <div class="cb-toon-wrap">${toonSVG(ch.id)}</div>
          <figcaption class="cb-portrait-cap"><span><b>${esc(ch.name)}</b>이(가) 함께 풀어줄게요</span></figcaption>
        </figure>
      </div>
      <div class="cb-stream" id="cb-stream"></div>
      <div class="cb-quick" id="cb-quick">
        <button class="cb-chip" data-msg="아직 잘 모르겠어요. 힌트를 하나 더 주세요.">🙋 잘 모르겠어요</button>
        <button class="cb-chip" data-msg="다음 힌트를 주세요.">➡️ 다음 힌트</button>
        <button class="cb-chip" data-msg="이렇게 풀어봤는데 맞는지 봐주세요.">✅ 확인해 주세요</button>
        ${user.role === 'student' ? '<button class="cb-chip cb-chip-teacher" id="cb-ask-teacher">📨 선생님께 질문</button>' : ''}
      </div>
      <div id="cb-preview" class="cb-preview"></div>
      <div class="cb-composer">
        <button id="cb-graph" class="cb-tool" title="그래프 그리기">📈</button>
        <button id="cb-attach" class="cb-tool" title="이미지 첨부">📎</button>
        <textarea id="cb-input" class="cb-text" rows="1" placeholder="${esc(ch.name)}에게 질문해 보세요 (Enter 전송)"></textarea>
        <button id="cb-send" class="cb-send">전송</button>
      </div>
      <p class="cb-hint">📎 이미지 첨부·캡처 <b>붙여넣기(Ctrl+V)</b> 가능 · 모르면 <b>잘 모르겠어요/다음 힌트</b>로 하나씩 안내받고, <b>📨 선생님께 질문</b>으로 지금 대화를 선생님께 공유할 수 있어요.</p>`;
    paintStream();
    paintStage(ch);
    const input = chat.querySelector('#cb-input');
    const pending = [];
    bindImageAttach({ pasteTarget: input, fileBtn: chat.querySelector('#cb-attach'), preview: chat.querySelector('#cb-preview'), store: pending });
    const send = async () => {
      const t = input.value.trim();
      if (!t && !pending.length) return;
      const imgs = pending.slice(); pending.length = 0;
      input.value = ''; chat.querySelector('#cb-preview').innerHTML = '';
      await sendChat(ch, key, t, imgs);
    };
    chat.querySelector('#cb-send').addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    chat.querySelectorAll('.cb-chip[data-msg]').forEach((b) => b.addEventListener('click', () => sendChat(ch, key, b.dataset.msg, [])));
    const askT = chat.querySelector('#cb-ask-teacher'); if (askT) askT.addEventListener('click', () => shareToTeacher(ch));
    chat.querySelector('#cb-graph').addEventListener('click', () => {
      const fx = prompt('그릴 함수 f(x)를 입력하세요 (예: x^2-1)');
      if (fx) { chatMsgs.push({ role: 'graph', content: fx, ts: Date.now() }); paintStream(); }
    });
  }

  /* ── 현재 대화창 전체(메시지+답변)를 선생님께 메신저 링크로 공유 ──
     공유한 대화만 선생님이 볼 수 있고, 공유하지 않은 질문은 볼 수 없다. */
  async function shareToTeacher(ch) {
    if (user.role !== 'student') { toast('학생만 선생님께 공유할 수 있어요.'); return; }
    if (!chatMsgs.length) { toast('먼저 멘토와 대화한 뒤 공유할 수 있어요.'); return; }
    let teachers = [];
    try { teachers = (await Auth.listContacts()).filter((u) => u.role === 'teacher'); } catch (ex) {}
    if (!teachers.length) { toast('연결된 선생님이 없어요. 선생님께 문의해 주세요.'); return; }
    const shareId = genId();
    const snapshot = chatMsgs.map((m) => ({ role: m.role, content: m.content, images: (m.images && m.images.length) ? m.images : null }));
    await DB.write(`sharedQ/${shareId}`, {
      id: shareId, fromUid: user.uid, fromName: user.name || user.loginId || '학생',
      charId: ch.id, charName: ch.name, messages: snapshot, createdAt: Date.now()
    });
    const body = `📨 [멘토 대화 공유] ${user.name || '학생'}님이 '${ch.name}'와 나눈 대화를 보내왔어요. 아래 버튼(링크)을 눌러 확인해 주세요.\n[[SQ:${shareId}]]`;
    let sent = false;
    if (window.Messenger && Messenger.sendNotice) { for (const t of teachers) { if (await Messenger.sendNotice(t.uid, body)) sent = true; } }
    if (activeThreadId) { try { await DB.write(`questions/${user.uid}/${activeThreadId}/shared`, true); } catch (e) {} }
    toast(sent ? '선생님께 대화 링크를 보냈어요!' : '공유는 저장했지만 메신저 전송에 실패했어요.');
    renderThreadList();
  }

  // 공유된 대화 보기(메신저 링크 클릭 → 읽기 전용 모달)
  async function openSharedQ(shareId) {
    const q = await DB.read(`sharedQ/${shareId}`);
    if (!q) { toast('공유된 대화를 찾을 수 없어요.'); return; }
    const rows = (q.messages || []).map((m) => {
      if (m.role === 'graph') return `<div class="cb-graph-wrap"><canvas width="320" height="180" class="sq-graph" data-fx="${esc(m.content)}"></canvas></div>`;
      const mine = m.role === 'user';
      const text = esc(m.content).replace(/GRAPH:\s*([^\n]+)/gi, '').trim();
      const imgs = (m.images || []).map((src) => `<img class="cb-msg-img" src="${src}" alt="첨부 이미지">`).join('');
      return `<div class="cb-row ${mine ? 'mine' : 'bot'}"><div class="cb-bubble">${imgs ? `<div class="cb-msg-imgs">${imgs}</div>` : ''}${text || (imgs ? '' : '…')}</div></div>`;
    }).join('');
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-1">📨 공유된 멘토 대화</h3>
      <p class="text-xs text-slate-400 mb-3">${esc(q.fromName || '학생')} · '${esc(q.charName || '멘토')}' 멘토 · ${timeAgo(q.createdAt)}</p>
      <div class="sq-view">${rows || '<p class="text-slate-400 text-sm">대화 내용이 없습니다.</p>'}</div>
      <div class="flex justify-end mt-3"><button class="btn-ghost modal-close">닫기</button></div>`);
    box.querySelectorAll('.sq-graph').forEach((cv) => plotFx(cv, cv.dataset.fx, -6, 6));
    renderMath(box.querySelector('.sq-view'));
    box.querySelector('.modal-close').addEventListener('click', closeModal);
  }
  window.openSharedQ = openSharedQ;

  function paintStream() {
    const s = rootEl && rootEl.querySelector('#cb-stream'); if (!s) return;
    if (!chatMsgs.length) { s.innerHTML = `<div class="cb-empty">무엇이든 물어보세요. 함께 단계적으로 풀어가요!</div>`; return; }
    s.innerHTML = chatMsgs.map((m, i) => {
      if (m.role === 'graph') return `<div class="cb-graph-wrap"><canvas width="380" height="220" class="cb-graph-canvas" data-fx="${esc(m.content)}"></canvas><p class="cb-graph-cap">f(x) = ${esc(m.content)}</p></div>`;
      const mine = m.role === 'user';
      // \n→<br> 대신 원문 줄바꿈 유지(white-space:pre-wrap) → KaTeX가 여러 줄 수식도 인식
      const text = esc(m.content).replace(/GRAPH:\s*([^\n]+)/gi, '').trim();
      const imgs = (m.images || []).map((src) => `<img class="cb-msg-img" src="${src}" alt="첨부 이미지">`).join('');
      let extra = '';
      if (!mine) { const mt = (m.content || '').match(/GRAPH:\s*([^\n]+)/i); if (mt) extra = `<div class="cb-graph-wrap"><canvas width="360" height="200" class="cb-graph-canvas" data-fx="${esc(mt[1].trim())}"></canvas><p class="cb-graph-cap">f(x) = ${esc(mt[1].trim())}</p></div>`; }
      const inner = (imgs ? `<div class="cb-msg-imgs">${imgs}</div>` : '') + (text || (imgs ? '' : '…'));
      return `<div class="cb-row ${mine ? 'mine' : 'bot'}"><div class="cb-bubble">${inner}</div>${extra}</div>`;
    }).join('');
    s.querySelectorAll('.cb-graph-canvas').forEach((cv) => plotFx(cv, cv.dataset.fx, -6, 6));
    renderMath(s);
    s.scrollTop = s.scrollHeight;
  }

  /* ── 만화 무대(말풍선 + 등장/대화 애니메이션) ── */
  let speechTimer = null;
  function latestBotText(ch) {
    for (let i = chatMsgs.length - 1; i >= 0; i--) { if (chatMsgs[i].role === 'assistant') return chatMsgs[i].content; }
    return ch ? ch.greeting : '';
  }
  function setStageState(state) {
    const fig = rootEl && rootEl.querySelector('#cb-figure'); if (!fig) return;
    fig.classList.remove('thinking', 'talking');
    if (state) fig.classList.add(state);
  }
  function paintStage(ch, opts) {
    opts = opts || {};
    const fig = rootEl && rootEl.querySelector('#cb-figure');
    const bubbleTxt = rootEl && rootEl.querySelector('#cb-speech-txt');
    if (!fig || !bubbleTxt) return;
    // 만화책처럼 등장(슬라이드+팝)
    fig.classList.remove('enter'); void fig.offsetWidth; fig.classList.add('enter');
    // 말풍선 내용: GRAPH 지시문은 제거하고 보여 줌
    const raw = (opts.text != null ? opts.text : latestBotText(ch)) || '';
    const text = raw.replace(/GRAPH:\s*([^\n]+)/gi, '').trim();
    clearTimeout(speechTimer);
    if (opts.thinking) { setStageState('thinking'); bubbleTxt.textContent = '음… 같이 생각해 볼까?'; return; }
    // 타이핑(말하는) 효과
    setStageState('talking');
    bubbleTxt.textContent = '';
    let i = 0;
    const step = () => {
      if (!rootEl || !rootEl.querySelector('#cb-speech-txt')) return;
      bubbleTxt.textContent = text.slice(0, i);
      if (i < text.length) { i += 2; speechTimer = setTimeout(step, 18); }
      else { setStageState(null); bubbleTxt.textContent = text; renderMath(bubbleTxt); }  // 타이핑 끝나면 수식 렌더
    };
    step();
  }

  async function sendChat(ch, key, text, images) {
    chatMsgs.push({ role: 'user', content: text, images: (images && images.length) ? images : undefined, ts: Date.now() });
    paintStream();
    paintStage(ch, { thinking: true });   // 캐릭터가 고민하는 표정/움직임
    const s = rootEl.querySelector('#cb-stream');
    if (s) { const t = document.createElement('div'); t.className = 'cb-row bot'; t.id = 'cb-typing'; t.innerHTML = '<div class="cb-bubble cb-typing">생각하는 중…</div>'; s.appendChild(t); s.scrollTop = s.scrollHeight; }
    try {
      const history = chatMsgs.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-12)
        .map((m) => {
          if (m.images && m.images.length) {
            const blocks = m.images.map(dataUrlToBlock).filter(Boolean);  // 이미지 먼저, 텍스트 나중(권장 순서)
            if (m.content) blocks.push({ type: 'text', text: m.content });
            return { role: m.role, content: blocks.length ? blocks : (m.content || '') };
          }
          return { role: m.role, content: m.content };
        });
      const reply = await callClaude(key, `${SOCRATIC}\n${ch.persona}`, history, 1024);
      chatMsgs.push({ role: 'assistant', content: reply, ts: Date.now() });
      paintStream();
      paintStage(ch, { text: reply });     // 말풍선으로 만화처럼 말하기
    } catch (e) {
      const msg = '미안해요, 지금은 답하기 어려워요. 잠시 후 다시 시도해 주세요. (' + e.message + ')';
      chatMsgs.push({ role: 'assistant', content: msg, ts: Date.now() });
      paintStream();
      paintStage(ch, { text: msg });
    }
    try { await saveThread(); } catch (e) {}
  }

  // 현재 대화를 질문 스레드로 저장(없으면 새로 생성, 제목=첫 질문)
  async function saveThread() {
    if (!user || !activeCharObj) return;
    if (!activeThreadId) activeThreadId = genId();
    const firstUser = chatMsgs.find((m) => m.role === 'user');
    const title = firstUser ? String(firstUser.content || '').replace(/\s+/g, ' ').slice(0, 40) : '새 질문';
    const existing = await DB.read(`questions/${user.uid}/${activeThreadId}`);
    await DB.write(`questions/${user.uid}/${activeThreadId}`, {
      id: activeThreadId, charId: activeCharObj.id, charName: activeCharObj.name,
      title, messages: chatMsgs.slice(-40),
      createdAt: (existing && existing.createdAt) || Date.now(), updatedAt: Date.now(),
      shared: (existing && existing.shared) || false
    });
    renderThreadList();
  }

  /* ── 공개 질문 탭 ── */
  async function renderPublic(body) {
    const me = (await Auth.getMyData()) || user;
    await ensureAnon(me);
    body.innerHTML = `
      <div class="card">
        <div class="mat-head">
          <div><h3 class="dash-title" style="margin:0">🙋 공개 질문</h3><p class="mat-sub">궁금한 점을 익명으로 올리고 서로 도와요. (질문 +5P · 답변 +3P)</p></div>
          <button id="pq-add" class="btn-primary">＋ 질문하기</button>
        </div>
        <div id="pq-list" class="pq-list"><p class="mat-loading">불러오는 중…</p></div>
      </div>`;
    body.querySelector('#pq-add').addEventListener('click', openAsk);
    await loadPublic();
    pubUnsub = DB.subscribe('publicQ', () => loadPublic());
  }

  async function loadPublic() {
    if (!rootEl) return;
    const listEl = rootEl.querySelector('#pq-list'); if (!listEl) return;
    const obj = (await DB.read('publicQ')) || {};
    const items = Object.values(obj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!items.length) { listEl.innerHTML = `<div class="mat-empty">아직 질문이 없어요. 첫 질문을 올려보세요!</div>`; return; }
    const isTeacher = user.role === 'teacher';
    listEl.innerHTML = items.map((q) => {
      const ans = q.answers ? Object.values(q.answers).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [];
      const mine = q.authorUid === user.uid;
      const qImgs = (q.images || []).map((src) => `<img class="pq-img" src="${src}" alt="첨부 이미지">`).join('');
      return `<div class="pq-item" data-id="${esc(q.id)}">
        <p class="pq-q">❓ ${esc(q.text)}</p>
        ${qImgs ? `<div class="pq-imgs">${qImgs}</div>` : ''}
        <p class="pq-meta">${esc(q.anonName || '익명')} · ${timeAgo(q.createdAt)}
          ${(mine || isTeacher) ? `<button class="pq-del" data-id="${esc(q.id)}">삭제</button>` : ''}</p>
        <div class="pq-answers">${ans.map((a) => { const aImgs = (a.images || []).map((src) => `<img class="pq-img" src="${src}" alt="첨부 이미지">`).join(''); return `<div class="pq-ans ${a.isAI ? 'ai' : ''}"><b>${a.isAI ? '🤖 AI 멘토' : esc(a.anonName || '익명')}</b> ${esc(a.text)}${aImgs ? `<div class="pq-imgs">${aImgs}</div>` : ''}</div>`; }).join('')}</div>
        <div class="pq-actions">
          <button class="btn-mini pq-reply" data-id="${esc(q.id)}">💬 답변하기</button>
        </div>
      </div>`;
    }).join('');
    renderMath(listEl);
    listEl.querySelectorAll('.pq-reply').forEach((b) => b.addEventListener('click', () => openReply(obj[b.dataset.id])));
    listEl.querySelectorAll('.pq-del').forEach((b) => b.addEventListener('click', async () => { if (confirm('질문을 삭제할까요?')) { await DB.remove(`publicQ/${b.dataset.id}`); if (!useFB()) loadPublic(); } }));
  }

  async function openAsk() {
    const me = (await Auth.getMyData()) || user;
    const anon = await ensureAnon(me);
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-1">질문하기</h3>
      <p class="text-xs text-slate-400 mb-3">${esc(anon)} (익명)으로 게시됩니다.</p>
      <form id="pq-form" class="space-y-3"><textarea id="pq-text" class="form-input" rows="4" placeholder="궁금한 점을 적어주세요"></textarea>
        <div class="cb-attach-row"><button type="button" id="pq-file" class="btn-ghost btn-mini">📎 이미지 첨부</button>
          <span class="cb-hint">화면 캡처 후 <b>붙여넣기(Ctrl+V)</b>로도 사진을 넣을 수 있어요.</span></div>
        <div id="pq-preview" class="cb-preview"></div>
        <div class="flex gap-2 justify-end"><button type="button" class="btn-ghost modal-close">취소</button><button type="submit" class="btn-primary">올리기 (+5P)</button></div></form>`);
    const images = [];
    bindImageAttach({ pasteTarget: box.querySelector('#pq-text'), fileBtn: box.querySelector('#pq-file'), preview: box.querySelector('#pq-preview'), store: images });
    box.querySelector('.modal-close').addEventListener('click', closeModal);
    box.querySelector('#pq-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = box.querySelector('#pq-text').value.trim(); if (!text && !images.length) { toast('질문 내용이나 이미지를 넣어주세요.'); return; }
      const id = genId();
      await DB.write(`publicQ/${id}`, { id, text, images: images.length ? images : undefined, authorUid: user.uid, anonName: anon, createdAt: Date.now(), answers: {} });
      await addPoints(5);
      closeModal(); toast('질문을 올렸어요! (+5P)'); if (!useFB()) loadPublic();
    });
  }

  async function openReply(q) {
    if (!q) return;
    const me = (await Auth.getMyData()) || user;
    const anon = await ensureAnon(me);
    const box = openModal(`
      <h3 class="text-lg font-bold text-slate-800 mb-1">답변하기</h3>
      <p class="text-sm text-slate-600 mb-3">❓ ${esc(q.text)}</p>
      <form id="pa-form" class="space-y-3"><textarea id="pa-text" class="form-input" rows="3" placeholder="도움이 되는 답변을 적어주세요"></textarea>
        <div class="cb-attach-row"><button type="button" id="pa-file" class="btn-ghost btn-mini">📎 이미지 첨부</button>
          <span class="cb-hint">화면 캡처 후 <b>붙여넣기(Ctrl+V)</b>로도 사진을 넣을 수 있어요.</span></div>
        <div id="pa-preview" class="cb-preview"></div>
        <div class="flex gap-2 justify-end"><button type="button" class="btn-ghost modal-close">취소</button><button type="submit" class="btn-primary">답변 (+3P)</button></div></form>`);
    const images = [];
    bindImageAttach({ pasteTarget: box.querySelector('#pa-text'), fileBtn: box.querySelector('#pa-file'), preview: box.querySelector('#pa-preview'), store: images });
    box.querySelector('.modal-close').addEventListener('click', closeModal);
    box.querySelector('#pa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = box.querySelector('#pa-text').value.trim(); if (!text && !images.length) { toast('답변 내용이나 이미지를 넣어주세요.'); return; }
      const aid = genId();
      await DB.write(`publicQ/${q.id}/answers/${aid}`, { id: aid, uid: user.uid, anonName: anon, text, images: images.length ? images : undefined, createdAt: Date.now() });
      await addPoints(3);
      closeModal(); toast('답변을 올렸어요! (+3P)'); if (!useFB()) loadPublic();
    });
  }

  window.Chatbot = { render, teardown: cleanup };
  console.log('[chatbot] STEP 10 로드 완료 — 수학자 멘토/소크라테스/그래프/공개질문/포인트·뱃지');
})();
