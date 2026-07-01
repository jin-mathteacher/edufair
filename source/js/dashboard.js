/* ============================================================
   dashboard.js — 대시보드 (STEP 03)
   ------------------------------------------------------------
   ▶ 교사 대시보드
     - 요약 카드(총 학생/반 수/오늘 접속/평균 복습 정답률)
     - 반별 현황(학생 수·오늘 접속·접속률)
     - 학생 접속 현황판(최근 접속·복습 응시 여부)
     - 반 평균 수학 핵심역량 레이더(Chart.js)
   ▶ 학생 대시보드
     - 미제출 과제 경고 배너 / 오늘의 수업 / 투두 완료율
     - 본인 수학 핵심역량 레이더(Chart.js)
     - 복습 퀴즈 다시 풀기
   ▶ 로그인 시 복습 퀴즈 팝업(AI 취약 개념 점검 기본 틀)
       → 결과로 5대 핵심역량 점수를 갱신 → 레이더에 반영

   ※ 스케줄러·수업·과제 등은 이후 STEP에서 채워지므로,
     해당 데이터가 없을 때는 '빈 상태'로 안전하게 표시합니다.
   ※ 블라인드 규칙: 학교명·성명·지역명을 코드에 포함하지 않습니다.
============================================================ */

(function () {
  'use strict';

  /* ============================================================
     0) 공용 데이터 계층 (Firebase / localStorage 공통)
        users 는 auth.js 가 관리하므로, 여기서는 그 외 앱 데이터
        (todos/lessons/homework 등)를 임의 경로로 읽고 씁니다.
  ============================================================ */
  const LS_DATA = 'mathapp.data.v1';
  const useFB = () => !!(window.FB && window.FB.ready && window.FB.db);

  const DB = {
    async read(path) {
      if (useFB()) {
        const snap = await window.FB.db.ref(path).once('value');
        return snap.exists() ? snap.val() : null;
      }
      const root = JSON.parse(localStorage.getItem(LS_DATA) || '{}');
      return path.split('/').reduce((o, k) => (o == null ? null : o[k]), root) ?? null;
    },
    async write(path, val) {
      if (useFB()) { await window.FB.db.ref(path).set(val); return; }
      const root = JSON.parse(localStorage.getItem(LS_DATA) || '{}');
      const ks = path.split('/');
      let o = root;
      for (let i = 0; i < ks.length - 1; i++) { o[ks[i]] = o[ks[i]] || {}; o = o[ks[i]]; }
      o[ks[ks.length - 1]] = val;
      localStorage.setItem(LS_DATA, JSON.stringify(root));
    }
  };

  /* ============================================================
     1) 상수 · 유틸
  ============================================================ */
  // 수학 5대 핵심역량 (평가·포트폴리오와 공유되는 기준)
  const COMP = [
    { key: 'problem', label: '문제해결' },
    { key: 'reason',  label: '추론' },
    { key: 'comm',    label: '의사소통' },
    { key: 'connect', label: '연결' },
    { key: 'info',    label: '정보처리' }
  ];
  const emptyComp = () => COMP.reduce((o, c) => ((o[c.key] = 0), o), {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const isToday = (ts) => {
    if (!ts) return false;
    const d = new Date(ts), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };
  function timeAgo(ts) {
    if (!ts) return '접속 기록 없음';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    const days = Math.floor(s / 86400);
    if (days < 30) return `${days}일 전`;
    return new Date(ts).toLocaleDateString('ko-KR');
  }
  const classLabel = (grade, classNo) => `${grade}학년 ${parseInt(classNo, 10)}반`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // 차트 인스턴스 (재렌더 시 파기)
  let radarChart = null;
  function destroyRadar() { if (radarChart) { radarChart.destroy(); radarChart = null; } }

  function drawRadar(canvas, dataObj, label) {
    if (!canvas || !window.Chart) return;
    destroyRadar();
    radarChart = new Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels: COMP.map((c) => c.label),
        datasets: [{
          label,
          data: COMP.map((c) => Math.round(dataObj[c.key] || 0)),
          fill: true,
          backgroundColor: 'rgba(37,99,235,.18)',
          borderColor: '#2563eb',
          borderWidth: 2,
          pointBackgroundColor: '#2563eb',
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, backdropColor: 'transparent' }, pointLabels: { font: { size: 13, weight: '600' } } } },
        plugins: { legend: { display: true, position: 'bottom' } }
      }
    });
  }

  /* ============================================================
     2) 복습 퀴즈 문제 은행 (교육과정 중립 · 블라인드 안전)
        각 문항은 5대 핵심역량 중 하나로 태깅됩니다.
  ============================================================ */
  const QUIZ_BANK = [
    { q: '12 × 8 의 값은?', choices: ['86', '96', '108', '112'], answer: 1, comp: 'info' },
    { q: '다음 중 소수(prime)는?', choices: ['21', '27', '29', '33'], answer: 2, comp: 'reason' },
    { q: '1/2 + 1/3 을 계산하면?', choices: ['2/5', '5/6', '1/6', '2/6'], answer: 1, comp: 'problem' },
    { q: '한 변의 길이가 5인 정사각형의 넓이는?', choices: ['10', '20', '25', '30'], answer: 2, comp: 'connect' },
    { q: '직각삼각형에서 빗변을 c, 다른 두 변을 a·b라 할 때 옳은 식은?', choices: ['a+b=c', 'a²+b²=c²', 'a·b=c', 'a²+b²=c'], answer: 1, comp: 'reason' },
    { q: '3, 6, 9, 12, ... 다음에 올 수는?', choices: ['13', '14', '15', '18'], answer: 2, comp: 'reason' },
    { q: 'x + 7 = 12 일 때 x 의 값은?', choices: ['3', '4', '5', '6'], answer: 2, comp: 'problem' },
    { q: '0.25 를 분수로 나타내면?', choices: ['1/2', '1/4', '2/5', '1/5'], answer: 1, comp: 'connect' },
    { q: '자료 4, 6, 8, 10 의 평균은?', choices: ['6', '7', '8', '9'], answer: 1, comp: 'info' },
    { q: '“두 수의 합은 그 순서를 바꾸어도 같다”를 가장 잘 설명한 것은?', choices: ['결합법칙', '교환법칙', '분배법칙', '항등원'], answer: 1, comp: 'comm' },
    { q: '둘레가 16인 정사각형의 한 변의 길이는?', choices: ['2', '4', '6', '8'], answer: 1, comp: 'problem' },
    { q: '“넓이는 길이 × 길이”처럼 단위가 변하는 까닭을 묻는 것은 주로 어떤 역량과 관련될까?', choices: ['정보처리', '의사소통', '연결', '암기'], answer: 2, comp: 'connect' }
  ];

  // 균형 있게 3문항 추출 (서로 다른 역량 우선) — Math.random 사용
  function pickQuestions(n) {
    const pool = QUIZ_BANK.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = [];
    const usedComp = new Set();
    for (const item of pool) {
      if (picked.length >= n) break;
      if (usedComp.has(item.comp)) continue;
      usedComp.add(item.comp);
      picked.push(item);
    }
    // 역량이 모자라면 남은 것으로 채움
    for (const item of pool) {
      if (picked.length >= n) break;
      if (!picked.includes(item)) picked.push(item);
    }
    return picked;
  }

  /* ============================================================
     3) 진입점 — 라우터가 호출 (app.js)
  ============================================================ */
  async function render(container, user) {
    container.innerHTML = `<div class="dash-loading">대시보드를 불러오는 중…</div>`;
    try {
      if (user.role === 'teacher') await renderTeacher(container, user);
      else await renderStudent(container, user);
    } catch (err) {
      console.error('[dashboard] 렌더 오류', err);
      container.innerHTML = `<div class="card text-red-500">대시보드를 불러오지 못했습니다: ${esc(err.message)}</div>`;
    }
  }

  /* ============================================================
     4) 교사 대시보드
  ============================================================ */
  async function renderTeacher(container, user) {
    const students = await Auth.listStudents();          // [{uid,loginId,name,grade,classNo,classId,lastSeenAt,visits,competency,reviewQuiz}]
    const totalStudents = students.length;

    // 반별 그룹
    const classMap = new Map();
    students.forEach((s) => {
      const id = s.classId || `${s.grade}${String(s.classNo).padStart(2, '0')}`;
      if (!classMap.has(id)) classMap.set(id, { id, grade: s.grade, classNo: s.classNo, list: [] });
      classMap.get(id).list.push(s);
    });
    const classes = [...classMap.values()].sort((a, b) => a.id.localeCompare(b.id));

    const todayOnline = students.filter((s) => isToday(s.lastSeenAt)).length;
    const quizTaken = students.filter((s) => s.reviewQuiz && s.reviewQuiz.lastScore != null);
    const avgReview = quizTaken.length
      ? Math.round(quizTaken.reduce((a, s) => a + s.reviewQuiz.lastScore, 0) / quizTaken.length)
      : null;

    // 반 평균 역량 (응시 학생 기준)
    const compStudents = students.filter((s) => s.competency);
    const avgComp = emptyComp();
    if (compStudents.length) {
      COMP.forEach((c) => {
        avgComp[c.key] = compStudents.reduce((a, s) => a + (s.competency[c.key] || 0), 0) / compStudents.length;
      });
    }

    container.innerHTML = `
      <div class="dash-wrap">
        <p class="dash-hello">안녕하세요, <b>${esc(user.name || user.loginId)}</b> 선생님 👋</p>

        <!-- 요약 카드 -->
        <div class="stat-grid">
          ${statCard('👥', '총 학생', `${totalStudents}명`, `${classes.length}개 반`)}
          ${statCard('🟢', '오늘 접속', `${todayOnline}명`, totalStudents ? `${Math.round(todayOnline / totalStudents * 100)}% 접속` : '—')}
          ${statCard('📝', '복습 응시', `${quizTaken.length}명`, totalStudents ? `미응시 ${totalStudents - quizTaken.length}명` : '—')}
          ${statCard('🎯', '평균 복습 정답률', avgReview == null ? '—' : `${avgReview}%`, avgReview == null ? '데이터 없음' : '복습 퀴즈 기준')}
        </div>

        ${totalStudents === 0 ? `
          <div class="card dash-empty">
            아직 등록된 학생이 없습니다. 우측 상단 <b>⚙️ 설정 → 학생 일괄등록</b>에서 학생을 추가하세요.
          </div>
        ` : `
          <div class="dash-cols">
            <!-- 반별 현황 -->
            <div class="card">
              <h3 class="dash-title">📊 반별 현황</h3>
              <table class="dash-table">
                <thead><tr><th>반</th><th class="num">학생</th><th class="num">오늘 접속</th><th>접속률</th></tr></thead>
                <tbody>
                  ${classes.map((c) => {
                    const on = c.list.filter((s) => isToday(s.lastSeenAt)).length;
                    const pct = c.list.length ? Math.round(on / c.list.length * 100) : 0;
                    return `<tr>
                      <td>${esc(classLabel(c.grade, c.classNo))}</td>
                      <td class="num">${c.list.length}</td>
                      <td class="num">${on}</td>
                      <td>${progressBar(pct)}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- 반 평균 핵심역량 레이더 -->
            <div class="card">
              <h3 class="dash-title">🧭 반 평균 핵심역량</h3>
              ${compStudents.length
                ? `<div class="radar-box"><canvas id="dash-radar"></canvas></div>
                   <p class="dash-note">복습 퀴즈에 응시한 ${compStudents.length}명 평균</p>`
                : `<div class="dash-empty-sm">아직 역량 데이터가 없습니다.<br>학생이 로그인 후 복습 퀴즈에 응시하면 집계됩니다.</div>`}
            </div>
          </div>

          <!-- 학생 접속 현황판 -->
          <div class="card">
            <h3 class="dash-title">🧑‍🎓 학생 접속 현황</h3>
            <div class="dash-scroll">
              <table class="dash-table">
                <thead><tr><th>아이디</th><th>이름</th><th>반</th><th>최근 접속</th><th>복습</th></tr></thead>
                <tbody>
                  ${students
                    .slice()
                    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
                    .map((s) => `
                    <tr>
                      <td class="mono">${esc(s.loginId)}</td>
                      <td>${esc(s.name || '-')}</td>
                      <td>${esc(classLabel(s.grade, s.classNo))}</td>
                      <td>${isToday(s.lastSeenAt) ? '<span class="dot-on"></span>' : '<span class="dot-off"></span>'}${timeAgo(s.lastSeenAt)}</td>
                      <td>${s.reviewQuiz && s.reviewQuiz.lastScore != null
                        ? `<span class="pill-ok">${s.reviewQuiz.lastScore}%</span>`
                        : `<span class="pill-no">미응시</span>`}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `}
      </div>
    `;

    if (compStudents.length) drawRadar($('#dash-radar', container), avgComp, '반 평균');
  }

  /* ============================================================
     5) 학생 대시보드
  ============================================================ */
  async function renderStudent(container, user) {
    const me = (await Auth.getMyData()) || user;
    const comp = me.competency || emptyComp();
    const hasComp = COMP.some((c) => (comp[c.key] || 0) > 0);

    // 오늘 할 일(투두) — 이후 STEP에서 채워짐
    const todos = (await DB.read(`todos/${me.uid}/${todayKey()}`)) || {};
    const todoList = Object.values(todos);
    const doneCnt = todoList.filter((t) => t && t.done).length;
    const todoPct = todoList.length ? Math.round(doneCnt / todoList.length * 100) : 0;

    // 오늘의 수업 — 이후 STEP(교과수업)에서 채워짐
    const lessons = (await DB.read('lessons')) || {};
    const myLessons = Object.values(lessons).filter((l) =>
      l && (l.classId === me.classId) && (!l.date || l.date === todayKey()));

    // 미제출 과제 — 이후 STEP(과제방)에서 채워짐
    const homeworks = (await DB.read('homework')) || {};
    const myDue = Object.values(homeworks).filter((h) => {
      if (!h || (h.classId && h.classId !== me.classId)) return false;
      const submitted = h.submissions && h.submissions[me.uid];
      return !submitted;
    });

    const review = me.reviewQuiz || null;

    container.innerHTML = `
      <div class="dash-wrap">
        <p class="dash-hello">반가워요, <b>${esc(me.name || me.loginId)}</b> 님 🎒
          <span class="dash-sub">${esc(classLabel(me.grade, me.classNo))} · ${esc(me.loginId)}</span></p>

        ${myDue.length ? `
          <div class="alert-banner">
            ⚠️ 미제출 과제가 <b>${myDue.length}건</b> 있어요!
            <span class="alert-sub">${myDue.slice(0, 3).map((h) => esc(h.title || '과제')).join(' · ')}</span>
          </div>` : ''}

        <!-- 요약 카드 -->
        <div class="stat-grid">
          ${statCard('📚', '오늘의 수업', myLessons.length ? `${myLessons.length}개` : '없음',
            myLessons.length ? esc(myLessons[0].title || '') : '예정된 수업이 없어요')}
          ${statCard('✅', '오늘 할 일', todoList.length ? `${doneCnt}/${todoList.length}` : '0개',
            todoList.length ? `완료율 ${todoPct}%` : '할 일이 없어요')}
          ${statCard('🎯', '복습 정답률', review && review.lastScore != null ? `${review.lastScore}%` : '—',
            review && review.lastDate ? `${review.lastDate} 응시` : '아직 응시 전')}
        </div>

        <div class="dash-cols">
          <!-- 오늘 할 일 진행 -->
          <div class="card">
            <h3 class="dash-title">✅ 오늘 할 일</h3>
            ${todoList.length ? `
              ${progressBar(todoPct)}
              <ul class="todo-mini">
                ${todoList.slice(0, 5).map((t) => `
                  <li class="${t.done ? 'done' : ''}">${t.done ? '☑' : '☐'} ${esc(t.text || '')}</li>`).join('')}
              </ul>
              <p class="dash-note">자세한 일정·할 일은 <b>스케줄러</b>에서 확인하세요.</p>
            ` : `<div class="dash-empty-sm">오늘 등록된 할 일이 없어요.<br><b>스케줄러</b>에서 할 일을 추가해 보세요.</div>`}
          </div>

          <!-- 본인 핵심역량 레이더 -->
          <div class="card">
            <h3 class="dash-title">🧭 나의 수학 핵심역량</h3>
            ${hasComp
              ? `<div class="radar-box"><canvas id="dash-radar"></canvas></div>`
              : `<div class="dash-empty-sm">아직 역량 데이터가 없어요.<br>복습 퀴즈를 풀면 역량이 분석됩니다.</div>`}
            <div class="text-center mt-3">
              <button id="retake-quiz" class="btn-primary">📝 복습 퀴즈 풀기</button>
            </div>
          </div>
        </div>
      </div>
    `;

    if (hasComp) drawRadar($('#dash-radar', container), comp, '나의 역량');

    const btn = $('#retake-quiz', container);
    if (btn) btn.addEventListener('click', () => startReviewQuiz(me, () => render(container, user)));
  }

  /* ============================================================
     6) 카드 · 진행바 컴포넌트
  ============================================================ */
  function statCard(icon, label, value, sub) {
    return `
      <div class="stat-card">
        <div class="stat-icon">${icon}</div>
        <div class="stat-body">
          <p class="stat-label">${esc(label)}</p>
          <p class="stat-value">${value}</p>
          <p class="stat-sub">${esc(sub || '')}</p>
        </div>
      </div>`;
  }
  function progressBar(pct) {
    pct = Math.max(0, Math.min(100, pct || 0));
    return `<div class="pbar"><div class="pbar-fill" style="width:${pct}%"></div><span class="pbar-txt">${pct}%</span></div>`;
  }

  /* ============================================================
     7) 복습 퀴즈 모달 (로그인 시 / 다시 풀기)
        - 3문항 → 정답 채점 → 역량 점수 갱신 → 저장
  ============================================================ */
  function startReviewQuiz(me, onDone) {
    const questions = pickQuestions(3);
    let idx = 0;
    const answers = new Array(questions.length).fill(null);

    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-box quiz-box">
          <div class="quiz-head">
            <h3 class="text-lg font-bold text-slate-800">📝 복습 퀴즈</h3>
            <span id="quiz-step" class="quiz-step"></span>
          </div>
          <p class="text-sm text-slate-500 mb-4">이전 학습 개념을 점검해요. 너무 깊게 고민하지 말고 편하게 풀어보세요!</p>
          <div id="quiz-body"></div>
        </div>
      </div>`;
    const body = root.querySelector('#quiz-body');
    const stepEl = root.querySelector('#quiz-step');

    function paint() {
      const item = questions[idx];
      stepEl.textContent = `${idx + 1} / ${questions.length}`;
      body.innerHTML = `
        <p class="quiz-q">${esc(item.q)}</p>
        <div class="quiz-choices">
          ${item.choices.map((c, i) => `
            <button class="quiz-choice ${answers[idx] === i ? 'sel' : ''}" data-i="${i}">${esc(c)}</button>`).join('')}
        </div>
        <div class="quiz-nav">
          <button id="quiz-prev" class="btn-ghost" ${idx === 0 ? 'disabled' : ''}>이전</button>
          <button id="quiz-next" class="btn-primary" ${answers[idx] == null ? 'disabled' : ''}>
            ${idx === questions.length - 1 ? '제출' : '다음'}
          </button>
        </div>`;
      body.querySelectorAll('.quiz-choice').forEach((b) =>
        b.addEventListener('click', () => {
          answers[idx] = parseInt(b.dataset.i, 10);
          paint();
        }));
      body.querySelector('#quiz-prev').addEventListener('click', () => { if (idx > 0) { idx--; paint(); } });
      body.querySelector('#quiz-next').addEventListener('click', () => {
        if (answers[idx] == null) return;
        if (idx < questions.length - 1) { idx++; paint(); }
        else finish();
      });
    }

    async function finish() {
      // 채점
      let correct = 0;
      const compHit = {};   // comp → {right, total}
      questions.forEach((item, i) => {
        const ok = answers[i] === item.answer;
        if (ok) correct++;
        const h = (compHit[item.comp] = compHit[item.comp] || { right: 0, total: 0 });
        h.total++; if (ok) h.right++;
      });
      const score = Math.round(correct / questions.length * 100);

      // 역량 점수 갱신 (이전 점수와 가중 평균)
      const prev = me.competency || emptyComp();
      const next = Object.assign({}, prev);
      Object.keys(compHit).forEach((k) => {
        const pct = Math.round(compHit[k].right / compHit[k].total * 100);
        next[k] = prev[k] ? Math.round(prev[k] * 0.5 + pct * 0.5) : pct;
      });

      try {
        await Auth.saveMyData({
          competency: next,
          reviewQuiz: { lastDate: todayKey(), lastScore: score, lastAt: Date.now() }
        });
      } catch (e) { console.error('[dashboard] 퀴즈 결과 저장 실패', e); }

      // 결과 화면
      stepEl.textContent = '완료';
      const weak = COMP
        .filter((c) => (next[c.key] || 0) < 60)
        .map((c) => c.label);
      body.innerHTML = `
        <div class="quiz-result">
          <div class="quiz-score-ring" style="--p:${score}">
            <span>${score}<small>점</small></span>
          </div>
          <p class="quiz-result-msg">
            ${score >= 80 ? '훌륭해요! 개념이 탄탄하네요 🎉'
              : score >= 50 ? '좋아요! 조금만 더 다지면 완벽해요 💪'
              : '괜찮아요. 차근차근 복습해 봐요 🌱'}
          </p>
          ${weak.length ? `<p class="quiz-weak">보완하면 좋은 영역: <b>${weak.join(' · ')}</b></p>` : ''}
          <button id="quiz-close" class="btn-primary mt-4">대시보드로</button>
        </div>`;
      body.querySelector('#quiz-close').addEventListener('click', () => {
        root.innerHTML = '';
        me.competency = next;
        me.reviewQuiz = { lastDate: todayKey(), lastScore: score };
        if (typeof onDone === 'function') onDone();
      });
    }

    paint();
  }

  /* ── 로그인 시 1일 1회 자동 팝업 (학생 전용) ── */
  async function maybeShowReviewQuiz(user) {
    if (!user || user.role !== 'student') return;
    const me = (await Auth.getMyData()) || user;
    if (me.reviewQuiz && me.reviewQuiz.lastDate === todayKey()) return; // 오늘 이미 응시
    // 약간의 지연 후 팝업 (대시보드 렌더와 겹치지 않도록)
    setTimeout(() => startReviewQuiz(me, () => {
      // 현재 화면이 대시보드면 갱신
      const c = document.getElementById('view-container');
      if (c && Auth.user) render(c, Auth.user);
    }), 600);
  }

  /* 전역 노출 */
  window.Dashboard = { render, maybeShowReviewQuiz };
  console.log('[dashboard] STEP 03 로드 완료 — 대시보드/복습퀴즈/레이더 준비됨');
})();
