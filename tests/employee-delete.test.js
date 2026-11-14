import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('격리된 D1에서 직원 삭제는 권한·CSRF를 검증하고 계정/QR만 폐기하며 근태 이력을 보존한다', async () => {
  const bundled = await build({
    stdin: {
      contents: "import {onRequest} from './functions/api/[[path]].js';export default{fetch(request,env){return onRequest({request,env})}}",
      resolveDir: resolve(import.meta.dirname, '..'),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
  });
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-11-07',
    d1Databases: { DB: 'isolated-employee-delete-test' },
    bindings: { INIT_ADMIN_SECRET: 'isolated-delete-test-secret' },
  }));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of ['schema.sql', 'migrations/0004_shared_attendance_qr.sql']) {
      const sql = await readFile(resolve(import.meta.dirname, '..', file), 'utf8');
      await db.exec(sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
    }
    const call = (path, { method = 'GET', cookie, csrf, body } = {}) =>
      mf.dispatchFetch(`https://delete-qa.test/api${path}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    assert.equal((await call('/admin/init', {
      method: 'POST',
      body: { name: '격리 관리자', identity: 'delete-admin', password: 'isolated-delete-admin-123!' },
    })).status, 403, '초기화 시크릿 없는 공개 관리자 생성은 거절');
    const init = await mf.dispatchFetch('https://delete-qa.test/api/admin/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Init-Secret': 'isolated-delete-test-secret' },
      body: JSON.stringify({ name: '격리 관리자', identity: 'delete-admin', password: 'isolated-delete-admin-123!' }),
    });
    assert.equal(init.status, 201);
    const adminLogin = await call('/auth/login', {
      method: 'POST', body: { identity: 'delete-admin', password: 'isolated-delete-admin-123!' },
    });
    const adminData = await adminLogin.json();
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const employeeLogin = await call('/auth/signup', {
      method: 'POST',
      body: {
        name: '격리 테스트 직원', employeeNo: 'DELETE-QA-01', department: '테스트부서',
        identity: 'delete-employee', password: 'isolated-delete-employee-123!',
        confirm: 'isolated-delete-employee-123!', consent: true,
      },
    });
    assert.equal(employeeLogin.status, 201);
    const login = await call('/auth/login', {
      method: 'POST', body: { identity: 'delete-employee', password: 'isolated-delete-employee-123!' },
    });
    const workerCookie = login.headers.get('set-cookie').split(';')[0];
    const workerCsrf = (await login.json()).csrf;
    const employee = await db.prepare("SELECT id FROM users WHERE username='delete-employee'").first();

    await db.prepare('INSERT INTO attendance_records(user_id,work_date,check_in,status) VALUES(?,?,?,?)')
      .bind(employee.id, '2026-11-13', '2026-11-13T01:00:00.000Z', '근무 중').run();
    const record = await db.prepare('SELECT id FROM attendance_records WHERE user_id=?').bind(employee.id).first();
    await db.prepare('INSERT INTO attendance_edit_logs(record_id,editor_id,reason,before_json,after_json) VALUES(?,?,?,?,?)')
      .bind(record.id, 1, '격리 테스트 이력', '{}', '{}').run();
    await db.prepare('INSERT INTO qr_tokens(user_id,work_date,token_hash,expires_at) VALUES(?,?,?,?)')
      .bind(employee.id, '2026-11-13', 'isolated-delete-qr', '2099-01-01T00:00:00.000Z').run();

    const deleteUrl = `/admin/employees/${employee.id}`;
    assert.equal((await call(deleteUrl, { method: 'DELETE', cookie: workerCookie, csrf: workerCsrf, body: {} })).status, 403);
    assert.equal((await call(deleteUrl, { method: 'DELETE', cookie: adminCookie, body: {} })).status, 403);
    assert.equal((await db.prepare('SELECT status FROM users WHERE id=?').bind(employee.id).first()).status, 'approved');

    const deletion = await call(deleteUrl, {
      method: 'DELETE', cookie: adminCookie, csrf: adminData.csrf, body: {},
    });
    assert.equal(deletion.status, 200, await deletion.text());
    assert.equal((await db.prepare('SELECT role,status FROM users WHERE id=?').bind(employee.id).first()).status, 'disabled');
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').bind(employee.id).first()).n, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM qr_tokens WHERE user_id=?').bind(employee.id).first()).n, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM attendance_records WHERE user_id=?').bind(employee.id).first()).n, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM attendance_edit_logs WHERE record_id=?').bind(record.id).first()).n, 1);
    assert.equal((await call('/auth/me', { cookie: workerCookie })).status, 401);
    assert.equal((await call('/auth/login', {
      method: 'POST', body: { identity: 'delete-employee', password: 'isolated-delete-employee-123!' },
    })).status, 403);
    const list = await (await call('/admin/employees?page=1&pageSize=100', { cookie: adminCookie })).json();
    assert.ok(!list.employees.some((item) => item.id === employee.id));
    const filtered = await (await call('/admin/employees?page=1&department=테스트부서', { cookie: adminCookie })).json();
    assert.ok(!filtered.employees.some((item) => item.id === employee.id));

    const admin = await db.prepare("SELECT id FROM users WHERE username='delete-admin'").first();
    const protectedAdmin = await call(`/admin/employees/${admin.id}`, {
      method: 'DELETE', cookie: adminCookie, csrf: adminData.csrf, body: {},
    });
    assert.equal(protectedAdmin.status, 404);
    assert.equal((await db.prepare('SELECT status FROM users WHERE id=?').bind(admin.id).first()).status, 'approved');
  } finally {
    await mf.dispose();
  }
});