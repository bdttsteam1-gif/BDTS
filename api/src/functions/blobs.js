// blobs.js — 기존 data-sync.js(구글시트 조각 저장) 를 대체하는 대용량 저장 API
// ---------------------------------------------------------------------
// 구글시트에서는 셀 5만자 제한 때문에 업로드 데이터를 수십~수백 조각으로
// 쪼개 저장하고 다시 이어붙여야 했습니다. Blob 에는 그 제한이 없으므로
// key 하나 = 파일 하나로 통째로 저장합니다. (조각/이전버전 청소 로직 불필요)
//
// GET  /api/blobs?store=claim&key=2026        → 하나 읽기
// GET  /api/blobs?store=claim                 → 그 store 전체 읽기
// POST /api/blobs {store, action:"wipe"}     → store 통째로 비우기 (admin 전용, 데이터 이관용)
// POST /api/blobs {store, key, data}          → 저장 (admin 전용)

const { app } = require('@azure/functions');
const S = require('./_store');

function blobPath(store, key) { return `${store}/${key}.json`; }

async function readBlob(container, name) {
  const bc = container.getBlockBlobClient(name);
  const buf = await bc.downloadToBuffer();
  return JSON.parse(buf.toString('utf8'));
}

app.http('blobs', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'blobs',
  handler: async (request, context) => {
    const user = await S.userOf(request);
    if (!user.email) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    try {
      const container = await S.container();

      if (request.method === 'GET') {
        const store = request.query.get('store');
        const key = request.query.get('key');
        if (!S.validSheet(store)) return { status: 400, jsonBody: { error: 'store 이름이 올바르지 않습니다.' } };

        if (key) {
          if (!S.validKey(key)) return { status: 400, jsonBody: { error: 'key 가 올바르지 않습니다.' } };
          try {
            return { jsonBody: await readBlob(container, blobPath(store, key)) };
          } catch (e) {
            if (e.statusCode === 404) return { status: 404, jsonBody: { error: '없는 key 입니다.' } };
            throw e;
          }
        }

        // store 전체 — { key: {ver, data} } 형태로 돌려준다 (기존 loadAll 과 동일)
        const out = {};
        for await (const b of container.listBlobsFlat({ prefix: store + '/' })) {
          const k = b.name.slice(store.length + 1).replace(/\.json$/, '');
          try {
            const wrapped = await readBlob(container, b.name);
            out[k] = wrapped;
          } catch (e) { context.warn('건너뜀: ' + b.name); }
        }
        return { jsonBody: out };
      }

      // ---- POST : 저장 ----
      const b = await request.json().catch(() => ({}));
      const { store, key } = b;

      // ---- store 통째로 비우기 (관리자 전용, 운영 데이터 옮기기에서만) ----
      // 예: {store:'claims', action:'wipe'} → claims/ 아래 파일을 모두 지웁니다.
      if (b.action === 'wipe') {
        if (!S.validSheet(store)) return { status: 400, jsonBody: { error: 'store 이름이 올바르지 않습니다.' } };
        if (!user.roles.includes('admin')) return { status: 403, jsonBody: { error: '관리자만 쓸 수 있습니다.' } };
        let deleted = 0;
        for await (const bl of container.listBlobsFlat({ prefix: store + '/' })) {
          await container.deleteBlob(bl.name);
          deleted++;
        }
        await S.writeAudit({
          by: user.email, byName: '', sheet: 'blob:' + store, recId: '*',
          action: '초기화', fields: '', note: deleted + '개 파일 삭제 (데이터 이관)'
        });
        return { jsonBody: { success: true, deleted } };
      }
      if (!S.validSheet(store) || !S.validKey(key)) {
        return { status: 400, jsonBody: { error: 'store 또는 key 가 올바르지 않습니다.' } };
      }
      if (!user.roles.includes('admin')) {
        return { status: 403, jsonBody: { error: '업로드 권한이 없습니다. (admin 전용)' } };
      }

      const wrapped = {
        ver: Date.now(),
        savedAt: new Date().toISOString(),
        savedBy: user.email,
        data: b.data
      };
      const body = JSON.stringify(wrapped);
      const bc = container.getBlockBlobClient(blobPath(store, key));
      await bc.upload(body, Buffer.byteLength(body), {
        blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' }
      });

      return { jsonBody: { success: true, ver: wrapped.ver, bytes: body.length } };
    } catch (e) {
      context.error(e);
      await S.serverError('blobs', e, { sheet: 'blob', action: request.method, by: user.email });
      return { status: 500, jsonBody: { error: e.message } };
    }
  }
});
