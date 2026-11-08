import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const app=await readFile(resolve(import.meta.dirname,'../app.js'),'utf8');

test('홈페이지 가입 문구와 승인 안내가 즉시 승인되는 신규 가입 동작과 일치한다',()=>{
 const landing=app.slice(app.indexOf('function landing()'),app.indexOf('function authPage'));
 assert.match(landing,/href="\/signup">회원가입</);
 assert.doesNotMatch(landing,/href="\/signup">근로자 회원가입/);
 assert.match(landing,/관리자가 회사 공용 QR을 발급하고/);
 const signup=app.slice(app.indexOf('function authPage('),app.indexOf('const adminLinks='));
 assert.match(signup,/가입하면 즉시 로그인할 수 있습니다/);
});

test('가입 화면은 비밀번호 확인 입력과 일치 상태를 실시간 표시한다',()=>{
 const start=app.indexOf('function authPage(');
 const end=app.indexOf('const adminLinks=',start);
 const auth=app.slice(start,end);
 assert.match(auth,/id="confirm-feedback"[^>]*aria-live="polite"/);
 assert.match(auth,/password\.addEventListener\('input',updateConfirmation\)/);
 assert.match(auth,/confirm\.addEventListener\('input',updateConfirmation\)/);
 assert.match(auth,/비밀번호가 일치합니다\./);
 assert.match(auth,/비밀번호가 일치하지 않습니다\./);
});

test('근무 일정 UI는 등록된 일정을 편집하고 저장 후 서버에서 다시 조회한다',()=>{
 const start=app.indexOf('async function schedules(');
 const end=app.indexOf('async function statistics(',start);
 assert.ok(start>=0&&end>start);
 const schedules=app.slice(start,end);
 assert.match(schedules,/data-schedule-edit/);
 assert.match(schedules,/근무 일정 수정/);
 assert.match(schedules,/변경 저장/);
 assert.match(schedules,/await api\('\/admin\/schedules',{method:'POST'/);
 assert.match(schedules,/const updated=await api\('\/admin\/schedules'\)/);
});