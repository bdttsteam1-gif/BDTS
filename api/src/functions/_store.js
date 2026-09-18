// _store.js — Azure Table / Blob 접근 공통 모듈
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONN = process.env.STORAGE_CONNECTION_STRING;
const TABLE_NAME = process.env.TABLE_NAME || 'portalrecords';
const CONTAINER = process.env.BLOB_CONTAINER || 'portal-blobs';

let _table = null;
let _container = null;

async function table() {
  if (_table) return _table;
  const c = TableClient.fromConnectionString(CONN, TABLE_NAME, { allowInsecureConnection: false });
  try { await c.createTable(); } catch (e) { if (e.statusCode !== 409) throw e; }
  _table = c;
  return c;
}

async function container() {
  if (_container) return _container;
  const svc = BlobServiceClient.fromConnectionString(CONN);
  const c = svc.getContainerClient(CONTAINER);
  await c.createIfNotExists();
  _container = c;
  return c;
}

// 구글시트 셀에는 5만자 제한이 있어 조각내야 했지만, Table 엔티티 속성도
// 64KB 제한이 있으므로 긴 레코드는 payload 를 나눠 담는다.
const PROP_MAX = 30000;

function packRecord(sheet, rec) {
  const json = JSON.stringify(rec);
  const ent = {
    partitionKey: sheet,
    rowKey: String(rec.id),
    updatedAt: new Date().toISOString(),
    parts: 0
  };
  let i = 0;
  for (let p = 0; p < json.length; p += PROP_MAX) {
    ent['p' + i] = json.substr(p, PROP_MAX);
    i++;
  }
  ent.parts = i;
  return ent;
}

function unpackRecord(ent) {
  let json = '';
  const n = Number(ent.parts) || 0;
  for (let i = 0; i < n; i++) json += ent['p' + i] || '';
  try { return JSON.parse(json); } catch (e) { return null; }
}

// 사용자가 지정한 시트 이름이 엉뚱한 곳을 건드리지 못하게 검사
const SHEET_RE = /^[A-Za-z0-9_-]{1,60}$/;
function validSheet(s) { return typeof s === 'string' && SHEET_RE.test(s); }
function validKey(s) { return typeof s === 'string' && /^[A-Za-z0-9_.\-@#]{1,180}$/.test(s); }

// ---------------- 로그인 세션 판정 (강제 무효화 반영) ----------------
// 관리자가 특정 사람을 "강제 로그아웃" 시키면 그 시각을 여기 기록해두고,
// 그 시각 이후에도 예전 세션 쿠키를 들고 오는 요청은 로그아웃 상태로 취급합니다.
const A = require('./_auth');
const REVOKE_PARTITION = 'session_revoke';

async function userOf(request) {
  const payload = A.payloadOf(request);
  if (!payload || !payload.email) return { email: '', roles: [] };

  try {
    const t = await table();
    const ent = await t.getEntity(REVOKE_PARTITION, payload.email);
    // revokedAt(초) 이후에 로그인한 세션만 유효. revokedAt 이전 세션(payload.iat)은 무효 처리.
    if (ent && Number(ent.revokedAt) && payload.iat < Number(ent.revokedAt)) {
      return { email: '', roles: [] };
    }
  } catch (e) {
    // 무효화 기록이 없으면(404) 정상 — 그대로 통과시킵니다.
  }

  return { email: payload.email, roles: payload.roles || [] };
}

// 관리자 전용 — 이 메일의 기존 세션을 전부 즉시 무효화합니다.
// (allowlist.json 에서 지우는 것과는 별개로, 지금 로그인되어 있는 기기도 바로 끊어냅니다.)
async function revokeUser(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) throw new Error('메일 주소가 필요합니다.');
  const t = await table();
  await t.upsertEntity({
    partitionKey: REVOKE_PARTITION,
    rowKey: email,
    revokedAt: Math.floor(Date.now() / 1000)
  }, 'Replace');
}

// ---------------- 비밀번호 ----------------
// 초기에는 전원이 환경 변수 INITIAL_PASSWORD 하나로 로그인합니다.
// 본인이 비밀번호를 바꾸면 그때부터 아래 user_secret 에 저장된 개인 값으로 판정합니다.
// (바꾸지 않은 사람은 계속 초기 비밀번호로 들어올 수 있습니다 — 변경은 선택입니다.)
const crypto = require('crypto');
const SECRET_PARTITION = 'user_secret';
const ATTEMPT_PARTITION = 'login_attempt';
const MAX_ATTEMPTS = 10;          // 이 횟수를 넘기면
const ATTEMPT_WINDOW_MIN = 15;    // 이 시간(분) 동안 잠깁니다

function hashPassword(plain, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return { salt, hash };
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;          // 길이가 다르면 비교 자체가 불필요
  return crypto.timingSafeEqual(ba, bb);              // 걸린 시간으로 값을 유추하지 못하게 합니다
}

async function getSecret(email) {
  const t = await table();
  try { return await t.getEntity(SECRET_PARTITION, String(email).toLowerCase()); }
  catch (e) { return null; }
}
async function hasOwnPassword(email) {
  return !!(await getSecret(email));
}
async function setPassword(email, plain) {
  email = String(email || '').trim().toLowerCase();
  if (!email) throw new Error('메일 주소가 필요합니다.');
  const { salt, hash } = hashPassword(plain);
  const t = await table();
  await t.upsertEntity({
    partitionKey: SECRET_PARTITION, rowKey: email,
    salt, hash, changedAt: new Date().toISOString()
  }, 'Replace');
}
// 개인 비밀번호가 있으면 그걸로, 없으면 초기 비밀번호로 판정합니다.
async function verifyPassword(email, plain) {
  const ent = await getSecret(email);
  if (ent && ent.hash) {
    const { hash } = hashPassword(plain, ent.salt);
    return safeEqual(hash, ent.hash);
  }
  const initial = process.env.INITIAL_PASSWORD;
  if (!initial) throw new Error('INITIAL_PASSWORD 환경 변수가 설정되지 않았습니다.');
  return safeEqual(String(plain), String(initial));
}

// 비밀번호를 무작위로 대입하는 시도를 막습니다.
async function loginAttempt(email) {
  const t = await table();
  const key = String(email).toLowerCase();
  let ent = null;
  try { ent = await t.getEntity(ATTEMPT_PARTITION, key); } catch (e) {}
  const now = Date.now();
  const since = ent ? new Date(ent.firstAt).getTime() : now;
  const expired = now - since > ATTEMPT_WINDOW_MIN * 60000;
  const n = (expired || !ent) ? 1 : (Number(ent.count) || 0) + 1;
  await t.upsertEntity({
    partitionKey: ATTEMPT_PARTITION, rowKey: key,
    count: n, firstAt: (expired || !ent) ? new Date(now).toISOString() : ent.firstAt
  }, 'Replace');
  return { count: n, locked: n > MAX_ATTEMPTS, waitMin: ATTEMPT_WINDOW_MIN };
}
async function clearAttempts(email) {
  const t = await table();
  try { await t.deleteEntity(ATTEMPT_PARTITION, String(email).toLowerCase()); } catch (e) {}
}

// ---------------- 변경 이력 ----------------
// 저장·수정·삭제할 때마다 한 줄씩 쌓습니다. 덮어쓰지 않습니다.
// rowKey 를 "거꾸로 센 시각"으로 만들어, 별도 정렬 없이도 최신순으로 읽힙니다.
const AUDIT_PARTITION = 'audit_log';

async function writeAudit(info) {
  try {
    const t = await table();
    const now = Date.now();
    const rk = String(1e15 - now).padStart(16, '0') + '-' + crypto.randomBytes(3).toString('hex');
    await t.createEntity({
      partitionKey: AUDIT_PARTITION, rowKey: rk,
      at: new Date(now).toISOString(),
      by: String(info.by || ''),
      byName: String(info.byName || ''),
      sheet: String(info.sheet || ''),
      recId: String(info.recId || ''),
      action: String(info.action || ''),
      fields: String(info.fields || ''),
      note: String(info.note || '')
    });
  } catch (e) {
    // 이력 기록이 실패해도 본 저장은 막지 않습니다 (기록보다 업무가 우선).
    console.error('audit 기록 실패:', e && e.message);
  }
}

async function listAudit(opts) {
  opts = opts || {};
  const limit = Math.min(Number(opts.limit) || 300, 2000);
  const t = await table();
  const out = [];
  const iter = t.listEntities({ queryOptions: { filter: `PartitionKey eq '${AUDIT_PARTITION}'` } });
  for await (const ent of iter) {
    if (opts.by && String(ent.by).toLowerCase() !== String(opts.by).toLowerCase()) continue;
    if (opts.sheet && ent.sheet !== opts.sheet) continue;
    if (opts.recId && String(ent.recId) !== String(opts.recId)) continue;
    if (opts.from && ent.at < opts.from) continue;
    if (opts.to && ent.at > opts.to) continue;
    out.push({
      at: ent.at, by: ent.by, byName: ent.byName, sheet: ent.sheet,
      recId: ent.recId, action: ent.action, fields: ent.fields, note: ent.note
    });
    if (out.length >= limit) break;   // rowKey 가 최신순이라 앞에서 끊어도 최신 것들입니다
  }
  return out;
}

// ---------------- 운영 로그 (2026-09) ----------------
// 변경 이력이 "누가 무엇을 바꿨나"라면, 운영 로그는 "무엇이 잘못됐나"를 남깁니다.
//   저장·삭제 실패 / 불러오기 실패 / 엑셀 업로드 실패 / 서버 오류 / 화면 오류 / 로그인 실패·잠김
// ★ 클레임 본문·병원 연락처 같은 내용은 남기지 않습니다. 건번호·메뉴·오류 메시지만 남깁니다.
// ★ 90일이 지난 줄은 관리자가 운영 로그를 열 때 자동으로 지웁니다.
// rowKey 는 변경 이력과 같이 "거꾸로 센 시각"이라 앞에서부터 읽으면 최신순입니다.
const OPS_PARTITION = 'ops_log';
const OPS_KEEP_DAYS = 90;
const OPS_MAX_PER_MIN = 300;              // 한 서버 인스턴스에서 1분에 이보다 많이 쌓이면 버립니다 (폭주 방지)
let _opsWin = { t: 0, n: 0 };
let _lastPurge = 0;

function _revKey(ms) { return String(1e15 - ms).padStart(16, '0'); }
function _clip(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ').slice(0, n); }

async function writeOps(info) {
  try {
    const now = Date.now();
    if (now - _opsWin.t > 60000) _opsWin = { t: now, n: 0 };
    if (++_opsWin.n > OPS_MAX_PER_MIN) return;
    const t = await table();
    await t.createEntity({
      partitionKey: OPS_PARTITION,
      rowKey: _revKey(now) + '-' + crypto.randomBytes(3).toString('hex'),
      at: new Date(now).toISOString(),
      kind: _clip(info.kind, 40),
      source: info.source === 'client' ? 'client' : 'server',
      page: _clip(info.page, 120),
      sheet: _clip(info.sheet, 60),
      action: _clip(info.action, 30),
      recId: _clip(info.recId, 120),
      by: _clip(info.by, 120),
      byName: _clip(info.byName, 60),
      message: _clip(info.message, 500),
      detail: _clip(info.detail, 1500),
      count: Math.max(1, Math.min(9999, parseInt(info.count, 10) || 1)),
      ua: _clip(info.ua, 160)
    });
  } catch (e) {
    // 로그를 못 남겨도 본 업무는 막지 않습니다.
    console.error('운영 로그 기록 실패:', e && e.message);
  }
}

// API 에서 예외가 났을 때 한 줄로 남기는 도우미 (응답은 기존과 똑같이 돌려줍니다)
async function serverError(where, e, extra) {
  extra = extra || {};
  await writeOps({
    kind: 'server_error', source: 'server', page: 'api/' + where,
    sheet: extra.sheet, action: extra.action, recId: extra.recId,
    by: extra.by, byName: extra.byName,
    message: (e && e.message) || String(e),
    detail: [e && e.statusCode ? 'HTTP ' + e.statusCode : '', e && e.code ? 'code ' + e.code : '']
      .filter(Boolean).join(' · ')
  });
}

// 기간은 rowKey 범위로 바로 걸러 읽습니다 (전체를 훑지 않습니다).
async function listOps(opts) {
  opts = opts || {};
  const limit = Math.min(Number(opts.limit) || 500, 3000);
  const t = await table();
  let filter = `PartitionKey eq '${OPS_PARTITION}'`;
  const toMs = opts.to ? Date.parse(opts.to) : NaN;
  const fromMs = opts.from ? Date.parse(opts.from) : NaN;
  if (!isNaN(toMs)) filter += ` and RowKey ge '${_revKey(toMs)}'`;          // 이 시각보다 최근은 제외
  if (!isNaN(fromMs)) filter += ` and RowKey le '${_revKey(fromMs)}~'`;     // 이 시각보다 오래된 것은 제외
  const out = [];
  for await (const ent of t.listEntities({ queryOptions: { filter } })) {
    if (opts.kind && ent.kind !== opts.kind) continue;
    if (opts.by && String(ent.by).toLowerCase() !== String(opts.by).toLowerCase()) continue;
    out.push({
      at: ent.at, kind: ent.kind, source: ent.source, page: ent.page, sheet: ent.sheet,
      action: ent.action, recId: ent.recId, by: ent.by, byName: ent.byName,
      message: ent.message, detail: ent.detail, count: Number(ent.count) || 1, ua: ent.ua
    });
    if (out.length >= limit) break;
  }
  return out;
}

// 최근 N일 종류별 건수 (포털 메인 관리자 칸의 "최근 7일 오류 N건")
async function opsSummary(days) {
  days = Math.max(1, Math.min(90, Number(days) || 7));
  const rows = await listOps({ from: new Date(Date.now() - days * 86400000).toISOString(), limit: 3000 });
  const byKind = {};
  let total = 0;
  rows.forEach(r => { byKind[r.kind] = (byKind[r.kind] || 0) + r.count; total += r.count; });
  return { days, total, byKind, lastAt: rows.length ? rows[0].at : '', capped: rows.length >= 3000 };
}

// 90일 지난 줄 지우기 — 한 인스턴스에서 12시간에 한 번만 돕니다.
async function purgeOps(force) {
  const now = Date.now();
  if (!force && now - _lastPurge < 12 * 3600000) return 0;
  _lastPurge = now;
  const t = await table();
  const cutoff = _revKey(now - OPS_KEEP_DAYS * 86400000);
  const keys = [];
  const iter = t.listEntities({ queryOptions: {
    filter: `PartitionKey eq '${OPS_PARTITION}' and RowKey gt '${cutoff}~'`, select: ['rowKey'] } });
  for await (const ent of iter) keys.push(ent.rowKey);
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    try { await t.submitTransaction(chunk.map(rk => ['delete', { partitionKey: OPS_PARTITION, rowKey: rk }])); }
    catch (e) { console.error('운영 로그 정리 실패:', e && e.message); }
  }
  return keys.length;
}

module.exports = {
  table, container, packRecord, unpackRecord,
  validSheet, validKey, userOf, revokeUser, CONTAINER,
  // 비밀번호
  getSecret, setPassword, verifyPassword, hasOwnPassword,
  loginAttempt, clearAttempts, MAX_ATTEMPTS,
  // 변경 이력
  writeAudit, listAudit,
  // 운영 로그
  writeOps, listOps, opsSummary, purgeOps, serverError, OPS_KEEP_DAYS
};
