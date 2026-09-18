// _allowlist.js — 허용 명단(allowlist.json) 읽기 공통 모듈
// 로그인(Login.js) · 세션 확인(Session.js) · 이력 기록(records.js)에서 함께 씁니다.

const fs = require('fs');
const path = require('path');

// 배포 환경마다 함수 파일이 놓이는 위치가 달라질 수 있어 후보를 모두 시도합니다.
function findAllowlistPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'allowlist.json'),
    path.join(__dirname, '..', 'allowlist.json'),
    path.join(__dirname, 'allowlist.json'),
    path.join(process.cwd(), 'allowlist.json'),
    path.join(process.cwd(), 'api', 'allowlist.json')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 다음 후보 */ }
  }
  return null;
}

function loadAllowlist() {
  const p = findAllowlistPath();
  if (!p) throw new Error('allowlist.json 파일을 찾을 수 없습니다. (__dirname=' + __dirname + ', cwd=' + process.cwd() + ')');
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) { throw new Error('allowlist.json 읽기 실패: ' + e.message); }
  let j;
  try { j = JSON.parse(raw); }
  catch (e) { throw new Error('allowlist.json 형식 오류(쉼표/괄호 확인): ' + e.message); }

  const users = new Map();
  (j.users || []).forEach(u => { if (u && u.email) users.set(String(u.email).trim().toLowerCase(), u); });
  const domains = (j.domains || []).map(d => String(d).trim().toLowerCase().replace(/^@/, ''));
  return { users, domains, count: users.size };
}

function rolesFor(email, list) {
  const hit = list.users.get(email);
  if (hit) return Array.isArray(hit.roles) && hit.roles.length ? hit.roles : ['member'];
  const domain = email.split('@')[1] || '';
  if (list.domains.includes(domain)) return ['member'];
  return null; // 허용 목록에 없음
}

// 이력 화면에 메일 대신 이름을 보여주기 위해 씁니다.
function nameFor(email, list) {
  const hit = list.users.get(String(email || '').trim().toLowerCase());
  return (hit && hit.name) ? hit.name : '';
}

module.exports = { loadAllowlist, rolesFor, nameFor, findAllowlistPath };
