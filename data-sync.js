// data-sync.js — 엑셀 업로드 데이터 "전 직원 공유" 저장 모듈 (Sales Report · 클레임 현황 공용)
// ------------------------------------------------------------------
// 거래처이력/CSC에 쓰는 것과 같은 Apps Script 웹앱을 사용해, 업로드된 데이터를
// 구글 스프레드시트의 'upload_blobs' 탭에 저장합니다. 큰 데이터는 조각(chunk)으로
// 나누어 저장하고, 페이지를 열 때 다시 합쳐서 불러옵니다.
//   → 어떤 기기/브라우저에서 업로드해도 모든 직원의 화면에 반영됩니다.
//
// ★ 준비물 (한 번만):
//   1) 스프레드시트에 'upload_blobs' 탭을 추가 (헤더는 자동 생성됨)
//   2) Code.gs에 doPost가 없다면 APPS_SCRIPT_UPDATE.md의 doPost 코드를 추가 후 재배포
//      (doPost가 없어도 소량 데이터는 JSONP GET으로 자동 폴백되지만,
//       Sales Report처럼 큰 데이터는 doPost가 필요합니다)
// ------------------------------------------------------------------

var DATA_SYNC_URL = (typeof HUB_SHEET_API_URL !== 'undefined' && HUB_SHEET_API_URL) ||
  'https://script.google.com/macros/s/AKfycbxkxRmbkTjnzFciIk6p_I9-8rbVzYZVcs7xO2MPEBkp0X4uOUAf8QmXgebpS7FpYkWxFA/exec';
var DATA_SYNC_TOKEN = (typeof HUB_SHEET_TOKEN !== 'undefined' && HUB_SHEET_TOKEN) || '0p9o8i7u';

var DS_CHUNK_POST = 30000;  // POST 사용 시 조각 크기 (시트 셀 한도 50,000자 이내)
var DS_CHUNK_GET  = 1000;   // JSONP GET 폴백 시 조각 크기 (URL 길이 한도 대비)
var DS_GET_MAX_CHUNKS = 80; // GET 폴백으로 저장 가능한 최대 조각 수 (초과 시 저장 거부)

(function () {
  'use strict';

  var _dsCounter = 0;
  function _dsJsonp(params, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    return new Promise(function (resolve, reject) {
      var cb = 'dsjsonp_' + Date.now() + '_' + (_dsCounter++);
      var script = document.createElement('script');
      var done = false, timer;
      function cleanup() { delete window[cb]; if (script.parentNode) script.parentNode.removeChild(script); clearTimeout(timer); }
      window[cb] = function (data) { if (done) return; done = true; cleanup(); resolve(data); };
      timer = setTimeout(function () { if (done) return; done = true; cleanup(); reject(new Error('요청 시간이 초과되었습니다.')); }, timeoutMs);
      script.onerror = function () { if (done) return; done = true; cleanup(); reject(new Error('요청을 보내지 못했습니다.')); };
      var qs = new URLSearchParams(Object.assign({}, params, { callback: cb, token: DATA_SYNC_TOKEN })).toString();
      script.src = DATA_SYNC_URL + '?' + qs;
      document.body.appendChild(script);
    });
  }

  function _dsPost(payload) {
    return fetch(DATA_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: DATA_SYNC_TOKEN }, payload))
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (data && data.error) throw new Error(data.error);
      return data;
    });
  }

  // POST(doPost) 지원 여부 감지 결과 캐시: null=미확인, true/false
  var _postSupported = null;
  function detectPost(sheetName) {
    if (_postSupported !== null) return Promise.resolve(_postSupported);
    return _dsPost({ sheet: sheetName, action: 'list' }).then(function () {
      _postSupported = true; return true;
    }).catch(function () {
      _postSupported = false; return false;
    });
  }

  // 시트 기반 "blob 저장소": 큰 JSON을 조각으로 나눠 저장/조립
  // 레코드: { id: key@ver#seq, key, ver, seq, total, savedat, data }
  function makeBlobStore(sheetName) {
    var shared = !!DATA_SYNC_URL;

    function addRecord(rec, usePost) {
      if (usePost) return _dsPost({ sheet: sheetName, action: 'add', record: JSON.stringify(rec) });
      return _dsJsonp({ sheet: sheetName, action: 'add', record: JSON.stringify(rec) }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        return res;
      });
    }
    function removeRecord(id, usePost) {
      if (usePost) return _dsPost({ sheet: sheetName, action: 'delete', id: id });
      return _dsJsonp({ sheet: sheetName, action: 'delete', id: id }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        return res;
      });
    }
    // 시트 전체를 읽어 특정 key에 해당하는 모든 레코드 id를 (캐시에 의존하지 않고) 매번 새로 조회.
    // ★ 이전 버전을 남김없이 정리하기 위한 핵심 — 한 세션에서 여러 번 save()해도,
    //   또는 이전 실행에서 정리가 누락되었어도 항상 서버의 실제 상태를 기준으로 청소한다.
    //   (구글시트는 스프레드시트 전체 셀 수가 1천만 개로 제한되므로, 조각 행이
    //    계속 누적되면 다른 탭(CSC/거래처이력 등)까지 저장이 막힐 수 있다 — 반드시 정리 필요)
    function _listIdsForKey(key) {
      return _dsJsonp({ sheet: sheetName, action: 'list' }, 60000).then(function (rows) {
        if (rows && rows.error) throw new Error(rows.error);
        if (!Array.isArray(rows)) rows = [];
        return rows.filter(function (r) { return r && String(r.key) === String(key); })
                   .map(function (r) { return r.id; });
      });
    }

    return {
      shared: shared,
      sheet: sheetName,

      // 시트의 모든 blob을 불러와 key별 최신 완성본을 조립: { key: { ver, data } }
      loadAll: function () {
        if (!shared) return Promise.resolve({});
        return _dsJsonp({ sheet: sheetName, action: 'list' }, 60000).then(function (rows) {
          if (rows && rows.error) throw new Error(rows.error);
          if (!Array.isArray(rows)) rows = [];
          // 같은 id가 여러 번 저장되었으면 마지막 것만 사용
          var byId = {};
          rows.forEach(function (r) { if (r && r.id != null) byId[String(r.id)] = r; });
          var groups = {}; // key → ver → {seq: data}
          Object.keys(byId).forEach(function (id) {
            var r = byId[id];
            var key = String(r.key || ''), ver = String(r.ver || '');
            if (!key || !ver) return;
            if (!groups[key]) groups[key] = {};
            if (!groups[key][ver]) groups[key][ver] = { total: parseInt(r.total, 10) || 0, parts: {} };
            groups[key][ver].parts[parseInt(r.seq, 10) || 0] = String(r.data == null ? '' : r.data);
          });
          var out = {};
          Object.keys(groups).forEach(function (key) {
            var vers = Object.keys(groups[key]).sort(function (a, b) { return Number(b) - Number(a); });
            for (var i = 0; i < vers.length; i++) {
              var g = groups[key][vers[i]];
              var full = '', complete = g.total > 0;
              for (var s = 0; s < g.total; s++) {
                if (g.parts[s] === undefined) { complete = false; break; }
                full += g.parts[s];
              }
              if (!complete) continue;
              try {
                out[key] = { ver: Number(vers[i]), data: JSON.parse(full) };
                break; // 최신 완성본을 찾았으면 종료
              } catch (e) { /* 손상된 버전 → 이전 버전 시도 */ }
            }
          });
          return out;
        });
      },

      // key에 obj 저장 (통째로 교체). onProgress(done, total) 콜백 제공.
      save: function (key, obj, onProgress) {
        if (!shared) return Promise.reject(new Error('공유 저장소 URL이 설정되지 않았습니다.'));
        var str = JSON.stringify(obj);
        return detectPost(sheetName).then(function (usePost) {
          var chunkSize = usePost ? DS_CHUNK_POST : DS_CHUNK_GET;
          var total = Math.max(1, Math.ceil(str.length / chunkSize));
          if (!usePost && total > DS_GET_MAX_CHUNKS) {
            throw new Error('데이터가 커서 공유 저장에 실패했습니다. Apps Script에 doPost 추가가 필요합니다 (APPS_SCRIPT_UPDATE.md 참고).');
          }
          var ver = Date.now();
          var savedat = new Date().toISOString();
          var i = 0;
          function next() {
            if (i >= total) return Promise.resolve();
            var rec = {
              id: key + '@' + ver + '#' + i,
              key: key, ver: ver, seq: i, total: total,
              savedat: savedat,
              data: str.substr(i * chunkSize, chunkSize)
            };
            return addRecord(rec, usePost).then(function () {
              i++;
              if (onProgress) onProgress(i, total);
              return next();
            });
          }
          return next().then(function () {
            // 이전 버전 조각을 남김없이 정리 (실패해도 저장 자체는 성공으로 처리 — 다음 저장 때 다시 시도됨)
            return _listIdsForKey(key).then(function (allIds) {
              var oldIds = allIds.filter(function (id) { return String(id).indexOf(key + '@' + ver + '#') !== 0; });
              return _pruneIds(oldIds, usePost);
            }).catch(function (e) {
              console.warn('이전 버전 정리 중 오류(다음 저장 시 재시도됨):', e);
            }).then(function () {
              return { ver: ver, chunks: total };
            });
          });
        });
      }
    };

    // id 목록을 순차적으로(최대한 안전하게) 모두 삭제 — 개수 제한 없음
    function _pruneIds(ids, usePost) {
      var i = 0;
      function step() {
        if (i >= ids.length) return Promise.resolve();
        return removeRecord(ids[i], usePost).catch(function () {}).then(function () { i++; return step(); });
      }
      return step();
    }
  }

  window.makeBlobStore = makeBlobStore;
  window.dataSyncConfigured = function () { return !!DATA_SYNC_URL; };
})();
