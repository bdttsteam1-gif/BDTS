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
  var SCALES = [100, 125, 150, 175, 200];

  function getScale() {
    var v = 100;
    try { v = parseInt(localStorage.getItem(SCALE_KEY) || '100', 10); } catch (e) {}
    return SCALES.indexOf(v) === -1 ? 100 : v;
  }
  function applyScale(v) {
    // zoom은 레이아웃까지 함께 배율이 조정되어 "글자 크기에 맞는 UI"가 유지됩니다.
    // (Chrome/Edge/Safari/최신 Firefox 지원)
    try {
      document.documentElement.style.zoom = (v === 100) ? '' : (v + '%');
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
      return '<button type="button" data-scale="' + s + '">' + s + '%</button>';
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

  window.UICommon = { setScale: setScale, getScale: getScale, downloadDashboard: downloadDashboard };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildScaleWidget);
  } else {
    buildScaleWidget();
  }
})();
