// upload-log.js — 엑셀 업로드 이력 (통합 클레임 로그 · Sales Report 공용)
// ------------------------------------------------------------------
//  업로드해서 반영이 됐는지 안 됐는지 화면에서 알 수 없다는 피드백을 반영합니다.
//  업로드가 끝날 때마다 "누가 · 언제 · 어떤 파일 · 몇 건" 을 Azure(upload_log 테이블)에 남기고,
//  화면 상단에 마지막 업로드를 표시합니다. Azure 에 저장되므로 다른 PC 에서 봐도 같은 내용이 보입니다.
//
//  사용법
//    UploadLog.record('claims', { file, year, added, note })   → 저장 (Promise)
//    UploadLog.render(el, 'claims', { year })                  → el 에 마지막 업로드 표시
//    UploadLog.history('sales')                                → 최근 이력 배열 (최신순)
//
//  kind : 'claims' (통합 클레임 로그) | 'sales' (Sales Report)
// ------------------------------------------------------------------
var UploadLog = (function () {
  'use strict';
  var SHEET = 'upload_log';
  var _store = null, _cache = null, _job = null;

  function store() {
    if (_store) return _store;
    if (typeof makeHubStore !== 'function') return null;
    _store = makeHubStore(SHEET);
    return _store;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtAt(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return String(iso || '');
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function newId() {
    var n = new Date();
    return n.getFullYear() + pad2(n.getMonth() + 1) + pad2(n.getDate()) + pad2(n.getHours()) + pad2(n.getMinutes()) + pad2(n.getSeconds())
      + '_' + Math.random().toString(36).slice(2, 7);
  }

  /* 전체 이력 (한 번 읽으면 잠시 보관) */
  function load(force) {
    var st = store();
    if (!st) return Promise.resolve([]);
    if (_cache && !force) return Promise.resolve(_cache);
    if (_job && !force) return _job;
    _job = st.list().then(function (rows) {
      _cache = (rows || []).slice().sort(function (a, b) { return String(b._at || b.at || '').localeCompare(String(a._at || a.at || '')); });
      _job = null;
      return _cache;
    }).catch(function () { _job = null; return _cache || []; });
    return _job;
  }
  function history(kind, n) {
    return load().then(function (rows) {
      return rows.filter(function (r) { return r.kind === kind; }).slice(0, n || 20);
    });
  }
  function latest(kind, year) {
    return history(kind, 200).then(function (rows) {
      if (year) {
        var hit = rows.filter(function (r) { return String(r.year || '') === String(year); })[0];
        if (hit) return hit;
      }
      return rows[0] || null;
    });
  }

  /* 업로드 완료 후 호출 — 서버가 _by(메일) · _byName(이름) · _at(시각) 을 붙여 줍니다 */
  function record(kind, info) {
    var st = store();
    var rec = Object.assign({ id: newId(), kind: kind, at: new Date().toISOString() }, info || {});
    if (!st) return Promise.resolve(rec);
    return st.add(rec).then(function () {
      if (_cache) _cache.unshift(rec);
      return rec;
    });
  }

  function line(r) {
    if (!r) return '';
    var who = r._byName || r._by || '';
    var when = fmtAt(r._at || r.at);
    var what = [];
    if (r.year) what.push(r.year + '년');
    if (r.note) what.push(r.note);
    else if (r.added != null) what.push('추가 ' + Number(r.added).toLocaleString() + '건');
    return '<b>마지막 업로드</b> ' + esc(r.file || '(파일명 없음)') + ' · ' + esc(when)
      + (who ? ' · ' + esc(who) : '') + (what.length ? ' · ' + esc(what.join(' · ')) : '');
  }

  /* el 에 마지막 업로드 한 줄을 그립니다. opts.year 가 있으면 그 연도의 마지막 업로드를 우선 보여줍니다.
     Azure 에 아직 이력이 없으면 "업로드 이력 없음" 으로 표시합니다. */
  function render(el, kind, opts) {
    if (!el) return Promise.resolve();
    opts = opts || {};
    el.className = (el.className.replace(/\bupload-log\b/g, '') + ' upload-log').trim();
    el.innerHTML = '<span class="ul-ico">⬆</span> 업로드 이력 확인 중…';
    return latest(kind, opts.year).then(function (r) {
      if (!r) { el.innerHTML = '<span class="ul-ico">⬆</span> 업로드 이력 없음' + (opts.year ? ' (' + esc(opts.year) + '년)' : '') + ' — 아직 이 화면에서 엑셀을 올린 기록이 없습니다.'; return; }
      el.innerHTML = '<span class="ul-ico">⬆</span> ' + line(r)
        + ' <button type="button" class="ul-more" data-ulk="' + esc(kind) + '">이력 보기</button>';
      var btn = el.querySelector('.ul-more');
      if (btn) btn.onclick = function () { showHistory(kind); };
    });
  }

  /* 최근 이력 20건 팝업 */
  function showHistory(kind) {
    history(kind, 20).then(function (rows) {
      var old = document.getElementById('ulHistory'); if (old) old.remove();
      var box = document.createElement('div');
      box.id = 'ulHistory'; box.className = 'ul-modal';
      box.innerHTML = '<div class="ul-sheet"><div class="ul-head"><b>업로드 이력</b> <span>최근 ' + rows.length + '건 · 최신순</span>'
        + '<button type="button" class="ul-x" aria-label="닫기">✕</button></div>'
        + (rows.length ? '<table class="ul-tbl"><thead><tr><th>일시</th><th>파일명</th><th>업로더</th><th>대상</th><th>결과</th></tr></thead><tbody>'
          + rows.map(function (r) {
            return '<tr><td>' + esc(fmtAt(r._at || r.at)) + '</td><td>' + esc(r.file || '') + '</td><td>' + esc(r._byName || r._by || '') + '</td>'
              + '<td>' + esc(r.year ? r.year + '년' : '') + '</td><td>' + esc(r.note || (r.added != null ? '추가 ' + Number(r.added).toLocaleString() + '건' : '')) + '</td></tr>';
          }).join('') + '</tbody></table>'
          : '<div class="ul-empty">이력이 없습니다.</div>')
        + '</div>';
      document.body.appendChild(box);
      box.querySelector('.ul-x').onclick = function () { box.remove(); };
      box.addEventListener('mousedown', function (e) { if (e.target === box) box.remove(); });
    });
  }

  /* 스타일 (한 번만) */
  (function css() {
    if (document.getElementById('uploadLogStyle')) return;
    var s = document.createElement('style'); s.id = 'uploadLogStyle';
    s.textContent = [
      '.upload-log{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 24px;font-size:12.5px;color:#374151;background:#f8fafc;border-bottom:1px solid #e5e7eb}',
      '.upload-log b{color:#111827}.upload-log .ul-ico{color:#2563eb;font-weight:700}',
      '.upload-log .ul-more{margin-left:auto;background:transparent;border:1px solid #d1d5db;border-radius:6px;padding:3px 9px;font-size:11.5px;cursor:pointer;color:#374151;font-family:inherit}',
      '.upload-log .ul-more:hover{border-color:#2563eb;color:#2563eb}',
      '.ul-modal{position:fixed;inset:0;z-index:1200;background:rgba(17,24,39,.45);display:flex;align-items:center;justify-content:center;padding:20px}',
      '.ul-sheet{background:#fff;border-radius:12px;width:min(820px,100%);max-height:80vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25)}',
      '.ul-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px}.ul-head span{color:#6b7280;font-size:12px}',
      '.ul-x{margin-left:auto;background:none;border:none;font-size:16px;cursor:pointer;color:#6b7280}',
      '.ul-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.ul-tbl th,.ul-tbl td{padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:left;vertical-align:top}',
      '.ul-tbl th{background:#f8fafc;font-size:11.5px;color:#6b7280;font-weight:600}',
      '.ul-empty{padding:30px;text-align:center;color:#9ca3af}'
    ].join('\n');
    document.head.appendChild(s);
  })();

  return { record: record, render: render, history: history, latest: latest, showHistory: showHistory, fmtAt: fmtAt };
})();
