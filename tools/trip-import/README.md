# 출장 보드 가져오기용 원본 기록

- `출장기록_가져오기.json`: 엑셀 '기술영업 리스트'에서 옮긴 팀원 29명 · 일정 1,009건 (예전 `pages/trip-board.html` 안에 들어 있던 내용)
- 2026-09-16, 운영 Azure(`trip_members`, `trip_trips`)로 가져오기를 마친 뒤 보드 파일에서 뺐습니다.
  보드 파일은 로그인 없이 주소로 열리기 때문입니다. `tools/` 폴더는 웹에서 열리지 않습니다(staticwebapp.config.json).
- 다시 가져와야 할 때: 이 JSON 내용을 `pages/trip-board.html` 의 `<script type="application/json" id="importData">` 안에 넣어 배포 →
  출장 보드 [가져오기] (이미 있는 건은 건너뜀) → 다시 `{"members":[],"batches":[]}` 로 비워 배포.
- 주의: 깃허브 저장소의 예전 커밋에는 이 기록이 남아 있습니다. 저장소가 비공개인지 확인해 주세요.
