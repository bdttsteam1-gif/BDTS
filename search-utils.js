// search-utils.js — 한글↔영문 스마트 검색 + 자동완성 드롭다운 공용 모듈
// ------------------------------------------------------------------
//  1) SearchUtils.makeMatcher(query) → function(text): boolean
//     - 영문 데이터를 한글로 검색: "장명선" → "Myoungseon JANG" 매칭 (로마자 표기 변형 지원)
//     - 국가명 한↔영: "체코" → "CZECH REPUBLIC", "vietnam" → "베트남" 등
//  2) SearchUtils.attachAutocomplete(input, provider, opts)
//     - 이니셜/일부만 입력하면 국가·대리점 등을 드롭다운으로 제안 (↑↓·Enter·클릭 선택)
// ------------------------------------------------------------------
(function () {
  'use strict';

  /* ============ 국가명 한↔영 사전 ============ */
  // [영문(데이터 표기, 소문자 비교), 한글] — 영문 별칭은 | 로 구분
  var COUNTRY_PAIRS = [
    ['korea|south korea|republic of korea', '한국|대한민국'],
    ['usa|united states|u.s.a|america', '미국'],
    ['china', '중국'], ['japan', '일본'], ['taiwan', '대만|타이완'],
    ['hong kong|hongkong', '홍콩'], ['macau|macao', '마카오'],
    ['mongolia', '몽골'], ['vietnam|viet nam', '베트남'], ['thailand', '태국|타이'],
    ['philippines', '필리핀'], ['indonesia', '인도네시아'], ['malaysia', '말레이시아'],
    ['singapore', '싱가포르'], ['myanmar|burma', '미얀마'], ['cambodia', '캄보디아'],
    ['laos', '라오스'], ['india', '인도'], ['pakistan', '파키스탄'],
    ['bangladesh', '방글라데시'], ['nepal', '네팔'], ['sri lanka|srilanka', '스리랑카'],
    ['maldives', '몰디브'], ['bhutan', '부탄'], ['afghanistan', '아프가니스탄'],
    ['kazakhstan', '카자흐스탄'], ['uzbekistan', '우즈베키스탄'], ['kyrgyzstan', '키르기스스탄|키르기즈스탄'],
    ['tajikistan', '타지키스탄'], ['turkmenistan', '투르크메니스탄'], ['azerbaijan', '아제르바이잔'],
    ['armenia', '아르메니아'], ['georgia', '조지아|그루지야'],
    ['turkey|turkiye', '터키|튀르키예'], ['iran', '이란'], ['iraq', '이라크'],
    ['israel', '이스라엘'], ['palestine', '팔레스타인'], ['jordan', '요르단'],
    ['lebanon', '레바논'], ['syria', '시리아'], ['saudi arabia|saudi', '사우디아라비아|사우디'],
    ['uae|united arab emirates|u.a.e', '아랍에미리트|두바이'], ['qatar', '카타르'],
    ['kuwait', '쿠웨이트'], ['bahrain', '바레인'], ['oman', '오만'], ['yemen', '예멘'],
    ['egypt', '이집트'], ['libya', '리비아'], ['tunisia', '튀니지'], ['algeria', '알제리'],
    ['morocco', '모로코'], ['mauritania', '모리타니'], ['sudan', '수단'],
    ['ethiopia', '에티오피아'], ['kenya', '케냐'], ['tanzania', '탄자니아'],
    ['uganda', '우간다'], ['rwanda', '르완다'], ['burundi', '부룬디'],
    ['somalia', '소말리아'], ['djibouti', '지부티'], ['eritrea', '에리트레아'],
    ['nigeria', '나이지리아'], ['ghana', '가나'], ['senegal', '세네갈'],
    ['cote d ivoire|cote divoire|ivory coast', '코트디부아르'], ['cameroon', '카메룬'],
    ['burkina faso', '부르키나파소'], ['mali', '말리'], ['niger', '니제르'],
    ['benin', '베냉'], ['togo', '토고'], ['guinea', '기니'], ['gabon', '가봉'],
    ['congo|democratic republic of the congo|dr congo|drc', '콩고'], ['angola', '앙골라'],
    ['zambia', '잠비아'], ['zimbabwe', '짐바브웨'], ['mozambique', '모잠비크'],
    ['malawi', '말라위'], ['botswana', '보츠와나'], ['namibia', '나미비아'],
    ['south africa', '남아프리카공화국|남아공'], ['madagascar', '마다가스카르'],
    ['mauritius', '모리셔스'], ['cabo verde|cape verde', '카보베르데'],
    ['chad', '차드'], ['liberia', '라이베리아'], ['sierra leone', '시에라리온'],
    ['gambia', '감비아'], ['lesotho', '레소토'], ['eswatini|swaziland', '에스와티니'],
    ['uk|united kingdom|great britain|england', '영국'], ['ireland', '아일랜드'],
    ['france', '프랑스'], ['germany', '독일'], ['italy', '이탈리아'],
    ['spain', '스페인'], ['portugal', '포르투갈'], ['netherlands|holland', '네덜란드'],
    ['belgium', '벨기에'], ['luxembourg', '룩셈부르크'], ['switzerland', '스위스'],
    ['austria', '오스트리아'], ['denmark', '덴마크'], ['sweden', '스웨덴'],
    ['norway', '노르웨이'], ['finland', '핀란드'], ['iceland', '아이슬란드'],
    ['poland', '폴란드'], ['czech republic|czechia|czech', '체코'],
    ['slovakia', '슬로바키아'], ['hungary', '헝가리'], ['romania', '루마니아'],
    ['bulgaria', '불가리아'], ['greece', '그리스'], ['cyprus', '키프로스'],
    ['croatia', '크로아티아'], ['slovenia', '슬로베니아'], ['serbia', '세르비아'],
    ['bosnia|bosnia and herzegovina', '보스니아'], ['montenegro', '몬테네그로'],
    ['north macedonia|macedonia', '북마케도니아|마케도니아'], ['albania', '알바니아'],
    ['kosovo', '코소보'], ['moldova', '몰도바'], ['ukraine', '우크라이나'],
    ['belarus', '벨라루스'], ['russia', '러시아'], ['lithuania', '리투아니아'],
    ['latvia', '라트비아'], ['estonia', '에스토니아'], ['malta', '몰타'],
    ['canada', '캐나다'], ['mexico', '멕시코'], ['guatemala', '과테말라'],
    ['honduras', '온두라스'], ['el salvador', '엘살바도르'], ['nicaragua', '니카라과'],
    ['costa rica', '코스타리카'], ['panama', '파나마'], ['cuba', '쿠바'],
    ['dominican republic', '도미니카공화국|도미니카'], ['haiti', '아이티'],
    ['jamaica', '자메이카'], ['trinidad|trinidad and tobago', '트리니다드토바고'],
    ['colombia', '콜롬비아'], ['venezuela', '베네수엘라'], ['ecuador', '에콰도르'],
    ['peru', '페루'], ['bolivia', '볼리비아'], ['brazil', '브라질'],
    ['chile', '칠레'], ['argentina', '아르헨티나'], ['uruguay', '우루과이'],
    ['paraguay', '파라과이'], ['guyana', '가이아나'], ['suriname', '수리남'],
    ['australia', '호주|오스트레일리아'], ['new zealand', '뉴질랜드'],
    ['fiji', '피지'], ['papua new guinea', '파푸아뉴기니']
  ];

  // 빠른 조회 테이블
  var EN_LIST = [];   // {en:[...], ko:[...]}
  COUNTRY_PAIRS.forEach(function (p) {
    EN_LIST.push({ en: p[0].split('|'), ko: p[1].split('|') });
  });

  function hasHangul(s) { return /[가-힣]/.test(s); }
  function normLatin(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, ''); }

  // 한글 질의 → 매칭되는 영문 국가명 목록 / 영문 질의 → 한글 국가명 목록
  function countryAliases(q) {
    var out = [];
    var ql = q.toLowerCase().trim();
    if (!ql) return out;
    EN_LIST.forEach(function (e) {
      var i;
      if (hasHangul(ql)) {
        for (i = 0; i < e.ko.length; i++) {
          if (e.ko[i].indexOf(ql) !== -1 || ql.indexOf(e.ko[i]) !== -1) {
            out = out.concat(e.en).concat(e.ko);
            return;
          }
        }
      } else {
        for (i = 0; i < e.en.length; i++) {
          if (e.en[i].indexOf(ql) === 0 || (ql.length >= 3 && e.en[i].indexOf(ql) !== -1)) {
            out = out.concat(e.ko).concat(e.en);
            return;
          }
        }
      }
    });
    return out;
  }

  // 영문 국가명 → 한글 표기 (자동완성 보조 라벨용)
  function koNameOf(enName) {
    var n = String(enName || '').toLowerCase().trim();
    for (var i = 0; i < EN_LIST.length; i++) {
      var e = EN_LIST[i];
      for (var j = 0; j < e.en.length; j++) {
        if (e.en[j] === n) return e.ko[0];
      }
    }
    return '';
  }

  /* ============ 한글 → 로마자 표기 변형 매칭 ============ */
  var CHO = [['g','k'],['kk','gg','k'],['n'],['d','t'],['tt','dd'],['r','l'],['m'],['b','p'],['pp','bb'],
             ['s','sh'],['ss','s'],[''],['j','ch','z'],['jj','zz'],['ch','c'],['k','c','q'],['t'],['p','f'],['h']];
  var JUNG = [['a','ah','ar'],['ae','e','a'],['ya'],['yae','ye'],['eo','u','o','au'],['e','ae','eh'],
              ['yeo','yo','yu','you'],['ye','yeh'],['o','oh'],['wa','oa'],['wae','we'],['oe','oi','we'],
              ['yo'],['u','oo','woo','w'],['wo','weo','wu'],['we'],['wi','wee','ui'],['yu','yoo','you','u'],
              ['eu','u','e'],['ui','ee','eui','i'],['i','ee','yi','e']];
  var JONG = [[''],['k','g'],['k','kk'],['k','ks'],['n'],['n','nj'],['n','nh'],['t','d'],['l','r'],
              ['k','lk','lg'],['m','lm'],['l','lb','p'],['l','ls'],['l','lt'],['p','lp'],['l','lh'],
              ['m'],['p','b'],['p','ps'],['t','s'],['t','ss'],['ng'],['t','j'],['t','ch'],['k'],['t'],['p','f'],['t','h']];

  // 한 음절의 로마자 변형 목록 (초성×중성×종성 조합, 상한 24개)
  var _sylCache = {};
  function sylVariants(ch) {
    if (_sylCache[ch]) return _sylCache[ch];
    var code = ch.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return (_sylCache[ch] = [ch.toLowerCase()]);
    var cho = CHO[Math.floor(code / 588)];
    var jung = JUNG[Math.floor((code % 588) / 28)];
    var jong = JONG[code % 28];
    var out = [];
    for (var a = 0; a < cho.length && out.length < 24; a++) {
      for (var b = 0; b < jung.length && out.length < 24; b++) {
        for (var c = 0; c < jong.length && out.length < 24; c++) {
          var v = cho[a] + jung[b] + jong[c];
          if (v && out.indexOf(v) === -1) out.push(v);
        }
      }
    }
    // 자주 쓰는 이름 표기 예외
    var SPECIAL = { '이': ['lee', 'yi', 'rhee', 'i', 'e'], '박': ['park', 'pak', 'bak'], '최': ['choi', 'choe'],
                    '유': ['yoo', 'yu', 'ryu', 'you'], '임': ['lim', 'im', 'yim'], '노': ['no', 'noh', 'roh'],
                    '오': ['oh', 'o'], '우': ['woo', 'u', 'wu'], '신': ['shin', 'sin'], '식': ['sik', 'shik'],
                    '허': ['heo', 'hur', 'huh', 'her'], '엄': ['eom', 'um', 'om'], '희': ['hee', 'hui', 'hi'] };
    if (SPECIAL[ch]) SPECIAL[ch].forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
    return (_sylCache[ch] = out);
  }

  // 한글 음절 배열이 (변형 조합으로) latin 문자열 안에 '연속으로' 나타나는지
  function seqInLatin(latin, sylls, allowPartialTail) {
    var variantLists = sylls.map(sylVariants);
    function dfs(pos, idx) {
      if (idx === variantLists.length) return true;
      var vs = variantLists[idx];
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (!v) { if (dfs(pos, idx + 1)) return true; continue; }
        if (latin.substr(pos, v.length) === v) {
          if (dfs(pos + v.length, idx + 1)) return true;
        } else if (allowPartialTail && idx === variantLists.length - 1 &&
                   pos < latin.length && v.indexOf(latin.substr(pos)) === 0 && latin.length - pos >= 1) {
          // 마지막 음절이 문자열 끝에서 일부만 일치해도 허용 (자동완성용)
          return true;
        }
      }
      return false;
    }
    for (var start = 0; start <= latin.length - 1; start++) {
      if (dfs(start, 0)) return true;
    }
    return false;
  }

  // 한글 질의(예: 장명선)가 영문 텍스트(예: Myoungseon JANG)에 매칭되는지
  function hangulQueryMatchesLatin(latinText, hangulQuery) {
    var latin = normLatin(latinText);
    if (!latin) return false;
    var sylls = hangulQuery.replace(/\s+/g, '').split('').filter(function (c) { return /[가-힣]/.test(c); });
    if (!sylls.length) return false;
    if (sylls.length > 8) sylls = sylls.slice(0, 8); // 성능 보호
    if (seqInLatin(latin, sylls, false)) return true;
    // 이름: 한글(성+이름) ↔ 영문(이름+성) 순서 뒤집힘 대응 — 첫 음절(성)을 뒤로
    if (sylls.length >= 2 && sylls.length <= 4) {
      var rot = sylls.slice(1).concat(sylls[0]);
      if (seqInLatin(latin, rot, false)) return true;
    }
    return false;
  }

  // 영문 질의(예: myoung)가 한글 텍스트(예: 장명선)의 로마자 표기에 매칭되는지
  function latinQueryMatchesHangul(hangulText, latinQuery) {
    var q = normLatin(latinQuery);
    if (!q || q.length < 2) return false;
    var sylls = String(hangulText).split('').filter(function (c) { return /[가-힣]/.test(c); });
    if (!sylls.length || sylls.length > 20) return false;
    // 각 시작 음절부터 변형을 이어붙여 q를 소진할 수 있는지 확인 (마지막은 부분 일치 허용)
    var lists = sylls.map(sylVariants);
    function dfs(sIdx, pos) {
      if (pos === q.length) return true;
      if (sIdx === lists.length) return false;
      var vs = lists[sIdx];
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (!v) continue;
        var rest = q.length - pos;
        if (rest >= v.length) {
          if (q.substr(pos, v.length) === v && dfs(sIdx + 1, pos + v.length)) return true;
        } else {
          if (v.indexOf(q.substr(pos)) === 0) return true; // 질의가 음절 중간에서 끝남
        }
      }
      return false;
    }
    for (var s = 0; s < lists.length; s++) {
      if (dfs(s, 0)) return true;
    }
    return false;
  }

  /* ============ 매처 팩토리 ============ */
  // 질의 1개에 대해 미리 계산해두고 텍스트마다 빠르게 판정
  function makeMatcher(query) {
    var q = String(query || '').trim();
    var ql = q.toLowerCase();
    var isHangul = hasHangul(q);
    var aliases = countryAliases(q).map(function (a) { return a.toLowerCase(); });

    return function (text) {
      if (!q) return true;
      var t = String(text == null ? '' : text).toLowerCase();
      if (!t) return false;
      if (t.indexOf(ql) !== -1) return true;                      // 1) 직접 부분일치
      for (var i = 0; i < aliases.length; i++) {                  // 2) 국가명 한↔영
        if (aliases[i] && t.indexOf(aliases[i]) !== -1) return true;
      }
      if (isHangul) {                                             // 3) 한글 → 로마자 이름 매칭
        if (t.length <= 60 && hangulQueryMatchesLatin(t, q)) return true;
      } else if (hasHangul(t)) {                                  // 4) 영문 → 한글 텍스트 매칭
        if (t.length <= 40 && latinQueryMatchesHangul(t, ql)) return true;
      }
      return false;
    };
  }

  function smartIncludes(text, query) { return makeMatcher(query)(text); }

  /* ============ 자동완성 드롭다운 ============ */
  // provider(): [{ value:'CZECH REPUBLIC', label:'CZECH REPUBLIC', sub:'체코 · 국가' }, ...]
  // opts: { onSelect(item), maxItems }
  var _acCssDone = false;
  function ensureAcCss() {
    if (_acCssDone) return; _acCssDone = true;
    var css = document.createElement('style');
    css.textContent =
      '.su-ac{position:absolute;left:0;right:0;top:calc(100% + 4px);background:#fff;border:1px solid #d1d5db;' +
      'border-radius:10px;box-shadow:0 10px 26px rgba(0,0,0,.14);z-index:500;max-height:320px;overflow-y:auto;display:none;}' +
      '.su-ac.open{display:block;}' +
      '.su-ac-item{display:flex;align-items:center;gap:8px;padding:9px 13px;font-size:13.5px;cursor:pointer;color:#111827;}' +
      '.su-ac-item .su-sub{margin-left:auto;font-size:11.5px;color:#9ca3af;white-space:nowrap;}' +
      '.su-ac-item:hover,.su-ac-item.sel{background:#eff6ff;color:#1d4ed8;}' +
      '.su-ac-hint{padding:7px 13px;font-size:11px;color:#9ca3af;border-top:1px solid #f1f5f9;}';
    document.head.appendChild(css);
  }

  function attachAutocomplete(input, provider, opts) {
    opts = opts || {};
    ensureAcCss();
    var wrap = input.parentNode;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    var box = document.createElement('div');
    box.className = 'su-ac';
    wrap.appendChild(box);
    var selIdx = -1, items = [];

    function close() { box.classList.remove('open'); selIdx = -1; }
    function open() { if (items.length) box.classList.add('open'); }

    function render() {
      box.innerHTML = items.map(function (it, i) {
        return '<div class="su-ac-item' + (i === selIdx ? ' sel' : '') + '" data-i="' + i + '">' +
          '<span>' + escHtml(it.label) + '</span>' +
          (it.sub ? '<span class="su-sub">' + escHtml(it.sub) + '</span>' : '') + '</div>';
      }).join('') + '<div class="su-ac-hint">↑↓ 이동 · Enter 선택 · Esc 닫기 — 한글로도 검색됩니다 (예: 체코 → CZECH)</div>';
    }
    function escHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }
    function pick(i) {
      var it = items[i];
      if (!it) return;
      input.value = it.value;
      close();
      if (opts.onSelect) opts.onSelect(it);
    }

    function refresh() {
      var q = input.value.trim();
      if (!q) { items = []; close(); box.innerHTML = ''; return; }
      var all = provider() || [];
      var match = makeMatcher(q);
      var ql = q.toLowerCase();
      var starts = [], contains = [];
      for (var i = 0; i < all.length; i++) {
        var it = all[i];
        var lv = String(it.value).toLowerCase();
        var hay = it.value + ' ' + (it.label || '') + ' ' + (it.sub || '');
        if (lv.indexOf(ql) === 0) starts.push(it);
        else if (match(hay)) contains.push(it);
        if (starts.length + contains.length >= 60) break;
      }
      items = starts.concat(contains).slice(0, opts.maxItems || 12);
      selIdx = -1;
      if (items.length) { render(); open(); } else close();
    }

    input.addEventListener('input', refresh);
    input.addEventListener('focus', function () { if (input.value.trim()) refresh(); });
    // capture 단계(부모)에서 처리 → 페이지의 Enter 검색 핸들러보다 먼저 동작
    wrap.addEventListener('keydown', function (e) {
      if (e.target !== input) return;
      if (!box.classList.contains('open')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); render(); }
      else if (e.key === 'Enter') {
        if (selIdx >= 0) { e.preventDefault(); e.stopPropagation(); pick(selIdx); }
        else close(); // 선택 없이 Enter → 드롭다운 닫고 페이지의 검색 실행에 맡김
      }
      else if (e.key === 'Escape') close();
    }, true);
    box.addEventListener('mousedown', function (e) {
      var t = e.target.closest ? e.target.closest('.su-ac-item') : null;
      if (t) { e.preventDefault(); pick(parseInt(t.getAttribute('data-i'), 10)); }
    });
    document.addEventListener('click', function (e) {
      if (e.target !== input && !box.contains(e.target)) close();
    });
    return { refresh: refresh, close: close };
  }

  window.SearchUtils = {
    makeMatcher: makeMatcher,
    smartIncludes: smartIncludes,
    countryAliases: countryAliases,
    koNameOf: koNameOf,
    attachAutocomplete: attachAutocomplete
  };
})();
