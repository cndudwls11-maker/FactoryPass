import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const html=await readFile(resolve(root,'index.html'),'utf8');
const app=await readFile(resolve(root,'app.js'),'utf8');
const routes=JSON.parse(await readFile(resolve(root,'_routes.json'),'utf8'));

test('정적 앱 리소스는 관리자/근로자 하위 경로에서도 루트 절대경로로 해석된다',()=>{
 assert.match(html,/href="\/styles\.css"/);
 assert.match(html,/src="\/app\.js"/);
 for(const pathname of ['/admin','/admin/employees','/admin/scanner','/admin/attendance','/admin/schedules','/admin/statistics','/admin/settings','/employee','/employee/attendance','/employee/profile']){
  assert.equal(new URL('/app.js',`https://factorypass.pages.dev${pathname}`).pathname,'/app.js');
  assert.equal(new URL('/styles.css',`https://factorypass.pages.dev${pathname}`).pathname,'/styles.css');
 }
});

test('Pages Functions routing은 API만 Functions에 포함하고 UI 경로는 정적 파일로 제공한다',async()=>{
 assert.deepEqual(routes.include,['/api/*']);
 assert.deepEqual(routes.exclude,[]);
 assert.match(await readFile(resolve(root,'wrangler.toml'),'utf8'),/pages_build_output_dir\s*=\s*"\."/);
});

test('앱 부팅 시 로딩 watchdog을 해제하고 스크립트/런타임 오류 안내 경로가 있다',()=>{
 assert.match(html,/__factoryPassBootTimer=setTimeout/);
 assert.match(html,/10000\)/);
 assert.match(app,/clearTimeout\(window\.__factoryPassBootTimer\)/);
 assert.match(app,/addEventListener\('error'/);
 assert.match(app,/정적 리소스를 불러오지 못했습니다/);
 assert.match(app,/boot\(\)\.catch/);
});

test('관리자/근로자 경로 모두 직접 URL 라우팅 분기를 갖고 서버 세션을 확인한다',()=>{
 for(const pathname of ['/admin','/admin/employees','/admin/scanner','/admin/attendance','/admin/schedules','/admin/statistics','/admin/settings','/employee','/employee/attendance','/employee/profile'])assert.ok(pathname);
 assert.match(app,/path\.startsWith\('\/admin'\)\|\|path\.startsWith\('\/employee'\)/);
 assert.match(app,/api\('\/auth\/me'\)/);
 assert.match(app,/user\.role!=='admin'/);
});