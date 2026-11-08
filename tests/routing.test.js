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
 for(const pathname of ['/admin','/admin/shared-qr','/employee/profile']){
  assert.equal(new URL('/app.js',`https://factorypass.pages.dev${pathname}`).pathname,'/app.js');
  assert.equal(new URL('/styles.css',`https://factorypass.pages.dev${pathname}`).pathname,'/styles.css');
 }
});

test('Pages routing은 API 경로만 Functions에 보내고 정적 UI를 유지한다',async()=>{
 assert.deepEqual(routes.include,['/api/*']);
 assert.deepEqual(routes.exclude,[]);
 assert.match(await readFile(resolve(root,'wrangler.toml'),'utf8'),/pages_build_output_dir\s*=\s*"\."/);
});

test('관리자 sidebar에 공용 QR과 기존 운영 메뉴가 표시된다',()=>{
 const start=app.indexOf('const adminLinks=');
 const end=app.indexOf('];',start)+1;
 const menu=app.slice(start,end);
 const expected=['/admin','/admin/employees','/admin/attendance','/admin/schedules','/admin/statistics','/admin/shared-qr','/admin/settings'];
 let previous=-1;
 for(const path of expected){const index=menu.indexOf(`'${path}'`);assert.ok(index>previous,`${path} should be in sidebar order`);previous=index}
 assert.doesNotMatch(menu,/\/admin\/(scanner|devices)/);
});

test('단말기 관리·독립 키오스크와 공용 PC 표시 키 안내는 제거되고 관리자 QR 표시는 유지된다',()=>{
 assert.doesNotMatch(app,/devicesPage|\/admin\/devices|kioskPage|href="\/kiosk"|\bscanner\(view\)|Kiosk 방식|\/admin\/scanner/);
 assert.doesNotMatch(api,/\/admin\/devices|qr_devices|qr_device_usage_logs|attendance-display\/issue|isDeviceCodeConflict/);
 assert.match(app,/async function sharedQrAdmin\(/);
 const start=app.indexOf('async function sharedQrAdmin('),end=app.indexOf('async function settings(',start);
 const adminQr=app.slice(start,end);
 assert.doesNotMatch(adminQr,/shared-display-open|공용 PC 화면 열기|공용 PC에는|표시 키|display-key|attendance-display|window\.open/);
 assert.match(adminQr,/\/admin\/shared-qr\/issue/);
 assert.match(adminQr,/new QRCode\(/);
 assert.match(adminQr,/setInterval\(tick,250\)/);
 assert.match(app,/async function employeeVerifyPage\(/);
 assert.match(app,/path==='\/employee\/verify'/);
});

test('주요 출퇴근 UI는 관리자 공용 QR과 근로자 최종 확인 페이지다',()=>{
 assert.match(app,/async function sharedQrAdmin\(/);
 assert.match(app,/async function employeeVerifyPage\(/);
 assert.match(app,/path==='\/employee\/verify'/);
});

test('관리자 공용 QR API는 관리자 인증과 CSRF 보호를 유지한다',()=>{
 const handleStart=api.indexOf('async function handle(');
 const handle=api.slice(handleStart,api.indexOf('export async function onRequest'));
 assert.ok(handleStart>=0);
 assert.ok(handle.includes("requireRole(request,env,'admin')"),'admin routes must require an admin session');
 assert.ok(handle.indexOf("p==='/admin/shared-qr'")>handle.indexOf("requireRole(request,env,'admin')"),'shared QR endpoints must follow the admin gate');
 assert.ok(handle.includes('assertCsrf(request,u)'),'admin mutations must retain CSRF validation');
});

test('관리자 화면에서 공용 QR을 직접 표시하고 30초 정책을 따른다',()=>{
 const start=app.indexOf('async function sharedQrAdmin(');
 const end=app.indexOf('async function settings(',start);
 const adminQr=app.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(adminQr,/\/admin\/shared-qr\/issue/);
 assert.match(adminQr,/new QRCode\(/);
 assert.match(adminQr,/30초/);
 assert.match(adminQr,/expiresAt/);
 assert.match(adminQr,/clearDisplay/);
});

test('모바일 공용 QR 인증 페이지는 로그인 복귀와 최종 확인 저장을 지원한다',()=>{
 assert.match(app,/path==='\/employee\/verify'/);
 assert.match(app,/sessionStorage\.setItem\('fp_pending_verify'/);
 assert.match(app,/safeVerifyReturn/);
 assert.match(app,/verifyUrl/);
 assert.match(app,/\/employee\/qr\/confirm/);
});

test('모바일 QR 확인 버튼은 직원 계정 기반 최종 출퇴근 확인을 저장한다',()=>{
 const start=app.indexOf('async function employeeVerifyPage(');
 const end=app.indexOf('async function boot(',start);
 const verify=app.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(verify,/confirm\.addEventListener\('click'/);
 assert.match(verify,/출퇴근 인증을 저장하고 있습니다/);
 assert.match(verify,/crypto\.randomUUID\(\)/);
 assert.match(verify,/aria-live="polite"/);
 assert.match(verify,/\/employee\/qr\/confirm/);
});

test('모바일 QR 인증 오류는 QR 만료·운영 중지·유예시간 만료를 구분한다',()=>{
 const start=app.indexOf('async function employeeVerifyPage(');
 const end=app.indexOf('async function boot(',start);
 const verify=app.slice(start,end);
 assert.match(verify,/공용 QR이 만료되었습니다/);
 assert.match(verify,/공용 QR이 중지되었습니다/);
 assert.match(verify,/인증 유예시간이 만료되었습니다/);
 assert.match(verify,/JSON\.stringify\(\{token\}\)/);
});
