// records.js — 기존 Apps Script(hub-sheet.js) 를 대체하는 레코드 API
// 탭(sheet) 하나 = Table Storage 의 PartitionKey 하나로 대응됩니다.
//   CSC / claim_progress / client_cards / master_log ...
//
// GET  /api/records?sheet=CSC                 → 전체 목록
// POST /api/records  {sheet, action, record}  → add | update | delete
//                    {sheet, action:"wipe"}                    → 파티션 비우기 (admin, 데이터 이관용)
//                    {sheet, action:"bulkAdd", records:[…]}   → 여러 건 넣기 (admin, 데이터 이관용)

const { app } = require('@azure/functions');
const S = require('./_store');
const AL = require('./_allowlist');

// 클레임 번호 형식: 2608-CC-007K  (연월 - CC - 일련번호 - K)
const CLAIM_NO_RE = /^(\d{4})-CC-(\d{3,})K$/;
const MAX_RENUMBER = 50;

// 일괄 처리(wipe / bulkAdd) — Table 트랜잭션은 같은 파티션 100건까지
const BATCH = 100;
// 로그인·비밀번호·감사 이력 파티션은 이관 도구가 절대 건드리지 못하게 합니다.
const PROTECTED_SHEETS = ['audit_log', 'audit', 'session_revoke', 'user_secret', 'login_attempt', 'allowlist', 'sessions', 'ops_log', 'claim_seq', 'edit_lock'];

// ---------------- 수정 잠금 (2026-09) ----------------
// 한 건을 두 사람이 동시에 열어 고치다 한쪽 내용이 사라지는 일을 "미리" 알려주는 장치입니다.
// 실제로 덮어쓰기를 막는 것은 아래의 버전 검사(ifVersion)입니다. 잠금은 안내용이라
// 저장 자체를 막지 않으며, 브라우저가 그냥 닫혀도 업무가 멈추지 않도록 짧은 시간 뒤 저절로 풀립니다.
//   PartitionKey = edit_lock, RowKey = <sheet>__<id>
const LOCK = 'edit_lock';
const LOCK_TTL_SEC = 180;          // 3분 — 화면이 45초마다 갱신 신호를 보냅니다
function lockKey(sheet, id) {
  return (String(sheet) + '__' + String(id)).replace(/[/\\#?]/g, '_').slice(0, 250);
}
function lockAlive(ent) {
  return !!(ent && ent.expAt && new Date(ent.expAt).getTime() > Date.now());
}
async function readLock(t, sheet, id) {
  try { return await t.getEntity(LOCK, lockKey(sheet, id)); }
  catch (e) { if (e.statusCode !== 404) throw e; return null; }
}
function lockInfo(ent, me) {
  return {
    locked: true, mine: String(ent.by || '').toLowerCase() === String(me || '').toLowerCase(),
    by: ent.by || '', byName: ent.byName || '', at: ent.at || '', expAt: ent.expAt || ''
  };
}

// 다음 번호를 만든다. 형식이 다르면 null (그런 id 는 번호 재발급 대상이 아님).
function nextClaimNo(id) {
  const m = CLAIM_NO_RE.exec(String(id));
  if (!m) return null;
  const n = parseInt(m[2], 10) + 1;
  return m[1] + '-CC-' + String(n).padStart(m[2].length, '0') + 'K';
}

// ---------------- 클레임 번호 장부 (2026-09) ----------------
// 한 번 발급된 번호는 그 건을 지우더라도 다시 쓰지 않습니다.
// 예전에는 브라우저가 "화면에 보이는 건"만 세어 다음 번호를 만들었기 때문에, 지운 건의 번호가
// 다음 사람에게 다시 발급됐고, 그 번호는 휴지통 번호라서 모두의 화면에서 숨겨졌습니다 (2026-09-11 사고).
// 이제는 연월(ym)마다 "마지막으로 발급한 번호"를 서버에 적어두고, 새 번호는 항상 그보다 큽니다.
//   PartitionKey = claim_seq, RowKey = <sheet>__<ym>, last = 마지막 번호
// 장부가 아직 없는 연월은 저장된 건 + 휴지통을 한 번 훑어 가장 큰 번호로 시작합니다.
const SETTINGS_SHEET = 'app_settings';   // 화면 설정 (가이드 주소 등) — 읽기는 모두, 쓰기는 관리자만
const SEQ = 'claim_seq';
function seqKey(sheet, ym) { return String(sheet) + '__' + String(ym); }
function claimNoOf(ym, n, width) { return ym + '-CC-' + String(n).padStart(width || 3, '0') + 'K'; }

async function maxIssued(t, sheet, ym) {
  let max = 0;
  const q = (pk, lo) => t.listEntities({
    queryOptions: { filter: `PartitionKey eq '${pk}' and RowKey ge '${lo}' and RowKey lt '${lo}~'`, select: ['rowKey'] }
  });
  for await (const e of q(sheet.replace(/'/g, "''"), ym + '-CC-')) {
    const m = CLAIM_NO_RE.exec(e.rowKey); if (m) max = Math.max(max, parseInt(m[2], 10));
  }
  for await (const e of q(TRASH, trashKey(sheet, ym + '-CC-'))) {
    const m = CLAIM_NO_RE.exec(String(e.rowKey).slice(String(sheet).length + 2));
    if (m) max = Math.max(max, parseInt(m[2], 10));
  }
  return max;
}

async function readSeq(t, sheet, ym) {
  try { return await t.getEntity(SEQ, seqKey(sheet, ym)); }
  catch (e) { if (e.statusCode !== 404) throw e; }
  const last = await maxIssued(t, sheet, ym);
  try {
    await t.createEntity({ partitionKey: SEQ, rowKey: seqKey(sheet, ym), last });
  } catch (e) { if (e.statusCode !== 409) throw e; }   // 다른 사람이 같은 순간에 만들었으면 그걸 읽습니다
  return await t.getEntity(SEQ, seqKey(sheet, ym));
}

// 장부의 last 를 n 이상으로 올립니다. ETag 로 동시 갱신을 막고, 겹치면 다시 읽어 큰 값으로 씁니다.
async function bumpSeq(t, sheet, ym, n) {
  for (let i = 0; i < 10; i++) {
    const ent = await readSeq(t, sheet, ym);
    if (Number(ent.last) >= n) return;
    try {
      await t.updateEntity({ partitionKey: SEQ, rowKey: seqKey(sheet, ym), last: n }, 'Merge', { etag: ent.etag });
      return;
    } catch (e) { if (e.statusCode !== 412) throw e; }
  }
}

// 줄 이름(id)과 내용 안의 번호(no)를 같은 값으로 맞춥니다. 둘이 다르면 화면이 그 건을 찾지 못합니다.
function withNo(record, id) {
  const out = Object.assign({}, record, { id });
  if (Object.prototype.hasOwnProperty.call(record, 'no')) out.no = id;
  return out;
}

// 새 건을 빈 번호로 저장합니다. hintId 는 브라우저가 계산한 번호(참고용) —
// 장부보다 작으면 장부 다음 번호로, 이미 있으면(409) 그 다음 번호로 밀어 저장합니다.
// 돌려주는 값: { id, requestedId, renumbered }
async function createWithFreshNo(t, sheet, record, hintId) {
  const first = String(hintId);
  const m = CLAIM_NO_RE.exec(first);
  if (!m) {
    // 클레임 번호 형식이 아니면 장부 없이 "겹치면 실패"만 보장합니다.
    await t.createEntity(S.packRecord(sheet, withNo(record, first)));
    return { id: first, requestedId: first, renumbered: false };
  }
  const ym = m[1], width = m[2].length;
  const seq = await readSeq(t, sheet, ym);
  let n = Math.max(parseInt(m[2], 10), Number(seq.last) + 1);
  for (let i = 0; i < MAX_RENUMBER; i++, n++) {
    const id = claimNoOf(ym, n, width);
    try {
      // ★ 2026-09-11: 예전에는 id(줄 이름)만 새 번호로 바꾸고 내용 안의 no 는 옛 번호 그대로 두었습니다.
      //   그래서 133K 로 요청해 134K 로 저장된 건은 내용에 no=133K 가 적혀, 화면이 읽을 때 133K 의
      //   중복으로 보고 버렸습니다. 저장은 됐는데 새로고침하면 사라지던 현상의 원인입니다.
      //   번호를 쓰는 칸(no)은 반드시 새 번호와 같이 맞춰 둡니다.
      await t.createEntity(S.packRecord(sheet, withNo(record, id)));
      await bumpSeq(t, sheet, ym, n);
      return { id, requestedId: first, renumbered: id !== first };
    } catch (e) {
      if (e.statusCode !== 409) throw e;
    }
  }
  const err = new Error('빈 번호를 찾지 못했습니다. 잠시 후 다시 저장해주세요.');
  err.statusCode = 409;
  throw err;
}

async function listAll(sheet) {
  const t = await S.table();
  const out = [];
  const iter = t.listEntities({
    queryOptions: { filter: `PartitionKey eq '${sheet.replace(/'/g, "''")}'` }
  });
  for await (const ent of iter) {
    const r = S.unpackRecord(ent);
    if (r) { out.push(r); continue; }
    /* 내용을 읽지 못한 줄 — 예전에는 조용히 빼버려서, 저장은 됐는데 화면에서 사라진 것처럼 보였습니다.
       이제는 "읽을 수 없는 기록"으로 남겨 눈에 보이게 하고 운영 로그에도 남깁니다 (2026-09-11). */
    out.push({
      id: ent.rowKey, no: ent.rowKey,
      title: '⚠ 내용을 읽지 못한 기록입니다 — 관리자에게 알려주세요',
      _broken: true, _at: ent.updatedAt || '', _by: ent.savedBy || ''
    });
    await S.writeOps({
      kind: 'load_fail', source: 'server', page: 'api/records',
      sheet, action: 'list', recId: ent.rowKey,
      message: '기록을 읽지 못했습니다 (내용이 깨졌거나 저장이 중간에 끊김)',
      detail: 'parts=' + ent.parts
    });
  }
  return out;
}

/* ---- 한 건이 저장소에 들어갈 수 있는 크기인지 먼저 봅니다 (2026-09-11) ----
   Azure Table 은 한 줄(엔티티)에 약 1MB 까지만 담깁니다. 사진을 첨부하면 글자로 바꿔 넣기 때문에
   사진 한 장(3~4MB)만 있어도 이 한계를 넘습니다. 예전에는 그냥 저장이 실패했고, 화면에는 잠깐 보였다가
   새로고침하면 사라져 원인을 알기 어려웠습니다. 이제는 무엇이 문제인지 분명히 알려줍니다. */
const ENTITY_MAX = 900 * 1024;        // 1MB 한계에 여유를 둡니다
function tooBig(rec) {
  const n = Buffer.byteLength(JSON.stringify(rec), 'utf8');
  if (n <= ENTITY_MAX) return null;
  const mb = (n / 1048576).toFixed(1);
  const files = Array.isArray(rec.files) ? rec.files.length : 0;
  return '이 건은 너무 커서 저장할 수 없습니다 (' + mb + 'MB · 한 건에 약 0.9MB 까지)'
    + (files ? '. 첨부 사진 ' + files + '장을 줄이거나, 사진 크기를 작게 해서 다시 저장해주세요.' : '.');
}

// ---------------- 휴지통 (30일 보관) ----------------
// 지운 기록을 한 칸(trash)에 모아둡니다. 30일이 지난 것은 목록을 읽을 때 자동으로 정리합니다.
const TRASH = 'trash';
const TRASH_DAYS = 30;

// 어느 탭의 몇 번인지 한 줄로 묶어 열쇠를 만듭니다. Table 의 rowKey 에 못 쓰는 글자는 바꿔줍니다.
function trashKey(sheet, id) {
  return (String(sheet) + '__' + String(id)).replace(/[/\\#?]/g, '_').slice(0, 250);
}

async function putTrash(t, info) {
  // 원본 내용은 그대로 두고(id 포함), 휴지통 안에서 쓸 자리 이름만 따로 붙입니다.
  // 예전에는 여기서 id 를 휴지통 열쇠로 덮어써서, 되살릴 때 엉뚱한 자리에 쓰였습니다.
  const payload = Object.assign({}, info.payload || {}, { id: String(info.id) });
  const ent = S.packRecord(TRASH, payload);
  ent.rowKey = trashKey(info.sheet, info.id);
  ent.trSheet = String(info.sheet);
  ent.trId = String(info.id);
  ent.trAt = new Date().toISOString();
  ent.trBy = String(info.by || '');
  ent.trByName = String(info.byName || '');
  ent.trNote = String(info.note || '');
  ent.trHasBody = !!info.payload;
  await t.upsertEntity(ent, 'Replace');
}

async function listTrash(t) {
  const out = [];
  const iter = t.listEntities({ queryOptions: { filter: `PartitionKey eq '${TRASH}'` } });
  for await (const ent of iter) {
    const rec = S.unpackRecord(ent) || {};
    const left = TRASH_DAYS - Math.floor((Date.now() - new Date(ent.trAt).getTime()) / 86400000);
    out.push({
      sheet: ent.trSheet, id: ent.trId, at: ent.trAt,
      by: ent.trBy, byName: ent.trByName, note: ent.trNote,
      daysLeft: Math.max(0, left),
      // 목록에 보여줄 최소한만 골라 보냅니다 (사진까지 실어 나르면 너무 무겁습니다).
      title: rec.title || '', contact: rec.contact || rec.hospital || '',
      date: rec.recvDate || rec.date || '', hasBody: !!ent.trHasBody
    });
  }
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));   // 최신순
  return out;
}

async function purgeExpired(t) {
  const limit = Date.now() - TRASH_DAYS * 86400000;
  const iter = t.listEntities({ queryOptions: { filter: `PartitionKey eq '${TRASH}'` } });
  for await (const ent of iter) {
    if (new Date(ent.trAt).getTime() < limit) {
      try { await t.deleteEntity(TRASH, ent.rowKey); } catch (e) {}
    }
  }
}

// 어느 항목이 바뀌었는지 이름만 모아 이력에 남긴다 (내용 자체는 남기지 않는다 — 용량·개인정보 때문).
// _by/_at 같은 자동 기록 항목은 제외한다.
const AUDIT_SKIP = new Set(['_by', '_at', '_byName', 'id']);
const AUDIT_LABEL = {
  contact: '병원명', recvDate: '접수일자', receiver: '담당자', title: 'Title',
  device: 'Device', sn: 'Serial Number', sw: 'SW Version', item: 'Item', lot: 'LOT No.',
  ctrlLot: 'Control LOT', complaint: 'Complaint', invesDets: 'Investigation DETS.', reply: 'Reply',
  repliedDate: 'Replied Date', endDate: 'END Date', action: 'Action', confirmation: 'Confirmation',
  termination: 'Termination', via: 'Via', c1: '1st CLASS', c2: '2nd CLASS', c3: '3rd CLASS', memo: '메모', prevNo: '이전 번호',
  hospital: '병원명', date: '일자', manager: '담당자', region: '지역명', phone: '전화번호',
  requester: '요청자', agency: '대리점', category: '분류', issue: 'Complaint 내용',
  status: '상태', note: '비고', devices: '장비 정보', items: 'Item 정보', files: '첨부 사진'
};

function diffFields(before, after) {
  if (!before || !after) return '';
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out = [];
  for (const k of keys) {
    if (AUDIT_SKIP.has(k)) continue;
    const a = before[k], b = after[k];
    const sa = (a === null || a === undefined) ? '' : (typeof a === 'object' ? JSON.stringify(a) : String(a));
    const sb = (b === null || b === undefined) ? '' : (typeof b === 'object' ? JSON.stringify(b) : String(b));
    if (sa !== sb) out.push(AUDIT_LABEL[k] || k);
    if (out.length >= 25) { out.push('…'); break; }
  }
  return out.join(', ');
}

app.http('records', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'records',
  handler: async (request, context) => {
    const user = await S.userOf(request);
    // Entra ID 대신 우리 세션 쿠키로 인증합니다 — 로그인 안 한 요청은 여기서 막습니다.
    if (!user.email) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    // 이력에 메일 주소와 함께 이름도 남겨, 나중에 볼 때 누구인지 바로 알 수 있게 합니다.
    let userName = '';
    try { userName = AL.nameFor(user.email, AL.loadAllowlist()); } catch (e) {}

    let sheet, action, record, id, unique = false, body = {};
    if (request.method === 'GET') {
      sheet = request.query.get('sheet');
      // 휴지통 목록도 GET 으로 읽습니다: /api/records?sheet=trash&action=trash
      action = request.query.get('action') === 'trash' ? 'trash' : 'list';
    } else {
      const b = await request.json().catch(() => ({}));
      body = b;
      sheet = b.sheet; action = b.action || 'list'; record = b.record; id = b.id;
      // unique=true 인 저장은 덮어쓰지 않고, 번호가 겹치면 다음 번호를 발급받습니다.
      unique = b.unique === true;
      if (typeof record === 'string') { try { record = JSON.parse(record); } catch (e) { record = null; } }
    }

    if (!S.validSheet(sheet)) return { status: 400, jsonBody: { error: 'sheet 이름이 올바르지 않습니다.' } };
    /* 로그인·비밀번호·변경 이력·운영 로그 저장소는 이 API 로 읽거나 쓰지 못합니다 (2026-09).
       예전에는 이관 도구(wipe·bulkAdd)만 막혀 있어서, 로그인한 사람이면 누구나 이 API 로
       변경 이력 줄을 지우거나 남의 비밀번호 기록을 덮어쓸 수 있었습니다. 화면에서는 쓰지 않는 저장소입니다. */
    if (PROTECTED_SHEETS.indexOf(sheet) >= 0 || (body && PROTECTED_SHEETS.indexOf(body.trSheet) >= 0)) {
      return { status: 403, jsonBody: { error: '이 저장소(' + sheet + ')는 이 경로로 쓸 수 없습니다.' } };
    }
    /* 화면 설정(가이드 주소 등)은 누구나 읽을 수 있지만 바꾸는 것은 관리자만 (2026-09) */
    if (sheet === SETTINGS_SHEET && action !== 'list' && !user.roles.includes('admin')) {
      return { status: 403, jsonBody: { error: '설정 변경은 관리자만 할 수 있습니다.' } };
    }

    try {
      if (action === 'list') {
        return { jsonBody: await listAll(sheet) };
      }

      const t = await S.table();

      /* ---- 한 건만 다시 읽기 (2026-09) ----
         수정 화면을 열 때 그 건만 서버에서 새로 받아옵니다. 전체 목록은 2.6MB 라 매번 부를 수 없고,
         오래된 사본으로 수정을 시작하면 저장할 때 충돌로 되돌아가야 하므로 여기서 미리 맞춥니다.
           {sheet, action:'get', id} → {record} (없으면 record: null) */
      if (action === 'get') {
        if (id == null) return { status: 400, jsonBody: { error: 'id 가 필요합니다.' } };
        try {
          const ent = await t.getEntity(sheet, String(id));
          const rec = S.unpackRecord(ent);
          if (!rec) return { status: 500, jsonBody: { error: '기록을 읽지 못했습니다.' } };
          if (rec.id && rec.no && rec.id !== rec.no) rec.no = rec.id;
          return { jsonBody: { record: rec } };
        } catch (e) {
          if (e.statusCode !== 404) throw e;
          return { jsonBody: { record: null } };   // 서버에 아직 없는 건(과거 씨앗 자료)일 수 있습니다
        }
      }

      /* ---- 수정 잠금 (안내용) ----
           {sheet, action:'lock',   id} → 잡거나(내 것이면 연장) 이미 남이 쥐고 있으면 그 사람을 알려줍니다
           {sheet, action:'unlock', id} → 내 잠금을 풉니다 (관리자는 남의 것도 풀 수 있습니다)
         저장을 막지는 않습니다 — 막는 것은 아래 버전 검사입니다. */
      if (action === 'lock') {
        if (id == null) return { status: 400, jsonBody: { error: 'id 가 필요합니다.' } };
        const cur = await readLock(t, sheet, id);
        if (lockAlive(cur) && String(cur.by || '').toLowerCase() !== String(user.email).toLowerCase()) {
          return { jsonBody: Object.assign({ success: false }, lockInfo(cur, user.email)) };
        }
        const now = new Date();
        await t.upsertEntity({
          partitionKey: LOCK, rowKey: lockKey(sheet, id),
          lkSheet: String(sheet), lkId: String(id),
          by: user.email, byName: userName,
          at: (lockAlive(cur) && cur.at) ? cur.at : now.toISOString(),
          expAt: new Date(now.getTime() + LOCK_TTL_SEC * 1000).toISOString()
        }, 'Replace');
        return { jsonBody: { success: true, locked: true, mine: true, ttl: LOCK_TTL_SEC } };
      }
      if (action === 'unlock') {
        if (id == null) return { status: 400, jsonBody: { error: 'id 가 필요합니다.' } };
        const cur = await readLock(t, sheet, id);
        if (cur && (String(cur.by || '').toLowerCase() === String(user.email).toLowerCase() || user.roles.includes('admin'))) {
          try { await t.deleteEntity(LOCK, lockKey(sheet, id)); } catch (e) { if (e.statusCode !== 404) throw e; }
        }
        return { jsonBody: { success: true } };
      }

      if (action === 'add' || action === 'update') {
        if (!record || record.id == null) {
          return { status: 400, jsonBody: { error: 'record.id 가 필요합니다.' } };
        }
        // 누가 언제 썼는지 흔적을 남겨 정보 추적이 가능하게 한다
        record._by = user.email || record._by || '';
        record._at = new Date().toISOString();
        record._byName = userName;

        const big = tooBig(record);
        if (big) {
          await S.writeOps({
            kind: 'save_fail', source: 'server', page: 'api/records',
            sheet, action, recId: String(record.id), by: user.email, byName: userName,
            message: '크기 초과로 저장하지 못했습니다', detail: big
          });
          return { status: 413, jsonBody: { error: big } };
        }

        /* ---- 저장 시점 검사 (2026-09) ----
           예전에는 수정이 그 건을 통째로 덮어썼습니다(Replace). 그래서 두 사람이 같은 건을 앞뒤로 저장하면
           먼저 저장한 사람의 내용이 조용히 사라졌고, 남이 지운 건을 내 옛 화면에서 저장하면 되살아났습니다.
           이제 화면은 "내가 불러왔을 때의 저장 시각(_at)"을 ifVersion 으로 함께 보냅니다.
           서버 값과 다르면 아무것도 쓰지 않고 409 로 돌려주며, 지금 저장된 내용을 같이 실어 보내
           화면이 최신 내용으로 되돌린 뒤 다시 고치게 합니다.
           ※ 이 검사는 수정(update)에만 걸립니다. 새 건 등록(add)은 번호 발급이 대신 막아줍니다. */
        let changed = '';
        if (action === 'update') {
          const sentVer = body && body.ifVersion !== undefined ? String(body.ifVersion || '') : null;
          let before = null;
          try { before = S.unpackRecord(await t.getEntity(sheet, String(record.id))); }
          catch (e) { if (e.statusCode !== 404) throw e; }

          if (sentVer !== null) {
            if (!before) {
              /* 화면이 알고 있는 버전이 있는데 서버에 없다 = 그 사이 누가 지웠다는 뜻입니다.
                 그대로 쓰면 지운 건이 되살아나므로 막습니다. (버전을 모르는 과거 씨앗 자료는 여기 오지 않습니다) */
              if (sentVer !== '') {
                return { status: 409, jsonBody: {
                  error: '이 건은 다른 분이 삭제했습니다. 되살리려면 [저장소 · 규칙] 탭의 휴지통에서 복원해주세요.',
                  conflict: true, deleted: true
                } };
              }
            } else if (String(before._at || '') !== sentVer) {
              return { status: 409, jsonBody: {
                error: '다른 분이 먼저 이 건을 수정했습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.'
                  + (before._byName || before._by ? ' (마지막 수정: ' + (before._byName || before._by) + ')' : ''),
                conflict: true, current: before
              } };
            }
          }
          changed = diffFields(before, record);
        }

        // ---- 클레임 번호는 서버가 중복을 막고, 겹치면 다음 번호를 발급한다 ----
        // 브라우저마다 번호를 계산하므로 두 사람이 같은 순간에 저장하면 같은 번호가 나올 수 있다.
        // createEntity 는 같은 rowKey 가 이미 있으면 409 를 내므로, 그걸 신호로 다음 번호를 시도한다.
        // (upsert 와 달리 남의 기록을 덮어쓰지 않는다.)
        if (action === 'add' && unique) {
          let got;
          try { got = await createWithFreshNo(t, sheet, record, record.id); }
          catch (e) {
            if (e.statusCode !== 409) throw e;
            return { status: 409, jsonBody: { error: e.message.indexOf('빈 번호') >= 0 ? e.message : ('이미 같은 번호(' + record.id + ')가 저장되어 있습니다.') } };
          }
          await S.writeAudit({
            by: user.email, byName: userName, sheet, recId: got.id, action: '등록',
            fields: '', note: got.renumbered ? ('번호 재발급 ' + got.requestedId + ' → ' + got.id) : ''
          });
          return { jsonBody: { success: true, id: got.id, _at: record._at, renumbered: got.renumbered, requestedId: got.requestedId } };
        }

        await t.upsertEntity(S.packRecord(sheet, record), 'Replace');
        await S.writeAudit({
          by: user.email, byName: userName, sheet, recId: record.id,
          action: action === 'add' ? '등록' : '수정', fields: changed, note: ''
        });
        /* 저장을 마쳤으면 내가 쥐고 있던 수정 잠금은 바로 풀어 다음 사람이 기다리지 않게 합니다 */
        if (action === 'update') {
          try {
            const lk = await readLock(t, sheet, record.id);
            if (lk && String(lk.by || '').toLowerCase() === String(user.email).toLowerCase()) {
              await t.deleteEntity(LOCK, lockKey(sheet, record.id));
            }
          } catch (e) { /* 잠금 해제 실패는 저장을 막지 않습니다 */ }
        }
        return { jsonBody: { success: true, id: record.id, _at: record._at } };
      }

      // ---- 번호 변경 (관리자 전용, 2026-09) ----
      // 접수일의 연·월이 바뀌면 번호도 그 달 기준으로 새로 받아야 합니다. 일반 사용자는 연·월을 바꿀 수 없고,
      // 관리자가 바꾸면 여기서 새 번호를 발급받고 옛 번호 건은 휴지통으로 옮깁니다 (옛 번호는 다시 쓰지 않습니다).
      //   {sheet, action:'renumber', oldId, record}  → record.id = 브라우저가 계산한 새 번호(참고용)
      if (action === 'renumber') {
        if (!user.roles.includes('admin')) {
          return { status: 403, jsonBody: { error: '접수일의 연·월 변경(번호 재발급)은 관리자만 할 수 있습니다.' } };
        }
        const oldId = body.oldId;
        if (!record || record.id == null || oldId == null) {
          return { status: 400, jsonBody: { error: 'oldId 와 record.id 가 필요합니다.' } };
        }
        if (String(oldId) === String(record.id)) {
          return { status: 400, jsonBody: { error: '같은 번호로는 변경할 수 없습니다.' } };
        }
        record._by = user.email; record._at = new Date().toISOString(); record._byName = userName;

        let before = null;
        try { before = S.unpackRecord(await t.getEntity(sheet, String(oldId))); }
        catch (e) { if (e.statusCode !== 404) throw e; }
        if (!before && body.before && typeof body.before === 'object') before = body.before;   // 씨앗 파일에서 온 건

        let got;
        try { got = await createWithFreshNo(t, sheet, record, record.id); }
        catch (e) {
          if (e.statusCode !== 409) throw e;
          return { status: 409, jsonBody: { error: e.message } };
        }
        // 옛 번호 건은 휴지통으로 (30일 보관) — 되살리면 번호가 둘이 되므로 메모를 남깁니다.
        await putTrash(t, {
          sheet, id: String(oldId), by: user.email, byName: userName,
          note: ('번호 변경 → ' + got.id + ' · ' + [before && before.title, before && (before.hospital || before.contact)].filter(Boolean).join(' / ')).slice(0, 200),
          payload: before
        });
        try { await t.deleteEntity(sheet, String(oldId)); }
        catch (e) { if (e.statusCode !== 404) throw e; }

        await S.writeAudit({
          by: user.email, byName: userName, sheet, recId: got.id, action: '번호변경',
          fields: '', note: '접수일 연·월 변경으로 ' + oldId + ' → ' + got.id + ' (관리자)'
        });
        return { jsonBody: { success: true, id: got.id, _at: record._at, oldId: String(oldId), requestedId: got.requestedId, renumbered: got.renumbered } };
      }

      // ---- 이미 있는 번호는 건드리지 않고 새 건만 넣기 (2026-09) ----
      // 통합 클레임로그 엑셀을 올릴 때, 국내(K) 건을 클레임 로그 (국내)에도 함께 넣는 데 씁니다.
      // bulkAdd 와 달리 덮어쓰지 않고(createEntity), 이미 있는 번호는 건너뜁니다. 관리자가 아니어도 쓸 수 있습니다.
      // 넣은 번호만큼 번호 장부도 올려, 이후 새 건이 같은 번호를 받지 않게 합니다.
      //   {sheet, action:'importNew', records:[{id, ...}], audit}
      if (action === 'importNew') {
        const list = Array.isArray(body.records) ? body.records : [];
        if (!list.length) return { status: 400, jsonBody: { error: 'records 배열이 비어 있습니다.' } };
        if (list.length > 500) return { status: 400, jsonBody: { error: '한 번에 500건까지만 보낼 수 있습니다.' } };
        const bad = list.filter(r => !r || r.id == null || String(r.id) === '');
        if (bad.length) return { status: 400, jsonBody: { error: 'id 가 없는 건이 ' + bad.length + '건 있습니다.' } };

        let saved = 0, skipped = 0;
        const maxByYm = {};
        for (const r of list) {
          const rec = Object.assign({}, r);
          rec._by = rec._by || user.email; rec._byName = rec._byName || userName;
          rec._at = rec._at || new Date().toISOString();
          try {
            await t.createEntity(S.packRecord(sheet, rec));
            saved++;
          } catch (e) {
            if (e.statusCode !== 409) throw e;
            skipped++;                       // 이미 있는 번호 — 기존 내용을 그대로 둡니다
          }
          const m = CLAIM_NO_RE.exec(String(rec.id));
          if (m) maxByYm[m[1]] = Math.max(maxByYm[m[1]] || 0, parseInt(m[2], 10));
        }
        for (const ym of Object.keys(maxByYm)) await bumpSeq(t, sheet, ym, maxByYm[ym]);

        if (body.audit) {
          await S.writeAudit({
            by: user.email, byName: userName, sheet, recId: '*', action: '업로드 반영',
            fields: '', note: (String(body.audit) + ' · 새로 넣음 ' + saved + '건, 이미 있어 건너뜀 ' + skipped + '건').slice(0, 200)
          });
        }
        return { jsonBody: { success: true, saved, skipped } };
      }

      // ---- 데이터 이관용 일괄 처리 (관리자 전용) ----
      // 운영 데이터 옮기기(pages/import.html)에서만 씁니다. 한 건씩 수천 번 부르면 10분 넘게 걸리고
      // 감사 이력도 수천 줄 쌓이므로, Table 트랜잭션(같은 파티션 100건)으로 묶고 감사는 한 줄만 남깁니다.
      if (action === 'wipe' || action === 'bulkAdd') {
        if (!user.roles.includes('admin')) {
          return { status: 403, jsonBody: { error: '관리자만 쓸 수 있습니다.' } };
        }
        if (PROTECTED_SHEETS.indexOf(sheet) >= 0) {
          return { status: 400, jsonBody: { error: '이 저장소(' + sheet + ')는 초기화 대상이 아닙니다.' } };
        }
      }

      // 파티션 통째로 비우기 — 휴지통을 거치지 않고 즉시 지웁니다. 감사 이력 1줄.
      if (action === 'wipe') {
        const keys = [];
        const iter = t.listEntities({
          queryOptions: { filter: `PartitionKey eq '${sheet.replace(/'/g, "''")}'`, select: ['partitionKey', 'rowKey'] }
        });
        for await (const ent of iter) keys.push(ent.rowKey);
        let deleted = 0;
        for (let i = 0; i < keys.length; i += BATCH) {
          const chunk = keys.slice(i, i + BATCH);
          await t.submitTransaction(chunk.map(rk => ['delete', { partitionKey: sheet, rowKey: rk }]));
          deleted += chunk.length;
        }
        await S.writeAudit({
          by: user.email, byName: userName, sheet, recId: '*',
          action: '초기화', fields: '', note: deleted + '건 즉시 삭제 (데이터 이관 — 휴지통 미보관)' + (body.note ? ' · ' + String(body.note).slice(0, 120) : '')
        });
        return { jsonBody: { success: true, deleted } };
      }

      // 여러 건 한꺼번에 넣기 — records: [{id, ...}, ...] (한 번에 최대 500건).
      // 이관 자료에는 수정자·시각 도장을 찍지 않습니다(누가 언제 "입력"했는지가 아니라 옮긴 것이므로).
      // 감사 이력은 body.audit 이 있을 때만 한 줄 남깁니다(화면이 마지막 묶음에서 총 건수를 보냅니다).
      if (action === 'bulkAdd') {
        const list = Array.isArray(body.records) ? body.records : [];
        if (!list.length) return { status: 400, jsonBody: { error: 'records 배열이 비어 있습니다.' } };
        if (list.length > 500) return { status: 400, jsonBody: { error: '한 번에 500건까지만 보낼 수 있습니다.' } };
        const bad = list.filter(r => !r || r.id == null || String(r.id) === '');
        if (bad.length) return { status: 400, jsonBody: { error: 'id 가 없는 건이 ' + bad.length + '건 있습니다.' } };
        let saved = 0;
        for (let i = 0; i < list.length; i += BATCH) {
          const chunk = list.slice(i, i + BATCH).map(r => {
            const rec = Object.assign({}, r);
            if (!rec._at) { rec._by = rec._by || ''; rec._byName = rec._byName || ''; rec._at = ''; }
            return ['upsert', S.packRecord(sheet, rec), 'Replace'];
          });
          await t.submitTransaction(chunk);
          saved += chunk.length;
        }
        if (body.audit) {
          await S.writeAudit({
            by: user.email, byName: userName, sheet, recId: '*',
            action: '이관', fields: '', note: String(body.audit).slice(0, 200)
          });
        }
        return { jsonBody: { success: true, saved } };
      }

      // ---- 삭제 = 휴지통으로 옮기기 (30일 보관) ----
      // 여러 명이 동시에 쓰는 화면이라 잘못 지웠을 때 되살릴 방법이 필요합니다.
      // 원래 자리에서는 지우되, 내용은 trash 칸에 그대로 옮겨둡니다.
      if (action === 'delete') {
        if (id == null) return { status: 400, jsonBody: { error: 'id 가 필요합니다.' } };

        let before = null;
        try { before = S.unpackRecord(await t.getEntity(sheet, String(id))); }
        catch (e) { /* 서버에 없는 건(과거 씨앗 자료)이면 화면이 보내준 내용을 씁니다 */ }
        /* 삭제도 수정과 같은 검사를 받습니다 — 내가 본 뒤 남이 고친 건을 모르고 지우지 않도록 */
        if (before && body && body.ifVersion !== undefined && String(body.ifVersion || '') !== String(before._at || '')) {
          return { status: 409, jsonBody: {
            error: '다른 분이 먼저 이 건을 수정했습니다. 최신 내용을 확인한 뒤 다시 삭제해주세요.'
              + (before._byName || before._by ? ' (마지막 수정: ' + (before._byName || before._by) + ')' : ''),
            conflict: true, current: before
          } };
        }
        if (!before && record && typeof record === 'object') before = record;

        const note = before
          ? [before.title, before.hospital || before.contact].filter(Boolean).join(' / ').slice(0, 200)
          : '';

        // 수백 건을 한꺼번에 지우는 초기화 작업은 휴지통을 거치지 않습니다 (휴지통이 넘칩니다).
        if (body.hard === true) {
          try { await t.deleteEntity(sheet, String(id)); }
          catch (e) { if (e.statusCode !== 404) throw e; }
          await S.writeAudit({
            by: user.email, byName: userName, sheet, recId: id,
            action: '삭제', fields: '', note: note + ' (일괄 초기화 — 휴지통 미보관)'
          });
          return { jsonBody: { success: true, trashed: false } };
        }

        await putTrash(t, {
          sheet, id: String(id), by: user.email, byName: userName,
          note, payload: before, fromSeed: !!(before && before === record)
        });
        try { await t.deleteEntity(sheet, String(id)); }
        catch (e) { if (e.statusCode !== 404) throw e; }

        await S.writeAudit({
          by: user.email, byName: userName, sheet, recId: id,
          action: '삭제', fields: '', note: note + ' (휴지통 30일 보관)'
        });
        return { jsonBody: { success: true, trashed: true } };
      }

      // ---- 휴지통 목록 ----
      if (action === 'trash') {
        await purgeExpired(t);
        return { jsonBody: await listTrash(t) };
      }

      // ---- 되살리기 ----
      if (action === 'restore') {
        const src = body.trSheet;
        if (!S.validSheet(src) || id == null) {
          return { status: 400, jsonBody: { error: 'trSheet 와 id 가 필요합니다.' } };
        }
        let ent = null;
        try { ent = await t.getEntity(TRASH, trashKey(src, id)); }
        catch (e) { return { status: 404, jsonBody: { error: '휴지통에 없는 항목입니다. 30일이 지나 지워졌을 수 있습니다.' } }; }

        const rec = S.unpackRecord(ent);
        if (!rec) return { status: 500, jsonBody: { error: '휴지통 내용을 읽지 못했습니다.' } };

        // 같은 번호로 새 기록이 이미 만들어졌으면 남의 기록을 덮어쓰지 않습니다.
        try { await t.getEntity(src, String(id)); return { status: 409, jsonBody: { error: '같은 번호(' + id + ')가 이미 있어 되살릴 수 없습니다.' } }; }
        catch (e) { if (e.statusCode !== 404) throw e; }

        await t.createEntity(S.packRecord(src, rec));
        try { await t.deleteEntity(TRASH, trashKey(src, id)); } catch (e) {}
        await S.writeAudit({
          by: user.email, byName: userName, sheet: src, recId: id,
          action: '복원', fields: '', note: '휴지통에서 되살림'
        });
        return { jsonBody: { success: true, record: rec } };
      }

      // ---- 휴지통에서 영구 삭제 ----
      if (action === 'purge') {
        const src = body.trSheet;
        if (!S.validSheet(src) || id == null) {
          return { status: 400, jsonBody: { error: 'trSheet 와 id 가 필요합니다.' } };
        }
        try { await t.deleteEntity(TRASH, trashKey(src, id)); }
        catch (e) { if (e.statusCode !== 404) throw e; }
        await S.writeAudit({
          by: user.email, byName: userName, sheet: src, recId: id,
          action: '영구삭제', fields: '', note: '휴지통에서 완전히 지움'
        });
        return { jsonBody: { success: true } };
      }

      return { status: 400, jsonBody: { error: '알 수 없는 action: ' + action } };
    } catch (e) {
      context.error(e);
      await S.serverError('records', e, {
        sheet, action, recId: id != null ? id : (record && record.id), by: user.email, byName: userName
      });
      return { status: 500, jsonBody: { error: e.message } };
    }
  }
});
