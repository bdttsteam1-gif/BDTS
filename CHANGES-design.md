# bdts-portal-main 디자인 적용 변경 내역 (2026-09-04, 2차)

## 원칙
- bdts-portal-github(리디자인)의 **디자인만** 가져왔습니다. 팔레트 · 레일 레이아웃 · 표/칩/버튼/팝업 규칙 · 사진 이미지.
- 각 화면의 입력 항목 · ID · 버튼 동작 · 저장/검색/연동 로직 · 데이터 파일은 **전혀 바꾸지 않았습니다.**
- 글꼴·사진은 모두 저장소 안에 들어 있어 **외부 인터넷 접속이 필요 없습니다.**

## 글꼴
- 본문·제목: **Pretendard Variable** (assets/fonts/pretendard/PretendardVariable.woff2 한 파일, SIL OFL). 이전 원본이 지정만 하고 불러오지 않던 글꼴을 실제로 포함해, 어느 PC에서나 같은 모양으로 보입니다. 한글·영문·숫자가 한 벌이라 섞임이 없습니다.
- 워드마크(BDTS)·KPI 숫자·코드 표기: **Space Grotesk** (assets/fonts/space-grotesk, SIL OFL). 리디자인의 편집 디자인 느낌을 영문·숫자에만 사용.
- 리디자인의 DM Sans 는 한글이 없어 한 문장에 두 글꼴이 섞이므로 쓰지 않았습니다.

## 사진 (assets/img, 원본 4~6MB → 80~170KB 로 축소)
- 포털 메인 히어로 / 기록하기 홈 / 거래처 이력 / 고객지원센터 / 국내 클레임 머리 / 통합 검색 / 정보조회 머리, 파비콘
- 모두 CSS 배경·가상요소로 넣어 HTML 마크업은 그대로입니다.

## 새 파일
- `assets/theme.css`, `assets/theme.js`, `assets/fonts/**`, `assets/img/**`

## 기존 파일 (각 파일당 3줄 추가, 삭제 0줄)
index.html, pages/audit.html, pages/claim.html, pages/import.html, pages/info.html, pages/records.html, pages/sales.html, pages/search.html
- <head> 끝: 안내 주석 1줄 + theme.css 링크 1줄 / </body> 앞: theme.js 1줄

## 되돌리기
위 8개 파일에서 추가된 3줄을 지우고 assets/theme.css, theme.js, fonts, img 를 삭제하면 원래 디자인으로 돌아갑니다.

## 남은 결정 사항
1. Chart.js 막대/선 색상(파랑 등)은 각 화면 JS 배열에 있어 그대로 두었습니다. 팔레트(moss/tan/ink)로 바꿀지.
2. 레일 메뉴 이름은 기존 BDTS-main 표기 그대로입니다. 프로젝트 문서의 최종 명칭으로 바꿀지.

---

# 3차 변경 (2026-09-15) — 글꼴 · 그래프 색 · 메뉴 글씨

## 1. 글꼴을 IBM Plex Sans KR 하나로 통일
- 본문·제목·워드마크·숫자 모두 **IBM Plex Sans KR** (SIL OFL, `assets/fonts/ibm-plex-sans-kr/`).
- 400·500·600·700 네 두께, **포털에 필요한 글자만 남겨 합계 약 550KB** (이전 Pretendard 한 파일 약 2MB + Space Grotesk).
  - 남긴 글자: 한글 완성형 2,350자 + 영문·숫자·기호 + 저장소 화면·데이터에 실제로 나오는 모든 글자 (총 3,026자)
  - 목록에 없는 드문 글자는 그 글자만 시스템 글꼴(맑은 고딕 등)로 보입니다. 다시 만드는 방법: `tools/font-subset/README.md`
- 이전 글꼴 파일(`assets/fonts/pretendard`, `assets/fonts/space-grotesk`)은 더 이상 쓰지 않아 삭제했습니다.
- 바뀐 곳: `assets/theme.css`(글꼴 선언·변수), `assets/theme.js`(Chart.js 기본 글꼴), `assets/portal.css`, `assets/auth-gate.js`(로그인 화면),
  `pages/info.html`·`records.html`·`sales.html`·`search.html`(본문 글꼴 지정), `pages/records.html`·`claim.html`(그래프 숫자 글꼴)

## 2. 통합 클레임 로그 대시보드 그래프 색 = Sales Report
- `pages/claim.html` 의 `COLORS` 를 Sales Report 의 `PAL` 과 같은 색·같은 순서로 바꿨습니다.
- 반투명 막대 + 테두리 → Sales Report 처럼 채운 막대(모서리 4px). 예전 어두운 화면용 격자색(#2d3150)·글자색(#8b90b8)도 걷어내고 공통 기본값을 씁니다.

## 3. 왼쪽 메뉴 글씨 크기
- 메뉴 이름을 12px → **19px** (최근 이슈 화면의 패널 제목 "해외"와 같은 크기). `assets/theme.css` `.bdts-rail .nav-copy b`
- 레일은 "가 100%" 글자 크기 조절과 무관하게 항상 같은 크기로 보입니다(기존 동작 그대로).

## 4. 쓰지 않는 파일 정리
어느 화면·설정·배포 파일에서도 불러오지 않는 것만 지웠습니다.

| 지운 파일 | 이유 |
|---|---|
| 최상위 `theme.css`, `theme.js` | 옛 디자인 사본. 모든 화면은 `assets/theme.css`, `assets/theme.js` 를 씁니다 |
| 최상위 `claim.html`, `sales.html` | 옛 화면 사본(경로가 `../` 라 최상위에서는 열리지도 않음). 실제 화면은 `pages/` |
| 최상위 `fonts/` (Pretendard 조각 89개, 3MB) | 위 옛 `theme.css` 만 쓰던 글꼴 |
| 최상위 `img/` (사진 9개, 856KB) | 위 옛 `theme.css` 만 쓰던 사진. 실제 사진은 `assets/img/` |
| `denied.html` | Entra ID 로그인 시절의 "권한 없음" 화면. 지금은 어떤 설정도 이 화면으로 보내지 않습니다 |
| `assets/img/mark.png` | 어디서도 부르지 않는 그림 |
| `client-data.js` (2MB), `data/clients.json` (2MB) | 옛 거래처 이력 자료(2,164건). 어느 화면도 읽지 않음(통합 검색도 거래처 이력을 따로 검색하지 않음). 사용자 확인 후 삭제 |

그 밖에
- `tools/migrate/#Uc2e4#Ud589#Uc548#Ub0b4.md` → `tools/migrate/실행안내.md` 로 이름 복구 (README 와 이관 안내가 이 이름으로 가리킵니다)
- 글꼴 글자 목록 `unicodes.txt` 를 웹 폴더(`assets/fonts`)에서 `tools/font-subset/` 로 옮김
- README 의 자료 표에서 `client-data.js` 설명을 실제 동작(Azure `client_cards`)에 맞게 고침
- `assets/migrate-convert.js`, `tools/migrate/overrides.json` 의 "깃허브 client-data.js" 문구는 날짜 보정 근거(BDTS-main 기록) 메모라 그대로 둠

---

# 4차 변경 (2026-09-16) — 왼쪽 메뉴에 [출장 보드] 추가

- `assets/theme.js`: Workspace 묶음의 **최근 이슈 바로 아래**에 `출장 보드`(부제: 팀 출장 · 방문 일정, 위치 핀 아이콘) 추가. 화면 `pages/trips.html` 에서 선택 표시.
- 새 파일: `pages/trips.html`(포털 틀), `pages/trip-board.html`(받은 `팀_출장보드.html` 을 포털용으로 옮긴 것), `assets/trip-board-store.js`(Azure 연결).
- `팀_출장보드.html` 에서 바꾼 점
  - 구글 폰트 연결 삭제 → 포털 내장 IBM Plex Sans KR 사용
  - 밝은 화면으로 고정(`data-theme="light"`) — 포털 다른 화면에 어두운 모드가 없어서
  - 저장소: Claude 공유 저장소(`window.claude.use("db")`) → Azure(`window.bdtsTripDb()`)
  - 상태 표시 "실시간 공유 중" → "팀 공유 중"(15초 주기 갱신이라)
  - 연결이 끊기면 저장을 막고 이유를 표시
  - 엑셀 기록 가져오기를 한 건씩 → 500건씩 한꺼번에(`importNew`)
  - 포털 "가 100%" 글자 크기 설정을 보드에도 적용(100% = 보드 원래 크기), 팝업·스크롤 높이가 배율에서도 화면 안에 들어오도록 조정
  - 제목 "팀 출장 보드" → "출장 보드"(메뉴 이름과 통일)
- 되돌리기: `theme.js` 의 `trips` 한 줄과 `pin` 아이콘 한 줄을 지우고 위 새 파일 3개를 삭제.
- (추가) 가져오기를 마친 뒤 `pages/trip-board.html` 의 가져오기용 기록(팀원 이름·방문 병원)을 뺐습니다. 원본은 `tools/trip-import/출장기록_가져오기.json`(웹 차단 폴더). 기록이 비어 있으면 가져오기 안내줄·팀원 관리 창의 가져오기 칸이 나타나지 않습니다.
- (추가) 출장 보드 일정 창에 **동행인** 칸 추가(같은 일정이 동행인 달력에도 생김, `groupId` 로 묶음·같이 수정·빼면 삭제). 팀원 칸·전체 달력 팀원 필터를 드롭다운 → **직접 입력**(추천 목록, 없는 이름은 빨간색)으로 변경.
- (추가) 출장 보드 전체 달력의 **출장 이력은 목록만** 표시, 팀원별 요약표는 **관리자 전용 [대시보드] 탭**으로 옮기고 월별·TOP 10 순위를 추가. 출장 이력 **엑셀 다운로드** 추가(현재 조건 전체, 최신순, 날짜는 글자).
