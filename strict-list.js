// strict-list.js — "목록에서만 선택" 강제 자동완성 위젯
// -------------------------------------------------------------------------
// 사용법:
//   StrictList.attach(inputEl, function(){ return MASTER_DEVICE; });
//   → 입력 시 목록 중 포함(substring) 매칭되는 항목을 드롭다운으로 보여주고,
//     목록에 있는 값(대소문자/공백 무시)만 유효로 인정합니다.
//     유효하지 않으면 입력칸이 빨갛게 표시되고(class="sl-invalid"),
//     StrictList.validateAll(...)이 false를 반환합니다.
//   저장(submit) 버튼 클릭 시 StrictList.validateAll(container, [...입력요소...])로
//   막아야 할 필드들을 한번에 검사하세요.
//
// 정규화: 목록에 대소문자/공백만 다르게 일치하는 값을 입력하면, 포커스를 벗어날 때
//        목록에 정의된 표준 표기로 자동 교정합니다 (예: "crp" → "CRP").
// -------------------------------------------------------------------------
var StrictList = (function () {

  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function findCanonical(list, value) {
    var n = norm(value);
    if (!n) return null;
    for (var i = 0; i < list.length; i++) {
      if (norm(list[i]) === n) return list[i];
    }
    // 대소문자/공백 차이가 아니라 "다른 글자"로 된 알려진 변형 표기(오타·구표기)도 확인
    if (typeof MASTER_ALIASES !== 'undefined') {
      var raw = String(value).trim();
      if (MASTER_ALIASES.hasOwnProperty(raw)) {
        var mapped = MASTER_ALIASES[raw];
        // 매핑 결과가 실제로 해당 목록에 있는 경우에만 적용 (Device 매핑을 Item 목록에 잘못 적용하는 것 방지)
        for (var j = 0; j < list.length; j++) {
          if (norm(list[j]) === norm(mapped)) return list[j];
        }
      }
    }
    return null;
  }

  function highlightMatch(text, q) {
    var idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function markValidity(inputEl, list) {
    var v = inputEl.value.trim();
    if (!v) {
      inputEl.classList.remove('sl-invalid');
      inputEl.removeAttribute('data-sl-invalid');
      return true;
    }
    var canon = findCanonical(list, v);
    if (canon) {
      inputEl.classList.remove('sl-invalid');
      inputEl.removeAttribute('data-sl-invalid');
      return true;
    }
    inputEl.classList.add('sl-invalid');
    inputEl.setAttribute('data-sl-invalid', '1');
    return false;
  }

  function attach(inputEl, getList, opts) {
    if (!inputEl) return;
    opts = opts || {};
    var maxResults = opts.maxResults || 30;

    // 드롭다운을 화면에 떠있게(absolute/fixed) 만들지 않고, 입력칸 바로 다음에 "정상적인 문서 흐름"으로
    // 삽입합니다. 다른 칸을 가리는 문제가 레이아웃에 따라 재발하지 않도록 하기 위한 선택입니다.
    // (목록이 열리면 아래 내용이 살짝 밀려 내려가고, 닫히면 다시 원래 자리로 돌아옵니다.)
    var list = document.createElement('div');
    list.className = 'sl-list';
    list.style.cssText = 'background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);max-height:180px;overflow:auto;display:none;font-size:13px;margin:4px 0 2px;';
    if (inputEl.parentNode) {
      inputEl.parentNode.insertBefore(list, inputEl.nextSibling);
    }

    var activeIdx = -1;

    function currentOptions() {
      try { return getList() || []; } catch (e) { return []; }
    }

    function render() {
      var q = inputEl.value.trim();
      if (!q) { hide(); return; }
      var ql = q.toLowerCase();
      var opts_ = currentOptions();
      var matches = [];
      for (var i = 0; i < opts_.length && matches.length < maxResults; i++) {
        if (opts_[i].toLowerCase().indexOf(ql) !== -1) matches.push(opts_[i]);
      }
      activeIdx = -1;
      if (matches.length === 0) {
        hide();
        return;
      }
      list.innerHTML = matches.map(function (m, i) {
        return '<div class="sl-item" data-idx="' + i + '" data-val="' + escapeHtml(m) + '" style="padding:7px 10px;cursor:pointer;">' + highlightMatch(m, q) + '</div>';
      }).join('');
      list.style.display = 'block';
    }

    function hide() { list.style.display = 'none'; }

    function selectValue(v) {
      inputEl.value = v;
      hide();
      markValidity(inputEl, currentOptions());
      var ev = new Event('change', { bubbles: true });
      inputEl.dispatchEvent(ev);
    }

    inputEl.addEventListener('input', function () {
      render();
      markValidity(inputEl, currentOptions());
    });
    inputEl.addEventListener('focus', function () { if (inputEl.value.trim()) render(); });
    inputEl.addEventListener('blur', function () {
      setTimeout(function () {
        hide();
        // 대소문자/공백만 다른 값은 표준 표기로 자동 교정
        var canon = findCanonical(currentOptions(), inputEl.value);
        if (canon && canon !== inputEl.value) inputEl.value = canon;
        markValidity(inputEl, currentOptions());
      }, 150);
    });
    inputEl.addEventListener('keydown', function (e) {
      var items = list.querySelectorAll('.sl-item');
      if (list.style.display !== 'block' || items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        items.forEach(function (it, i) { it.style.background = i === activeIdx ? '#eef2ff' : ''; });
        items[activeIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        items.forEach(function (it, i) { it.style.background = i === activeIdx ? '#eef2ff' : ''; });
        items[activeIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && items[activeIdx]) {
          e.preventDefault();
          selectValue(items[activeIdx].getAttribute('data-val'));
        }
      } else if (e.key === 'Escape') {
        hide();
      }
    });
    list.addEventListener('mousedown', function (e) {
      var item = e.target.closest ? e.target.closest('.sl-item') : null;
      if (!item || !item.getAttribute('data-val')) return;
      e.preventDefault();
      selectValue(item.getAttribute('data-val'));
    });

    // 최초 로드시(수정모드로 값이 채워진 경우) 유효성 표시
    markValidity(inputEl, currentOptions());
  }

  // inputs: input 엘리먼트들의 배열, getList: 각 input에 대응하는 목록을 반환하는 함수 or 고정 배열
  function validateAll(inputs, getList) {
    var ok = true;
    inputs.forEach(function (el) {
      if (!el) return;
      var list = typeof getList === 'function' ? getList() : getList;
      var valid = markValidity(el, list || []);
      if (!valid) ok = false;
    });
    return ok;
  }

  // 단일 필드만 조용히 재검사(드롭다운을 열지 않음) — 기존 값 불러오기(수정모드) 후 호출하기 적합
  function validate(inputEl, getList) {
    var list = typeof getList === 'function' ? getList() : getList;
    return markValidity(inputEl, list || []);
  }

  return { attach: attach, validate: validate, validateAll: validateAll, findCanonical: findCanonical };
})();

// 공통 스타일 (한 번만 삽입)
(function () {
  if (document.getElementById('sl-style')) return;
  var style = document.createElement('style');
  style.id = 'sl-style';
  style.textContent = '.sl-invalid{border-color:#dc2626 !important;background:#fef2f2 !important;} .sl-item:hover{background:#f3f4f6;}';
  document.head.appendChild(style);
})();
