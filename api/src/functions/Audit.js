// Audit.js — 변경 이력 조회 (admin 전용)
// GET /api/audit?by=&sheet=&recId=&from=&to=&limit=
// 결과는 최신순입니다 (rowKey 를 거꾸로 센 시각으로 만들어 두었습니다).

const { app } = require('@azure/functions');
const S = require('./_store');

app.http('Audit', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit',
  handler: async (request, context) => {
    const user = await S.userOf(request);
    if (!user.email) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    if (!user.roles.includes('admin')) {
      return { status: 403, jsonBody: { error: '변경 이력은 관리자만 볼 수 있습니다.' } };
    }

    try {
      const rows = await S.listAudit({
        by: request.query.get('by') || '',
        sheet: request.query.get('sheet') || '',
        recId: request.query.get('recId') || '',
        from: request.query.get('from') || '',
        to: request.query.get('to') || '',
        limit: request.query.get('limit') || 300
      });
      return { jsonBody: rows };
    } catch (e) {
      context.error(e);
      await S.serverError('audit', e, { by: user.email });
      return { status: 500, jsonBody: { error: '이력을 읽지 못했습니다: ' + e.message } };
    }
  }
});
