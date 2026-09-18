// trip-board-store.js — [출장 보드] (pages/trip-board.html) 의 공유 저장소 (2026-09)
// ------------------------------------------------------------------
//  출장 보드는 원래 Claude 공유 저장소(window.claude.use("db"))에 맞춰 만들어졌습니다.
//  포털에서는 보안상 Azure 만 쓰므로, 같은 사용법(collection/doc/onSnapshot)을
//  기존 레코드 API(/api/records, Azure Table)로 옮겨 주는 얇은 연결부입니다.
//
//  저장 위치 (Azure Table 파티션)
//    trip_members : 팀원        (id = 팀원 번호)
//    trip_trips   : 출장·휴가   (id = 일정 번호)
//    trip_meta    : 가져오기 기록(import-2026) · 가져오기 잠금(import-2026-lease)
//
//  동시 사용
//    - 저장은 건별 덮어쓰기(다른 화면과 같은 방식), 삭제는 휴지통(30일)으로 옮깁니다.
//    - 다른 사람이 바꾼 내용은 15초마다(창이 보일 때만) 다시 읽어 반영합니다.
//    - 엑셀 기록 가져오기는 importNew(이미 있는 번호는 건너뜀)로 보내므로
//      두 사람이 동시에 눌러도 같은 일정이 두 번 생기지 않습니다.
// ------------------------------------------------------------------
(function () {
  'use strict';

  var API = '/api/records';
  var SHEETS = { members: 'trip_members', trips: 'trip_trips', meta: 'trip_meta' };
  var POLL_MS = 15000;
  var BULK = 500;                       // importNew 한 번에 보낼 수 있는 최대 건수

  function httpError(status, msg) {
    var e = new Error(msg || ('오류 ' + status));
    e.status = status;
    if (status === 429) e.code = 'resource_exhausted';
    else if (status === 401 || status === 403) e.code = 'not_granted';
    else if (status === 413) e.code = 'too_big';
    else if (status >= 500 || !status) e.code = 'unavailable';
    return e;
  }

  /* 저장·불러오기 실패는 포털 [운영 로그]에 한 줄 남깁니다 (내용은 보내지 않고 저장소·동작·오류만) */
  function opsReport(method, body, err) {
    try {
      var ops = window.bdtsOps || (window.parent && window.parent !== window && window.parent.bdtsOps);
      if (!ops) return;
      var action = method === 'GET' ? 'list' : (body && body.action) || '';
      ops.report(method === 'GET' ? 'load_fail' : action === 'delete' ? 'delete_fail' : 'save_fail', {
        sheet: (body && body.sheet) || 'trip_*', action: action,
        recId: String((body && (body.id || (body.record && body.record.id))) || ''),
        message: (err && err.message) || '', detail: err && err.status ? 'HTTP ' + err.status : '서버에 닿지 못함'
      });
    } catch (e) {}
  }

  function req(method, url, body) {
    var opt = { method: method, credentials: 'same-origin' };
    if (body) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    return fetch(url, opt).then(function (res) {
      if (res.status === 401) { location.reload(); throw httpError(401, '다시 로그인해주세요.'); }
      return res.json().catch(function () { throw httpError(res.status, '서버 응답을 읽지 못했습니다.'); })
        .then(function (j) {
          if (!res.ok || (j && j.error)) throw httpError(res.status, (j && j.error) || '');
          return j;
        });
    }, function (err) { throw httpError(0, (err && err.message) || '서버에 닿지 못했습니다.'); })
      .catch(function (e) { if (e.status !== 401) opsReport(method, body, e); throw e; });
  }

  function list(sheet) {
    return req('GET', API + '?sheet=' + encodeURIComponent(sheet)).then(function (r) {
      return (Array.isArray(r) ? r : []).filter(function (x) { return x && x.id != null && !x._broken; });
    });
  }
  function put(sheet, id, data) {
    var rec = Object.assign({}, data, { id: String(id) });
    return req('POST', API, { sheet: sheet, action: 'update', record: rec });
  }
  function del(sheet, id, payload) {
    return req('POST', API, { sheet: sheet, action: 'delete', id: String(id), record: payload || null });
  }

  /* 서버 기록에서 저장 흔적(_by, _at …)과 id 를 떼어 원래 내용만 돌려줍니다 */
  function strip(rec) {
    var out = {};
    Object.keys(rec).forEach(function (k) { if (k !== 'id' && k.charAt(0) !== '_') out[k] = rec[k]; });
    return out;
  }
  function snap(rows) {
    return { docs: rows.map(function (r) { var d = strip(r); return { id: String(r.id), data: function () { return d; } }; }) };
  }

  function makeDb() {
    var cache = { members: null, trips: null, meta: null };
    var subs = { members: [], trips: [], meta: [] };
    var timer = null, busy = false, again = false;

    function emit(col) {
      var rows = cache[col] || [];
      subs[col].forEach(function (s) {
        try { s.next(rows); } catch (e) { console.error('trip-board', e); }
      });
    }
    function failAll(err) {
      Object.keys(subs).forEach(function (col) {
        subs[col].forEach(function (s) { if (s.error) try { s.error(err); } catch (e) {} });
      });
    }
    function refresh() {
      if (busy) { again = true; return Promise.resolve(); }
      busy = true;
      var cols = Object.keys(SHEETS).filter(function (c) { return subs[c].length; });
      return Promise.all(cols.map(function (c) {
        return list(SHEETS[c]).then(function (rows) { cache[c] = rows; emit(c); });
      })).catch(failAll).then(function () {
        busy = false;
        if (again) { again = false; return refresh(); }
      });
    }
    var soonT = null;
    function refreshSoon() { clearTimeout(soonT); soonT = setTimeout(refresh, 1200); }
    function startPolling() {
      if (timer) return;
      timer = setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    }

    /* 저장 직후 화면이 바로 바뀌도록 캐시에 먼저 반영하고, 잠시 뒤 서버 내용으로 다시 맞춥니다 */
    function localPut(col, id, data) {
      if (!cache[col]) return;
      var rec = Object.assign({}, data, { id: String(id) });
      var i = cache[col].findIndex(function (x) { return String(x.id) === String(id); });
      if (i >= 0) cache[col][i] = rec; else cache[col].push(rec);
      emit(col);
    }
    function localDel(col, id) {
      if (!cache[col]) return;
      cache[col] = cache[col].filter(function (x) { return String(x.id) !== String(id); });
      emit(col);
    }

    function subscribe(col, next, error) {
      subs[col].push({ next: next, error: error });
      if (cache[col]) next(cache[col]); else refreshSoon();
      startPolling();
      return function () { subs[col] = subs[col].filter(function (s) { return s.next !== next; }); };
    }

    function collection(col) {
      if (!SHEETS[col]) throw new Error('알 수 없는 저장소: ' + col);
      return {
        doc: function (id) {
          return {
            set: function (data) {
              return put(SHEETS[col], id, data).then(function () { localPut(col, id, data); refreshSoon(); });
            },
            delete: function () {
              var before = (cache[col] || []).find(function (x) { return String(x.id) === String(id); }) || null;
              return del(SHEETS[col], id, before).then(function () { localDel(col, id); refreshSoon(); });
            }
          };
        },
        onSnapshot: function (cb, onErr) {
          return subscribe(col, function (rows) { cb(snap(rows)); }, onErr);
        }
      };
    }

    /* "meta/import-2026" 처럼 경로로 부르는 문서 = trip_meta 의 한 건 */
    function doc(path) {
      var id = String(path).split('/').pop();
      function current() { return (cache.meta || []).find(function (x) { return String(x.id) === id; }) || null; }
      return {
        set: function (data) {
          return put(SHEETS.meta, id, data).then(function () { localPut('meta', id, data); refreshSoon(); });
        },
        onSnapshot: function (cb, onErr) {
          return subscribe('meta', function () {
            var r = current(), d = r ? strip(r) : null;
            cb({ exists: !!r, data: function () { return d; } });
          }, onErr);
        },
        /* 가져오기 잠금 — 다른 사람이 진행 중이면 기다리게 합니다.
           완벽한 잠금은 아니지만, 가져오기 자체가 "이미 있는 번호는 건너뛰기"라 겹쳐도 중복이 생기지 않습니다. */
        acquire: function (opt) {
          var leaseId = id + '-lease', now = Date.now();
          return list(SHEETS.meta).then(function (rows) {
            var l = rows.find(function (x) { return String(x.id) === leaseId; });
            if (l && l.holder && l.holder !== opt.holder && Number(l.until) > now) return { acquired: false };
            return put(SHEETS.meta, leaseId, { holder: opt.holder, until: now + (opt.ttlMs || 120000) })
              .then(function () { return { acquired: true }; });
          });
        }
      };
    }

    /* 여러 건을 한꺼번에 새로 넣기 (이미 있는 번호는 그대로 둠) */
    function bulkCreate(col, records, onProgress) {
      var sheet = SHEETS[col], saved = 0, i = 0;
      function next() {
        if (i >= records.length) { refreshSoon(); return Promise.resolve(saved); }
        var chunk = records.slice(i, i + BULK).map(function (r) { return Object.assign({}, r, { id: String(r.id) }); });
        return req('POST', API, {
          sheet: sheet, action: 'importNew', records: chunk,
          audit: '출장 보드 기록 가져오기 ' + (i + 1) + '~' + (i + chunk.length) + '건'
        }).then(function (r) {
          saved += Number(r && r.saved) || 0;
          chunk.forEach(function (c) { localPut(col, c.id, strip(c)); });
          i += chunk.length;
          if (onProgress) onProgress(chunk.length);
          return next();
        });
      }
      return next();
    }

    return { collection: collection, doc: doc, bulkCreate: bulkCreate, refresh: refresh };
  }

  /* 로그인 확인이 끝난 뒤 서버에 한 번 닿아 보고, 닿으면 공유 저장소를 돌려줍니다.
     - 파일을 PC 에서 바로 열었을 때(file://)만 null → 이 브라우저에만 저장
     - 포털 주소에서 연결이 안 되면 오류로 돌려줍니다. 몰래 이 브라우저에만 저장되어
       다른 팀원에게 안 보이는 일이 없도록, 화면에 "연결 끊김"을 띄우고 저장을 막습니다. */
  window.bdtsTripDb = function () {
    if (location.protocol === 'file:') return Promise.resolve(null);
    var ready = window.__bdtsAuthReady || Promise.resolve();
    return ready.then(function () {
      return list(SHEETS.members).then(function () { return makeDb(); });
    });
  };
})();
