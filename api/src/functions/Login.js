// Login.js — 메일 + 비밀번호 로그인 (메일 발송 없음)
// 통과 조건 두 가지를 모두 만족해야 합니다.
//   1) allowlist.json 에 등록된 메일일 것
//   2) 비밀번호가 맞을 것 (개인 비밀번호를 정했으면 그것, 아니면 초기 비밀번호)
//
// 실패했을 때 "없는 메일"인지 "비밀번호가 틀렸는지" 구분해서 알려주지 않습니다.
// 구분해 주면 어떤 메일이 등록되어 있는지 하나씩 확인해볼 수 있기 때문입니다.

const { app } = require('@azure/functions');
const S = require('./_store');
const A = require('./_auth');
const AL = require('./_allowlist');

const SAME_MSG = '메일 주소 또는 비밀번호가 올바르지 않습니다.';

app.http('Login', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: async (request, context) => {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
      return { status: 400, jsonBody: { error: '메일 주소와 비밀번호를 입력해주세요.' } };
    }

    // 무작위 대입 차단 — 실패가 쌓이면 일정 시간 잠급니다.
    let att;
    try { att = await S.loginAttempt(email); }
    catch (e) {
      context.error(e);
      await S.serverError('auth/login', e, { by: email, action: '시도 횟수 기록' });
      return { status: 500, jsonBody: { error: '로그인 처리 중 오류가 발생했습니다. 관리자에게 문의해주세요.' } };
    }
    if (att.locked) {
      /* 잠긴 순간 한 번만 남깁니다 (잠긴 동안 계속 두드려도 줄이 쌓이지 않게) */
      if (att.count === S.MAX_ATTEMPTS + 1) {
        await S.writeOps({ kind: 'login_locked', by: email, page: 'auth/login',
          message: `로그인 ${S.MAX_ATTEMPTS}회 실패로 ${att.waitMin}분 잠김` });
      }
      return { status: 429, jsonBody: { error: `시도 횟수를 초과했습니다. ${att.waitMin}분 뒤에 다시 시도해주세요.` } };
    }

    let list;
    try { list = AL.loadAllowlist(); }
    catch (e) {
      context.error(e);
      await S.serverError('auth/login', e, { by: email, action: '허용 명단 읽기' });
      return { status: 500, jsonBody: { error: '허용 명단을 읽지 못했습니다. 관리자에게 문의해주세요.' } };
    }

    const roles = AL.rolesFor(email, list);
    if (!roles) {
      context.log(`로그인 거부(명단 없음): ${email}`);
      await S.writeOps({ kind: 'login_fail', by: email, page: 'auth/login', message: '허용 명단에 없는 메일', count: 1 });
      return { status: 401, jsonBody: { error: SAME_MSG } };
    }

    let ok = false;
    try { ok = await S.verifyPassword(email, password); }
    catch (e) {
      context.error(e);
      await S.serverError('auth/login', e, { by: email, action: '비밀번호 확인' });
      return { status: 500, jsonBody: { error: '비밀번호 설정이 되어 있지 않습니다. 관리자에게 문의해주세요.' } };
    }
    if (!ok) {
      context.log(`로그인 실패(비밀번호 불일치): ${email} — ${att.count}회째`);
      await S.writeOps({ kind: 'login_fail', by: email, byName: AL.nameFor(email, list), page: 'auth/login',
        message: '비밀번호 불일치', detail: `${att.count}회째 (${S.MAX_ATTEMPTS}회 넘으면 ${att.waitMin}분 잠김)` });
      return { status: 401, jsonBody: { error: SAME_MSG } };
    }

    await S.clearAttempts(email);

    const usingInitial = !(await S.hasOwnPassword(email));
    const cookie = A.makeSessionCookie(email, roles);
    const name = AL.nameFor(email, list);
    context.log(`로그인 성공: ${email} (${roles.join(',')})`);

    await S.writeAudit({
      by: email, byName: name, sheet: '-', recId: '-',
      action: '로그인', fields: '', note: usingInitial ? '초기 비밀번호' : '개인 비밀번호'
    });

    return {
      status: 200,
      headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json' },
      jsonBody: {
        ok: true, email, roles, name,
        // 아직 초기 비밀번호를 쓰는 사람에게는 화면에서 변경을 권유합니다 (강제하지는 않습니다).
        usingInitialPassword: usingInitial
      }
    };
  }
});
