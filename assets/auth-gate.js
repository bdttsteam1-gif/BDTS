// auth-gate.js — 화면이 뜨기 전에 로그인 여부를 확인합니다.
// 로그인이 안 되어 있으면 전체 화면을 덮는 로그인 창을 띄우고,
// 회사 메일 + 비밀번호를 통과해야 원래 페이지 내용이 보이게 합니다.
//
// 예전에는 메일로 6자리 코드를 받는 방식이었지만, 메일 발송 제약 때문에
// 비밀번호 방식으로 바꿨습니다. (api/src/functions/Login.js)
//
// 이 스크립트는 반드시 페이지의 다른 내용보다 먼저 실행돼야 하므로,
// 각 HTML 파일의 <body> 맨 앞부분에서 불러옵니다.

(function () {
  'use strict';

  var GATE_ID = 'authGate';
  var STYLE_ID = 'authGateStyle';

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
#${GATE_ID}{position:fixed;inset:0;background:#1a1a2e;z-index:99999;display:flex;
  align-items:center;justify-content:center;font-family:'IBM Plex Sans KR',-apple-system,'Segoe UI',sans-serif}
#${GATE_ID} .box{background:#fff;border-radius:14px;padding:36px 32px;width:100%;max-width:380px}
#${GATE_ID} h1{font-size:18px;font-weight:700;margin-bottom:4px}
#${GATE_ID} h1 span{color:#2563eb}
#${GATE_ID} p{font-size:12.5px;color:#6b7280;margin-bottom:18px;line-height:1.6}
#${GATE_ID} input{width:100%;padding:11px 13px;border:1px solid #d1d5db;border-radius:8px;
  font-size:15px;margin-bottom:10px;box-sizing:border-box}
#${GATE_ID} input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
#${GATE_ID} button{width:100%;background:#2563eb;color:#fff;border:none;padding:11px;
  border-radius:8px;font-size:15px;font-weight:700;cursor:pointer}
#${GATE_ID} button:disabled{opacity:.5;cursor:default}
#${GATE_ID} .err{color:#b91c1c;font-size:12.5px;margin-top:8px;min-height:16px;line-height:1.5}
#${GATE_ID} .ok{color:#15803d;font-size:12.5px;margin-top:8px}
#${GATE_ID} .back{background:none;color:#6b7280;font-size:12.5px;margin-top:12px;padding:0;
  width:auto;font-weight:400;text-decoration:underline}
#${GATE_ID} .hint{font-size:11.5px;color:#9ca3af;margin-top:14px;line-height:1.6}
`;
    document.head.appendChild(s);
  }

  function gate() {
    var el = document.getElementById(GATE_ID);
    if (!el) { el = document.createElement('div'); el.id = GATE_ID; document.body.appendChild(el); }
    return el;
  }

  function render() {
    css();
    var el = gate();
    el.innerHTML = `
      <div class="box">
        <h1>Boditech <span>MED</span></h1>
        <p>회사 메일 주소와 비밀번호를 입력해주세요.<br>등록된 계정만 들어올 수 있습니다.</p>
        <input type="email" id="gEmail" placeholder="you@boditech.co.kr" autocomplete="username">
        <input type="password" id="gPw" placeholder="비밀번호" autocomplete="current-password">
        <button id="gLogin">로그인</button>
        <div class="err" id="gErr"></div>
        <div class="hint">비밀번호를 모르시면 관리자(장명선)에게 문의해주세요.</div>
      </div>`;

    var btn = document.getElementById('gLogin');
    var doLogin = function () {
      var email = document.getElementById('gEmail').value.trim();
      var pw = document.getElementById('gPw').value;
      var err = document.getElementById('gErr');
      if (!email || !pw) { err.textContent = '메일 주소와 비밀번호를 모두 입력해주세요.'; return; }
      btn.disabled = true; btn.textContent = '확인 중…';
      fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: pw })
      }).then(function (r) { return r.json(); }).then(function (j) {
        btn.disabled = false; btn.textContent = '로그인';
        if (j.error) { err.textContent = j.error; return; }
        el.remove();
        window.__bdtsUser = {
          email: j.email, name: j.name || '', roles: j.roles,
          isAdmin: j.roles.indexOf('admin') >= 0,
          usingInitialPassword: !!j.usingInitialPassword
        };
        document.dispatchEvent(new CustomEvent('bdts-authed'));
        // 아직 초기 비밀번호를 쓰는 사람에게 한 번 권유합니다 (강제하지 않습니다).
        if (j.usingInitialPassword) setTimeout(suggestChange, 1200);
      }).catch(function () {
        btn.disabled = false; btn.textContent = '로그인';
        err.textContent = '요청에 실패했습니다. 잠시 후 다시 시도해주세요.';
      });
    };
    btn.onclick = doLogin;
    ['gEmail', 'gPw'].forEach(function (id) {
      document.getElementById(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    });
    document.getElementById('gEmail').focus();
  }

  // ---- 비밀번호 변경 (선택) ----
  function openChangePassword() {
    css();
    var el = gate();
    el.innerHTML = `
      <div class="box">
        <h1>비밀번호 변경</h1>
        <p>새 비밀번호는 8자 이상으로 정해주세요.<br>바꾸지 않아도 지금 비밀번호로 계속 쓸 수 있습니다.</p>
        <input type="password" id="cCur" placeholder="현재 비밀번호" autocomplete="current-password">
        <input type="password" id="cNew" placeholder="새 비밀번호 (8자 이상)" autocomplete="new-password">
        <input type="password" id="cNew2" placeholder="새 비밀번호 확인" autocomplete="new-password">
        <button id="cSave">변경하기</button>
        <div class="err" id="cErr"></div>
        <button class="back" id="cSkip">나중에 하기</button>
      </div>`;
    var save = document.getElementById('cSave');
    var close = function () { el.remove(); };
    document.getElementById('cSkip').onclick = close;
    save.onclick = function () {
      var cur = document.getElementById('cCur').value;
      var nw = document.getElementById('cNew').value;
      var nw2 = document.getElementById('cNew2').value;
      var err = document.getElementById('cErr');
      if (nw !== nw2) { err.textContent = '새 비밀번호가 서로 다릅니다.'; return; }
      if (nw.length < 8) { err.textContent = '새 비밀번호는 8자 이상이어야 합니다.'; return; }
      save.disabled = true; save.textContent = '저장 중…';
      fetch('/api/auth/change-password', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: cur, next: nw })
      }).then(function (r) { return r.json(); }).then(function (j) {
        save.disabled = false; save.textContent = '변경하기';
        if (j.error) { err.textContent = j.error; return; }
        if (window.__bdtsUser) window.__bdtsUser.usingInitialPassword = false;
        alert('비밀번호를 변경했습니다.');
        close();
      }).catch(function () {
        save.disabled = false; save.textContent = '변경하기';
        err.textContent = '요청에 실패했습니다. 다시 시도해주세요.';
      });
    };
    document.getElementById('cCur').focus();
  }
  // 다른 화면에서도 부를 수 있게 열어둡니다 (예: 메뉴의 "비밀번호 변경").
  window.bdtsChangePassword = openChangePassword;

  function suggestChange() {
    if (confirm('아직 처음 받은 비밀번호를 쓰고 있습니다.\n지금 본인만의 비밀번호로 바꾸시겠어요?\n(나중에 바꿔도 됩니다)')) {
      openChangePassword();
    }
  }

  // 시작 — 세션이 이미 있는지 먼저 확인
  //
  // ★ 한 번 로그인한 PC 는 계속 로그인 상태로 남습니다.
  //   서버(Session.js)가 확인할 때마다 쿠키 기한을 오늘부터 다시 채워 주기 때문입니다.
  //   그래서 여기서는 "네트워크가 잠깐 끊겼을 뿐인데 로그인 화면이 뜨는" 일이 없도록,
  //   401(정말 로그인 안 됨)과 통신 실패를 구분하고 통신 실패는 몇 번 다시 시도합니다.
  function checkSession(tries) {
    return fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) return { authenticated: false };   // 확실히 로그인 안 된 상태
        if (!r.ok) throw new Error('http ' + r.status);          // 서버 오류 → 재시도 대상
        return r.json();
      })
      .catch(function (e) {
        if (tries > 0) {
          return new Promise(function (res) { setTimeout(res, 800); }).then(function () {
            return checkSession(tries - 1);
          });
        }
        throw e;
      });
  }

  window.__bdtsAuthReady = checkSession(2)
    .then(function (j) {
      if (j && j.authenticated) {
        window.__bdtsUser = {
          email: j.email, name: j.name || '', roles: j.roles, isAdmin: j.isAdmin,
          usingInitialPassword: !!j.usingInitialPassword
        };
        return;
      }
      return new Promise(function (resolve) {
        render();
        document.addEventListener('bdts-authed', function onAuthed() {
          document.removeEventListener('bdts-authed', onAuthed);
          resolve();
        });
      });
    })
    .catch(function () {
      // 여러 번 시도해도 서버에 닿지 못한 경우 — 로그인 화면을 띄우되 원인을 알려줍니다.
      render();
      var err = document.getElementById('gErr');
      if (err) err.textContent = '서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 새로고침해주세요.';
    });
})();
