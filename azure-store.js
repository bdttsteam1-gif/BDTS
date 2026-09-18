// azure-store.js — hub-sheet.js + data-sync.js 를 통째로 대체하는 파일
// =====================================================================
// ★ 핵심: 함수 이름과 사용법을 예전과 똑같이 맞춰 두었습니다.
//     makeHubStore(sheetName, lsKey) → { shared, list, add, update, remove }
//     makeBlobStore(storeName)       → { shared, loadAll, save }
//
//   그래서 csc.html / info.html / claim.html / sales.html 안의 코드는
//   한 글자도 안 고쳐도 됩니다. HTML 의 <script> 줄에서
//       <script src="hub-sheet.js"></script>
//       <script src="data-sync.js"></script>
//   이 두 줄을
//       <script src="azure-store.js"></script>
//   한 줄로 바꾸기만 하면 구글시트 대신 Azure 로 저장됩니다.
//
//   JSONP·토큰·조각내기(chunk)·이전버전 청소는 전부 사라졌습니다.
//   인증은 Azure 로그인 쿠키가 자동으로 처리하므로 토큰을 코드에 심지 않습니다.
// =====================================================================

var AZ_API = '/api';

(function () {
  'use strict';

  // 로그인 재시도가 필요하면 화면에 뜬 로그인 게이트(auth-gate.js)를 다시 띄웁니다.
  function _forceRelogin() {
    location.reload();
  }

  /* 운영 로그 (2026-09) — 저장·삭제·불러오기가 실패하면 관리자 [운영 로그]에 한 줄 남깁니다.
     화면 14곳의 "저장 실패" 안내를 하나하나 고치는 대신, 모든 저장이 지나가는 이 길목에서 남겨 빠짐이 없게 합니다.
     내용(클레임 본문 등)은 보내지 않고 메뉴·건번호·동작·오류 메시지만 보냅니다. */
  function _opsReport(url, opts, err, status) {
    try {
      if (/\/api\/(opslog|auth\/)/.test(url)) return;                     /* 로그 전송·로그인 자체는 제외 */
      var method = (opts && opts.method) || 'GET', b = {};
      if (opts && typeof opts.body === 'string') { try { b = JSON.parse(opts.body) || {}; } catch (e) {} }
      var isBlob = url.indexOf('/api/blobs') >= 0;
      var qs = url.split('?')[1] || '';
      var qp = function (k) { var m = qs.match(new RegExp('(?:^|&)' + k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : ''; };
      var action = method === 'GET' ? (qp('action') || 'list') : (b.action || (isBlob ? 'save' : ''));
      var kind = method === 'GET' ? 'load_fail' : isBlob ? 'upload_fail'
        : (action === 'delete' || action === 'purge') ? 'delete_fail' : 'save_fail';
      var rec = b.record && typeof b.record === 'object' ? b.record : {};
      var info = {
        sheet: (isBlob ? 'blob:' : '') + (b.sheet || b.store || qp('sheet') || qp('store') || ''),
        action: action,
        recId: String(rec.id != null ? rec.id : (b.id != null ? b.id : (b.key || qp('key') || ''))),
        message: (err && err.message) || String(err || ''),
        detail: status ? ('HTTP ' + status) : '서버에 닿지 못함 (인터넷 연결 · 서버 중단)'
      };
      if (window.bdtsOps) window.bdtsOps.report(kind, info);
      else (window.__bdtsOpsQ = window.__bdtsOpsQ || []).push([kind, info]);
      if (err && typeof err === 'object') err.__bdtsLogged = true;
    } catch (e) {}
  }

  function _req(url, opts) {
    var status = 0;
    return fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}))
      .then(function (res) {
        status = res.status;
        if (res.status === 401) {
          _forceRelogin();
          var e401 = new Error('다시 로그인해주세요.'); e401.__bdtsLogged = true;
          throw e401;
        }
        return res.json().catch(function () {
          throw new Error('서버 응답을 읽지 못했습니다. (' + res.status + ')');
        }).then(function (j) {
          if (!res.ok || (j && j.error)) {
            var ex = new Error((j && j.error) || ('오류 ' + res.status));
            ex.status = res.status;
            ex.data = j || {};                       /* 충돌이면 conflict / current(최신 내용) 가 들어 있습니다 */
            if (ex.data.conflict) ex.__bdtsLogged = true;   /* 충돌은 오류가 아니라 정상적인 안내입니다 */
            throw ex;
          }
          return j;
        });
      })
      .catch(function (err) {
        if (!(err && err.__bdtsLogged)) _opsReport(url, opts, err, status);
        throw err;
      });
  }
  function _get(url) { return _req(url); }
  function _post(url, body) {
    return _req(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  // ---------------- 로그인한 사람 정보 ----------------
  // auth-gate.js 가 페이지 로딩 시 이미 세션을 확인해서 window.__bdtsAuthReady 에 담아둡니다.
  // whoAmI() 는 그 결과가 끝나길 기다렸다가 돌려줍니다.
  function whoAmI() {
    var ready = window.__bdtsAuthReady || Promise.resolve();
    return ready.then(function () {
      return window.__bdtsUser || { email: '', roles: [], isAdmin: false };
    });
  }

  function logout() {
    return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .then(function () { location.href = '/'; });
  }
  window.bdtsLogout = logout;

  /* ---- 저장 버전(_ver) ----
     _ver 는 "이 건을 서버에서 마지막으로 읽었을 때의 저장 시각"입니다.
     _at 는 화면이 저장 직전에 미리 찍어두기도 해서(stampEdit) 기준으로 쓸 수 없으므로 따로 둡니다.
     서버가 저장을 마치면 새 _at 를 돌려주고, 여기서 _ver 를 그 값으로 바꿔 다음 저장에 씁니다. */
  function _verOf(rec, opts) {
    if (opts && opts.ifVersion !== undefined) return String(opts.ifVersion || '');
    if (!rec) return '';
    if (rec._ver !== undefined && rec._ver !== null) return String(rec._ver);
    return String(rec._at || '');
  }
  function _stampVer(rec, res) {
    if (rec && res && res._at) { rec._at = res._at; rec._ver = res._at; }
    return res;
  }
  /* 목록·단건을 불러온 직후, 읽은 시점의 저장 시각을 _ver 로 박아둡니다 */
  function markVer(rec) { if (rec && typeof rec === 'object') rec._ver = rec._at || ''; return rec; }
  window.bdtsMarkVer = markVer;

  // ---------------- 레코드 저장소 (구 makeHubStore) ----------------
  function makeHubStore(sheetName, lsKey) {
    return {
      shared: true,
      sheet: sheetName,

      list: function () {
        return _get(AZ_API + '/records?sheet=' + encodeURIComponent(sheetName))
          .then(function (r) { return Array.isArray(r) ? r.map(markVer) : []; });
      },
      // 한 건만 다시 읽기 — 수정 화면을 열 때 내 사본을 최신으로 맞추는 데 씁니다.
      get: function (id) {
        return _post(AZ_API + '/records', { sheet: sheetName, action: 'get', id: id })
          .then(function (r) { return r && r.record ? markVer(r.record) : null; });
      },
      add: function (rec, opts) {
        // opts.unique = true 이면 서버가 덮어쓰지 않고, 번호가 겹치면 다음 번호를 발급합니다.
        return _post(AZ_API + '/records', {
          sheet: sheetName, action: 'add', record: rec,
          unique: !!(opts && opts.unique)
        }).then(function (r) { return _stampVer(rec, r); });
      },
      /* 수정은 "내가 불러왔을 때의 저장 시각"을 함께 보냅니다 (_ver).
         그 사이 남이 먼저 저장했으면 서버가 409 로 막고 최신 내용을 돌려줍니다 — 덮어쓰지 않습니다. */
      update: function (rec, opts) {
        return _post(AZ_API + '/records', {
          sheet: sheetName, action: 'update', record: rec, ifVersion: _verOf(rec, opts)
        }).then(function (r) { return _stampVer(rec, r); });
      },
      /* 수정 잠금 — 저장을 막는 장치가 아니라, 남이 이미 열어둔 건을 미리 알려주는 안내입니다.
         3분이 지나면 저절로 풀리므로 브라우저가 갑자기 닫혀도 업무가 막히지 않습니다. */
      lock: function (id) {
        return _post(AZ_API + '/records', { sheet: sheetName, action: 'lock', id: id })
          .catch(function () { return { success: true, offline: true }; });   /* 잠금 실패가 업무를 막지는 않습니다 */
      },
      unlock: function (id, opts) {
        var body = JSON.stringify({ sheet: sheetName, action: 'unlock', id: id });
        if (opts && opts.beacon) {
          /* 창을 닫는 중이라 보통 요청은 취소될 수 있습니다 — 끝까지 보내지는 방식으로 보냅니다 */
          try {
            return fetch(AZ_API + '/records', { method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
          } catch (e) { return Promise.resolve(); }
        }
        return _post(AZ_API + '/records', { sheet: sheetName, action: 'unlock', id: id }).catch(function () {});
      },
      // 번호 변경 (관리자 전용): 접수일의 연·월이 바뀐 건을 새 번호로 다시 저장하고 옛 번호 건은 휴지통으로 보냅니다.
      // rec.id = 브라우저가 계산한 새 번호(참고용, 서버가 빈 번호로 확정). before = 옛 번호 건의 내용(씨앗 자료용).
      renumber: function (oldId, rec, before) {
        return _post(AZ_API + '/records', {
          sheet: sheetName, action: 'renumber', oldId: oldId, record: rec, before: before || null
        });
      },
      // 삭제는 '휴지통으로 옮기기'입니다. 30일 안에는 되살릴 수 있습니다.
      // payload 를 함께 보내면, 서버에 아직 저장되지 않은 과거 자료(씨앗 파일에서 읽은 건)도
      // 휴지통에 내용까지 담기므로 똑같이 되살릴 수 있습니다.
      remove: function (id, payload, opts) {
        return _post(AZ_API + '/records', {
          sheet: sheetName, action: 'delete', id: id, record: payload || null,
          ifVersion: _verOf(payload, opts),
          // hard=true 면 휴지통을 거치지 않고 바로 지웁니다.
          // 연도별 자료 초기화처럼 수백 건을 한꺼번에 지우는 곳에서만 씁니다.
          hard: !!(opts && opts.hard)
        });
      }
    };
  }

  // ---------------- 휴지통 (30일 보관) ----------------
  // 어느 화면에서 지웠든 한곳에 모입니다. 되살리면 원래 있던 자리로 돌아갑니다.
  function makeTrashStore() {
    return {
      shared: true,
      list: function () {
        return _get(AZ_API + '/records?sheet=trash&action=trash')
          .then(function (r) { return Array.isArray(r) ? r : []; });
      },
      restore: function (sheet, id) {
        return _post(AZ_API + '/records', { sheet: 'trash', action: 'restore', trSheet: sheet, id: id });
      },
      purge: function (sheet, id) {
        return _post(AZ_API + '/records', { sheet: 'trash', action: 'purge', trSheet: sheet, id: id });
      }
    };
  }

  // ---------------- 대용량 저장소 (구 makeBlobStore) ----------------
  function makeBlobStore(storeName) {
    return {
      shared: true,
      sheet: storeName,

      // { key: { ver, data } } — 예전 형식 그대로
      loadAll: function () {
        return _get(AZ_API + '/blobs?store=' + encodeURIComponent(storeName));
      },

      // 통째로 저장. 조각내기가 없어졌으므로 진행률은 0%→100% 두 번만 호출됩니다.
      save: function (key, obj, onProgress) {
        if (onProgress) onProgress(0, 1);
        return _post(AZ_API + '/blobs', { store: storeName, key: String(key), data: obj })
          .then(function (r) {
            if (onProgress) onProgress(1, 1);
            return { ver: r.ver, chunks: 1 };
          });
      },

      loadOne: function (key) {
        return _get(AZ_API + '/blobs?store=' + encodeURIComponent(storeName) +
                    '&key=' + encodeURIComponent(key));
      }
    };
  }

  window.makeHubStore = makeHubStore;
  window.makeBlobStore = makeBlobStore;
  window.makeTrashStore = makeTrashStore;
  window.whoAmI = whoAmI;
  window.dataSyncConfigured = function () { return true; };

  // 예전 코드가 참조하던 전역 이름들 — 있어도 문제없게 비워둡니다.
  window.HUB_SHEET_API_URL = AZ_API;
  window.HUB_SHEET_TOKEN = '';
})();
