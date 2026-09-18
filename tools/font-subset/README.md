# 글꼴 줄이기 (IBM Plex Sans KR)

포털 글꼴은 `assets/fonts/ibm-plex-sans-kr/` 에 있는 4개 파일(400·500·600·700)입니다.
원본 전체(약 1.7MB)에서 포털에 필요한 글자만 남겨 약 550KB로 줄였습니다.

남긴 글자
- 한글 완성형 2,350자(KS X 1001)
- 영문·숫자·기호·자모·전각 문자
- 저장소의 화면·데이터 파일(거래처·클레임·매출 등)에 실제로 나오는 모든 글자

남긴 글자 목록은 `tools/font-subset/unicodes.txt` 에 있습니다.
목록에 없는 드문 글자(예: 새로 입력된 병원명의 희귀 한글)는 그 글자만 맑은 고딕 등 시스템 글꼴로 보입니다.
이런 글자가 늘어나면 아래 순서로 다시 만들면 됩니다.

```
pip install fonttools brotli
npm pack @ibm/plex-sans-kr@1.1.0 && tar -xzf ibm-plex-sans-kr-1.1.0.tgz
python tools/font-subset/make_subset.py package/fonts/complete/woff2/hinted
```
