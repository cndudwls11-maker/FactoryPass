import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { csvCell } from '../functions/_lib/pagination.js';
import { pages } from '../site.config.mjs';

let mf, db, adminCookie, adminCsrf;
before(async () => {
  const bundled = await build({
    stdin: {
      contents:
        "import {onRequest} from './functions/api/[[path]].js';export default{fetch(request,env){return onRequest({request,env})}}",
      resolveDir: resolve(import.meta.dirname, '..'),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: '2026-11-07',
      d1Databases: { DB: 'isolated-factorypass-test' },
      bindings: { INIT_ADMIN_SECRET: 'local-only-test-admin-initialization' },
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of [
    'schema.sql',
    'migrations/0004_shared_attendance_qr.sql',
  ]) {
    const sql = await readFile(
      resolve(import.meta.dirname, '..', file),
      'utf8',
    );
    await db.exec(sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
  }
  let r = await mf.dispatchFetch('https://qa.test/api/admin/init', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Init-Secret': 'local-only-test-admin-initialization',
    },
    body: JSON.stringify({
      name: 'QA 관리자',
      identity: 'qa-admin',
      password: 'isolated-only-password-123!',
    }),
  });
  assert.equal(r.status, 201, await r.text());
  r = await mf.dispatchFetch('https://qa.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: 'qa-admin',
      password: 'isolated-only-password-123!',
    }),
  });
  adminCookie = r.headers.get('set-cookie').split(';')[0];
  adminCsrf = (await r.json()).csrf;
  const statements = [];
  for (let i = 1; i <= 55; i++)
    statements.push(
      db
        .prepare(
          "INSERT INTO users(role,name,employee_no,department,username,password_hash,status) VALUES('employee',?,?,?,?,?,'approved')",
        )
        .bind(
          `테스트 직원 ${i}`,
          `QA-${String(i).padStart(3, '0')}`,
          i % 2 ? '생산' : '품질',
          `qa-employee-${i}`,
          'unused-test-hash',
        ),
    );
  await db.batch(statements);
});
after(async () => {
  await mf?.dispose();
});
const get = (path, cookie = adminCookie) =>
  mf.dispatchFetch('https://qa.test/api' + path, {
    headers: cookie ? { Cookie: cookie } : {},
  });
test('직원 목록 API는 인증·검색·정렬·페이지 이동을 지원한다', async () => {
  const first = await get('/admin/employees?page=1&pageSize=25'),
    a = await first.json();
  assert.equal(first.status, 200);
  assert.equal(a.employees.length, 25);
  assert.equal(a.pagination.total, 55);
  assert.equal(a.pagination.pages, 3);
  const b = await (await get('/admin/employees?page=2&pageSize=25')).json();
  assert.equal(b.employees.length, 25);
  assert.ok(!a.employees.some((x) => b.employees.some((y) => x.id === y.id)));
  const c = await (await get('/admin/employees?page=3&pageSize=25')).json();
  assert.equal(c.employees.length, 5);
  const search = await (
    await get('/admin/employees?page=1&search=QA-001')
  ).json();
  assert.equal(search.pagination.total, 1);
  assert.equal(search.employees[0].employee_no, 'QA-001');
  const department = await (
    await get(
      '/admin/employees?page=1&department=' + encodeURIComponent('품질'),
    )
  ).json();
  assert.equal(department.pagination.total, 27);
  assert.equal((await get('/admin/employees?page=1', '')).status, 401);
});
test('비정상 페이지 번호·날짜·JSON·쿠키를 4xx로 처리한다', async () => {
  for (const path of [
    '/admin/employees?page=-1',
    '/admin/employees?page=1&pageSize=10000',
    '/admin/attendance?page=1&from=2026-02-30&to=2026-03-01',
    '/admin/attendance?page=1&from=2026-11-13&to=2026-11-01',
  ])
    assert.equal((await get(path)).status, 400, path);
  assert.equal((await get('/auth/me', 'fp_session=%')).status, 401);
  for (const body of ['null', '[]', 'false', '{']) {
    const r = await mf.dispatchFetch('https://qa.test/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(r.status, 400, body);
  }
  const r = await mf.dispatchFetch('https://qa.test/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(17000) }),
  });
  assert.equal(r.status, 413);
});
test('근태 페이지를 바꿔도 기간 전체 집계와 접근 권한이 유지된다', async () => {
  const user = await db
    .prepare("SELECT id FROM users WHERE username='qa-employee-1'")
    .first();
  const sid = 'a'.repeat(64);
  await db
    .prepare(
      'INSERT INTO sessions(id,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',
    )
    .bind(sid, user.id, 'b'.repeat(48), '2099-01-01T00:00:00.000Z')
    .run();
  await db
    .prepare(
      'INSERT INTO shared_qr_sessions(id,token_hash,generation,issued_at,expires_at) VALUES(?,?,?,?,?)',
    )
    .bind(
      'qa-session',
      'qa-hash',
      0,
      '2026-11-13T00:00:00.000Z',
      '2026-11-14T00:00:00.000Z',
    )
    .run();
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const hour = Math.floor(i / 2) + 1,
      claim = 'qa-claim-' + i;
    rows.push(
      db
        .prepare(
          'INSERT INTO shared_qr_claims(id,session_id,user_id,generation,claimed_at,expires_at,used_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(
          claim,
          'qa-session',
          user.id,
          0,
          '2026-11-13T00:00:00.000Z',
          '2026-11-14T00:00:00.000Z',
          '2026-11-13T00:01:00.000Z',
        ),
    );
    rows.push(
      db
        .prepare(
          'INSERT INTO attendance_events(user_id,event_type,occurred_at,work_date,claim_id,request_id) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          user.id,
          i % 2 ? 'out' : 'in',
          `2026-11-13T${String(hour).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00.000Z`,
          '2026-11-13',
          claim,
          crypto.randomUUID(),
        ),
    );
  }
  await db.batch(rows);
  const cookie = 'fp_session=' + sid;
  const a = await (
    await get(
      '/employee/attendance?from=2026-11-13&to=2026-11-13&page=1&pageSize=25',
      cookie,
    )
  ).json();
  const b = await (
    await get(
      '/employee/attendance?from=2026-11-13&to=2026-11-13&page=2&pageSize=25',
      cookie,
    )
  ).json();
  assert.equal(a.records.length, 25);
  assert.equal(b.records.length, 5);
  assert.equal(a.pagination.total, 30);
  assert.deepEqual(a.summary, b.summary);
  assert.equal(a.summary.present, 15);
  assert.equal(a.summary.checkouts, 15);
  assert.equal(a.summary.minutes, 450);
  assert.equal((await get('/admin/employees?page=1', cookie)).status, 403);
  const csrf = await mf.dispatchFetch('https://qa.test/api/admin/shared-qr', {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: '{"enabled":true}',
  });
  assert.equal(csrf.status, 403);
});
test('CSV에서 스프레드시트 수식을 실행할 수 없고 쉼표·따옴표를 보존한다', () => {
  for (const value of [
    '=2+2',
    '+SUM(A1)',
    '-1+2',
    '@SUM(A1)',
    ' \t=cmd',
    '\tvalue',
  ])
    assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell(42), '"42"');
  assert.equal(csvCell('홍, "길동"'), '"홍, ""길동"""');
});
test('실제 D1에서 공용 QR 확인·출근·퇴근·중복 요청 처리를 끝까지 수행한다', async () => {
  const user = await db
      .prepare("SELECT id FROM users WHERE username='qa-employee-2'")
      .first(),
    sid = 'c'.repeat(64),
    csrf = 'd'.repeat(48);
  await db
    .prepare(
      'INSERT INTO sessions(id,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',
    )
    .bind(sid, user.id, csrf, '2099-01-01T00:00:00.000Z')
    .run();
  const post = (path, body, cookie = adminCookie, token = adminCsrf) =>
    mf.dispatchFetch('https://qa.test/api' + path, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
      },
      body: JSON.stringify(body),
    });
  let r = await post('/admin/shared-qr', { enabled: true });
  assert.equal(r.status, 200, await r.text());
  const qr = await (await post('/admin/shared-qr/issue', {})).json();
  assert.ok(qr.token);
  let firstRequest;
  for (const expected of ['in', 'out']) {
    const verified = await post(
      '/employee/qr/verify',
      { token: qr.token },
      'fp_session=' + sid,
      csrf,
    );
    const claim = await verified.json();
    assert.equal(verified.status, 200, JSON.stringify(claim));
    const request = { claimId: claim.claimId, requestId: crypto.randomUUID() };
    const response = await post(
      '/employee/qr/confirm',
      request,
      'fp_session=' + sid,
      csrf,
    );
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.eventType, expected);
    if (!firstRequest) firstRequest = request;
  }
  const repeated = await post(
    '/employee/qr/confirm',
    firstRequest,
    'fp_session=' + sid,
    csrf,
  );
  assert.equal(repeated.status, 409);
  const count = await db
    .prepare('SELECT COUNT(*) n FROM attendance_events WHERE user_id=?')
    .bind(user.id)
    .first();
  assert.equal(count.n, 2);
});
test('모든 경로에 서버가 읽을 수 있는 검색·공유 정보가 있다', async () => {
  for (const [path, [title]] of Object.entries(pages)) {
    const filename = path === '/' ? 'index.html' : path.slice(1) + '.html',
      html = await readFile(
        resolve(import.meta.dirname, '../dist', filename),
        'utf8',
      );
    assert.ok(html.includes(`<title>${title}</title>`), path);
    for (const field of [
      'og:title',
      'og:description',
      'og:site_name" content="FactoryPass',
      'og:image',
      'twitter:card',
      '/assets/favicon.svg',
      '/assets/favicon-48.png',
    ])
      assert.ok(html.includes(field), path);
    if (path !== '/') assert.ok(html.includes('noindex,follow'), path);
  }
  const home = await readFile(
    resolve(import.meta.dirname, '../dist/index.html'),
    'utf8',
  );
  assert.ok(home.includes('<h1>QR코드'));
  assert.match(
    home,
    /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"WebSite","name":"FactoryPass","url":"https:\/\/factorypass\.pages\.dev\/"\}<\/script>/,
  );
  const favicon = await readFile(
    resolve(import.meta.dirname, '../dist/assets/favicon-48.png'),
  );
  assert.equal(favicon.readUInt32BE(16), 48);
  assert.equal(favicon.readUInt32BE(20), 48);
  const errorPage = await readFile(
    resolve(import.meta.dirname, '../dist/404.html'),
    'utf8',
  );
  assert.ok(errorPage.includes('og:site_name" content="FactoryPass'));
  assert.ok(errorPage.includes('/assets/favicon-48.png'));
  assert.ok(!home.includes('fonts.googleapis.com'));
  assert.ok(!home.includes('chart.umd'));
  const robot = await readFile(
    resolve(import.meta.dirname, '../dist/robots.txt'),
    'utf8',
  );
  assert.ok(robot.startsWith('User-agent:'));
  const sitemap = await readFile(
    resolve(import.meta.dirname, '../dist/sitemap.xml'),
    'utf8',
  );
  assert.ok(!sitemap.includes('/admin'));
});
test('확인 시간이 만료되거나 QR 세대가 바뀌어도 새 인증을 시작할 수 있다', async () => {
  const user = await db
      .prepare("SELECT id FROM users WHERE username='qa-employee-3'")
      .first(),
    sid = 'e'.repeat(64),
    csrf = 'f'.repeat(48);
  await db
    .prepare(
      'INSERT INTO sessions(id,user_id,csrf_token,expires_at) VALUES(?,?,?,?)',
    )
    .bind(sid, user.id, csrf, '2099-01-01T00:00:00.000Z')
    .run();
  const post = (path, body, cookie = adminCookie, token = adminCsrf) =>
    mf.dispatchFetch('https://qa.test/api' + path, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
      },
      body: JSON.stringify(body),
    });
  let qr = await (await post('/admin/shared-qr/issue', {})).json();
  const a = await (
    await post(
      '/employee/qr/verify',
      { token: qr.token },
      'fp_session=' + sid,
      csrf,
    )
  ).json();
  assert.ok(a.claimId);
  await db
    .prepare('UPDATE shared_qr_claims SET expires_at=? WHERE id=?')
    .bind(new Date(Date.now() - 1000).toISOString(), a.claimId)
    .run();
  let response = await post(
    '/employee/qr/verify',
    { token: qr.token },
    'fp_session=' + sid,
    csrf,
  );
  const b = await response.json();
  assert.equal(response.status, 200, JSON.stringify(b));
  assert.notEqual(a.claimId, b.claimId);
  await post('/admin/shared-qr', { enabled: true });
  qr = await (await post('/admin/shared-qr/issue', {})).json();
  response = await post(
    '/employee/qr/verify',
    { token: qr.token },
    'fp_session=' + sid,
    csrf,
  );
  const c = await response.json();
  assert.equal(response.status, 200, JSON.stringify(c));
  assert.notEqual(b.claimId, c.claimId);
  const count = await db
    .prepare('SELECT COUNT(*) n FROM attendance_events WHERE user_id=?')
    .bind(user.id)
    .first();
  assert.equal(count.n, 0, 'resolving claims must not create attendance');
});
