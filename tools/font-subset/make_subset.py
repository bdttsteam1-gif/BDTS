"""IBM Plex Sans KR 글꼴을 포털에서 쓰는 글자만 남겨 다시 만듭니다.

사용법 (저장소 최상위 폴더에서):
  pip install fonttools brotli
  npm pack @ibm/plex-sans-kr@1.1.0 && tar -xzf ibm-plex-sans-kr-1.1.0.tgz
  python tools/font-subset/make_subset.py package/fonts/complete/woff2/hinted
"""
import os, sys, subprocess
from fontTools.ttLib import TTFont

SRC = sys.argv[1] if len(sys.argv) > 1 else 'package/fonts/complete/woff2/hinted'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'fonts', 'ibm-plex-sans-kr')
WEIGHTS = ['Regular', 'Medium', 'SemiBold', 'Bold']

cmap = set(TTFont(os.path.join(SRC, 'IBMPlexSansKR-Regular.woff2')).getBestCmap())

# 1) 한글 KS X 1001 완성형 2,350자
ks = set()
for b1 in range(0xB0, 0xC9):
    for b2 in range(0xA1, 0xFF):
        try: ks.add(ord(bytes([b1, b2]).decode('euc-kr')))
        except UnicodeDecodeError: pass

# 2) 영문·숫자·기호·한글 자모·전각 문자
base = set(range(0x20, 0x7F)) | set(range(0xA0, 0x180)) | set(range(0x2000, 0x2070)) \
     | set(range(0x2100, 0x2200)) | set(range(0x2460, 0x24FF)) | set(range(0x25A0, 0x2600)) \
     | set(range(0x3000, 0x3040)) | set(range(0x3131, 0x318F)) | set(range(0xFF01, 0xFF5F))

# 3) 저장소 화면·데이터 파일에 실제로 나오는 글자 (병원명·이름의 드문 글자 포함)
used = set()
for dp, dn, fn in os.walk(ROOT):
    if 'fonts' in dp or 'node_modules' in dp or '.git' in dp: continue
    for n in fn:
        if n.endswith(('.html', '.js', '.json', '.css', '.md')):
            with open(os.path.join(dp, n), encoding='utf-8', errors='ignore') as f:
                used |= {ord(c) for c in f.read()}

want = sorted((base | ks | used) & cmap)
uni = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'unicodes.txt')   # 글자 목록은 도구 폴더에 (웹에는 올라가지 않음)
with open(uni, 'w') as f:
    f.write('\n'.join('U+%04X' % c for c in want))
print('글자 수:', len(want))

for w in WEIGHTS:
    subprocess.run(['pyftsubset', os.path.join(SRC, f'IBMPlexSansKR-{w}.woff2'),
                    f'--unicodes-file={uni}', '--flavor=woff2', '--layout-features=*',
                    '--no-hinting', '--desubroutinize',
                    f'--output-file={os.path.join(OUT, f"IBMPlexSansKR-{w}-subset.woff2")}'], check=True)
    print(w, '완료')
