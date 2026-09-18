// Logout.js — 세션 쿠키 삭제
const { app } = require('@azure/functions');
const A = require('./_auth');

app.http('Logout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: async () => {
    return { status: 200, headers: { 'Set-Cookie': A.clearSessionCookie() }, jsonBody: { ok: true } };
  }
});
