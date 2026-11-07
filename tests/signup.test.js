import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/[[path]].js';

function makeEnv({userColumns,uniqueColumn,insertError,dbFailure=false}={}){
 const inserted=[];let selectCount=0;
 const env={DB:{prepare(sql){return{sql,values:[],bind(...values){this.values=values;return this},async first(){if(this.sql.includes('SELECT id FROM departments'))return null;if(this.sql.includes('SELECT'))return null;return null},async run(){if(this.sql.startsWith('INSERT INTO users')){if(dbFailure)throw Object.assign(new Error('D1 database is unavailable'),{code:'D1_ERROR'});if(userColumns){const columns=this.sql.match(/INSERT INTO users\(([^)]+)\)/)?.[1].split(',').map(x=>x.trim())||[];const missing=columns.filter(c=>!userColumns.includes(c));if(missing.length)throw Object.assign(new Error(`table users has no column named ${missing[0]}`),{code:'SQLITE_ERROR'});}if(uniqueColumn)throw Object.assign(new Error(`UNIQUE constraint failed: users.${uniqueColumn}`),{code:'SQLITE_CONSTRAINT_UNIQUE'});if(insertError)throw insertError;inserted.push({sql:this.sql,values:this.values});return{success:true,meta:{changes:1}}}throw new Error(`Unexpected SQL: ${this.sql}`)}}}}};
 return{env,inserted,get selectCount(){return selectCount}}
}
const validBody={name:'홍길동',employeeNo:'FP-2001',department:'생산팀',identity:'worker@example.com',password:'very-secure-pass',confirm:'very-secure-pass',consent:true};
function request(body){return new Request('https://factorypass.test/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
async function signup(env,body=validBody){const response=await onRequest({request:request(body),env});return{response,payload:await response.json()}}

test('회원가입은 users 실제 컬럼에 insert하고 pending으로 응답한다',async()=>{
 const{env,inserted}=makeEnv({userColumns:['role','name','employee_no','department_id','department','email','username','password_hash','status','id','created_at','updated_at']});const{response,payload}=await signup(env);
 assert.equal(response.status,201);assert.deepEqual(payload,{ok:true,status:'pending'});assert.equal(inserted.length,1);assert.match(inserted[0].sql,/INSERT INTO users\(role,name,employee_no,department_id,department,email,username,password_hash,status\)/);assert.equal(inserted[0].values.length,7);assert.equal(inserted[0].values[0],'홍길동');assert.equal(inserted[0].values[1],'FP-2001');assert.equal(inserted[0].values[4],'worker@example.com');assert.equal(inserted[0].values[5],null);assert.match(inserted[0].values[6],/^pbkdf2\$310000\$/);
});

for(const column of ['employee_no','email','username'])test(`users.${column} UNIQUE 충돌만 409 중복으로 처리한다`,async()=>{const{env}=makeEnv({uniqueColumn:column});const{response,payload}=await signup(env);assert.equal(response.status,409);assert.match(payload.error,/이미 등록/)});

test('테이블/컬럼 오류는 중복으로 오인하지 않고 안전한 500을 반환한다',async()=>{const{env}=makeEnv({userColumns:['id','role','name']});const{response,payload}=await signup(env);assert.equal(response.status,500);assert.equal(payload.error,'서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');assert.doesNotMatch(JSON.stringify(payload),/SQLITE|password_hash|users\./)});

test('NOT NULL 제약 오류는 중복 오류로 분류하지 않는다',async()=>{const{env}=makeEnv({insertError:Object.assign(new Error('NOT NULL constraint failed: users.password_hash'),{code:'SQLITE_CONSTRAINT_NOTNULL'})});const{response,payload}=await signup(env);assert.equal(response.status,500);assert.doesNotMatch(JSON.stringify(payload),/NOT NULL|password_hash/)});

test('D1 연결/SQL 오류는 중복으로 처리하지 않고 상세 정보는 서버 로그에만 기록한다',async()=>{const{env}=makeEnv({dbFailure:true});const original=console.error;let log='';console.error=(message)=>{log=String(message)};try{const{response,payload}=await signup(env);assert.equal(response.status,500);assert.equal(payload.error,'서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');assert.match(log,/D1 database is unavailable/);assert.doesNotMatch(JSON.stringify(payload),/D1 database|SQL/)}finally{console.error=original}});

test('필수값 검증 오류는 INSERT 전 400으로 반환한다',async()=>{const{env,inserted}=makeEnv();const{response,payload}=await signup(env,{...validBody,employeeNo:''});assert.equal(response.status,400);assert.match(payload.error,/필수 입력값/);assert.equal(inserted.length,0)});

test('회원가입은 로그인 세션이나 CSRF 토큰 없이 허용된 공개 POST다',async()=>{const{env}=makeEnv();const response=await onRequest({request:request(validBody),env});assert.equal(response.status,201)});

test('인증/CSRF 검증 함수는 세션 없는 보호 API 요청을 거절한다',async()=>{const response=await onRequest({request:new Request('https://factorypass.test/api/admin/employees',{method:'GET'}),env:makeEnv().env});assert.equal(response.status,401);assert.match((await response.json()).error,/로그인/)});

test('D1 binding 누락은 503으로 구별하며 내부 세부를 노출하지 않는다',async()=>{const response=await onRequest({request:request(validBody),env:{}});assert.equal(response.status,503);assert.equal((await response.json()).error,'D1 데이터베이스 바인딩이 설정되지 않았습니다.')});