// Session.js — 지금 로그인한 사람이 누구인지 확인 (화면이 시작할 때마다 호출)
// 관리자가 강제 무효화한 세션이면 여기서도 즉시 로그아웃 상태로 나옵니다.
//
// ★ 세션 연장: 확인이 성공할 때마다 쿠키 기한을 오늘부터 다시 6개월로 늘립니다.
//   계속 쓰는 PC 는 로그인이 풀리지 않습니다. 비밀번호를 바꾸지 않아도 마찬가지입니다.
//   (비밀번호 변경은 다른 기기의 로그인을 끊지 않습니다 — 끊어야 할 때는 관리자의 강제 무효화를 씁니다.)
const { app } = require('@azure/functions');
const S = require('./_store');
const A = require('./_auth');
const AL = require('./_allowlist');

app.http('Session', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/session',
  handler: async (request) => {
    const user = await S.userOf(request);
    if (!user.email) return { status: 401, jsonBody: { authenticated: false } };

    // 허용 명단에서 빠진 사람은 기존 쿠키가 남아 있어도 여기서 막습니다.
    let roles = user.roles, name = '';
    try {
      const list = AL.loadAllowlist();
      const cur = AL.rolesFor(user.email, list);
      if (!cur) return { status: 401, jsonBody: { authenticated: false } };
      roles = cur;                       // 권한이 바뀌었으면 최신 값으로 따릅니다
      name = AL.nameFor(user.email, list);
    } catch (e) { /* 명단을 못 읽으면 기존 쿠키 값을 그대로 씁니다 */ }

    let usingInitial = true;
    try { usingInitial = !(await S.hasOwnPassword(user.email)); } catch (e) {}

    return {
      status: 200,
      // 접속할 때마다 기한을 다시 채워 넣습니다 (sliding). 그래서 계속 쓰면 안 풀립니다.
      headers: { 'Set-Cookie': A.makeSessionCookie(user.email, roles), 'Content-Type': 'application/json' },
      jsonBody: {
        authenticated: true, email: user.email, name, roles,
        isAdmin: roles.includes('admin'), usingInitialPassword: usingInitial
      }
    };
  }
});
