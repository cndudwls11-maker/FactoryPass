import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const html=await readFile(resolve(root,'index.html'),'utf8');
const app=await readFile(resolve(root,'app.js'),'utf8');
const api=await readFile(resolve(root,'functions/api/[[path]].js'),'utf8');
const routes=JSON.parse(await readFile(resolve(root,'_routes.json'),'utf8'));

test('정적 앱 리소스는 하위 관리자/근로자 URL에서도 루트 절대경로로 로드된다',()=>{
 assert.match(html,/href="\/styles\.css"/);
 assert.match(html,/src="\/app\.js"/);
 for(const pathname of ['/admin','/admin/devices','/kiosk','/employee/profile']){
  assert.equal(new URL('/app.js',`https://factorypass.pages.dev${pathname}`).pathname,'/app.js');
  assert.equal(new URL('/styles.css',`https://factorypass.pages.dev${pathname}`).pathname,'/styles.css');
 }
});

test('Pages routing은 API 경로만 Functions에 보내고 정적 UI를 유지한다',async()=>{
 assert.deepEqual(routes.include,['/api/*']);
 assert.deepEqual(routes.exclude,[]);
 assert.match(await readFile(resolve(root,'wrangler.toml'),'utf8'),/pages_build_output_dir\s*=\s*"\."/);
});

test('관리자 sidebar 메뉴 순서에 QR 단말기 관리가 있고 기존 순서를 유지한다',()=>{
 const start=app.indexOf('const adminLinks=');
 const end=app.indexOf('employeeLinks=',start);
 const menu=app.slice(start,end);
 const expected=['/admin','/admin/employees','/admin/attendance','/admin/schedules','/admin/statistics','/kiosk','/admin/devices','/admin/settings'];
 let previous=-1;
 for(const path of expected){const index=menu.indexOf(`'${path}'`);assert.ok(index>previous,`${path} should be in sidebar order`);previous=index}
 assert.doesNotMatch(menu,/\/admin\/scanner/);
});

test('단말기 관리 UI는 등록·수정·활성상태·실사용내역 API를 연결한다',()=>{
 const start=app.indexOf('async function devicesPage(');
 const end=app.indexOf('\nasync function schedules(',start);
 assert.ok(start>=0&&end>start);
 const devices=app.slice(start,end);
 assert.match(devices,/\/admin\/devices/);
 assert.match(devices,/method:'PATCH'/);
 assert.match(devices,/activate/);
 assert.match(devices,/deactivate/);
 assert.match(devices,/\/usage/);
 assert.match(devices,/usage_count/);
 assert.match(devices,/등록된 단말기가 없습니다/);
 assert.doesNotMatch(devices,/sample device|test device/i);
});

test('단말기 API는 공통 admin role gate 아래에서만 라우팅된다',()=>{
 const adminStart=api.indexOf("if(p.startsWith('/admin/'))");
 const devicesRoute=api.indexOf("if(p==='/admin/devices'",adminStart);
 assert.ok(adminStart>=0&&devicesRoute>adminStart);
 assert.match(api.slice(adminStart,devicesRoute),/requireRole\(request,env,'admin'\)/);
});

test('Kiosk 화면은 실제 스캔 API를 추가하지 않은 범위 안내 화면이다',()=>{
 const kioskStart=app.indexOf('function kioskPage()');
 const devicesStart=app.indexOf('async function devicesPage(',kioskStart);
 const kiosk=app.slice(kioskStart,devicesStart);
 assert.match(kiosk,/Kiosk 출퇴근 인증/);
 assert.match(kiosk,/다음 개발 단계/);
 assert.match(kiosk,/현재 사용 불가/);
 assert.doesNotMatch(kiosk,/\/api\/kiosk|USB HID|scanToken/);
});

test('모바일 QR 인증 페이지는 로그인 후 안전한 fragment 경로로 복귀하고 출퇴근 저장 API를 제공하지 않는다',()=>{
 assert.match(app,/path==='\/employee\/verify'/);
 assert.match(app,/sessionStorage\.setItem\('fp_pending_verify'/);
 assert.match(app,/safeVerifyReturn/);
 assert.match(app,/verifyUrl/);
 assert.doesNotMatch(app,/\/employee\/qr\/confirm/);
});

test('이전 QR 스캐너 코드는 보존되고 직접 URL은 관리자 안내 화면을 사용한다',()=>{
 assert.match(app,/async function legacyCameraScanner\(/);
 assert.match(app,/function scanner\(v\)/);
 assert.match(app,/path==='\/admin\/scanner'/);
 assert.match(app,/scanner\(v\)/);
});