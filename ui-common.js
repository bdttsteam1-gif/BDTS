// ui-common.js — 전 페이지 공통 UI 모듈
// ------------------------------------------------------------------
//  1) 글자 크기(화면 배율) 조절: 100 / 125 / 150 / 175 / 200%
//     - 오른쪽 아래 "가" 버튼 → 배율 선택 (localStorage에 저장, 모든 페이지 공통 적용)
//  2) 빈 공간에서 Backspace → 바로 전 페이지로 이동
//     - 입력창(input/textarea/select/contenteditable)에 포커스가 있으면 동작하지 않음
//  3) 대시보드 이미지(PNG) 다운로드: UICommon.downloadDashboard(element, 파일명)
// ------------------------------------------------------------------
(function () {
  'use strict';

  /* ============ 1) 글자 크기 (화면 배율) ============ */
  var SCALE_KEY = 'bdts_ui_scale';
  /* 2026-09: 예전의 115% 가 보기 좋다는 의견에 따라 그 크기를 "100% (기준)" 으로 삼습니다.
     화면에 보이는 값 × BASE 가 실제 배율입니다. 85% 가 예전의 100% 와 거의 같습니다. */
  var BASE = 1.15;
  /* 좁은 화면(핸드폰)에서는 기준을 실제 100% 로 둡니다. 115% 배율이 걸리면 375px 폰이 326px 폭으로 줄어
     각 화면의 모바일 CSS(768~820px 기준)가 예상한 폭보다 좁아져 검색창·표가 밖으로 삐져나갔습니다.
     화면 크기 버튼(125% 등)은 그대로 쓸 수 있습니다. */
  try { if (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) BASE = 1; } catch (e) {}
  var SCALES = [85, 100, 125, 150, 175, 200];

  function getScale() {
    var v = 100;
    try { v = parseInt(localStorage.getItem(SCALE_KEY) || '100', 10); } catch (e) {}
    return SCALES.indexOf(v) === -1 ? 100 : v;
  }
  function applyScale(v) {
    // zoom은 레이아웃까지 함께 배율이 조정되어 "글자 크기에 맞는 UI"가 유지됩니다.
    // (Chrome/Edge/Safari/최신 Firefox 지원)
    try {
      var real = Math.round(v * BASE * 100) / 100;          /* 실제 배율 (기준 100% = 115%) */
      document.documentElement.style.zoom = real + '%';
      /* 왼쪽 메뉴·떠 있는 버튼은 theme.css 가 이 값으로 원래 크기를 지킵니다 */
      document.documentElement.style.setProperty('--zoom', real / 100);
      /* 거래처 이력·고객지원센터처럼 칸이 많은 화면은 배율에 따라 한 줄 칸 수를 줄입니다 (records.html CSS) */
      if (document.body) { document.body.classList.toggle('fs-lg', v >= 125 && v < 175); document.body.classList.toggle('fs-xl', v >= 175); }
      document.dispatchEvent(new CustomEvent('bdts-fs', { detail: { pct: v } }));
    } catch (e) {}
    var lbl = document.getElementById('uiScaleLabel');
    if (lbl) lbl.textContent = v + '%';
    var menu = document.getElementById('uiScaleMenu');
    if (menu) {
      var btns = menu.querySelectorAll('button[data-scale]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('on', parseInt(btns[i].getAttribute('data-scale'), 10) === v);
      }
    }
  }
  function setScale(v) {
    try { localStorage.setItem(SCALE_KEY, String(v)); } catch (e) {}
    applyScale(v);
  }

  function buildScaleWidget() {
    if (document.getElementById('uiScaleWidget')) return;
    var css = document.createElement('style');
    css.textContent =
      '#uiScaleWidget{position:fixed;right:14px;bottom:14px;z-index:9999;font-family:inherit;}' +
      '#uiScaleBtn{display:flex;align-items:center;gap:6px;background:#1a1a2e;color:#fff;border:1px solid #2d3150;' +
      'border-radius:22px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);}' +
      '#uiScaleBtn:hover{background:#24244a;}' +
      '#uiScaleBtn .ga{font-size:15px;}' +
      '#uiScaleMenu{display:none;position:absolute;right:0;bottom:46px;background:#fff;border:1px solid #d1d5db;' +
      'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:6px;min-width:130px;}' +
      '#uiScaleMenu.open{display:block;}' +
      '#uiScaleMenu .ttl{font-size:11px;color:#9ca3af;font-weight:700;padding:4px 8px 6px;}' +
      '#uiScaleMenu button{display:block;width:100%;text-align:left;background:none;border:none;border-radius:6px;' +
      'padding:8px 10px;font-size:13px;font-weight:600;color:#374151;cursor:pointer;}' +
      '#uiScaleMenu button:hover{background:#eff6ff;color:#2563eb;}' +
      '#uiScaleMenu button.on{background:#2563eb;color:#fff;}';
    document.head.appendChild(css);

    var wrap = document.createElement('div');
    wrap.id = 'uiScaleWidget';
    var menuHtml = '<div class="ttl">글자·화면 크기</div>' + SCALES.map(function (s) {
      return '<button type="button" data-scale="' + s + '">' + s + '%' + (s === 100 ? ' <span style="font-size:10px;color:#9ca3af">기준</span>' : '') + '</button>';
    }).join('');
    wrap.innerHTML =
      '<div id="uiScaleMenu">' + menuHtml + '</div>' +
      '<button type="button" id="uiScaleBtn" title="글자 크기 조절"><span class="ga">가</span><span id="uiScaleLabel">100%</span></button>';
    document.body.appendChild(wrap);

    var btn = document.getElementById('uiScaleBtn');
    var menu = document.getElementById('uiScaleMenu');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    menu.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button[data-scale]') : null;
      if (!t) return;
      setScale(parseInt(t.getAttribute('data-scale'), 10));
      menu.classList.remove('open');
    });
    document.addEventListener('click', function () { menu.classList.remove('open'); });
    applyScale(getScale());
  }
  /* Ctrl(⌘) + / − / 0 으로도 조절합니다 */
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var i = SCALES.indexOf(getScale());
    if (e.key === '=' || e.key === '+') { e.preventDefault(); if (i < SCALES.length - 1) setScale(SCALES[i + 1]); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); if (i > 0) setScale(SCALES[i - 1]); }
    else if (e.key === '0') { e.preventDefault(); setScale(100); }
  });

  /* ============ 2) 빈 공간 Backspace → 이전 페이지 ============ */
  function isEditable(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Backspace') return;
    if (e.defaultPrevented) return;
    if (isEditable(e.target) || isEditable(document.activeElement)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    history.back();
  });

  /* ============ 3) 대시보드 이미지 다운로드 ============ */
  var _h2cLoading = null;
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (_h2cLoading) return _h2cLoading;
    _h2cLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = function () { resolve(window.html2canvas); };
      s.onerror = function () { _h2cLoading = null; reject(new Error('html2canvas 로딩 실패 (인터넷 연결 확인)')); };
      document.head.appendChild(s);
    });
    return _h2cLoading;
  }

  // element(또는 셀렉터)를 PNG로 저장. 배율(zoom)이 적용되어 있어도 100% 기준으로 캡처.
  function downloadDashboard(el, filename) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) { alert('다운로드할 대시보드 영역을 찾지 못했습니다.'); return Promise.resolve(); }
    var name = (filename || 'dashboard') + '_' + new Date().toISOString().slice(0, 10) + '.png';
    var prevZoom = document.documentElement.style.zoom;
    document.documentElement.style.zoom = '';
    return loadHtml2Canvas().then(function (h2c) {
      return h2c(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
    }).then(function (canvas) {
      document.documentElement.style.zoom = prevZoom;
      var a = document.createElement('a');
      a.download = name;
      a.href = canvas.toDataURL('image/png');
      document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); }, 300);
    }).catch(function (err) {
      document.documentElement.style.zoom = prevZoom;
      alert('이미지 저장 실패: ' + err.message);
    });
  }

  /* ============ 4) 그래프(Chart.js) 크기를 배율과 무관하게 칸에 맞춤 (2026-09) ============
     증상: 통합 클레임 로그 등의 그래프가 커졌다가 갑자기 화면에 맞춰지거나,
           다른 모니터로 창을 옮기거나 검색한 뒤에는 커진 채로 작아지지 않음.
     원인: 1)의 글자 크기 기능은 html 에 CSS zoom(기준 100% = 실제 115%)을 겁니다.
           Chart.js 는 그래프 칸 크기를 getBoundingClientRect() 로 재는데, 이 값에는 zoom 이
           곱해져 있어 그래프를 칸보다 15% 크게 그립니다. 처음 그릴 때, 모니터 배율이 바뀔 때,
           글자 크기를 바꿀 때, 스크롤바가 생기거나 없어질 때마다 이 잘못된 값으로 다시 잽니다.
     해결: 크기를 잴 때는 항상 zoom 이 곱해지지 않은 칸의 clientWidth/clientHeight 를 쓰도록 합니다.
           (그래프를 그리는 모든 화면 공통 — 통합 클레임 로그 · Sales Report · 거래처 이력 · 고객지원센터 · 국내 클레임) */
  function patchChart() {
    var C = window.Chart;
    if (!C || !C.prototype || typeof C.prototype.resize !== 'function') return false;
    if (C.prototype.__bdtsZoomSafe) return true;
    var origResize = C.prototype.resize;
    C.prototype.resize = function (w, h) {
      try {
        var cv = this.canvas, box = cv && cv.parentNode, o = this.options || {};
        if (o.responsive !== false && box && box.nodeType === 1 && box.clientWidth > 0) {
          var cs = getComputedStyle(box);
          w = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
          h = o.maintainAspectRatio === false
            ? box.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)
            : w / (this.aspectRatio || 2);
        }
      } catch (e) {}
      return origResize.call(this, w, h);
    };
    /* 같은 원인으로 마우스 위치도 15% 어긋나, 막대를 눌러도 다른 막대가 잡히거나 아무것도 안 열렸습니다.
       (예: 국가별 그래프에서 India 막대를 누르면 반응 없음) → 마우스 위치를 그래프 기준 좌표로 다시 계산합니다. */
    try {
      C.register({
        id: 'bdtsZoomPointer',
        beforeEvent: function (chart, args) {
          var ev = args && args.event, ne = ev && ev.native, cv = chart.canvas;
          if (!ne || !cv) return;
          var src = (ne.touches && ne.touches.length) ? ne.touches[0]
            : (ne.changedTouches && ne.changedTouches.length) ? ne.changedTouches[0] : ne;
          if (src.clientX == null) return;
          var r = cv.getBoundingClientRect();
          if (!r.width || !r.height || !cv.offsetWidth || !cv.offsetHeight) return;
          var kx = cv.offsetWidth / r.width, ky = cv.offsetHeight / r.height;
          if (Math.abs(kx - 1) < 0.01 && Math.abs(ky - 1) < 0.01) return;   /* 배율 100% 면 손대지 않음 */
          ev.x = (src.clientX - r.left) * kx;
          ev.y = (src.clientY - r.top) * ky;
          var a = chart.chartArea;
          if (a) args.inChartArea = ev.x >= a.left && ev.x <= a.right && ev.y >= a.top && ev.y <= a.bottom;
        }
      });
    } catch (e) {}
    C.prototype.__bdtsZoomSafe = true;
    return true;
  }
  if (!patchChart()) {
    document.addEventListener('DOMContentLoaded', patchChart);
    window.addEventListener('load', patchChart);
  }

  /* ============ 5) 운영 로그 보내기 (2026-09) ============
     저장·삭제·불러오기·업로드 실패와 화면 오류를 관리자 [운영 로그]로 보냅니다 (api/OpsLog.js).
     - 누가 보냈는지는 서버가 로그인 쿠키로 정합니다.
     - 같은 문제가 되풀이되면 한 줄로 묶어 "N회"로 보냅니다. 한 화면에서 최대 50줄까지만.
     - 클레임 본문·연락처 같은 내용은 보내지 않습니다 (메뉴·건번호·오류 메시지만). */
  var Ops = (function () {
    var q = {}, order = [], sent = 0, MAX = 50, timer = null;
    function pageName() {
      return (location.pathname.split('/').pop() || 'index.html') + (location.hash || '').split('?')[0].slice(0, 40);
    }
    function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }
    function report(kind, info) {
      try {
        info = info || {};
        var ev = {
          kind: kind, page: clip(info.page || pageName(), 120), sheet: clip(info.sheet, 60),
          action: clip(info.action, 30), recId: clip(info.recId, 120),
          message: clip(info.message, 500), detail: clip(info.detail, 1500), count: 1
        };
        var k = [ev.kind, ev.page, ev.sheet, ev.action, ev.recId, ev.message].join('|');
        if (q[k]) { q[k].count++; }
        else {
          if (sent + order.length >= MAX) return;
          q[k] = ev; order.push(k);
        }
        if (!timer) timer = setTimeout(flush, 3000);
      } catch (e) {}
    }
    function flush(useBeacon) {
      clearTimeout(timer); timer = null;
      if (!order.length) return;
      var events = order.map(function (k) { return q[k]; });
      q = {}; order = []; sent += events.length;
      for (var i = 0; i < events.length; i += 20) {                            /* 서버는 한 번에 20줄까지 받습니다 */
        var body = JSON.stringify({ events: events.slice(i, i + 20) });
        try {
          if (useBeacon === true && navigator.sendBeacon) {
            navigator.sendBeacon('/api/opslog', new Blob([body], { type: 'application/json' }));
            continue;
          }
          fetch('/api/opslog', { method: 'POST', credentials: 'same-origin', keepalive: true,
            headers: { 'Content-Type': 'application/json' }, body: body }).catch(function () {});
        } catch (e) {}
      }
    }
    /* 화면을 떠날 때 남은 것을 보냅니다 */
    window.addEventListener('pagehide', function () { flush(true); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });

    /* 화면 오류 — 우리 코드에서 난 것만 (브라우저 확장 프로그램·외부 스크립트·의미 없는 알림은 뺍니다) */
    function ours(file) { return !file || file.indexOf(location.origin) === 0; }
    function noise(msg) { return /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection/i.test(String(msg || '')); }
    window.addEventListener('error', function (e) {
      if (!e || !e.message || noise(e.message) || !ours(e.filename)) return;
      var where = (e.filename || '').split('/').pop() + (e.lineno ? ':' + e.lineno + (e.colno ? ':' + e.colno : '') : '');
      report('client_error', { message: e.message, detail: where + (e.error && e.error.stack ? '\n' + String(e.error.stack).slice(0, 1200) : '') });
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      if (r && r.__bdtsLogged) return;                                          /* 저장소(azure-store.js)가 이미 남긴 오류 */
      var msg = r && r.message ? r.message : String(r);
      if (noise(msg)) return;
      report('client_error', { message: '처리되지 않은 오류: ' + msg, detail: r && r.stack ? String(r.stack).slice(0, 1200) : '' });
    });
    /* 이 파일보다 먼저 쌓인 것 (azure-store.js 가 먼저 불렸을 때) */
    (window.__bdtsOpsQ || []).forEach(function (a) { report(a[0], a[1]); });
    window.__bdtsOpsQ = null;
    return { report: report, flush: flush };
  })();
  window.bdtsOps = Ops;

  window.UICommon = { setScale: setScale, getScale: getScale, downloadDashboard: downloadDashboard, patchChart: patchChart };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildScaleWidget);
  } else {
    buildScaleWidget();
  }
})();
