// portal.js — 전 페이지 공통 유틸
// ※ 정렬 규칙: 이 포털의 모든 목록·검색 결과는 "최신순"이 기본입니다.
//   sortLatest() 를 거치지 않고 화면에 뿌리는 코드는 만들지 마세요.

var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

var esc = function (v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

/* ---------- 날짜 ---------- */
// '2026.03.09', '2025--08-21', '20205-04-08' 같은 지저분한 값도 받아냅니다.
function normDate(v) {
  var d = String(v == null ? '' : v).trim().replace(/[.\/]/g, '-').replace(/-+/g, '-');
  var m = d.match(/^(\d{4,5})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  var y = m[1].length === 5 ? m[1].slice(0, 4) : m[1];
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/* ---------- 최신순 정렬 (전 페이지 공통 규칙) ---------- */
function sortLatest(arr, dateKey) {
  dateKey = dateKey || 'd';
  return arr.sort(function (a, b) {
    var da = normDate(a[dateKey]) || '0000-00-00';
    var db = normDate(b[dateKey]) || '0000-00-00';
    if (da !== db) return db < da ? -1 : 1;   // 날짜 내림차순
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

/* ---------- 검색 ---------- */
function tokenize(q) {
  return String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}
// 모든 토큰이 들어있어야 통과 (AND 검색)
function matchAll(haystack, tokens) {
  var h = String(haystack || '').toLowerCase();
  for (var i = 0; i < tokens.length; i++) if (h.indexOf(tokens[i]) < 0) return false;
  return true;
}
function highlight(text, tokens) {
  var out = esc(text);
  tokens.forEach(function (t) {
    if (!t) return;
    var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  });
  return out;
}
// 검색어 주변만 잘라서 보여줍니다.
function snippet(text, tokens, span) {
  span = span || 160;
  var s = String(text || '');
  var low = s.toLowerCase();
  var pos = -1;
  for (var i = 0; i < tokens.length; i++) {
    var p = low.indexOf(tokens[i]);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0) return s.slice(0, span);
  var st = Math.max(0, pos - Math.floor(span / 3));
  return (st > 0 ? '…' : '') + s.substr(st, span) + (st + span < s.length ? '…' : '');
}

/* ---------- 자료 위치 ----------
   기본값은 이 저장소 안의 data 폴더입니다.
   자료를 Azure Blob 으로 옮겼다면 여기 한 줄만 바꾸면 됩니다. 예:
     var DATA_BASE = 'https://stbdtsportal.blob.core.windows.net/portal-data';
   (index.html 은 'data', pages/*.html 은 '../data' 를 씁니다) */
var DATA_BASE = null;

function dataURL(path) {
  if (!DATA_BASE) return path;
  return DATA_BASE.replace(/\/$/, '') + '/' + String(path).split('/').pop();
}

/* ---------- 데이터 로딩 (한 번 받으면 캐시) ---------- */
var _cache = {};
function loadJSON(rawPath) {
  var path = dataURL(rawPath);
  if (_cache[path]) return _cache[path];
  _cache[path] = fetch(path, { credentials: 'same-origin' }).then(function (r) {
    if (!r.ok) throw new Error(path + ' 를 불러오지 못했습니다 (' + r.status + ')');
    return r.json();
  });
  return _cache[path];
}

/* ---------- 화면 보조 ---------- */
function toast(msg, ms) {
  var el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.classList.remove('on'); }, ms || 2200);
}
function fmtNum(n) { return Number(n || 0).toLocaleString('ko-KR'); }
function fmtSize(b) {
  b = Number(b || 0);
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b > 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}

/* ---------- 탭 ---------- */
function initTabs(scope) {
  $$('.b-tab', scope).forEach(function (t) {
    t.onclick = function () {
      $$('.b-tab', scope).forEach(function (x) { x.classList.remove('active'); });
      $$('.b-view', scope).forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      var v = document.getElementById(t.dataset.view);
      if (v) v.classList.add('active');
      if (typeof window.onTabChange === 'function') window.onTabChange(t.dataset.view);
      try { location.hash = t.dataset.view; } catch (e) {}
    };
  });
  var h = (location.hash || '').replace('#', '');
  if (h) { var b = $$('.b-tab', scope).filter(function (t) { return t.dataset.view === h; })[0]; if (b) b.click(); }
}

/* ---------- 로그인한 사람 표시 ---------- */
function showWho() {
  var el = $('#who');
  if (!el || typeof whoAmI !== 'function') return;
  whoAmI().then(function (me) {
    if (me && me.email) el.textContent = me.email + (me.isAdmin ? ' (관리자)' : '');
  });
}

/* ---------- 모달 ---------- */
function openModal(title, html) {
  var m = $('#modal');
  if (!m) return;
  $('#modalTitle', m).textContent = title;
  $('#modalBody', m).innerHTML = html;
  m.classList.add('on');
}
function closeModal() { var m = $('#modal'); if (m) m.classList.remove('on'); }
document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
