// recent-issues.js — [최근 이슈] 화면 (pages/issues.html) "최근 30일 클레임 TOP" (2026-09)
//   ※ 처음에는 포털 메인에 있었으나(home-top.js) 2026-09-10 요청으로 별도 화면으로 옮겼습니다.
// ------------------------------------------------------------------
//  오늘을 포함한 최근 30일 동안 접수된 클레임에서 가장 많이 나온
//  아이템 · LOT No. · 대리점(해외) / 병원(국내) 을 해외·국내로 나눠 보여줍니다.
//
//  어느 자료로 세는지
//   - 해외 : 통합 클레임 로그 (data/claims-YYYY.json + 엑셀 업로드분)
//   - 국내 : 기존 건은 통합 클레임 로그,
//            통합 클레임 로그에 아직 없는 번호(새로 작성한 건)는 클레임 로그 (국내) 기준
//            → 같은 Complaint No. 는 한 번만 셉니다. 휴지통에 들어간 국내 건은 세지 않습니다.
//   - 국내는 Distributor 가 항상 Domestic (Korea) 라서 대리점 대신 거래처(Contact)로 순위를 매깁니다.
//
//  날짜는 "YYYY-MM-DD" 글자 그대로 비교합니다 (시간대 변환 없음 → 날짜가 하루 밀리는 일이 없습니다).
// ------------------------------------------------------------------
(function () {
  'use strict';

  var DAYS = 30, TOP = 5;
  var box = document.getElementById('recentIssues');
  if (!box) return;
  /* 이 화면이 pages/ 안에 있으므로 자료·링크 경로 앞에 붙일 값 (포털 루트 기준) */
  var ROOT = /\/pages\//.test(location.pathname) ? '../' : '';

  /* ---------- 날짜 ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymdLocal(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function normDate(v) {
    if (v == null || v === '') return '';
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
    if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
    if (/^\d{5}(\.\d+)?$/.test(s)) {                      /* 엑셀 날짜 숫자 — UTC 로 계산해 하루 밀림 방지 */
      var d = new Date(Math.round((parseFloat(s) - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }
    return '';
  }
  var now = new Date();
  var END = ymdLocal(now);
  var START = ymdLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1)));
  function inWindow(d) { return d && d >= START && d <= END; }

  /* ---------- 글자 정리 ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function key(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s\u00a0\u3000]+/g, ''); }
  var EMPTY = { '': 1, '-': 1, 'n/a': 1, 'na': 1, 'none': 1, '없음': 1, 'unknown': 1, 'unkown': 1, '확인불가': 1 };
  function usable(s) { return !EMPTY[key(s)]; }
  function isDomestic(r) { return /korea/i.test(r.country || '') || /domestic/i.test(r.dist || ''); }

  /* LOT 칸에는 "AAVXB74X\nAAVKB77X", "A, B" 처럼 여러 개가 들어 있기도 합니다 → 하나씩 셉니다.
     글자와 숫자가 섞인 5자 이상만 LOT 로 봅니다 (N/A · Rev · 01 · 괄호 메모 등은 제외). */
  function lotsOf(v) {
    var seen = {}, out = [];
    String(v || '').split(/[\s\u00a0\u3000,\/;]+/).forEach(function (t) {
      t = t.replace(/^[-.·]+|[-.·]+$/g, '').toUpperCase();
      if (!/^[A-Z0-9-]{5,}$/.test(t) || !/[A-Z]/.test(t) || !/[0-9]/.test(t) || seen[t]) return;
      seen[t] = 1; out.push(t);
    });
    return out;
  }

  /* 같은 이름을 대소문자·띄어쓰기만 다르게 쓴 것은 하나로 세고, 가장 많이 쓴 표기로 보여줍니다.
     항목마다 해당 클레임 행(rows)을 함께 담아 두어, 누르면 그 클레임만 모아 볼 수 있습니다. */
  function best(o) { var b = '', c = 0; Object.keys(o).forEach(function (k) { if (o[k] > c) { c = o[k]; b = k; } }); return b; }
  function tally() {
    var m = {};
    return {
      add: function (name, row, sub, country) {
        if (!usable(name)) return;
        var k = key(name), e = m[k] || (m[k] = { n: 0, names: {}, subs: {}, countries: {}, rows: [] });
        e.n++; e.rows.push(row);
        e.names[name] = (e.names[name] || 0) + 1;
        if (sub && usable(sub)) e.subs[sub] = (e.subs[sub] || 0) + 1;
        if (country && usable(country)) e.countries[country] = (e.countries[country] || 0) + 1;
      },
      nameOf: function (s) {                                             /* 다른 칸에서 쓸 대표 표기 */
        var e = m[key(s)]; return e ? best(e.names) : s;
      },
      top: function (n) {
        return Object.keys(m).map(function (k) { var e = m[k]; return { name: best(e.names), sub: best(e.subs), country: best(e.countries), n: e.n, rows: e.rows }; })
          .sort(function (a, b) { return b.n - a.n || (a.name < b.name ? -1 : 1); })
          .slice(0, n);
      }
    };
  }

  /* ---------- 자료 읽기 ---------- */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error(src)); };
      document.head.appendChild(s);
    });
  }
  function getJSON(url) { return fetch(url, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); }); }

  /* 통합 클레임 로그 — 30일이 걸친 연도만 읽습니다. 화면(pages/claim.html)과 같은 방식으로 업로드분을 합칩니다. */
  function loadIntegrated() {
    var y1 = +START.slice(0, 4), y2 = +END.slice(0, 4), want = [];
    for (var y = y1; y <= y2; y++) want.push(String(y));
    return getJSON(ROOT + 'data/meta.json').then(function (meta) {
      var have = (meta.claimYears || []).map(function (x) { return String(x.year); });
      window.CLAIM_YEARS = have.length ? have.slice().sort() : want;
      return want.filter(function (y) { return !have.length || have.indexOf(y) >= 0; });
    }).catch(function () { return want; }).then(function (years) {
      return Promise.all([
        Promise.all(years.map(function (y) { return getJSON(ROOT + 'data/claims-' + y + '.json').catch(function () { return []; }); })),
        (typeof fetchAllClaimExtras === 'function' ? fetchAllClaimExtras() : Promise.resolve({})).catch(function () { return {}; })
      ]).then(function (res) {
        var rows = [];
        years.forEach(function (y, i) {
          var base = Array.isArray(res[0][i]) ? res[0][i] : [];
          var seen = {}; base.forEach(function (r) { seen[String(r.no || '').trim()] = 1; });
          var extra = ((res[1] || {})[y] || []).filter(function (r) { var no = String(r.no || '').trim(); return no && !seen[no]; });
          rows = rows.concat(base, extra);
        });
        return rows;
      });
    });
  }

  /* 클레임 로그 (국내) — Azure 저장분 + (30일이 과거 자료 기간에 걸칠 때만) 과거 자료 파일 */
  function loadDomesticLog() {
    var hub = function (p) { return Promise.resolve().then(p).catch(function () { return []; }); };
    var live = hub(function () { return typeof makeHubStore === 'function' ? makeHubStore('master_log').list() : []; });
    var trash = hub(function () { return typeof makeTrashStore === 'function' ? makeTrashStore().list() : []; });
    var seed = loadScript(ROOT + 'data/domestic-base.js').then(function () {
      var months = Object.keys((window.__SEED && window.__SEED.seqK) || {}).sort();
      if (!months.length) return [];
      var last = months[months.length - 1];                               /* 예: "2607" → 2026-07 말일 */
      var y = 2000 + +last.slice(0, 2), m = +last.slice(2, 4);
      var seedEnd = y + '-' + pad2(m) + '-' + pad2(new Date(y, m, 0).getDate());
      if (START > seedEnd) return [];                                     /* 과거 자료는 30일 안에 들 수 없음 → 안 받음 */
      return loadScript(ROOT + 'data/domestic-rows.js').then(function () { return window.__ROWS || []; });
    }).catch(function () { return []; });
    return Promise.all([live, seed, trash]).then(function (p) {
      var gone = {};
      (p[2] || []).forEach(function (t) { if (t && t.sheet === 'master_log') gone[String(t.id)] = 1; });
      var seen = {}, out = [];
      (p[0] || []).concat(p[1] || []).forEach(function (r) {           /* 저장분이 먼저 → 같은 번호면 최신 수정본 */
        var no = r && String(r.no || '').trim();
        if (!no || seen[no] || gone[no]) return;
        seen[no] = 1; out.push(r);
      });
      return out;
    });
  }

  /* ---------- 계산 ---------- */
  var S = null;   /* 계산 결과 (대리점 정식 명칭을 받은 뒤 다시 그릴 때 씁니다) */
  function termOf(t) { return /clos/i.test(t || '') ? 'Closed' : (t ? 'On Going' : ''); }
  function compute(integrated, domLog) {
    var ov = [], dom = [], integNos = {}, lastDate = '';
    integrated.forEach(function (r) {
      var d = normDate(r.recv_date);
      if (d && d <= END && d > lastDate) lastDate = d;
      if (isDomestic(r)) integNos[String(r.no || '').trim()] = 1;
      if (!inWindow(d)) return;
      var row = { src: '통합 클레임 로그', date: d, no: r.no, country: r.country, dist: r.dist, contact: r.contact,
        item: r.item, lot: r.lot, title: r.title, term: termOf(r.term), complaint: r.complaint, invest: r.invest, reply: r.reply, files: null, raw: r };
      (isDomestic(r) ? dom : ov).push(row);
    });
    var domIntegCount = dom.length, domNew = 0;
    domLog.forEach(function (r) {
      var no = String(r.no || '').trim();
      if (!no || integNos[no]) return;                                    /* 통합 클레임 로그에 있는 번호는 그쪽 기준 */
      var d = normDate(r.recvDate);
      if (!inWindow(d)) return;
      dom.push({ src: '클레임 로그 (국내)', date: d, no: r.no, country: r.country || 'Korea', dist: r.dist, contact: r.contact,
        item: r.item, lot: r.lot, title: r.title, term: termOf(r.term), complaint: r.complaint, invest: r.invesDets, reply: r.reply,
        files: Array.isArray(r.files) ? r.files : null, raw: r });
      domNew++;
    });
    return { ov: ov, dom: dom, domInteg: domIntegCount, domNew: domNew, lastDate: lastDate };
  }
  function officialName(r) { return (typeof officialDist === 'function' && typeof DistAlias !== 'undefined' && DistAlias.ready) ? officialDist(r.raw) : r.dist; }
  /* 대리점 정식 명칭 "회사명; 국가" 에서 국가만 — 없으면 클레임의 Country 칸 */
  function countryPart(name, r) { var m = String(name || '').match(/[;:]\s*([^;:]+)$/); return m ? m[1].trim() : String(r.country || '').trim(); }
  /* 순위 + 칸마다 "값이 비어 있어 빠진 건수" (예: 장비 문의라 Item 이 없는 클레임) */
  function ranks(rows, third) {
    var it = tally(), lt = tally(), th = tally(), miss = { item: 0, lot: 0, third: 0 };
    rows.forEach(function (r) {
      var item = String(r.item || '').trim();
      if (usable(item)) it.add(item, r); else miss.item++;
      var ls = lotsOf(r.lot);
      if (ls.length) ls.forEach(function (l) { lt.add(l, r, item); }); else miss.lot++;
      var t = String(third(r) || '').trim();
      if (usable(t)) th.add(t, r, '', countryPart(t, r)); else miss.third++;
    });
    var lots = lt.top(TOP);
    lots.forEach(function (e) { if (e.sub) e.sub = it.nameOf(e.sub); });   /* LOT 옆 아이템 이름을 아이템 순위와 같은 표기로 */
    return { item: it.top(TOP), lot: lots, third: th.top(TOP), miss: miss };
  }
  /* 대리점 이름 — 한 줄에 다 안 들어가면 회사명만 줄이고 국가는 남깁니다: "Labindustrias…; Guatemala"
     (정식 명칭 "회사명; 국가" 형식일 때. 국가 표기가 없는 이름은 끝을 줄입니다) */
  function oneLineName(name) {
    var m = String(name || '').match(/^(.*?)\s*([;:])\s*([^;:]+)$/);
    if (!m || !m[1]) return '<span class="ht-nm ht-one"><span class="ht-co">' + esc(name) + '</span></span>';
    return '<span class="ht-nm ht-one"><span class="ht-co">' + esc(m[1]) + '</span><span class="ht-cty">' + esc(m[2]) + ' ' + esc(m[3].trim()) + '</span></span>';
  }
  var REG = {};   /* 화면에 그린 순위 항목 — 누르면 여기서 해당 클레임을 꺼냅니다 */
  /* 칸은 항상 5줄 — 최근 30일에 5가지가 안 되면 남는 줄은 "—" 로 비워 두어 해외·국내 크기가 같게 합니다 */
  function col(pid, cid, title, list, opt) {
    opt = opt || {};
    var max = list.length ? list[0].n : 1, lis = [];
    for (var i = 0; i < TOP; i++) {
      var e = list[i];
      if (!e) { lis.push('<li class="ht-row ht-emp"><span class="ht-rk">' + (i + 1) + '</span><span class="ht-nm">—</span></li>'); continue; }
      var id = pid + '-' + cid + '-' + i;
      REG[id] = { panel: pid, col: title, entry: e };
      var nm = opt.oneLine ? oneLineName(e.name)
        : '<span class="ht-nm ht-two"><span class="ht-t">' + esc(e.name) + '</span>' + (e.sub ? '<small>' + esc(e.sub) + '</small>' : '') + '</span>';
      lis.push('<li class="ht-row" role="button" tabindex="0" data-ht="' + id + '" title="' + esc(e.name) + (e.sub ? ' · ' + esc(e.sub) : '') + ' — ' + e.n + '건 · 누르면 클레임 목록">'
        + '<span class="ht-bar" style="width:' + Math.max(4, Math.round(e.n / max * 100)) + '%"></span>'
        + '<span class="ht-rk">' + (i + 1) + '</span>' + nm
        + '<b class="ht-n">' + e.n + '<em>건</em></b></li>');
    }
    var notes = [];
    if (opt.note) notes.push(opt.note);
    if (list.length && list.length < TOP) notes.push(list.length + '가지뿐');
    if (opt.miss) notes.push('미기재 ' + opt.miss + '건 제외');
    return '<div class="ht-col"><h4><span>' + title + '</span>' + (notes.length ? '<small title="' + esc(notes.join(' · ')) + '">' + esc(notes.join(' · ')) + '</small>' : '') + '</h4><ol>' + lis.join('') + '</ol></div>';
  }
  function panel(opt) {
    var note = opt.rows.length ? opt.note : opt.emptyNote;
    var head = '<div class="ht-ph"><span class="ht-tag">' + opt.tag + '</span><h3>' + opt.title + '</h3><span class="ht-total">' + opt.rows.length.toLocaleString() + '<em>건</em></span>'
      + '<span class="ht-note' + (opt.rows.length ? '' : ' ht-warn') + '"' + (note ? ' title="' + esc(String(note).replace(/<[^>]+>/g, '')) + '"' : '') + '>' + (note || '') + '</span>'
      + '<a class="ht-link" href="' + opt.href + '">' + opt.linkLabel + ' →</a></div>';
    var r = opt.rows.length ? ranks(opt.rows, opt.third) : { item: [], lot: [], third: [], miss: {} };
    return '<div class="ht-panel ht-' + opt.id + (opt.rows.length ? '' : ' is-empty') + '">' + head + '<div class="ht-cols">'
      + col(opt.id, 'item', '아이템', r.item, { miss: r.miss.item })
      + col(opt.id, 'lot', 'LOT No.', r.lot, { note: '작은 글씨는 아이템', miss: r.miss.lot })
      + col(opt.id, 'third', opt.thirdTitle, r.third, { oneLine: opt.thirdOneLine, note: opt.thirdNote, miss: r.miss.third }) + '</div></div>';
  }
  var md = function (d) { return d.slice(5).replace('-', '.'); };
  function render() {
    REG = {};
    box.innerHTML =
      '<div class="ht-head"><div class="h-grp ht-grp">최근 30일 클레임 TOP</div>'
      + '<span class="ht-period">' + START + ' ~ ' + END + ' · 접수일 기준 · 오늘 포함 30일</span></div>'
      + '<div class="ht-panels">'
      + panel({
          id: 'ov', tag: 'OVERSEAS', title: '해외', rows: S.ov, third: officialName, thirdTitle: '대리점', thirdOneLine: true,
          thirdNote: '길면 회사명을 줄여 국가까지 표시', href: ROOT + 'pages/claim.html', linkLabel: '통합 클레임 로그',
          emptyNote: '최근 30일 접수 없음' + (S.lastDate ? ' · 통합 클레임 로그 마지막 접수일 <b>' + S.lastDate + '</b> — 새 엑셀을 올리면 바로 반영' : '')
        })
      + panel({
          id: 'dom', tag: 'DOMESTIC', title: '국내', rows: S.dom, third: function (r) { return String(r.contact || '').trim(); }, thirdTitle: '거래처 (Contact)',
          href: ROOT + 'pages/records.html#claim', linkLabel: '클레임 로그 (국내)',
          note: '출처: 통합 클레임 로그 ' + S.domInteg + ' · 클레임 로그 (국내) ' + S.domNew,
          emptyNote: '최근 30일 접수 없음'
        })
      + '</div>';
  }


  /* ---------- 클레임 모아 보기 (팝업) ---------- */
  var modal = null, modalPushed = false;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'htModal'; modal.className = 'ht-modal';
    modal.innerHTML = '<div class="ht-mbox" role="dialog" aria-modal="true"><div class="ht-mhead"></div><div class="ht-mbody"></div></div>'
      + '<div class="ht-lb"><img alt=""><div class="ht-lbcap"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-ht-close]')) { closeModal(); return; }
      var lb = modal.querySelector('.ht-lb');
      if (e.target.closest('.ht-lb')) { lb.classList.remove('on'); return; }
      var im = e.target.closest('img[data-ht-img]');
      if (im) { lb.querySelector('img').src = im.src; lb.querySelector('.ht-lbcap').textContent = im.alt; lb.classList.add('on'); return; }
      var tr = e.target.closest('tr[data-ht-i]');
      if (tr) {
        var nx = tr.nextElementSibling;
        if (nx && nx.classList.contains('ht-det')) { nx.hidden = !nx.hidden; tr.classList.toggle('open', !nx.hidden); }
      }
    });
    return modal;
  }
  function openModal(id) {
    var reg = REG[id]; if (!reg) return;
    var e = reg.entry, isOv = reg.panel === 'ov';
    var rows = e.rows.slice().sort(function (a, b) {                     /* 최신순 (접수일 → 번호) */
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(a.no || '') < String(b.no || '') ? 1 : -1;
    });
    var m = ensureModal();
    m.className = 'ht-modal on ht-' + reg.panel;
    m.querySelector('.ht-mhead').innerHTML =
      '<span class="ht-tag">' + (isOv ? 'OVERSEAS' : 'DOMESTIC') + '</span>'
      + '<div class="ht-mtitle"><small>' + (isOv ? '해외' : '국내') + ' · ' + esc(reg.col) + '</small><b>' + esc(e.name) + '</b></div>'
      + '<span class="ht-total">' + rows.length + '<em>건</em></span>'
      + '<span class="ht-note">' + START + ' ~ ' + END + ' · 최신순</span>'
      + '<button type="button" class="ht-x" data-ht-close="1" aria-label="닫기">✕ 닫기</button>';
    var th = '<tr><th>접수일</th><th>Complaint No.</th>' + (isOv ? '<th>국가</th><th>대리점</th>' : '<th>거래처</th>')
      + '<th>Item</th><th>LOT No.</th><th>Title</th><th>상태</th></tr>';
    var ncol = isOv ? 8 : 7;
    var body = rows.map(function (r, i) {
      var st = r.term === 'Closed' ? '<span class="ht-st done">Closed</span>' : r.term ? '<span class="ht-st open">On Going</span>' : '-';
      var imgs = (r.files || []).filter(function (f) { return f && f.data; });
      var det = '<div class="ht-dgrid">'
        + '<div class="ht-dk">출처</div><div class="ht-dv">' + esc(r.src) + '</div>'
        + '<div class="ht-dk">Complaint</div><div class="ht-dv pre">' + (esc(r.complaint) || '-')
        + (imgs.length ? '<div class="ht-thumbs">' + imgs.map(function (f) { return '<img data-ht-img="1" src="' + esc(f.data) + '" alt="' + esc(f.name || '') + '">'; }).join('') + '</div>' : '') + '</div>'
        + '<div class="ht-dk">Investigation</div><div class="ht-dv pre">' + (esc(r.invest) || '-') + '</div>'
        + '<div class="ht-dk">Reply</div><div class="ht-dv pre">' + (esc(r.reply) || '-') + '</div></div>';
      return '<tr data-ht-i="' + i + '"><td class="nw">' + esc(r.date) + '</td><td class="nw b">' + esc(r.no) + '</td>'
        + (isOv ? '<td>' + esc(r.country) + '</td><td>' + esc(officialName(r)) + '</td>' : '<td>' + esc(r.contact) + '</td>')
        + '<td>' + esc(r.item) + '</td><td class="lot">' + esc(r.lot) + '</td><td>' + esc(r.title) + '</td><td class="nw">' + st + '</td></tr>'
        + '<tr class="ht-det" hidden><td colspan="' + ncol + '">' + det + '</td></tr>';
    }).join('');
    m.querySelector('.ht-mbody').innerHTML = '<div class="ht-mhint">줄을 누르면 Complaint · Investigation · Reply 내용이 펼쳐집니다.</div>'
      + '<div class="ht-tbl"><table><thead>' + th + '</thead><tbody>' + body + '</tbody></table></div>';
    m.querySelector('.ht-mbody').scrollTop = 0;
    document.documentElement.classList.add('ht-lock');
    /* 브라우저 뒤로가기 · Backspace 로도 팝업만 닫히게 (포털 메인에서 벗어나지 않도록) */
    if (!modalPushed) { try { history.pushState({ htModal: 1 }, ''); modalPushed = true; } catch (err) {} }
    var x = m.querySelector('.ht-x'); if (x) x.focus();
  }
  function hideModal() {
    if (!modal) return;
    modal.classList.remove('on'); modal.querySelector('.ht-lb').classList.remove('on');
    document.documentElement.classList.remove('ht-lock');
  }
  function closeModal() {
    if (modalPushed) { history.back(); return; }                           /* popstate 에서 닫힙니다 */
    hideModal();
  }
  window.addEventListener('popstate', function () { if (modalPushed) { modalPushed = false; hideModal(); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && modal.classList.contains('on')) {
      var lb = modal.querySelector('.ht-lb.on'); if (lb) { lb.classList.remove('on'); return; }
      closeModal();
    }
  });
  box.addEventListener('click', function (e) { var li = e.target.closest('[data-ht]'); if (li) openModal(li.getAttribute('data-ht')); });
  box.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var li = e.target.closest('[data-ht]'); if (li) { e.preventDefault(); openModal(li.getAttribute('data-ht')); }
  });

  /* ---------- 시작 ---------- */
  box.innerHTML = '<div class="ht-head"><div class="h-grp ht-grp">최근 30일 클레임 TOP</div><span class="ht-period">불러오는 중…</span></div>';
  var auth = window.__bdtsAuthReady || Promise.resolve();
  auth.then(function () {
    return Promise.all([loadIntegrated(), loadDomesticLog()]);
  }).then(function (p) {
    S = compute(p[0], p[1]);
    render();
    /* 해외 대리점은 Sales Report 정식 명칭으로 (통합 클레임 로그 화면과 같은 이름) — 해외 건이 있을 때만 받습니다 */
    if (S.ov.length && typeof DistAlias !== 'undefined') {
      DistAlias.load({ base: ROOT || './', rows: function () { return S.ov.map(function (r) { return r.raw; }); }, onReady: render }).catch(function () {});
    }
  }).catch(function (e) {
    box.innerHTML = '<div class="ht-head"><div class="h-grp ht-grp">최근 30일 클레임 TOP</div>'
      + '<span class="ht-period" style="color:#9b5f51">자료를 불러오지 못했습니다. 새로고침해주세요.</span></div>';
    console.error('recent-issues', e);
  });
})();
