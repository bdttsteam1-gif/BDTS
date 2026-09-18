// ChangePassword.js — 본인 비밀번호 변경 (선택 사항)
// 바꾸지 않아도 초기 비밀번호로 계속 쓸 수 있습니다.
// 로그인한 사람만 자기 것을 바꿀 수 있습니다 (남의 것은 바꿀 수 없습니다).

const { app } = require('@azure/functions');
const S = require('./_store');
const AL = require('./_allowlist');

const MIN_LEN = 8;

app.http('ChangePassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/change-password',
  handler: async (request, context) => {
    const user = await S.userOf(request);
    if (!user.email) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    const body = await request.json().catch(() => ({}));
    const current = String(body.current || '');
    const next = String(body.next || '');

    if (!current || !next) {
      return { status: 400, jsonBody: { error: '현재 비밀번호와 새 비밀번호를 모두 입력해주세요.' } };
    }
    if (next.length < MIN_LEN) {
      return { status: 400, jsonBody: { error: `새 비밀번호는 ${MIN_LEN}자 이상이어야 합니다.` } };
    }
    if (current === next) {
      return { status: 400, jsonBody: { error: '현재 비밀번호와 다른 값으로 정해주세요.' } };
    }

    let ok = false;
    try { ok = await S.verifyPassword(user.email, current); }
    catch (e) {
      context.error(e);
      await S.serverError('auth/change-password', e, { by: user.email, action: '비밀번호 확인' });
      return { status: 500, jsonBody: { error: '비밀번호 확인 중 오류가 발생했습니다.' } };
    }
    if (!ok) return { status: 400, jsonBody: { error: '현재 비밀번호가 올바르지 않습니다.' } };

    try { await S.setPassword(user.email, next); }
    catch (e) {
      context.error(e);
      await S.serverError('auth/change-password', e, { by: user.email, action: '비밀번호 저장' });
      return { status: 500, jsonBody: { error: '비밀번호 저장에 실패했습니다. 다시 시도해주세요.' } };
    }

    let name = '';
    try { name = AL.nameFor(user.email, AL.loadAllowlist()); } catch (e) {}
    await S.writeAudit({
      by: user.email, byName: name, sheet: '-', recId: '-',
      action: '비밀번호 변경', fields: '', note: ''
    });
    context.log(`비밀번호 변경: ${user.email}`);

    return { jsonBody: { ok: true } };
  }
});
