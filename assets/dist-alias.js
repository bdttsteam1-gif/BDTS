// dist-alias.js — Distributor 정식 명칭 (Sales Report 고객명 기준, 국내 제외)
// ------------------------------------------------------------------
//  클레임 로그에는 약식 이름(예: Labtek)으로 올라오지만, 화면에서는 Sales Report의 정식 고객명으로 보여줍니다.
//  1) sales-data.js(SALES_ROWS)의 국가별 고객명을 읽고  2) 국가가 같은 고객 중 이름이 겹치는 것을 자동으로 맞추고
//  3) 사람이 [대리점명 정리]에서 확정·수정한 것은 Azure(dist_alias)에 저장되어 자동 매칭보다 우선합니다.
//  사용: DistAlias.load({ rows: () => [...클레임 행...], onReady: fn })  →  officialDist(row)
// ------------------------------------------------------------------
const DistAlias = { ready: false, sales: {}, saved: {}, auto: {}, seed: {}, seed2: {}, store: null, countries: [], rowsFn: null, onReady: null };
const DA_STOP = new Set('ltd co inc s a de sa srl llc limited company gmbh sl the and of medical med lab labs laboratories diagnostics diagnostic trading pharma pharmaceutical pharmaceuticals international group corp corporation pvt private est services sarl spol sro bv nv ag plc cia ltda sac sas sau slu pty ptd pte lda eood doo ooo llp kk'.split(' '));
/* 국가 표기 통일 — 클레임 로그와 Sales Report 가 다르게 쓰는 이름 (UAE / U.A.E. / United Arab Emirates 등). 글자·숫자만 남긴 뒤 비교합니다 */
const DA_CALIAS = { unitedarabemirates: 'uae', swiss: 'switzerland', netherland: 'netherlands', thenetherlands: 'netherlands', holland: 'netherlands',
  inida: 'india', czech: 'czechrepublic', czechia: 'czechrepublic', drcrepublicofcongo: 'drcongo', drc: 'drcongo', democraticrepublicofcongo: 'drcongo', republicofcongo: 'congo',
  northmacedonia: 'macedonia', saotomeeprincipe: 'saotomeandprincipe', saotome: 'saotomeandprincipe', bosniaherzegovina: 'bosniaandherzegovina', bosnia: 'bosniaandherzegovina',
  capeverde: 'caboverde', unitedstates: 'usa', unitedstatesofamerica: 'usa', unitedkingdom: 'uk', england: 'uk', greatbritain: 'uk', turkiye: 'turkey', vietnam: 'vietnam',
  russianfederation: 'russia', southkorea: 'korea', republicofkorea: 'korea', trinidadtobago: 'trinidadandtobago', swaziland: 'eswatini', ivorycoast: 'cotedivoire',
  somaliadjibouti: 'somalia', myanmarburma: 'myanmar', burma: 'myanmar', hongkongsar: 'hongkong', macau: 'macao', laopdr: 'laos', lao: 'laos', moldovarepublic: 'moldova',
  kyrgyzrepublic: 'kyrgyzstan', slovakrepublic: 'slovakia', peu: 'peru', guayana: 'guyana', dominicarepublic: 'dominicanrepublic', guatemalla: 'guatemala', guatmala: 'guatemala' };
function daStripAccents(x) { try { return String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { return String(x || ''); } }
function daBase(x) { return daStripAccents(x).replace(/＆/g, '&').replace(/Ν/g, 'N').replace(/\(.*?\)/g, '').toLowerCase(); }   /* (Lit) 같은 꼬리표 제거 */
function daNorm(x) { return daBase(x).replace(/[^a-z0-9가-힣]+/g, ' ').trim(); }
function daNosp(x) { return daBase(x).replace(/[^a-z0-9가-힣]/g, ''); }
function daToks(x) { return daNorm(x).split(' ').filter(t => t.length > 1 && !DA_STOP.has(t)); }
function daBigrams(x) { const s = new Set(); for (let i = 0; i < x.length - 1; i++) s.add(x.slice(i, i + 2)); return s; }
function daDice(a, b) { const A = daBigrams(a), B = daBigrams(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach(g => { if (B.has(g)) n++; }); return 2 * n / (A.size + B.size); }
function daCKey(c) { const n = daStripAccents(c).toLowerCase().replace(/[^a-z0-9]/g, ''); return DA_CALIAS[n] || n; }
function daKey(country, dist) { return daNorm(country) + '|' + daNorm(dist); }
function daIsDomestic(r) { return /korea/i.test(r.country || '') || /domestic/i.test(r.dist || ''); }
/* 클레임 국가 → Sales 국가 키 (표기 차이·오타는 별칭표 + 앞글자 + 유사도로 흡수) */
function daCountryKey(country) {
  const k = daCKey(country); if (!k) return null;
  const keys = DistAlias.countries;
  if (DistAlias.sales[k]) return k;
  let hit = keys.find(kk => (kk.startsWith(k) || k.startsWith(kk)) && Math.min(k.length, kk.length) >= 5); if (hit) return hit;
  let best = null, bs = 0; keys.forEach(kk => { const d = daDice(k, kk); if (d > bs) { bs = d; best = kk; } });
  return bs >= 0.8 ? best : null;
}
/* Sales Report 고객명 "회사명; 국가" 의 국가 꼬리표를 우선 쓰고, 없으면 국가 열을 씁니다 */
function daBuildSales() {
  DistAlias.sales = {};
  const seen = {};   /* "Avivir LLC; Russia" 와 "Avivir LLC: Russia" 처럼 기호만 다른 중복은 하나로 (; 표기를 우선) */
  (typeof SALES_ROWS !== 'undefined' ? SALES_ROWS : []).forEach(r => {
    let cu = String(r[4] || '').trim(); if (!cu) return;
    const m = cu.match(/^(.*?)[;:]\s*([^;:]+)$/);
    const head = m ? m[1].trim() : cu, suf = m ? m[2].trim() : '';
    if (m) cu = head + '; ' + suf;
    const k1 = daCKey(suf) || daCKey(r[3]), k2 = daCKey(r[3]);
    [k1, k2].forEach(k => {
      if (!k || k === 'korea') return;
      const dk = k + '|' + daNosp(head); if (seen[dk]) return; seen[dk] = 1;
      (DistAlias.sales[k] = DistAlias.sales[k] || new Set()).add(cu);
    });
  });
  DistAlias.countries = Object.keys(DistAlias.sales);
}
/* 이름 점수: 4 완전일치 · 3 포함 · 2.5 머리글자(GHC=Global Health Care) · 2 단어 겹침 · 1.5 유사도 · 1 앞 4글자 */
function daScore(dist, head, country) {
  const ck = daCKey(country || '');
  const nd = daNosp(dist), nc = daNosp(head);
  if (!nd || !nc) return 0;
  if (nd === nc) return 4;
  if (nd.length >= 4 && nc.length >= 4 && (nc.includes(nd) || nd.includes(nc))) return 3;
  const geo = t => ck && t.length >= 3 && (ck.includes(t) || t.includes(ck));
  const dt = daToks(dist).filter(t => !geo(t)), ct = daToks(head).filter(t => !geo(t));
  const ini = ct.map(t => t[0]).join('');
  if (nd.length >= 2 && nd.length <= 5 && nd === ini) return 2.5;
  if (dt.length && ct.length && dt.some(t => t.length >= 3 && ct.includes(t))) return 2;
  if (daDice(nd, nc) >= 0.72) return 1.5;
  if (dt.length && ct.length && dt.some(t => t.length >= 4 && ct.some(c => c.startsWith(t.slice(0, 4))))) return 1;
  return 0;
}
/* 약식 이름 하나에 대해 같은 국가의 Sales 고객명 후보를 점수순으로 */
function daCandidates(country, dist) {
  const ck = daCountryKey(country); if (!ck) return { ck: null, cands: [] };
  const custs = Array.from(DistAlias.sales[ck] || []);
  const cands = custs.map(cu => ({ name: cu, score: daScore(dist, cu.split(';')[0], country) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { ck, cands };
}
function daAutoMatch(country, dist) {
  const { ck, cands } = daCandidates(country, dist);
  if (!ck || !cands.length) return null;
  const best = cands[0], next = cands[1];
  if (best.score >= 2 && best.score > (next ? next.score : 0)) return { official: best.name, score: best.score };
  return null;
}
function daAllRows() { return (DistAlias.rowsFn ? DistAlias.rowsFn() : []) || []; }
/* seed 조회 — 정확한 키가 없으면 국가 표기 차이(Tai Wan/Taiwan 등)를 흡수한 보조 키로 찾습니다 */
function daSeedOf(country, dist) {
  const k = daKey(country, dist);
  if (Object.prototype.hasOwnProperty.call(DistAlias.seed, k)) return DistAlias.seed[k];
  const k2 = daCKey(country) + '|' + daNosp(dist);
  if (Object.prototype.hasOwnProperty.call(DistAlias.seed2, k2)) return DistAlias.seed2[k2];
  return undefined;
}
function daRefresh() {
  DistAlias.auto = {};
  if (!DistAlias.countries.length) return;
  const seen = {};
  daAllRows().forEach(r => {
    if (daIsDomestic(r) || !r.dist) return;
    const k = daKey(r.country, r.dist); if (seen[k]) return; seen[k] = 1;
    if (DistAlias.saved[k] || daSeedOf(r.country, r.dist) !== undefined) return;
    const m = daAutoMatch(r.country, r.dist); if (m) DistAlias.auto[k] = m.official;
  });
}
function officialDist(r) {
  if (!r || !r.dist || daIsDomestic(r)) return (r && r.dist) || '';
  const k = daKey(r.country, r.dist);
  const sv = DistAlias.saved[k];
  if (sv) return sv.official || r.dist;      /* official 이 비어 있으면 "약식 유지"로 확정한 것 */
  const sd = daSeedOf(r.country, r.dist);    /* 목록(이름_매칭)에서 정한 값 — '' 이면 클레임 로그 이름 그대로 */
  if (sd !== undefined) return sd || r.dist;
  return DistAlias.auto[k] || r.dist;
}

/* 불러오기: Sales Report 고객명(sales-data.js) + Azure 에 저장된 연결(dist_alias) → 자동 매칭 계산
   opts.rows : 클레임 행 전체를 돌려주는 함수 (자동 매칭 대상)   opts.onReady : 끝났을 때 화면 다시 그리기 */
function daLoad(opts) {
  opts = opts || {};
  if (opts.rows) DistAlias.rowsFn = opts.rows;
  if (opts.onReady) DistAlias.onReady = opts.onReady;
  const base = opts.base || '../';
  const loadSales = new Promise(res => {
    if (typeof SALES_ROWS !== 'undefined') return res();
    const sc = document.createElement('script'); sc.src = base + 'sales-data.js'; sc.onload = res; sc.onerror = res; document.head.appendChild(sc);
  });
  const loadSeed = new Promise(res => {
    if (typeof window.__DIST_SEED !== 'undefined') return res();
    const sc = document.createElement('script'); sc.src = base + 'data/dist-alias-seed.js'; sc.onload = res; sc.onerror = res; document.head.appendChild(sc);
  });
  const loadSaved = Promise.resolve().then(() => {
    if (typeof makeHubStore !== 'function') return [];
    DistAlias.store = makeHubStore('dist_alias');
    return DistAlias.store.list();
  }).catch(() => []);
  return Promise.all([loadSales, loadSaved, loadSeed]).then(res => {
    daBuildSales();
    DistAlias.seed = Object.assign({}, window.__DIST_SEED || {});
    DistAlias.seed2 = {};
    Object.keys(DistAlias.seed).forEach(k => { const p = k.split('|'); DistAlias.seed2[daCKey(p[0]) + '|' + daNosp(p[1] || '')] = DistAlias.seed[k]; });
    DistAlias.saved = {};
    (res[1] || []).forEach(x => { if (x && x.id) DistAlias.saved[x.id] = x; });
    daRefresh();
    DistAlias.ready = true;
    if (typeof DistAlias.onReady === 'function') { try { DistAlias.onReady(); } catch (e) {} }
  });
}
DistAlias.load = daLoad;
