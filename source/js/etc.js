/* ============================================================
   etc.js — 기타 (STEP 13) · window.Etc
   ------------------------------------------------------------
   하위 3탭:
     1) 🎨 수학 그림 작성기 — 좌표축·도형·함수그래프·펜·텍스트 → PNG 저장
     2) 🧪 바이브코딩       — 거북이 그래픽 + math.js 코딩 놀이터 (AI 코드 도우미)
     3) 🌐 다국어            — UI 언어 전환(한국어/English/中文/Tiếng Việt)
   ※ math.js(CDN) 사용. 블라인드 규칙 준수.
============================================================ */

window.Etc = (function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let user = null, rootEl = null, sub = 'sketch';

  const TABS = [
    { key: 'sketch', label: '🎨 수학 그림 생성기' },
    { key: 'vibe', label: '🧪 바이브코딩' }
  ];

  function render(container, currentUser) {
    user = currentUser; rootEl = container;
    container.innerHTML = `
      <div class="etc-wrap">
        <div class="collab-subtabs" id="etc-tabs">
          ${TABS.map((t) => `<button class="collab-subtab ${t.key === sub ? 'active' : ''}" data-k="${t.key}">${t.label}</button>`).join('')}
        </div>
        <div id="etc-body"></div>
      </div>`;
    container.querySelector('#etc-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.collab-subtab'); if (!b) return;
      selectSub(b.dataset.k);
    });
    selectSub(sub);
  }

  function selectSub(k) {
    sub = k;
    if (!rootEl) return;
    rootEl.querySelectorAll('.collab-subtab').forEach((t) => t.classList.toggle('active', t.dataset.k === k));
    const body = rootEl.querySelector('#etc-body');
    if (k === 'vibe') renderVibe(body);
    else renderSketch(body);
  }

  /* ============================================================
     1) 수학 그림 생성기 — 손그림/문제 → 시험용 수학 그림(SVG)
     ------------------------------------------------------------
     교사·학생이 대충 그린 스케치나 문제를 올리면, AI(Claude Vision)가
     시험 문항에 어울리는 정확한 수학 그림(SVG)으로 다시 그려줍니다.
  ============================================================ */
  function renderSketch(body) {
    body.innerHTML = `
      <div class="gen-grid">
        <div class="card gen-left">
          <h3 class="dash-title" style="margin:0 0 6px">🎨 수학 그림 생성기</h3>
          <p class="text-xs text-slate-500 mb-2">손으로 대충 그린 그림이나 문제를 올리면, AI가 <b>시험 문항용 수학 그림</b>으로 다시 그려줍니다.</p>
          <div class="gen-tools">
            <button class="gen-tool on" data-t="pen" title="펜">✏️ 펜</button>
            <button class="gen-tool" data-t="eraser" title="지우개">🧽 지우개</button>
            <button class="sk-btn" id="gen-clear">전체 지움</button>
            <label class="sk-btn cursor-pointer">📁 이미지 업로드<input id="gen-file" type="file" accept="image/*" class="hidden"></label>
          </div>
          <div class="gen-draw-wrap"><canvas id="gen-draw" width="520" height="360"></canvas></div>
          <p class="text-[11px] text-slate-400 mt-1">여기에 손으로 그리거나, 이미지 업로드 / 캡처 <b>Ctrl+V</b> 붙여넣기</p>
          <label class="form-label mt-2">문제·설명 (선택)</label>
          <textarea id="gen-desc" class="form-input" rows="2" placeholder="예) 밑변 6, 높이 4인 삼각형 ABC와 내접원 / y=x^2-2 그래프와 접선"></textarea>
          <div class="flex gap-2 mt-2">
            <button id="gen-run" class="btn-primary">✨ 수학 그림 생성</button>
            <button id="gen-reset" class="btn-ghost">입력 초기화</button>
          </div>
          <p id="gen-msg" class="text-xs min-h-[1rem] mt-1"></p>
        </div>
        <div class="card gen-right">
          <h4 class="pf-h4">결과 그림</h4>
          <div id="gen-out" class="gen-out"><span class="text-slate-400 text-sm">왼쪽에서 그림/문제를 넣고 <b>생성</b>을 누르세요.</span></div>
          <div class="flex gap-2 mt-2 justify-end">
            <button id="gen-dl-svg" class="btn-ghost" disabled>⬇ SVG</button>
            <button id="gen-dl-png" class="btn-primary" disabled>⬇ PNG</button>
          </div>
        </div>
      </div>`;

    // ── 입력 캔버스(손그림) ──
    const canvas = body.querySelector('#gen-draw');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    let tool = 'pen', drawing = false, hasInk = false, last = null;
    let uploaded = null; // 업로드/붙여넣기 이미지 dataURL
    const clearCanvas = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); };
    clearCanvas();
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); drawing = true; last = pos(e); canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return; e.preventDefault(); const p = pos(e);
      ctx.strokeStyle = tool === 'eraser' ? '#fff' : '#1e293b'; ctx.lineWidth = tool === 'eraser' ? 20 : 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; hasInk = true;
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
    body.querySelectorAll('.gen-tool').forEach((b) => b.addEventListener('click', () => { tool = b.dataset.t; body.querySelectorAll('.gen-tool').forEach((x) => x.classList.toggle('on', x === b)); }));
    body.querySelector('#gen-clear').addEventListener('click', () => { clearCanvas(); hasInk = false; });

    // 업로드/붙여넣기 → 캔버스에 표시(참고용) + uploaded 저장
    const showUploaded = (dataUrl) => {
      uploaded = dataUrl;
      const img = new Image();
      img.onload = () => { clearCanvas(); const s = Math.min(W / img.width, H / img.height); const w = img.width * s, h = img.height * s; ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); hasInk = true; };
      img.src = dataUrl;
    };
    body.querySelector('#gen-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) fileToDataUrl(f).then(showUploaded); });
    body.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) { if (it.type && it.type.indexOf('image') === 0) { const f = it.getAsFile(); if (f) { e.preventDefault(); fileToDataUrl(f).then(showUploaded); break; } } }
    });

    body.querySelector('#gen-reset').addEventListener('click', () => { clearCanvas(); hasInk = false; uploaded = null; body.querySelector('#gen-desc').value = ''; });

    // ── 생성 ──
    const out = body.querySelector('#gen-out');
    const msg = body.querySelector('#gen-msg');
    let lastSvg = '';
    body.querySelector('#gen-run').addEventListener('click', async () => {
      const desc = body.querySelector('#gen-desc').value.trim();
      if (!hasInk && !desc) { msg.className = 'text-xs mt-1 text-amber-600'; msg.textContent = '그림을 그리거나 이미지를 올리거나 문제를 입력하세요.'; return; }
      let key = ''; try { key = await Auth.getApiKey(); } catch (e) {}
      if (!key) { msg.className = 'text-xs mt-1 text-amber-600'; msg.textContent = '⚙️ 설정에서 AI 키를 등록하면 그림을 생성합니다.'; return; }
      msg.className = 'text-xs mt-1 text-violet-600'; msg.textContent = 'AI가 수학 그림을 그리는 중… (최대 40초)';
      out.innerHTML = '<span class="text-slate-400 text-sm">생성 중…</span>';
      // 입력 이미지: 업로드본 우선, 없으면 캔버스 손그림
      const imgData = uploaded || (hasInk ? canvas.toDataURL('image/png') : null);
      try {
        const svg = await generateFigure(key, imgData, desc);
        lastSvg = sanitizeSvg(svg);
        out.innerHTML = lastSvg;
        body.querySelector('#gen-dl-svg').disabled = false;
        body.querySelector('#gen-dl-png').disabled = false;
        msg.className = 'text-xs mt-1 text-green-600'; msg.textContent = '✅ 완성! 필요하면 다시 생성하거나 저장하세요.';
      } catch (ex) { out.innerHTML = '<span class="text-red-500 text-sm">생성 실패</span>'; msg.className = 'text-xs mt-1 text-red-500'; msg.textContent = '실패: ' + ex.message; }
    });

    body.querySelector('#gen-dl-svg').addEventListener('click', () => {
      if (!lastSvg) return;
      const blob = new Blob([lastSvg], { type: 'image/svg+xml' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'math-figure.svg'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    body.querySelector('#gen-dl-png').addEventListener('click', () => {
      if (!lastSvg) return;
      const svgBlob = new Blob([lastSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width || 600; c.height = img.height || 450;
        const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(img, 0, 0, c.width, c.height);
        const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'math-figure.png'; a.click();
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { URL.revokeObjectURL(url); alert('PNG 변환 실패 — SVG로 저장해 주세요.'); };
      img.src = url;
    });
  }

  const fileToDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

  // AI에게 수학 그림(SVG) 생성 요청
  async function generateFigure(key, imgDataUrl, desc) {
    const sys = `너는 한국 수학 시험 문항용 '그림 생성기'다. 입력(손그림 이미지 및/또는 문제 설명)을 이해해 시험지에 어울리는 정확한 수학 그림을 만든다.
출력 규칙: 오직 하나의 <svg>...</svg> 코드만 출력(설명·코드블록·주석 금지).
그림 규칙: viewBox="0 0 400 300", 흰 배경, 검은색(#111) 얇은 선(stroke-width 1.5~2), 필요한 점·선분·각·길이에 라벨(text, 12~14px). 비례를 정확히. 색 채움은 꼭 필요할 때만 옅게. 좌표평면이면 축·눈금·화살표 포함. 글자는 한글/영문 라벨 허용. <script>나 이벤트 속성 금지.`;
    const content = [];
    if (imgDataUrl) {
      const m = /^data:(image\/[a-z]+);base64,(.*)$/i.exec(imgDataUrl);
      if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
    content.push({ type: 'text', text: (imgDataUrl ? '이 손그림을' : '') + (desc ? ` 다음 설명을 참고해` : '') + ` 시험 문항용 수학 그림(SVG)으로 그려줘.${desc ? '\n설명: ' + desc : ''}\nSVG만 출력.` });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 2000, system: sys, messages: [{ role: 'user', content }] })
    });
    if (!res.ok) throw new Error('AI 호출 실패 (' + res.status + ')');
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('AI가 요청을 거절했습니다.');
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const s = text.indexOf('<svg'), e = text.lastIndexOf('</svg>');
    if (s < 0 || e < 0) throw new Error('그림(SVG)을 만들지 못했습니다. 문제를 더 구체적으로 적어보세요.');
    return text.slice(s, e + 6);
  }

  // AI 생성 SVG 최소 정화(스크립트·이벤트 핸들러 제거)
  function sanitizeSvg(svg) {
    return String(svg)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '');
  }


  /* ============================================================
     2) 바이브코딩 (거북이 그래픽 + math.js)
  ============================================================ */
  const VIBE_API = 'forward(d) back(d) right(deg) left(deg) penup() pendown() color("#hex") width(n) goto(x,y) dot(r) repeat(n, fn) print(...) · math (math.js)';
  function renderVibe(body) {
    body.innerHTML = `
      <div class="vibe-grid">
        <div class="card vibe-left">
          <h3 class="dash-title" style="margin:0 0 8px">🧪 바이브코딩 — 수학 코딩 놀이터</h3>
          <p class="text-xs text-slate-500 mb-2">거북이를 움직여 도형·패턴을 그려요. 사용 명령: <code class="vibe-api">${esc(VIBE_API)}</code></p>
          <textarea id="vibe-code" class="vibe-code" spellcheck="false">// 정오각형 그리기
color("#2563eb"); width(3);
repeat(5, function(){
  forward(120);
  right(72);
});</textarea>
          <div class="vibe-ai-row">
            <input id="vibe-ai" class="form-input" placeholder="무엇을 그릴까요? 예) 별 모양, 나선, 정삼각형 30개">
            <button id="vibe-ai-btn" class="btn-ghost">🤖 코드 생성</button>
          </div>
          <div class="flex gap-2 mt-2">
            <button id="vibe-run" class="btn-primary">▶ 실행</button>
            <button id="vibe-clear" class="btn-ghost">화면 지움</button>
          </div>
          <p id="vibe-msg" class="text-xs min-h-[1rem] mt-1"></p>
          <pre id="vibe-out" class="vibe-out"></pre>
        </div>
        <div class="card vibe-right">
          <canvas id="vibe-canvas" width="520" height="520"></canvas>
        </div>
      </div>`;

    const canvas = body.querySelector('#vibe-canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const clear = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); };
    clear();

    function run(code) {
      clear();
      const out = body.querySelector('#vibe-out'); out.textContent = '';
      let x = W / 2, y = H / 2, ang = -90, pen = '#1e293b', down = true, w = 2, steps = 0;
      const logs = [];
      const guard = () => { if (++steps > 200000) throw new Error('명령이 너무 많습니다(무한 반복?).'); };
      const api = {
        forward(d) { guard(); const a = ang * Math.PI / 180, nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d; if (down) { ctx.strokeStyle = pen; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke(); } x = nx; y = ny; },
        back(d) { api.forward(-d); },
        right(deg) { ang += deg; }, left(deg) { ang -= deg; },
        penup() { down = false; }, pendown() { down = true; },
        color(c) { pen = c; }, width(n) { w = Math.max(0.5, +n || 1); },
        goto(nx, ny) { x = +nx; y = +ny; }, home() { x = W / 2; y = H / 2; ang = -90; },
        dot(r) { ctx.fillStyle = pen; ctx.beginPath(); ctx.arc(x, y, +r || 3, 0, 7); ctx.fill(); },
        repeat(n, fn) { n = Math.min(100000, n | 0); for (let i = 0; i < n; i++) { guard(); fn(i); } },
        print() { logs.push([].slice.call(arguments).join(' ')); },
        math: window.math
      };
      try {
        const fn = new Function(...Object.keys(api), '"use strict";\n' + code);
        fn(...Object.values(api));
        out.textContent = logs.join('\n');
        body.querySelector('#vibe-msg').className = 'text-xs min-h-[1rem] mt-1 text-green-600';
        body.querySelector('#vibe-msg').textContent = '✅ 실행 완료';
      } catch (e) {
        body.querySelector('#vibe-msg').className = 'text-xs min-h-[1rem] mt-1 text-red-500';
        body.querySelector('#vibe-msg').textContent = '오류: ' + e.message;
      }
    }

    body.querySelector('#vibe-run').addEventListener('click', () => run(body.querySelector('#vibe-code').value));
    body.querySelector('#vibe-clear').addEventListener('click', clear);
    body.querySelector('#vibe-ai-btn').addEventListener('click', async () => {
      const want = body.querySelector('#vibe-ai').value.trim();
      const msg = body.querySelector('#vibe-msg');
      if (!want) { msg.className = 'text-xs mt-1 text-amber-600'; msg.textContent = '무엇을 그릴지 입력하세요.'; return; }
      let key = ''; try { key = await Auth.getApiKey(); } catch (e) {}
      if (!key) { msg.className = 'text-xs mt-1 text-amber-600'; msg.textContent = '⚙️ 설정에서 AI 키를 등록하면 코드를 생성해 줍니다.'; return; }
      msg.className = 'text-xs mt-1 text-violet-600'; msg.textContent = 'AI가 코드를 작성하는 중…';
      const sys = `너는 학생용 거북이 그래픽 코드 생성기다. 다음 JS 함수만 사용해 요청한 그림을 그리는 코드를 작성한다(설명·코드블록 없이 코드만): ${VIBE_API}. 캔버스는 520x520, 거북이는 중앙에서 위를 향해 시작. 반복은 repeat(n, function(){...}) 사용. 안전하게 유한 반복만.`;
      try {
        const code = await callClaude(key, sys, `요청: ${want}\n위 명령만 써서 코드만 출력.`, 700);
        body.querySelector('#vibe-code').value = code.replace(/^```[a-z]*\n?|```$/g, '').trim();
        msg.className = 'text-xs mt-1 text-green-600'; msg.textContent = '✅ 코드를 생성했습니다. ▶ 실행을 눌러보세요.';
      } catch (ex) { msg.className = 'text-xs mt-1 text-red-500'; msg.textContent = '실패: ' + ex.message; }
    });
    run(body.querySelector('#vibe-code').value);
  }

  async function callClaude(key, system, prompt, maxTokens) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: maxTokens || 700, system, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error('AI 호출 실패 (' + res.status + ')');
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  console.log('[etc] STEP 13 로드 완료 — 수학그림 생성기 / 바이브코딩 (다국어는 헤더로 이동)');
  return { render };
})();
