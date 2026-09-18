# tools/migrate — BDTS-main(구글 시트) 운영 데이터 → bdts-portal-main(Azure) 이관

**관리자는 포털 화면에서 xlsx 를 바로 넣으면 됩니다 → `실행안내.md`.** 아래는 같은 규칙의 터미널 버전(개발·검증용)입니다.
브라우저 변환 로직은 `assets/migrate-convert.js` 이며 `convert.py` 와 같은 결과를 냅니다(보정표 `overrides.json` 의 내용은 두 곳에 같이 들어 있습니다 — 하나를 고치면 다른 쪽도 맞춰 주세요).

앞으로 `거래처이력카드.xlsx`(구글 시트 백업본)를 받을 때마다 같은 순서로 반복합니다.

1. `python3 convert.py 거래처이력카드.xlsx`
   - `seed/` 폴더에 JSON 5개 + `이관_검토리포트.md` + `manifest.json` 이 생깁니다.
   - 리포트의 "읽지 못해 비워 둔 날짜"·"목록에 없는 값"을 확인합니다.
   - 사람이 확정한 값은 `overrides.json` 에 적고 다시 실행합니다(적용 내역이 리포트에 남습니다).
2. 관리자로 포털 로그인 → 홈 하단 **[운영 데이터 옮기기]**(pages/import.html)
   - 지금 Azure 에 든 건수 확인 → 지울 저장소 선택 → `seed/*.json` 드롭 → 실행 → 대조 결과 확인
3. 리포트(`이관_검토리포트.md`)를 작업 기록과 함께 보관합니다.

옵션
- `--title-from request|none` : 거래처 이력카드 Title(포털 신규 항목)을 접수사항 첫 줄로 채울지
- `--no-derive-hospital`      : CSC 병원명이 비어 있을 때 제목 앞부분("병원 / …")으로 채우지 않음
- `--base <domestic-base.js>` : 목록 대조 기준 파일(기본: ../../data/domestic-base.js)
- `--value-map value-map.json` : 사용자 확정 값 정리표(원본 값 → 포털 목록 값). 화면(assets/migrate-convert.js)에도 같은 표가 내장되어 있으니 둘을 같이 고칩니다
- `--overrides overrides.json` : 사람이 확정한 날짜 보정표

하지 않는 것
- 마스터로그(클레임 로그 국내)는 만들지 않습니다(`logs: []`). 과거 클레임은 씨앗(data/domestic-rows.js)에 있습니다.
- 원본 값을 고치지 않습니다. 날짜 표기 통일·보정표 적용 외에는 그대로 옮기고, 바뀐 건은 전부 리포트에 남깁니다.
