// _auth.js — 이메일 인증코드 로그인용 세션 발급/검증
// Entra ID 를 걷어내고, 우리가 직접 발급하는 JWT 를 HttpOnly 쿠키에 담아 씁니다.
// 외부 라이브러리 없이 Node 기본 crypto 만으로 서명/검증합니다 (설치 실패 위험을 없애기 위함).
//
// ★ 세션 기간: 한 번 로그인하면 6개월간 다시 로그인할 필요가 없습니다.
//   관리자는 특정 사람의 세션을 즉시 무효화할 수 있습니다 (_store.js 의 revokeUser 참고).

const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const COOKIE_NAME = 'bdts_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 183; // 약 6개월

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest();
  return h + '.' + p + '.' + b64url(sig);
}

function verify(token) {
  if (!token || token.split('.').length !== 3) return null;
  const [h, p, s] = token.split('.');
  const expect = b64url(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  if (expect !== s) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(p).toString('utf8')); } catch (e) { return null; }
  if (!payload.exp || Date.now() / 1000 > payload.exp) return null;
  return payload;
}

function makeSessionCookie(email, roles) {
  const payload = {
    email: String(email).toLowerCase(),
    roles: roles || ['member'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400
  };
  const token = sign(payload);
  const maxAge = SESSION_DAYS * 86400;
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// 쿠키에 든 JWT 를 그대로 풀어서 돌려줍니다 (iat 포함) — 아직 강제무효화 여부는 확인하지 않은 "1차 검증"입니다.
// 강제무효화까지 반영된 최종 판정은 _store.js 의 userOf() 를 쓰세요.
function payloadOf(request) {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[COOKIE_NAME];
  return verify(token);
}

module.exports = {
  sign, verify, makeSessionCookie, clearSessionCookie, parseCookies, payloadOf,
  COOKIE_NAME, SESSION_DAYS
};
