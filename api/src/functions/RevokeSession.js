// RevokeSession.js — 관리자 전용: 특정 사람의 기존 로그인 세션을 즉시 무효화
// allowlist.json 에서 그 사람을 지우는 것과는 별개입니다.
// (allowlist 에서 지우면 "새로 로그인은 못 하게" 막고, 이 API 는 "지금 로그인되어 있는 기기도 즉시 끊어냅니다".)
// 퇴사·기기 분실 등으로 즉시 접근을 끊어야 할 때 둘 다 함께 처리하시는 걸 권합니다.

const { app } = require('@azure/functions');
const S = require('./_store');

app.http('RevokeSession', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/revoke-session',
  handler: async (request, context) => {
    const me = await S.userOf(request);
    if (!me.email) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    if (!me.roles.includes('admin')) return { status: 403, jsonBody: { error: '관리자만 사용할 수 있습니다.' } };

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { status: 400, jsonBody: { error: '올바른 메일 주소를 입력해주세요.' } };
    }

    try {
      await S.revokeUser(email);
      context.log(`${me.email} 가 ${email} 의 세션을 무효화했습니다.`);
      return { jsonBody: { ok: true, message: email + ' 의 로그인 세션을 무효화했습니다. 다음 접속부터 다시 인증코드를 받아야 합니다.' } };
    } catch (e) {
      context.error(e);
      return { status: 500, jsonBody: { error: e.message } };
    }
  }
});
