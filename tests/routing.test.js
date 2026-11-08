import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const html=await readFile(resolve(root,'index.html'),'utf8');
const app=await readFile(resolve(root,'app.js'),'utf8');
const api=await readFile(resolve(root,'functions/api/[[path]].js'),'utf8');
const routes=JSON.parse(await readFile(resolve(root,'_routes.json'),'utf8'));

test('정적 앱 리소스는 관리자/근로자 하위 경로에서 루트 절대경로로 해석된다',()=>{
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

test('앱 부팅 시 watchdog을 해제하고 로딩 실패 안내 경로가 있다',()=>{
 assert.match(html,/__factoryPassBootTimer=setTimeout/);
 assert.match(html,/10000\)/);
 assert.match(app,/clearTimeout\(window\.__factoryPassBootTimer\)/);
 assert.match(app,/addEventListener\('error'/);
 assert.match(app,/boot\(\)\.catch/);
});

test('관리자 메뉴 순서와 Kiosk 새 탭, 스캐너 메뉴 제거가 반영된다',()=>{
 const start=app.indexOf('const adminLinks=');
 const end=app.indexOf('employeeLinks=',start);
 const menu=app.slice(start,end);
 const expected=['/admin','/admin/employees','/admin/attendance','/admin/schedules','/admin/statistics','/kiosk','/admin/devices','/admin/settings'];
 let previous=-1;
 for(const path of expected){const index=menu.indexOf(`'${path}'`);assert.ok(index>previous,`${path} should be in requested sidebar order`);previous=index}
 assert.doesNotMatch(menu,/\/admin\/scanner/);
 assert.match(menu,/new-tab/);
 assert.match(app,/target="_blank" rel="noopener noreferrer"/);
});

test('Kiosk는 안내 화면만 표시하고 인증/출퇴근 API를 호출하지 않는다',()=>{
 const kioskStart=app.indexOf('function kioskPage()');
 const devicesStart=app.indexOf('function devicesPage(',kioskStart);
 assert.ok(kioskStart>=0&&devicesStart>kioskStart);
 const kiosk=app.slice(kioskStart,devicesStart);
 assert.match(kiosk,/FACTORYPASS KIOSK/);
 assert.match(kiosk,/role="status"/);
 assert.doesNotMatch(kiosk,/\/admin\/scan|attendance_records|\/api\/employee/);
});

test('단말기 화면은 안내/빈 상태만 표시하며 가짜 연결 상태를 만들지 않는다',()=>{
 const start=app.indexOf('function devicesPage(');
 const end=app.indexOf('async function schedules(',start);
 assert.ok(start>=0&&end>start);
 const devices=app.slice(start,end);
 assert.match(devices,/QR 단말기 관리/);
 assert.match(devices,/등록된 단말기를 관리하는 공간입니다/);
 assert.match(devices,/단말기 등록 및 인증 기능은 다음 단계에서 추가 예정/);
 assert.match(devices,/등록된 단말기가 없습니다/);
 assert.doesNotMatch(devices,/Device-|온라인|접속 중|lastSeen/);
});

test('기존 스캐너 구현은 보존되고 direct URL은 안내하며 devices는 관리자 보호 경로다',()=>{
 assert.match(app,/async function legacyCameraScanner\(/);
 assert.match(app,/function scanner\(v\)/);
 assert.match(app,/기존 QR 스캐너/);
 assert.match(app,/\/admin\/scanner/);
 assert.match(app,/\/admin\/devices/);
 const adminGate=app.slice(app.indexOf("if(path.startsWith('/admin')"),app.indexOf('let title=',app.indexOf("if(path.startsWith('/admin')")));
 assert.match(adminGate,/user\.role!=='admin'/);
 assert.match(api,/p\.startsWith\('\/admin\/'\)\)\{const u=await requireRole\(request,env,'admin'\)/);
});