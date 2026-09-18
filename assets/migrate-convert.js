/* migrate-convert.js — BDTS-main(구글 시트 백업 거래처이력카드.xlsx) → 포털 저장 형식 변환 (브라우저용)
 * ---------------------------------------------------------------------------------------------
 * tools/migrate/convert.py 와 같은 규칙을 브라우저에서 그대로 돌립니다. pages/import.html 이 씁니다.
 *   window.MigrateConvert.fromWorkbook(wb, { base: window.__SEED, overrides })  → { files, manifest, report, notlist }
 *   window.MigrateConvert.reportMarkdown(result)                                 → 검토 리포트 문자열
 *   window.MigrateConvert.notlistWorkbook(result)                                → 목록에 없는 값 xlsx (SheetJS workbook)
 *
 * 원칙 (convert.py 와 동일)
 *   - 원본 값은 바꾸지 않습니다. 날짜는 'YYYY-MM-DD' 표기만 통일하고, 바뀐 건은 전부 리포트에 남깁니다.
 *   - 읽을 수 없는 날짜는 비워 두고 _raw… 에 원본을 보존합니다. 사람이 확정한 값(보정표)만 적용하고 그 내역도 남깁니다.
 *   - 마스터로그(클레임 로그 국내)는 만들지 않습니다(logs: []).
 *   - 목록(장비·아이템·이름·분류)에 없는 값은 고치지 않고 그대로 두되 따로 모아 보여줍니다.
 */
(function () {
  'use strict';

  /* 사람이 확정한 보정표 — tools/migrate/overrides.json 과 같은 내용. 형식 {시트: {id: {항목: 값}}}
     (원본 xlsx 에 같은 id 가 계속 남아 있으므로, 다음에 내려받은 파일에도 그대로 적용됩니다) */
  var DEFAULT_OVERRIDES = {
    records: {
      '799': { date: '2025-04-08', _근거: "원본 #VALUE!, 깃허브 client-data.js 의 같은 건이 '20205-04-08' — 2026-09-09 사용자 확인" }
    },
    claim_progress: {
      'u_1788249616758_ohyw': { replied: '2026-09-01', _근거: "원본 '2026-89-01 15:03' (접수 2026-09-01) — 2026-09-09 사용자 확인" },
      'u_1788310411342_k1tx': { replied: '2026-09-02', _근거: "원본 '2026-00-02 09:50' (접수 2026-09-02) — 2026-09-09 사용자 확인" }
    }
  };

  /* 사용자가 확정한 값 정리표 — tools/migrate/value-map.json 과 같은 내용 (목록에_없는_값_260909.xlsx, 2026-09-09).
     원본 값 → 포털 목록 값. 없는 값은 원본 그대로. 바꾼 건은 기록의 _valueFix 에 원본이 남습니다. */
  var DEFAULT_VALUE_MAP = {
      "거래처 이력카드": {
          "분류": {
              "PM": "PM(Preventive Maintenance)",
              "소프트웨어 업데이트": "PM(Preventive Maintenance)",
              "A/S 수리": "AS 수리",
              "Pre-maintenance": "PM(Preventive Maintenance)",
              "컴플": "컴플레인"
          },
          "시약명": {
              "Total b-hCG": "Total B-hCG",
              "b-HCG Plus": "b-hCG Plus",
              "B-hcg": "Total B-hCG",
              "Total Anti-Infliximab": "Total Anti-infliximab",
              "TRIAS Mycoplasma": "Mycoplasma",
              "Washing Cartridge": "AFIAS washing cartridge",
              "TRIAS Influenza A+B": "influenza A+B",
              "Total B-hcG": "Total B-hCG"
          },
          "담당자": {
              "김대영, 최형우": "최형우, 김대영",
              ".최형우": "최형우"
          },
          "기기명": {
              "TRIAS-3": "TRIAS 3",
              "AH600Pro": "AH600 Pro",
              "AH600 PRO": "AH600 Pro",
              "ALCIS-2": "ALCIS 2",
              "ALCIS-1": "ALCIS 1",
              "Hemochroma Plus": "Hemochroma plus",
              "AFIAS-11": "AFIAS-1",
              "ichroma II": "ichroma 2",
              "AFIAS 10": "AFIAS-10"
          }
      },
      "고객지원센터": {
          "접수담당자": {
              "하용왕": "하용황"
          },
          "회신자": {
              "박헤신": "박혜신",
              "박혜신/김대영": "박혜신, 김대영"
          },
          "장비": {
              "AH600 PRO": "AH600 Pro",
              "AH-600 Pro": "AH600 Pro"
          },
          "아이템": {
              "b-hCG Plus,b-hCG": "b-hCG Plus, Total B-hCG",
              "Total B-hcG": "Total B-hCG"
          }
      }
  };

  var CATEGORY_LIST = ['문의', '컴플레인', 'PM(Preventive Maintenance)', '내부 성능 평가', 'AS 수리', '세팅', '기타'];
  var CONTACT_LIST = ['방문', '전화', '메일', '기타'];
  var VIA_MAP = { '메일': 'email', 'CSC': 'CSC(고객지원센터)', 'QR': 'QR Code', '전화': 'phone call', 'SNS': 'SNS', '방문': 'Visit', 'AFIAS NET': 'AFIAS NET' };
  var ACT_MAP = { '전화': 'Phone call response', '메일': 'Email response', 'CSC': 'CSC(고객지원센터)', 'SNS': 'SNS response', '방문': 'Visit', 'AFIAS NET': 'AFIAS NET', 'QR': 'QR Code' };

  function pad2(n) { return String(n).padStart(2, '0'); }
  /* 엑셀 날짜(일련번호)는 초 단위 오차가 생겨 10:31:59.99 처럼 읽힐 수 있어 가장 가까운 초로 맞춥니다 */
  function fixDate(v) { return (v instanceof Date && !isNaN(v.getTime())) ? new Date(Math.round(v.getTime() / 1000) * 1000) : v; }
  function S(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) { v = fixDate(v); return isNaN(v.getTime()) ? '' : v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate()) + ' ' + pad2(v.getHours()) + ':' + pad2(v.getMinutes()) + ':' + pad2(v.getSeconds()); }
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return String(v).replace(/\r\n?/g, '\n').trim();
  }
  function validYMD(y, mo, d) { return y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31; }

  function Converter(base, overrides, valueMap) {
    this.base = base || {};
    this.VMAP = valueMap || {};
    this.VMAP_USED = {};
    this.DEVICES = new Set(this.base.device || []);
    this.ITEMS = new Set(this.base.item || []);
    this.NAMES = new Set((this.base.names || []).map(function (n) { return n.ko; }));
    this.HOSPS = new Set((this.base.hospitals || []).map(function (h) { return h.name; }));
    this.OVR = overrides || {};
    this.OVR_USED = []; this.DATE_FIX = []; this.DATE_BAD = []; this.NL = {}; this.rep = [];
  }
  /* 값 정리표 적용 — 바뀌면 rec._valueFix 와 집계에 남깁니다 */
  Converter.prototype.vfix = function (rec, sheet, cat, field, val) {
    var nu = ((this.VMAP[sheet] || {})[cat] || {})[val];
    if (nu === undefined || nu === val) return val;
    (rec._valueFix = rec._valueFix || []).push({ field: field, from: val, to: nu });
    var k = [sheet, cat, val, nu].join('\u0001'); this.VMAP_USED[k] = (this.VMAP_USED[k] || 0) + 1;
    return nu;
  };
  Converter.prototype.override = function (sheet, rid, field, cur, raw) {
    var v = (this.OVR[sheet] || {})[String(rid)] || {};
    if (Object.prototype.hasOwnProperty.call(v, field)) {
      this.OVR_USED.push([sheet, String(rid), field, raw != null ? raw : cur, v[field]]);
      return v[field];
    }
    return cur;
  };
  Converter.prototype.normDate = function (v, sheet, rid, field) {
    if (v === null || v === undefined || v === '') return '';
    v = fixDate(v);
    if (v instanceof Date) {
      if (isNaN(v.getTime()) || !validYMD(v.getFullYear(), v.getMonth() + 1, v.getDate())) { this.DATE_BAD.push([sheet, rid, field, '(엑셀이 날짜로 읽지 못한 값)']); return ''; }
      return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
    }
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?$/.exec(s))) {
      if (validYMD(+m[1], +m[2], +m[3])) {
        var out = m[1] + '-' + m[2] + '-' + m[3];
        if (out !== s) this.DATE_FIX.push([sheet, rid, field, s, out, '시각 잘라냄']);
        return out;
      }
      this.DATE_BAD.push([sheet, rid, field, s]); return '';
    }
    if ((m = /^(\d{4})[.\-\/]+(\d{1,2})[.\-\/]+(\d{1,2})\.?$/.exec(s))) {
      if (validYMD(+m[1], +m[2], +m[3])) {
        var o2 = m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
        this.DATE_FIX.push([sheet, rid, field, s, o2, '구분자 통일']);
        return o2;
      }
    }
    this.DATE_BAD.push([sheet, rid, field, s]); return '';
  };
  Converter.prototype.normDateTime = function (v, sheet, rid, field) {
    if (v === null || v === undefined || v === '') return ['', ''];
    v = fixDate(v);
    if (v instanceof Date) {
      if (isNaN(v.getTime()) || !validYMD(v.getFullYear(), v.getMonth() + 1, v.getDate())) { this.DATE_BAD.push([sheet, rid, field, '(엑셀이 날짜로 읽지 못한 값)']); return ['', '']; }
      return [v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate()), pad2(v.getHours()) + ':' + pad2(v.getMinutes())];
    }
    var s = String(v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
    if (m) {
      if (validYMD(+m[1], +m[2], +m[3])) return [m[1] + '-' + m[2] + '-' + m[3], m[4] + ':' + m[5]];
      this.DATE_BAD.push([sheet, rid, field, s]); return ['', ''];
    }
    return [this.normDate(s, sheet, rid, field), ''];
  };
  Converter.prototype.nl = function (sheet, cat, val, rid) {
    var key = sheet + '|' + cat;
    var m = this.NL[key] || (this.NL[key] = { sheet: sheet, cat: cat, vals: {} });
    (m.vals[val] = m.vals[val] || []).push(String(rid));
  };

  function fmtPhone(s) {
    s = S(s); if (!s) return '';
    var m = /^([\d\-\s\.\(\)]+)(.*)$/.exec(s); if (!m) return s;
    var digits = m[1].replace(/\D/g, ''), tail = m[2].trim(); if (!digits) return s;
    var p;
    if (digits.indexOf('02') === 0) p = digits.length >= 9 ? ['02', digits.slice(2, -4), digits.slice(-4)] : ['02', digits.slice(2)];
    else if (/^1[5-9]\d\d/.test(digits) && digits.length === 8) p = [digits.slice(0, 4), digits.slice(4)];
    else if (digits.length >= 10) p = [digits.slice(0, 3), digits.slice(3, -4), digits.slice(-4)];
    else if (digits.length >= 8) p = [digits.slice(0, -4), digits.slice(-4)];
    else p = [digits];
    return (p.filter(Boolean).join('-') + (tail ? ' ' + tail : '')).trim();
  }
  function firstLine(s, n) { n = n || 80; var line = S(s).replace(/\r/g, '').split('\n')[0].trim(); return line.length > n ? line.slice(0, n) + '…' : line; }
  function normId(v) { var s = S(v); return /^\d+$/.test(s) ? Number(s) : s; }
  function jload(v) { var s = S(v); if (!s || s === '[]') return []; try { var x = JSON.parse(s); return Array.isArray(x) ? x : []; } catch (e) { return []; } }

  /* 시트 → [{헤더: 값}] (빈 줄 제외). cellDates:true 로 읽은 workbook 을 기대합니다 */
  function sheetRows(wb, name) {
    var ws = wb.Sheets[name]; if (!ws) return { hdr: [], rows: [] };
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    if (!aoa.length) return { hdr: [], rows: [] };
    var hdr = aoa[0].map(function (h) { return S(h); });
    var rows = [];
    for (var i = 1; i < aoa.length; i++) {
      var r = aoa[i]; if (!r || !r.some(function (c) { return c !== null && c !== undefined && c !== ''; })) continue;
      var d = {}; hdr.forEach(function (h, j) { if (h) d[h] = j < r.length ? r[j] : null; });
      rows.push(d);
    }
    return { hdr: hdr, rows: rows };
  }
  function stableKey(r) { return JSON.stringify(r, Object.keys(r).sort()); }
  Converter.prototype.dedupe = function (rows, label) {
    var seen = {}, out = [], same = 0, diff = [];
    rows.forEach(function (r) {
      var k = S(r.id);
      if (k in seen) { if (stableKey(seen[k]) === stableKey(r)) same++; else diff.push(k); return; }
      seen[k] = r; out.push(r);
    });
    if (same || diff.length) this.rep.push('- ' + label + ': 같은 id 중복 — 완전 동일 ' + same + '건 제거' + (diff.length ? ', **내용이 다른 중복 ' + diff.length + '건**(첫 건만 남김, 확인 필요): ' + diff.join(', ') : ''));
    return out;
  };

  /* ================================================================ 변환 본체 */
  function fromWorkbook(wb, opts) {
    opts = opts || {};
    var ovr = JSON.parse(JSON.stringify(DEFAULT_OVERRIDES));
    if (opts.overrides) Object.keys(opts.overrides).forEach(function (sh) {
      if (sh.charAt(0) === '_') return;
      ovr[sh] = Object.assign(ovr[sh] || {}, opts.overrides[sh]);
    });
    var vmap = JSON.parse(JSON.stringify(DEFAULT_VALUE_MAP));
    if (opts.valueMap) Object.keys(opts.valueMap).forEach(function (sh) {
      if (sh.charAt(0) === '_') return; vmap[sh] = vmap[sh] || {};
      Object.keys(opts.valueMap[sh]).forEach(function (cat) { vmap[sh][cat] = Object.assign(vmap[sh][cat] || {}, opts.valueMap[sh][cat]); });
    });
    var C = new Converter(opts.base, ovr, vmap), rep = C.rep, files = {}, manifest = {};
    var self = C;
    rep.push('# BDTS-main → bdts-portal-main 이관 검토 리포트', '',
      '- 원본: `' + (opts.source || 'xlsx') + '`  (탭: ' + wb.SheetNames.join(', ') + ')',
      '- 생성: ' + new Date().toLocaleString('ko-KR') + ' (브라우저 변환)',
      '- 기준 목록: 장비 ' + C.DEVICES.size + ' · 아이템 ' + C.ITEMS.size + ' · 이름 ' + C.NAMES.size + ' · 병원 ' + C.HOSPS.size, '');

    /* ---------- 1. 거래처 이력카드 ---------- */
    var rs = sheetRows(wb, 'records'); var raw = rs.rows;
    rep.push('## 1. 거래처 이력카드 (records → client_cards)', '', '- 원본 행: ' + raw.length + '건 (빈 줄 제외)');
    raw = C.dedupe(raw, 'records');
    var cards = [], clientHosps = new Set();
    raw.forEach(function (r) {
      var rid = normId(r.id);
      var date = C.normDate(r.date, 'records', rid, 'date');
      date = C.override('records', rid, 'date', date, S(r.date));
      if (!date) C.DATE_BAD.push(['records', rid, 'date', S(r.date) || '(빈 값)']);
      var reagent = S(r.reagent), lot = S(r.reagentLot);
      var items = (reagent || lot) ? [{ item: reagent, lot: lot }] : [];
      var st = { device: S(r.device), sn: S(r.sn), sw: S(r.sw), items: items, req: S(r.request), act: S(r.action), etc: S(r.etc), c1: '', c2: '', c3: '', files: [] };
      jload(r.images).forEach(function (u, k) { if (typeof u === 'string' && u) st.files.push({ name: '사진 ' + (k + 1) + ' (Google Drive)', data: u, legacyUrl: true }); });
      var card = {
        id: rid, manager: S(r.manager), contact: S(r.contact), date: date, hospital: S(r.hospital), requester: S(r.requester),
        region: S(r.region), phone: fmtPhone(r.phone), agency: S(r.agency), category: S(r.category),
        title: opts.titleFrom === 'none' ? '' : firstLine(r.request), doctorNote: S(r.doctorNote), folder: S(r.folder),
        sets: [st], logs: [], logMap: [], _src: 'BDTS-main', _srcId: S(r.id)
      };
      if (!date && S(r.date)) card._rawDate = S(r.date);
      var its = items.length ? items : [{ item: '', lot: '' }];
      card.devices = its.map(function (it) { return { device: st.device, sn: st.sn, sw: st.sw, item: it.item, lot: it.lot, req: st.req, act: st.act, etc: st.etc, files: st.files }; });
      card.cls = { c1: '', c2: '', c3: '' }; card.files = st.files.slice();
      /* 사용자 확정 값 정리표 */
      card.category = C.vfix(card, '거래처 이력카드', '분류', 'category', card.category);
      card.manager = C.vfix(card, '거래처 이력카드', '담당자', 'manager', card.manager);
      st.device = C.vfix(card, '거래처 이력카드', '기기명', 'sets[0].device', st.device);
      if (items.length) items[0].item = C.vfix(card, '거래처 이력카드', '시약명', 'sets[0].items[0].item', items[0].item);
      reagent = items.length ? items[0].item : '';
      card.devices.forEach(function (dv) { dv.device = st.device; dv.item = reagent; });
      cards.push(card); clientHosps.add(card.hospital);
      if (st.device && !C.DEVICES.has(st.device)) C.nl('거래처 이력카드', '기기명', st.device, rid);
      if (reagent && !C.ITEMS.has(reagent)) C.nl('거래처 이력카드', '시약명', reagent, rid);
      if (card.manager && !C.NAMES.has(card.manager)) C.nl('거래처 이력카드', '담당자', card.manager, rid);
      if (card.category && CATEGORY_LIST.indexOf(card.category) < 0) C.nl('거래처 이력카드', '분류', card.category, rid);
      if (card.contact && CONTACT_LIST.indexOf(card.contact) < 0) C.nl('거래처 이력카드', '컨택방식', card.contact, rid);
    });
    cards.sort(function (a, b) { return (String(b.date || '0000-00-00') + String(b.id)).localeCompare(String(a.date || '0000-00-00') + String(a.id)); });
    files.client_cards = cards; manifest.client_cards = cards.length;
    var mgr = {}; cards.forEach(function (c) { mgr[c.manager] = (mgr[c.manager] || 0) + 1; });
    rep.push('- 변환 결과: **' + cards.length + '건** → client_cards',
      '- 형식: 포털 신규 입력과 같은 구조(`sets[1]` = 기기+시약+접수/조치, `logs: []`). Title 은 ' + (opts.titleFrom === 'none' ? '비워 둠' : '접수사항 첫 줄(80자)'),
      '- 포털 입력 화면에 없던 항목 보존: 기기 블록의 `etc`(기타 특이사항·현황·정보 ' + cards.filter(function (c) { return c.sets[0].etc; }).length + '건 → 상세 팝업·검색에 표시), `folder`(원본 폴더 ' + cards.filter(function (c) { return c.folder; }).length + '건), 구글드라이브 사진 URL ' + cards.reduce(function (a, c) { return a + c.files.length; }, 0) + '건',
      '- 병원 수: ' + clientHosps.size + ' · 담당자: ' + Object.keys(mgr).sort(function (a, b) { return mgr[b] - mgr[a]; }).slice(0, 6).map(function (k) { return k + ' ' + mgr[k]; }).join(', '), '');
    pushNl(C, '거래처 이력카드');

    /* ---------- 2. 고객지원센터 ---------- */
    var cp = sheetRows(wb, 'claim_progress'); raw = cp.rows;
    rep.push('## 2. 고객지원센터 (claim_progress → csc_cards)', '', '- 원본 행: ' + raw.length + '건');
    raw = C.dedupe(raw, 'claim_progress');
    var knownHosps = new Set(Array.from(C.HOSPS).concat(Array.from(clientHosps)).concat(raw.map(function (r) { return S(r.hospital); }).filter(Boolean)));
    var cscs = [], derived = 0, unknownVia = {}, unknownAct = {};
    raw.forEach(function (r) {
      var rid = S(r.id);
      var dt = C.normDateTime(r.recvAt, 'claim_progress', rid, 'recvAt'), d = dt[0], t = dt[1];
      var rt2 = C.normDateTime(r.replyAt, 'claim_progress', rid, 'replyAt'), rd = rt2[0], rt = rt2[1];
      d = C.override('claim_progress', rid, 'date', d, S(r.recvAt));
      rd = C.override('claim_progress', rid, 'replied', rd, S(r.replyAt));
      if (rd && !rt) { var mm = /(\d{2}):(\d{2})/.exec(S(r.replyAt)); rt = mm ? mm[0] : ''; }
      if (!d) C.DATE_BAD.push(['claim_progress', rid, 'recvAt', S(r.recvAt) || '(빈 값)']);
      var title = S(r.title), hosp = S(r.hospital);
      if (!hosp && opts.deriveHospital !== false && title.indexOf(' / ') >= 0) {
        var head = title.split(' / ')[0].trim(); if (knownHosps.has(head)) { hosp = head; derived++; }
      }
      var viaRaw = S(r.via), actRaw = S(r.replyVia);
      var via = VIA_MAP[viaRaw] || viaRaw, act = ACT_MAP[actRaw] || actRaw;
      if (viaRaw && !VIA_MAP[viaRaw]) unknownVia[viaRaw] = (unknownVia[viaRaw] || 0) + 1;
      if (actRaw && !ACT_MAP[actRaw]) { unknownAct[actRaw] = (unknownAct[actRaw] || 0) + 1; C.nl('고객지원센터', '회신 경로', actRaw, rid); }
      var done = ['완료', '완료됨', 'done'].indexOf(S(r.status)) >= 0;
      var devs = jload(r.devicesJson), itms = jload(r.itemsJson);
      if (!devs.length && ['device', 'serial', 'sw', 'sample', 'store'].some(function (k) { return S(r[k]); }))
        devs = [{ device: S(r.device), sample: S(r.sample), sampleOther: S(r.sampleOther), store: S(r.store) }];
      if (!itms.length && ['item', 'itemLot', 'ctrlLot', 'itemUnit', 'anticoag'].some(function (k) { return S(r[k]); }))
        itms = [{ item: S(r.item), itemLot: S(r.itemLot), unit: S(r.itemUnit), ctrlItem: S(r.ctrlItem), ctrlLot: S(r.ctrlLot), anticoag: S(r.anticoag) }];
      var d0 = devs[0] || {};
      var items = itms.map(function (x) {
        var smp = S(x.sample) || S(d0.sample) || S(r.sample);
        if (['Other', '기타', 'other'].indexOf(smp) >= 0) smp = S(x.sampleOther) || S(d0.sampleOther) || S(r.sampleOther) || smp;
        return { item: S(x.item), lot: S(x.itemLot || x.lot), ctrl: S(x.ctrlLot || x.ctrl), unit: S(x.unit), sample: smp, store: S(x.store) || S(d0.store) || S(r.store), anti: S(x.anticoag || x.anti) };
      }).filter(function (it) { return Object.keys(it).some(function (k) { return it[k]; }); });
      /* 값 정리표 + "TSH, T3" 처럼 쉼표로 묶인 아이템은 여러 개로 나눕니다 (LOT 등은 첫 아이템에) */
      var rec0 = {}, splitItems = [];
      items.forEach(function (it) {
        it.item = C.vfix(rec0, '고객지원센터', '아이템', 'sets[0].items[].item', it.item);
        var parts = it.item.indexOf(',') >= 0 ? it.item.split(',').map(function (p) { return p.trim(); }) : [it.item];
        if (parts.length > 1) {
          (rec0._valueFix = rec0._valueFix || []).push({ field: 'sets[0].items[].item', from: it.item, to: parts.join(' / '), note: '아이템 ' + parts.length + '개로 나눔' });
          var kk = ['고객지원센터', '아이템', it.item, '아이템 ' + parts.length + '개로 나눔'].join('\u0001'); C.VMAP_USED[kk] = (C.VMAP_USED[kk] || 0) + 1;
        }
        parts.forEach(function (pn, k) { splitItems.push(k === 0 ? Object.assign({}, it, { item: pn }) : { item: pn, lot: '', ctrl: '', unit: '', sample: it.sample, store: it.store, anti: it.anti }); });
      });
      items = splitItems;
      devs.forEach(function (dv) { dv.device = C.vfix(rec0, '고객지원센터', '장비', 'sets[].device', S(dv.device)); });
      var sets = (devs.length ? devs : [{}]).map(function (dv, i) {
        return { device: S(dv.device), sn: i === 0 ? S(r.serial) : '', sw: i === 0 ? S(r.sw) : '', items: i === 0 ? items : [], issue: i === 0 ? S(r.complaint) : '', c1: '', c2: '', c3: '', files: [] };
      });
      var phone = fmtPhone(r.phone);
      var card = {
        id: rid, date: d, time: t, receiver: C.vfix(rec0, '고객지원센터', '접수담당자', 'receiver', S(r.writer)), via: via, title: title, kind: S(r.kind) || 'TS', hospital: hosp, region: S(r.region),
        phones: phone ? [{ no: phone, memo: '' }] : [], phone: phone, person: S(r.contact), sets: sets,
        confirm: C.vfix(rec0, '고객지원센터', '회신자', 'confirm', S(r.replier)), replied: rd, rtime: rt, action: act, status: done ? '완료' : '진행 중', end: done ? rd : '',
        note: S(r.note), mailSubject: S(r.mailSubject), cscKeyword: S(r.cscKeyword), logs: [], logMap: [], _src: 'BDTS-main', _srcId: rid
      };
      if (rec0._valueFix) card._valueFix = rec0._valueFix;
      if (!d && S(r.recvAt)) card._rawRecvAt = S(r.recvAt);
      if (!rd && S(r.replyAt)) card._rawReplyAt = S(r.replyAt);
      if (done && !rd) { card.status = '진행 중'; card.end = ''; card._noReplyDate = true; }   /* 회신일 없이는 완료가 아님 (사용자 결정 2026-09-09) */
      card.devices = sets.map(function (s2) { return { device: s2.device, sn: s2.sn, sw: s2.sw }; });
      card.items = items.slice(); card.issue = sets[0].issue; card.files = []; card.c1 = card.c2 = card.c3 = '';
      cscs.push(card);
      sets.forEach(function (s2) { if (s2.device && !C.DEVICES.has(s2.device)) C.nl('고객지원센터', '장비', s2.device, rid); });
      items.forEach(function (it) { if (it.item && !C.ITEMS.has(it.item)) C.nl('고객지원센터', '아이템', it.item, rid); });
      if (card.receiver && !C.NAMES.has(card.receiver)) C.nl('고객지원센터', '접수담당자', card.receiver, rid);
      if (card.confirm && !C.NAMES.has(card.confirm)) C.nl('고객지원센터', '회신자', card.confirm, rid);
    });
    cscs.sort(function (a, b) { return (String(b.date || '0000-00-00') + b.time + b.id).localeCompare(String(a.date || '0000-00-00') + a.time + a.id); });
    files.csc_cards = cscs; manifest.csc_cards = cscs.length;
    var nr = cscs.filter(function (c) { return c._noReplyDate; });
    rep.push('- 변환 결과: **' + cscs.length + '건** → csc_cards (완료 ' + cscs.filter(function (c) { return c.status === '완료'; }).length + ' · 진행 중 ' + cscs.filter(function (c) { return c.status !== '완료'; }).length + ' · 종류 그외 ' + cscs.filter(function (c) { return c.kind === '그외'; }).length + ')',
      '- 접수 경로 → Via 변환: ' + Object.keys(VIA_MAP).map(function (k) { return k + '→' + VIA_MAP[k]; }).join(', '),
      '- 회신 경로 → Action 변환: ' + Object.keys(ACT_MAP).map(function (k) { return k + '→' + ACT_MAP[k]; }).join(', '));
    if (Object.keys(unknownVia).length) rep.push('- 변환표에 없는 접수 경로(그대로 둠): ' + Object.keys(unknownVia).map(function (k) { return '`' + k + '` ' + unknownVia[k]; }).join(', '));
    if (Object.keys(unknownAct).length) rep.push('- 변환표에 없는 회신 경로(그대로 둠): ' + Object.keys(unknownAct).map(function (k) { return '`' + k + '` ' + unknownAct[k]; }).join(', '));
    rep.push('- 병원명이 비어 있던 건: ' + raw.filter(function (x) { return !S(x.hospital); }).length + '건 → 제목 "병원 / …" 앞부분이 병원 목록에 있어 채운 건 **' + derived + '건**, 여전히 빈 건 ' + cscs.filter(function (c) { return !c.hospital; }).length + '건',
      '- 원본은 "완료"인데 회신일이 없는 건: **' + nr.length + '건 → 진행 중(On going)으로 이관** (회신일 없이는 완료가 아님 · 클레임 파트에서 END Date 를 적어 Closed 로): ' + nr.map(function (c) { return c.id + '(' + (c.hospital || c.title.slice(0, 20)) + ')'; }).join(', '));
    pushNl(C, '고객지원센터'); rep.push('');

    /* ---------- 3. 통합 클레임 로그 업로드분 ---------- */
    var ce = sheetRows(wb, 'claim_extra'); raw = ce.rows;
    rep.push('## 3. 통합 클레임 로그 업로드분 (claim_extra → claim_extra)', '', '- 원본 행: ' + raw.length + '건');
    raw = C.dedupe(raw, 'claim_extra');
    var extras = raw.map(function (r) {
      var rid = S(r.id), o = {};
      ce.hdr.forEach(function (h) { if (!h) return; o[h] = (h === 'recv_date' || h === 'replied') ? C.normDate(r[h], 'claim_extra', rid, h) : S(r[h]); });
      return o;
    });
    files.claim_extra = extras; manifest.claim_extra = extras.length;
    var yrs = {}; extras.forEach(function (e) { yrs[e.year] = (yrs[e.year] || 0) + 1; });
    var nos = extras.map(function (e) { return e.no; }).filter(Boolean).sort();
    rep.push('- 변환 결과: **' + extras.length + '건** → claim_extra (연도 ' + Object.keys(yrs).sort().map(function (y) { return y + ' ' + yrs[y]; }).join(', ') + ' · 관리번호 ' + (nos[0] || '-') + ' ~ ' + (nos[nos.length - 1] || '-') + ')',
      '- 포털 씨앗(data/claims-YYYY.json)과의 중복은 화면(claim-sheet.js)이 "관리번호+접수일+제목"으로 걸러 보여줍니다.', '');

    /* ---------- 4. 참고 기록 · 카트리지 ---------- */
    ['csc_reference_log', 'cartridge_log'].forEach(function (sheet) {
      var sr = sheetRows(wb, sheet); var rows = C.dedupe(sr.rows, sheet);
      files[sheet] = rows.map(function (r) {
        var rid = S(r.id), o = {};
        sr.hdr.forEach(function (h) { if (h) o[h] = h === 'date' ? C.normDate(r[h], sheet, rid, h) : S(r[h]); });
        return o;
      });
      manifest[sheet] = files[sheet].length;
    });
    rep.push('## 4. 참고 기록 · 카트리지 기록', '', '- csc_reference_log ' + manifest.csc_reference_log + '건 · cartridge_log ' + manifest.cartridge_log + '건 (날짜 표기만 통일)',
      '- 시트 upload_blobs / csc_faq_extra / csc_error_extra 는 포털에서 쓰지 않아 옮기지 않습니다.', '');

    /* ---------- 4-1. 값 정리표 ---------- */
    var vkeys = Object.keys(C.VMAP_USED);
    rep.push('## 4-1. 사용자 확정 값 정리표 적용', '');
    if (vkeys.length) {
      rep.push('| 화면 | 항목 | 원본 | 바꾼 값 | 건수 |', '|---|---|---|---|---|');
      vkeys.sort().forEach(function (k) { var p = k.split('\u0001'); rep.push('| ' + p[0] + ' | ' + p[1] + ' | `' + p[2] + '` | `' + p[3] + '` | ' + C.VMAP_USED[k] + ' |'); });
      rep.push('', '- 바꾼 건은 각 기록의 `_valueFix` 에 원본이 남아 있어 추적할 수 있습니다.');
    } else rep.push('- 없음');
    rep.push('');

    /* ---------- 5. 날짜 ---------- */
    var cut = C.DATE_FIX.filter(function (x) { return x[5] === '시각 잘라냄'; }), fix = C.DATE_FIX.filter(function (x) { return x[5] !== '시각 잘라냄'; });
    rep.push('## 5. 날짜 표기 보정 (값이 바뀐 건 전부)', '', '- `YYYY-MM-DD 00:00:00` 에서 시각만 잘라낸 건: ' + cut.length + '건 (날짜 값은 그대로)', '- 구분자·형식을 바꾼 건: **' + fix.length + '건**');
    if (fix.length) { rep.push('', '| 시트 | id | 항목 | 원본 | 결과 | 사유 |', '|---|---|---|---|---|---|'); fix.forEach(function (x) { rep.push('| ' + x[0] + ' | ' + x[1] + ' | ' + x[2] + ' | `' + x[3] + '` | `' + x[4] + '` | ' + x[5] + ' |'); }); }
    rep.push('', '### 사람이 확인한 보정표 적용 내역', '');
    if (C.OVR_USED.length) { rep.push('| 시트 | id | 항목 | 원본 | 적용값 |', '|---|---|---|---|---|'); C.OVR_USED.forEach(function (x) { rep.push('| ' + x[0] + ' | ' + x[1] + ' | ' + x[2] + ' | `' + x[3] + '` | `' + x[4] + '` |'); }); }
    else rep.push('- 없음');
    var seen = {}, ovk = {};
    C.OVR_USED.forEach(function (x) { ovk[x[0] + '|' + x[1] + '|' + x[2]] = 1; });
    var bad = C.DATE_BAD.filter(function (x) {
      var k = x.join('|'); if (seen[k]) return false; seen[k] = 1;
      var f = { recvAt: 'date', replyAt: 'replied' }[x[2]] || x[2];
      return !ovk[x[0] + '|' + x[1] + '|' + f];
    });
    rep.push('', '### 읽지 못해 비워 둔 날짜 (원본은 `_raw…` 항목에 보존 — 확인 후 보정표에 적거나 화면에서 직접 수정)', '');
    if (bad.length) { rep.push('| 시트 | id | 항목 | 원본 |', '|---|---|---|---|'); bad.forEach(function (x) { rep.push('| ' + x[0] + ' | ' + x[1] + ' | ' + x[2] + ' | `' + x[3] + '` |'); }); }
    else rep.push('- 없음');
    rep.push('', '## 6. 목록에 없는 값', '', '- 값은 고치지 않고 그대로 옮겼습니다. 전체 목록(건수·해당 id)은 "목록에 없는 값" 파일에 있습니다.', '');

    manifest._built = new Date().toISOString().slice(0, 19); manifest._source = opts.source || 'xlsx';
    var notlist = Object.keys(C.NL).map(function (k) { return C.NL[k]; });
    var valueFixCount = vkeys.reduce(function (a, k) { return a + C.VMAP_USED[k]; }, 0);
    return { files: files, manifest: manifest, report: rep.join('\n') + '\n', notlist: notlist, dateFix: fix, dateBad: bad, overridesUsed: C.OVR_USED, noReply: nr.length, valueFixCount: valueFixCount };
  }
  function pushNl(C, sheet) {
    Object.keys(C.NL).forEach(function (k) {
      var g = C.NL[k]; if (g.sheet !== sheet) return;
      var vals = Object.keys(g.vals).sort(function (a, b) { return g.vals[b].length - g.vals[a].length; });
      C.rep.push('- 목록에 없는 ' + g.cat + ' 값(그대로 둠): ' + vals.slice(0, 30).map(function (v) { return '`' + v + '` ' + g.vals[v].length; }).join(', '));
    });
  }

  function notlistWorkbook(result) {
    var wb = XLSX.utils.book_new();
    var ws0 = XLSX.utils.aoa_to_sheet([
      ['이 파일은 이관 시 포털 목록(장비·아이템·이름 등)에 없어 그대로 옮긴 값들입니다.'],
      ['값은 고치지 않았습니다. 정리 규칙을 정해 주시면 보정표 또는 변환 규칙으로 반영합니다.']
    ]);
    XLSX.utils.book_append_sheet(wb, ws0, '안내');
    (result.notlist || []).forEach(function (g) {
      var aoa = [['화면', '항목', '값(원본 그대로)', '건수', '해당 id']];
      Object.keys(g.vals).sort(function (a, b) { return g.vals[b].length - g.vals[a].length; })
        .forEach(function (v) { aoa.push([g.sheet, g.cat, v, g.vals[v].length, g.vals[v].slice(0, 200).join(', ')]); });
      var ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 34 }, { wch: 8 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, ws, (g.sheet.slice(0, 6) + '_' + g.cat).slice(0, 31));
    });
    return wb;
  }

  window.MigrateConvert = { fromWorkbook: fromWorkbook, notlistWorkbook: notlistWorkbook, DEFAULT_OVERRIDES: DEFAULT_OVERRIDES };
})();
