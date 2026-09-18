// theme.js — Quiet Editorial Workspace 디자인 레이어 (bdts-portal-redesign 기준)
// ------------------------------------------------------------------
//  ★ 이 파일은 "보이는 모양"만 바꿉니다. 각 화면의 입력 항목·저장·검색·연동 로직은
//    한 줄도 건드리지 않습니다. (theme.css 와 한 쌍)
//
//  하는 일
//   1) 모든 화면 왼쪽에 고정 레일(사이드바)을 붙입니다.
//      - Workspace: 포털 메인 / 최근 이슈 (pages/issues.html) / 출장 보드 (pages/trips.html)
//      - Record : 거래처 이력 / 고객지원센터 / 클레임 로그 (국내)  (pages/records.html#…)
//      - Review : 통합 클레임 로그 / Sales Report / 정보 / 통합 검색
//      - Control: 변경 이력 / 운영 데이터 옮기기  (관리자에게만 표시)
//   2) 레일 접기/펼치기, 좁은 화면에서는 상단 메뉴 버튼으로 열고 닫기
//   3) records.html 안에서는 페이지 이동 대신 기존 nav() 를 그대로 호출해서
//      "저장하지 않고 이동할까요?" 확인 팝업 등 기존 동작을 그대로 유지합니다.
// ------------------------------------------------------------------
(function () {
  'use strict';
  if (document.getElementById('bdtsRail')) return;

  var inPages = /\/pages\//.test(location.pathname);
  var root = inPages ? '../' : '';
  var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var COLLAPSE_KEY = 'bdts_rail_collapsed';

  var GROUPS = [
    { label: 'Workspace', items: [
      { key: 'home', label: '포털 메인', helper: 'Overview', href: root + 'index.html', icon: 'home' },
      { key: 'issues', label: '최근 이슈', helper: '최근 30일 클레임 TOP', href: root + 'pages/issues.html', icon: 'flame', page: 'issues.html' },
      { key: 'trips', label: '출장 보드', helper: '팀 출장 · 방문 일정', href: root + 'pages/trips.html', icon: 'pin', page: 'trips.html' }
    ]},
    { label: 'Record', items: [
      { key: 'client', label: '거래처 이력', helper: '방문 · 전화', href: root + 'pages/records.html#client', icon: 'building', rec: 'client' },
      { key: 'csc', label: '고객지원센터', helper: 'CSC 접수', href: root + 'pages/records.html#csc', icon: 'clipboard', rec: 'csc' },
      { key: 'claim', label: '클레임 로그 (국내)', helper: 'Domestic complaint', href: root + 'pages/records.html#claim', icon: 'shield', rec: 'claim' }
    ]},
    { label: 'Review', items: [
      { key: 'claims', label: '통합 클레임 로그', helper: 'Complaint log', href: root + 'pages/claim.html', icon: 'package', page: 'claim.html' },
      { key: 'sales', label: 'Sales Report', helper: '연도 · 월별 매출', href: root + 'pages/sales.html', icon: 'chart', page: 'sales.html' },
      { key: 'info', label: '정보', helper: '장비 · 매뉴얼', href: root + 'pages/info.html', icon: 'book', page: 'info.html' },
      { key: 'search', label: '통합 검색', helper: 'Unified search', href: root + 'pages/search.html', icon: 'search', page: 'search.html' }
    ]},
    { label: 'Control', admin: true, items: [
      { key: 'audit', label: '변경 이력', helper: 'Audit · 운영 로그', href: root + 'pages/audit.html', icon: 'clock', page: 'audit.html' },
      { key: 'import', label: '운영 데이터 옮기기', helper: 'Import center', href: root + 'pages/import.html', icon: 'upload', page: 'import.html' }
    ]}
  ];

  /* lucide 계열 얇은 선 아이콘 (1.7px) */
  var ICON = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    building: '<rect x="4" y="3" width="16" height="18"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2"/>',
    clipboard: '<rect x="6" y="4" width="12" height="17"/><path d="M9 4V2h6v2M9 10h6M9 14h6"/>',
    shield: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    package: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    upload: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>',
    panel: '<rect x="3" y="4" width="18" height="16"/><path d="M9 4v16M14 10l-2 2 2 2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2M14 9l2 2"/>',
    logout: '<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M18 12H9"/>',
    up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
    pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.4-4.8.3 1.6 1.1 2.6 2.1 3 0-3 .2-5.5.5-8.2z"/>'
  };
  function svg(name, size) {
    return '<svg width="' + (size || 17) + '" height="' + (size || 17) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }

  /* 지금 어느 화면에 있는지 */
  function recordsPage() {
    if (file !== 'records.html') return '';
    var h = (location.hash || '').replace('#', '').split('/')[0];
    return ['client', 'csc', 'claim'].indexOf(h) >= 0 ? h : '';
  }
  function isActive(item) {
    if (item.page) return file === item.page;
    if (item.rec) return recordsPage() === item.rec;
    if (item.key === 'home') return file === 'index.html' || file === '';
    return false;
  }

  function build() {
    /* 화면 이름을 <html data-bdts-page> 에 적어 두어 CSS 가 화면별 장식(사진 등)을 고를 수 있게 합니다 */
    document.documentElement.setAttribute('data-bdts-page', file.replace('.html', '') || 'index');
    if (!document.querySelector('link[rel~="icon"]')) {
      var ico = document.createElement('link'); ico.rel = 'icon'; ico.type = 'image/png'; ico.href = root + 'assets/img/favicon.png';
      document.head.appendChild(ico);
    }
    var rail = document.createElement('aside');
    rail.id = 'bdtsRail';
    rail.className = 'bdts-rail';
    rail.setAttribute('aria-label', '포털 메뉴');

    var html = '';
    html += '<div class="rail-brand"><a class="brand-lockup" href="' + root + 'index.html"><span class="brand-square"></span><span class="brand-name">BDTS<sup>™</sup></span></a>'
      + '<button type="button" class="rail-toggle" aria-label="사이드바 접기" title="사이드바 접기">' + svg('panel', 16) + '</button></div>';
    html += '<div class="rail-user"><div class="avatar" id="bdtsAvatar">·</div><div><b id="bdtsUserName">Boditech MED</b><span id="bdtsUserMail">내부 포털</span></div></div>';
    html += '<nav class="rail-nav">';
    GROUPS.forEach(function (g) {
      html += '<div class="nav-group' + (g.admin ? ' nav-group-admin' : '') + '"' + (g.admin ? ' hidden' : '') + '><div class="nav-group-label">' + esc(g.label) + '</div>';
      g.items.forEach(function (it) {
        html += '<a class="nav-item' + (isActive(it) ? ' active' : '') + '" data-key="' + it.key + '"' + (it.rec ? ' data-rec="' + it.rec + '"' : '') + ' href="' + it.href + '">'
          + svg(it.icon) + '<span class="nav-copy"><b>' + esc(it.label) + '</b><small>' + esc(it.helper) + '</small></span>'
          + (isActive(it) ? '<span class="nav-marker"></span>' : '') + '</a>';
      });
      html += '</div>';
    });
    html += '</nav>';
    html += '<div class="rail-bottom">'
      + '<button type="button" class="rail-bottom-item" id="bdtsPw">' + svg('key', 16) + '<span>비밀번호 변경</span></button>'
      + '<button type="button" class="rail-bottom-item" id="bdtsOut">' + svg('logout', 16) + '<span>로그아웃</span></button>'
      + '<div class="rail-version">Boditech MED · Internal only</div></div>';
    rail.innerHTML = html;

    var openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.id = 'bdtsRailOpen';
    openBtn.className = 'floating-rail-toggle';
    openBtn.setAttribute('aria-label', '사이드바 열기');
    openBtn.title = '사이드바 열기';
    openBtn.innerHTML = svg('panel', 16);

    var mobileBtn = document.createElement('button');
    mobileBtn.type = 'button';
    mobileBtn.id = 'bdtsMobileMenu';
    mobileBtn.className = 'mobile-menu';
    mobileBtn.setAttribute('aria-label', '메뉴 열기');
    mobileBtn.innerHTML = svg('menu', 18);

    var scrim = document.createElement('div');
    scrim.id = 'bdtsRailScrim';
    scrim.className = 'rail-scrim';

    document.body.insertBefore(scrim, document.body.firstChild);
    document.body.insertBefore(mobileBtn, document.body.firstChild);
    document.body.insertBefore(openBtn, document.body.firstChild);
    document.body.insertBefore(rail, document.body.firstChild);
    document.documentElement.classList.add('bdts-shell');

    /* 접기 / 펼치기 */
    var collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) {}
    function setCollapsed(v) {
      collapsed = !!v;
      document.documentElement.classList.toggle('rail-collapsed', collapsed);
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
    }
    setCollapsed(collapsed);
    rail.querySelector('.rail-toggle').onclick = function () { setCollapsed(true); };
    openBtn.onclick = function () { setCollapsed(false); };

    /* 좁은 화면 */
    function closeMobile() { rail.classList.remove('mobile-open'); scrim.classList.remove('on'); }
    mobileBtn.onclick = function () { rail.classList.toggle('mobile-open'); scrim.classList.toggle('on', rail.classList.contains('mobile-open')); };
    scrim.onclick = closeMobile;

    /* 메뉴 클릭 — records.html 안에서는 기존 nav() 를 그대로 사용 */
    rail.querySelectorAll('.nav-item').forEach(function (a) {
      a.addEventListener('click', function (e) {
        closeMobile();
        var rec = a.getAttribute('data-rec');
        if (rec && file === 'records.html' && typeof window.nav === 'function') {
          e.preventDefault();
          window.nav(rec);
        }
      });
    });
    window.addEventListener('hashchange', markActive);
    window.addEventListener('popstate', markActive);
    /* records.html 은 pushState 로만 화면을 바꾸므로(hashchange 가 나지 않음) 직접 호출할 수 있게 열어둡니다 */
    window.bdtsRailMark = markActive;

    /* 글자 크기 버튼은 ui-common.js 의 오른쪽 하단 "가 100%" 하나만 씁니다 (모든 화면 공통) */
    /* 맨 위로 버튼 — 어느 화면에서나 300px 이상 내려가면 나타납니다 */
    var toTop = document.createElement('button');
    toTop.type = 'button';
    toTop.id = 'bdtsToTop';
    toTop.className = 'bdts-totop';
    toTop.setAttribute('aria-label', '맨 위로');
    toTop.title = '맨 위로';
    toTop.innerHTML = svg('up', 18);
    document.body.appendChild(toTop);
    toTop.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };
    function toTopCheck() { toTop.classList.toggle('on', (window.scrollY || document.documentElement.scrollTop) > 300); }
    window.addEventListener('scroll', toTopCheck, { passive: true });
    toTopCheck();

    /* 계정 메뉴 */
    document.getElementById('bdtsPw').onclick = function () {
      if (typeof window.bdtsChangePassword === 'function') window.bdtsChangePassword();
    };
    document.getElementById('bdtsOut').onclick = function () {
      if (typeof window.bdtsLogout === 'function') window.bdtsLogout();
      else location.href = root + 'index.html';
    };

    /* 로그인한 사람 · 관리자 메뉴 */
    function applyUser(me) {
      if (!me || !me.email) return;
      var name = me.name || me.email.split('@')[0];
      document.getElementById('bdtsUserName').textContent = name + (me.isAdmin ? ' (관리자)' : '');
      document.getElementById('bdtsUserMail').textContent = me.email;
      document.getElementById('bdtsAvatar').textContent = name.replace(/\s+/g, '').slice(0, 2).toUpperCase();
      if (me.isAdmin) {
        rail.querySelectorAll('.nav-group-admin').forEach(function (g) { g.hidden = false; });
      }
    }
    var tries = 0;
    (function waitUser() {
      if (window.__bdtsUser) { applyUser(window.__bdtsUser); return; }
      if (typeof window.whoAmI === 'function') {
        window.whoAmI().then(applyUser).catch(function () {});
        return;
      }
      if (window.__bdtsAuthReady && typeof window.__bdtsAuthReady.then === 'function') {
        window.__bdtsAuthReady.then(function () { applyUser(window.__bdtsUser); }).catch(function () {});
        return;
      }
      if (tries++ < 40) setTimeout(waitUser, 250);
    })();
  }

  function markActive() {
    var rail = document.getElementById('bdtsRail');
    if (!rail) return;
    var cur = recordsPage();
    rail.querySelectorAll('.nav-item').forEach(function (a) {
      var rec = a.getAttribute('data-rec');
      if (!rec) return;
      var on = cur === rec;
      a.classList.toggle('active', on);
      var mk = a.querySelector('.nav-marker');
      if (on && !mk) { mk = document.createElement('span'); mk.className = 'nav-marker'; a.appendChild(mk); }
      if (!on && mk) mk.remove();
    });
  }

  /* Chart.js 글꼴·글자색만 팔레트에 맞춥니다 (막대·선 색상 등 데이터 색은 각 화면 JS 그대로) */
  try {
    if (window.Chart && window.Chart.defaults) {
      window.Chart.defaults.font.family = '"IBM Plex Sans KR",-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
      window.Chart.defaults.color = '#35352f';
      if (window.Chart.defaults.borderColor !== undefined) window.Chart.defaults.borderColor = 'rgba(17,17,15,0.07)';
    }
  } catch (e) {}

  /* 모든 화면의 왼쪽 위를 [홈] + [← 뒤로] 두 개로 맞춥니다.
     화면마다 홈 버튼 모양(class)이 달라서, 홈 버튼을 찾아 그 옆에 같은 모양의 뒤로 버튼을 넣습니다.
     이미 뒤로 버튼이 있는 화면(거래처 이력·고객지원센터·클레임 로그)은 그대로 둡니다. */
  function addBackButton() {
    var home = document.querySelector('.home-btn, .nav-home, .b-home, .g-home, .wrap > a.home');
    if (!home || !home.parentNode) return;
    var box = home.parentNode;
    if (box.querySelector('[data-back], .b-back, .g-back, .back-btn, [data-bdts-back]')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-bdts-back', '1');
    btn.className = 'bdts-back';   /* 화면마다 다른 class 와 겹치지 않도록 전용 이름만 씁니다 (모양은 theme.css) */
    btn.textContent = '← 뒤로';
    btn.title = '이전 화면으로';
    btn.onclick = function () {
      /* 이 화면에 처음 들어온 경우(뒤로 갈 곳이 없는 경우)에는 포털 메인으로 보냅니다 */
      if (history.length > 1) history.back();
      else location.href = root + 'index.html';
    };
    home.insertAdjacentElement('afterend', btn);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { build(); addBackButton(); });
  else { build(); addBackButton(); }
})();
