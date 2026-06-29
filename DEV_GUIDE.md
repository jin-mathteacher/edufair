# 개발 지침 (DEV_GUIDE)
> 수학 교육 통합 플랫폼 · 경기도교육청 디지털교육연구대회 SW·AI분과
> **이 파일만 읽으면 개발 가능** — 매 작업 시 이 파일을 컨텍스트로 사용

---

## 1. 기술 스택 (확정)

| 구분 | 사용 |
|------|------|
| 프론트 | `index.html` + Vanilla JS + Tailwind CSS (CDN) |
| 실시간 DB | Firebase Realtime Database |
| 인증 | Firebase Authentication |
| 파일저장 | Firebase Storage (사진·PDF) |
| 호스팅 | Firebase Hosting (HTTPS 자동 → 카메라용) |
| AI | Claude API (**교사가 설정화면에서 키 직접 입력**, 소스에 미포함) |
| 달력 | FullCalendar.js (MIT, CDN) |
| 차트 | Chart.js (MIT) |
| PDF | PDF.js (렌더), jsPDF (출력) |
| 엑셀 | XLSX.js |
| 화이트보드 | Fabric.js |
| 그래프 | function-plot |
| 수식 | math.js |

> 모든 라이브러리 CDN, 오픈소스 라이선스(MIT/Apache). [서식 5] 출처 기재 필수.

---

## 2. 절대 규칙 (대회 요강)

- 🚫 **블라인드**: 코드·주석·UI·파일명에 학교명·성명·지역명 **절대 금지**
- ✅ 시작파일 = `program/index.html`, 시작화면에 **보고서 제목 + 대상학년** 표시
- ✅ 해상도 1920×1080 이상 정상 동작, 반응형
- ✅ `source/` = `program/` 동일 복사본
- 🔑 API 키는 소스에 넣지 않음 → 교사 설정화면 입력 → Firebase 교사계정에 저장

---

## 3. 폴더 구조

```
program/
├── index.html
├── css/style.css
└── js/
    ├── app.js        (라우터·전역상태)
    ├── firebase.js   (Firebase 초기화)
    ├── auth.js       (로그인·권한)
    ├── dashboard.js
    ├── scheduler.js  ★스케줄러+달력+투두
    ├── messenger.js
    ├── lesson.js     (교과수업)
    ├── assessment.js (평가)
    ├── homework.js   (과제방)
    ├── chatbot.js    (AI 질문방)
    ├── collab.js     (협업)
    ├── portfolio.js
    ├── mathsketch.js
    └── ai.js         (Claude API 호출)
```

---

## 4. 사이드바 메뉴 순서 (확정)

```
1. 📅 스케줄러   (달력·일정·투두 / 교사→학생 일정 공유)
2. 💬 메신저
3. 📚 학습실     (교과수업 / 협업의장 / 과제방)
4. 🤖 질문방     (AI 챗봇)
5. 🛠️ 기타       (바이브코딩 / 수학그림작성기)
6. 🏆 포트폴리오
```

레이아웃: **1:9 CSS Grid** (사이드바 1 : 본문 9), 토글로 전체화면 전환.

---

## 5. 개발 원칙

**하나 완성 → 오류 점검 → 이상 없으면 다음 STEP**
각 STEP의 "완료 기준" 충족 시 진행. 오류 시 해당 STEP에서 해결.

---

## 6. 개발 순서 (STEP 01~14)

| STEP | 기능 | 완료 기준 |
|------|------|----------|
| 01 | Firebase 설정 + index.html 뼈대 + 1:9 레이아웃 | 레이아웃 표시, 사이드바 토글 |
| 02 | 인증(로그인·권한·학생 엑셀 일괄등록) | 교사/학생 로그인 분기 |
| 03 | 대시보드(반별 현황·접속·복습퀴즈) | 데이터 로드·표시 |
| **04** | **★스케줄러+달력+투두 (교사→학생 공유)** | 일정 보내기→학생 달력 반영 |
| 05 | 메신저(실시간·사진·카메라·알림) | 실시간 송수신·사진 업로드 |
| 06 | 교과수업(생성·열람·복사·동기화) | 수업 생성·복사·열람 |
| 07 | 수업노트(터치필기·PDF업로드/출력) | 필기·PDF 동작 |
| 08 | 평가(유형별·자동채점·역량레이더) | 응시·채점·차트 |
| 09 | 과제방(제출·AI사진분석·투두연동) | 등록·알림·제출 |
| 10 | AI챗봇(수학자캐릭터·소크라테스·그래프) | 대화·그래프 |
| 11 | 협업 화이트보드+게이미피케이션 | 동시편집·대전 |
| 12 | 포트폴리오+뱃지+AI관찰기록 | 생성·PDF출력 |
| 13 | 기타(수학그림·바이브코딩·다국어) | 각 기능 동작 |
| 14 | 통합테스트+블라인드검수+제출준비 | 오류0·블라인드0건 |

---

## 7. ★ STEP 04 스케줄러 핵심 (신규 기능)

**흐름**: 교사 일정 등록 → `[학생에게 보내기]` 클릭 → Firebase → 선택 반 학생 전원 달력 자동 저장

**달력**
- FullCalendar.js, 월/주/일 뷰
- 교사 발송 일정 = 🔵파랑(학생 삭제불가) / 과제마감 = 🟠주황(과제방 자동연동) / 개인 = ⚪회색(본인만)

**투두리스트** (달력 우측 패널)
- 날짜 클릭 → 해당 날 할 일, 체크 시 Firebase 저장(기기간 동기화)
- source: `manual`(직접) | `homework`(과제연동) | `teacher`(교사발송)

**Firebase 구조**
```
/schedules/{userId}/events/{eventId}
  title, date, time, color, memo, isFromTeacher, classId, createdAt
/todos/{userId}/{date}/{todoId}
  text, done, priority, source
```

---

## 8. 핵심 기능 요약

**인증**: 학생 아이디=학년반번호(예 10701), 초기PW=아이디, 첫로그인 PW변경강제, 교사가 PW초기화.

**메신저**: Firebase onValue() 실시간, 사진/카메라(getUserMedia), 읽음표시, 알림배지, 수업 질문 시 슬라이드번호 자동첨부, 교사전용 유의미질문 체크(학생비공개).

**교과수업**: 슬라이드 타입(개념기반/수업노트/유튜브/임베디드/평가). 학생은 **배정된 반 수업만** 열람. **수업 복사**(다른 반으로 전체 복제, 체크박스 다중선택). 교사 슬라이드 변경→학생 화면 동기화. 화면이탈 경고(visibilitychange).

**수업노트**: Canvas+Pointer Events 터치필기, 더블클릭→펜모드, PDF.js 슬라이드(최대30장), jsPDF 출력.

**평가**: 객관식/다중/참거짓/빈칸/서술형/수식/그래프/드래그/워드클라우드/막대그래프. AI 서술형 피드백. 수학 5대 핵심역량 레이더(문제해결·추론·의사소통·연결·정보처리). 총괄평가 하→중→상·동형문제.

**과제방**: 등록→메신저알림+학생투두 자동추가. 기한초과 경고음(AudioContext)+배너. 사진제출→Claude Vision 분석→의심 플래그→교사확인.

**AI챗봇**: 수학자캐릭터(뉴턴·가우스·오일러), 소크라테스식(답 직접제공 금지 프롬프트), function-plot 그래프, 공개질문 익명처리·포인트·뱃지.

**포트폴리오**: 접속시간·참여도·성공률 기록, Claude API 관찰기록 자동생성, 뱃지, jsPDF 출력.

---

## 9. 대체안 (구현 불가 → 확정 대체)

| 원래 | 대체 |
|------|------|
| 카카오톡 알림 | 앱 내 메신저 알림 완전 대체 |
| 실시간 화면동기화 | Firebase onValue() |
| 카메라 file:// 차단 | Firebase Hosting HTTPS |
| 외부 문제DB(저작권) | 교사 PDF 업로드→Claude 파싱 |
| 손필기 채점 | Claude Vision + 교사 확인 |
| 외부 임베디드(CORS) | 임베드 자동감지→불가시 새 창 버튼 |

---

## 10. 감점 방지 (각 1점)

① 보고서 분량초과(본문10p/요약2p) ② 블라인드 미처리 ③ 컬러인쇄 ④ 글꼴(바탕체) 미준수

---

## 11. 검증 체크

1. `program/index.html` 브라우저 실행
2. 교사/학생 로그인 분리
3. 태블릿 터치필기
4. 1920×1080 레이아웃
5. grep로 학교명·성명·지역명 0건
6. Chrome·Edge·Safari
7. 시나리오: 수업→평가→메신저→과제

---

## 12. 메신저 푸시 알림

**Level A (구현됨 · STEP 05)** — 앱이 켜져 있는 동안 새 메시지를 **OS 알림 배너**로 표시.
- Web Notifications API(페이지 컨텍스트)만 사용 → **서버·서비스워커·과금 불필요**.
- 기존 `inbox/{uid}` 실시간 구독의 델타(안읽음 증가)로 발화. 메신저 헤더 🔔 토글로 권한 요청(자동 프롬프트 금지).
- 자기 메시지·현재 보고 있는 대화는 알림 제외. **HTTPS/localhost 필요**(`file://` 차단), Firebase 연결 시에만 동작.

**Level B (미구현 · 향후 확장)** — 앱을 **완전히 닫아도** 푸시. 대회 제출본 범위 밖(백엔드·과금 필요).
1. Firebase 콘솔: Cloud Messaging 활성화 + **VAPID 키** 발급, **Blaze(유료) 플랜** 전환.
2. `index.html`에 `firebase-messaging-compat.js` 추가 + 도메인 루트에 **`firebase-messaging-sw.js`** 생성.
3. 클라이언트: 권한 요청 → `getToken({vapidKey})` → 토큰을 `/users/{uid}/fcmTokens/{token}=true` 저장. 포그라운드 `onMessage`, 백그라운드 SW `onBackgroundMessage`.
4. **Cloud Functions**: `messages/{threadId}/{msgId}` `onCreate` 트리거 → 수신자(`to`) 토큰 조회 → `admin.messaging().send()`. `firebase deploy --only functions`.
5. Safari/iOS는 16.4+ & **홈화면 추가(PWA)** 필요 → `manifest.webmanifest` 권장.

---
> 상세 본문: `개발계획서.html` / 전체 계획: `~/.claude/plans/c-users-user-desktop-pdf-dl-snoopy-church.md`
