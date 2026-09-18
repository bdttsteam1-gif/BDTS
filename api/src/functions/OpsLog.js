// OpsLog.js — 운영 로그 (2026-09)
// POST /api/opslog  {events:[{kind, page, sheet, action, recId, message, detail, count}]}
//        → 화면에서 난 문제(저장 실패·불러오기 실패·업로드 실패·화면 오류)를 모읍니다. 로그인한 사람만.
//          누가 보냈는지는 화면이 적어 보낸 값이 아니라 세션 쿠키로 서버가 정합니다.
// GET  /api/opslog?kind=&by=&from=&to=&limit=   → 목록 (관리자 전용, 최신순)
// GET  /api/opslog?summary=7                    → 최근 7일 종류별 건수 (관리자 전용)
// 서버 쪽 문제(서버 오류·로그인 실패·잠김)는 각 API 가 직접 남깁니다 (_store.writeOps).

const { app } = require('@azure/functions');
const S = require('./_store');
const AL = require('./_allowlist');

// 화면이 보낼 수 있는 종류 — 서버 오류·로그인 기록은 화면이 꾸며 보낼 수 없게 막습니다.
const CLIENT_KINDS = new Set(['save_fail', 'delete_fail', 'load_fail', 'upload_fail', 'client_error']);
const MAX_EVENTS = 20;

app.http('OpsLog', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'opslog',
  handler: async (request, context) => {
    const user = await S.userOf(request);
    if (!user.email) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const list = (Array.isArray(body.events) ? body.events : []).slice(0, MAX_EVENTS);
      let name = '';
      try { name = AL.nameFor(user.email, AL.loadAllowlist()); } catch (e) {}
      const ua = String(request.headers.get('user-agent') || '');
      let saved = 0;
      for (const ev of list) {
        if (!ev || !CLIENT_KINDS.has(ev.kind)) continue;
        await S.writeOps({
          kind: ev.kind, source: 'client', page: ev.page, sheet: ev.sheet, action: ev.action,
          recId: ev.recId, message: ev.message, detail: ev.detail, count: ev.count,
          by: user.email, byName: name, ua
        });
        saved++;
      }
      return { jsonBody: { ok: true, saved } };
    }

    if (!user.roles.includes('admin')) {
      return { status: 403, jsonBody: { error: '운영 로그는 관리자만 볼 수 있습니다.' } };
    }
    try {
      try { await S.purgeOps(false); } catch (e) { context.warn('운영 로그 정리 건너뜀: ' + e.message); }
      if (request.query.get('summary')) {
        return { jsonBody: await S.opsSummary(request.query.get('summary')) };
      }
      const rows = await S.listOps({
        kind: request.query.get('kind') || '',
        by: request.query.get('by') || '',
        from: request.query.get('from') || '',
        to: request.query.get('to') || '',
        limit: request.query.get('limit') || 500
      });
      return { jsonBody: rows };
    } catch (e) {
      context.error(e);
      return { status: 500, jsonBody: { error: '운영 로그를 읽지 못했습니다: ' + e.message } };
    }
  }
});
