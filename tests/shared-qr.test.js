import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {confirmSharedAttendance,createDisplayKey,issueDisplayQr,issueSharedQr,setSharedQrEnabled,sharedQrStatus,verifySharedQr} from '../functions/_lib/shared-qr.js';
import {onRequest} from '../functions/api/[[path]].js';

const root=resolve(import.meta.dirname,'..');
const migration=await readFile(resolve(root,'migrations/0004_shared_attendance_qr.sql'),'utf8');

function database(){
 const state={users:new Map(),control:{id:1,enabled:0,generation:0,updated_at:null},keys:[],sessions:[],claims:[],events:[],states:new Map(),legacy:[],sessionRows:[]};
 for(const [id,role,name,employee_no,department,email] of [[1,'admin','관리자',null,null,'admin@example.test'],[2,'employee','근로자 A','FP-A','생산','a@example.test'],[3,'employee','근로자 B','FP-B','생산','b@example.test']])state.users.set(id,{id,role,name,employee_no,department,email,status:'approved'});

 const prepare=sql=>({
  sql,values:[],
  bind(...values){this.values=values;return this;},
  async first(){return execute(sql,this.values,'first');},
  async all(){return{results:await execute(sql,this.values,'all')};},
  async run(){const result=await execute(sql,this.values,'run');assert.equal(typeof result.changes,'number',`D1 meta.changes for ${sql}`);return{meta:{changes:result.changes,last_row_id:result.lastRowId??null}};}
 });

 async function execute(sql,v,mode){
  if(sql.startsWith('UPDATE shared_qr_claims SET used_at=? WHERE user_id=?')){
   const [resolvedAt,userId,cutoff,generation]=v;let changes=0;
   for(const claim of state.claims){const session=state.sessions.find(s=>s.id===claim.session_id);if(claim.user_id===userId&&!claim.used_at&&(claim.expires_at<=cutoff||claim.generation!==generation||session?.revoked_at)){claim.used_at=resolvedAt;changes++;}}
   return{changes};
  }
  if(sql.startsWith('UPDATE shared_qr_control')){
   state.control={id:1,enabled:v[0],generation:state.control.generation+1,updated_by:v[1],updated_at:v[2]};
   state.sessions=state.sessions.map(x=>({...x,revoked_at:v[2]}));
   return{changes:1};
  }

  if(sql.startsWith('SELECT enabled,generation,updated_at FROM shared_qr_control'))return{...state.control,enabled:Number(state.control.enabled)};
  if(sql.startsWith('INSERT INTO shared_qr_sessions')){
    const display=sql.includes('shared_qr_display_keys');
   assert.match(sql,/INSERT INTO shared_qr_sessions\(id,token_hash,generation,issued_at,expires_at,created_by\) SELECT \?,\?,\?,\?,\?,\?/);
    assert.equal(v.length,display?9:7,`shared_qr_sessions binding count (display=${display})`);
   const [id,tokenHash,generation,issuedAt,expiresAt,createdBy]=v;
   const displayKeyId=display?v[6]:null,now=display?v[7]:null,generationBind=v[display?8:6];
    assert.equal(v[5],createdBy,'created_by bind');
    if(display)assert.equal(v[6],state.keys.find(x=>x.id===v[6])?.id,'display key id bind');
    assert.equal(generationBind,state.control.generation,'generation bind');
   const key=displayKeyId&&state.keys.find(x=>x.id===displayKeyId&&!x.revoked_at&&x.expires_at>now);
   if(state.control.enabled!==1||state.control.generation!==generation||generation!==generationBind||(displayKeyId&&!key))return{changes:0};
   assert.match(tokenHash,/^[a-f\d]{64}$/i,'session stores only token hash');
   if(state.sessions.some(x=>x.id===id||x.token_hash===tokenHash))throw new Error('UNIQUE constraint failed: shared_qr_sessions.token_hash');
   state.sessions.push({id,token_hash:tokenHash,generation,issued_at:issuedAt,expires_at:expiresAt,created_by:createdBy,revoked_at:null});
   return{changes:1};
  }
  if(sql.startsWith('INSERT INTO shared_qr_display_keys')){
   assert.equal(v.length,5);
   state.keys.push({id:v[0],key_hash:v[1],created_by:v[2],created_at:v[3],expires_at:v[4],revoked_at:null});
   return{changes:1};
  }
  if(sql.includes('UPDATE shared_qr_display_keys')){
   let changes=0;
   for(const key of state.keys)if(!key.revoked_at){key.revoked_at=v[0];changes++;}
   return{changes};
  }
   if(sql.startsWith('SELECT id FROM shared_qr_display_keys'))return state.keys.find(x=>x.key_hash===v[0]&&!x.revoked_at&&x.expires_at>v[1])||null;
  if(sql.startsWith('SELECT key_hash FROM shared_qr_display_keys'))return state.keys.map(x=>({key_hash:x.key_hash}));
  if(sql.includes('FROM shared_qr_display_keys'))return state.keys.find(x=>x.key_hash===v[0]&&!x.revoked_at&&x.expires_at>v[1])||null;

  if(sql.startsWith('INSERT INTO shared_qr_claims')){
   const [id,sessionId,userId,generation,claimedAt,expiresAt,sessionRowId,hash,now]=v;
   assert.equal(v.length,9,'shared_qr_claims binding count');
   assert.equal(sessionId,sessionRowId,'claim session id matches scoped session id');
   assert.match(hash,/^[a-f\d]{64}$/i,'claim existence check uses token hash');
   const session=state.sessions.find(x=>x.id===sessionRowId&&x.token_hash===hash&&!x.revoked_at&&x.expires_at>now&&state.control.enabled===1&&x.generation===state.control.generation&&x.generation===generation);
   if(!session)return{changes:0};
   if(state.claims.some(x=>x.user_id===userId&&!x.used_at))return{changes:0};
   if(state.claims.some(x=>x.id===id))throw new Error('UNIQUE constraint failed: shared_qr_claims.id');
   state.claims.push({id,session_id:sessionId,user_id:userId,generation,claimed_at:claimedAt,expires_at:expiresAt,used_at:null,request_id:null});
   if(!state.states.has(userId)){
    const legacy=state.legacy.find(x=>x.user_id===userId);
    state.states.set(userId,{last_type:legacy?.check_out?'out':legacy?.check_in?'in':null,last_at:legacy?.check_out||legacy?.check_in||null,revision:0});
   }
   return{changes:1};
  }

  if(sql.startsWith('INSERT INTO sessions')){
   assert.equal(v.length,4);
   state.sessionRows.push({id:v[0],user_id:v[1],csrf_token:v[2],expires_at:v[3]});
   return{changes:1};
  }
  if(sql.includes('FROM sessions s JOIN users u')){
   const session=state.sessionRows.find(x=>x.id===v[0]&&x.expires_at>v[1]);
   const user=session&&state.users.get(session.user_id);
   return user?{...user,csrf_token:session.csrf_token}:null;
  }
  if(sql.includes('FROM shared_qr_sessions s JOIN shared_qr_control'))return state.sessions.filter(x=>x.token_hash===v[0]).map(x=>({...x,enabled:state.control.enabled,current_generation:state.control.generation}))[0]||null;
  if(sql.includes('FROM shared_qr_claims c JOIN shared_qr_sessions s')){
    const claim=state.claims.find(x=>x.id===v[0]&&x.user_id===v[1]);
    const session=claim&&state.sessions.find(x=>x.id===claim.session_id);
   return claim&&session?{...claim,revoked_at:session.revoked_at,session_generation:session.generation,enabled:state.control.enabled,current_generation:state.control.generation}:null;
   }
   if(sql.includes('FROM shared_qr_claims')&&sql.includes('used_at IS NULL'))return state.claims.filter(x=>x.user_id===v[0]&&!x.used_at&&x.expires_at>v[1]).sort((a,b)=>b.claimed_at.localeCompare(a.claimed_at))[0]||null;
  if(sql.includes('FROM attendance_event_state')){const row=state.states.get(v[0]);return row?{last_type:row.last_type,event_type:row.last_type,occurred_at:row.last_at}:null;}
  if(sql.startsWith('SELECT COUNT(*) n FROM attendance_events'))return{n:state.events.length};
  if(sql.includes('FROM attendance_events WHERE request_id='))return state.events.find(x=>x.request_id===v[0]&&x.user_id===v[1])||null;
  if(sql.includes('FROM attendance_events WHERE user_id=? ORDER BY occurred_at DESC'))return state.events.filter(x=>x.user_id===v[0]).sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)||b.id-a.id)[0]||null;
  if(sql.includes('FROM attendance_records WHERE user_id=?'))return state.legacy.filter(x=>x.user_id===v[0]).sort((a,b)=>b.work_date.localeCompare(a.work_date))[0]||null;
  if(sql.startsWith('SELECT id FROM departments')||sql.startsWith('SELECT id FROM holidays'))return null;
  throw new Error(`Unexpected D1 ${mode} query: ${sql} [${JSON.stringify(v)}]`);
 }

 const DB={prepare,async batch(statements){
  const backup=structuredClone(state),results=[];
  try{
   for(const query of statements){
    let changes=0;
    if(query.sql.startsWith('UPDATE shared_qr_claims')){
     const [usedAt,requestId,id,userId,now]=query.values;
     const claim=state.claims.find(x=>x.id===id&&x.user_id===userId&&!x.used_at&&x.expires_at>now);
     const session=claim&&state.sessions.find(x=>x.id===claim.session_id&&!x.revoked_at);
      if(claim&&session&&state.control.enabled===1&&session.generation===state.control.generation&&claim.generation===state.control.generation){claim.used_at=usedAt;claim.request_id=requestId;changes=1;}
    }else if(query.sql.startsWith('UPDATE attendance_event_state')){
     const [lastAt,userId,claimId,owner,usedAt]=query.values;
     const claim=state.claims.find(x=>x.id===claimId&&x.user_id===owner&&x.used_at===usedAt);
     const eventState=state.states.get(userId);
      if(claim&&eventState){const eventType=eventState.last_type==='in'?'out':'in';eventState.last_type=eventType;eventState.last_at=lastAt;eventState.revision++;query.returningRow={last_type:eventType};changes=1;}
    }else if(query.sql.startsWith('INSERT INTO attendance_events')){
     const [userId,occurredAt,workDate,sessionId,claimId,requestId,owner,lastAt]=query.values;
     const eventState=state.states.get(owner);
     const claim=state.claims.find(x=>x.id===claimId&&x.user_id===owner&&x.used_at===lastAt);
     if(eventState&&eventState.last_at===lastAt&&claim&&userId===owner){
      if(state.events.some(x=>x.claim_id===claimId||x.request_id===requestId))throw new Error('UNIQUE constraint failed: attendance_events.claim_id');
      state.events.push({id:state.events.length+1,user_id:userId,event_type:eventState.last_type,occurred_at:occurredAt,work_date:workDate,shared_qr_session_id:sessionId,claim_id:claimId,request_id:requestId});
      changes=1;
     }
    }
     results.push({meta:{changes},...(query.returningRow?{results:[query.returningRow]}:{})});
   }
   return results;
  }catch(error){
   for(const key of Object.keys(state))delete state[key];
   Object.assign(state,backup);
   throw error;
  }
 }};
 return{env:{DB},state};
}

test('migration은 기존 attendance_records 데이터를 보존하고 반복 이벤트 테이블과 인덱스를 추가한다',()=>{
 const ctx=database();
 assert.ok(ctx.state.legacy);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS attendance_events/);
 assert.match(migration,/request_id TEXT NOT NULL UNIQUE/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS attendance_event_state/);
});

test('관리자만 공용 QR을 활성화·중지하고 비관리자 API는 차단된다',async()=>{
 const ctx=database(),admin={id:1,role:'admin',status:'approved'},initial=await sharedQrStatus(ctx.env);
 assert.equal(initial.enabled,false);
 await assert.rejects(()=>issueSharedQr(ctx.env,admin,'https://factorypass.pages.dev'),error=>error.status===423);
 await setSharedQrEnabled(ctx.env,admin,true);
 const active=await issueSharedQr(ctx.env,admin,'https://factorypass.pages.dev',new Date('2026-11-09T00:00:00.000Z'));
 assert.match(active.verifyUrl,/\/employee\/verify#t=[a-f\d]{64}$/);
 assert.equal(active.expiresAt,'2026-11-09T15:00:00.000Z');
 assert.ok(active.rotationSeconds>0&&active.rotationSeconds<=86400);
 await setSharedQrEnabled(ctx.env,admin,false);
 await assert.rejects(()=>verifySharedQr(ctx.env,{id:2,role:'employee',status:'approved'},active.token),error=>error.status===423);
});

test('기존 선택형 공용 QR 표시 키는 hash 저장과 중지 처리를 유지한다',async()=>{
 const ctx=database(),admin={id:1,role:'admin',status:'approved'};
 await setSharedQrEnabled(ctx.env,admin,true);
 const key=await createDisplayKey(ctx.env,admin),stored=await ctx.env.DB.prepare('SELECT key_hash FROM shared_qr_display_keys').first();
 assert.notEqual(stored.key_hash,key.key);
 const issued=await issueDisplayQr(ctx.env,key.key,'https://factorypass.pages.dev');
 assert.match(issued.verifyUrl,/^https:\/\//);
 await new Promise(resolve=>setTimeout(resolve,5));
 await setSharedQrEnabled(ctx.env,admin,false);
  await assert.rejects(()=>issueDisplayQr(ctx.env,key.key,'https://factorypass.pages.dev'),error=>error.status===401);
});

test('같은 30초 QR을 직원 둘이 인증하고 각각 독립 이벤트를 저장한다',async()=>{
 const ctx=database(),admin={id:1,role:'admin',status:'approved'},a={id:2,role:'employee',name:'근로자 A',employee_no:'FP-A',department:'생산',status:'approved'},b={id:3,role:'employee',name:'근로자 B',employee_no:'FP-B',department:'생산',status:'approved'},now=new Date('2026-11-09T00:00:00Z');
 await setSharedQrEnabled(ctx.env,admin,true,now);
 const qr=await issueSharedQr(ctx.env,admin,'https://factorypass.pages.dev',now);
 const [claimA,claimB]=await Promise.all([verifySharedQr(ctx.env,a,qr.token,new Date(now.getTime()+3000)),verifySharedQr(ctx.env,b,qr.token,new Date(now.getTime()+8000))]);
 assert.notEqual(claimA.claimId,claimB.claimId);
 const requestA=randomUUID(),requestB=randomUUID();
 const [resultA,resultB]=await Promise.all([confirmSharedAttendance(ctx.env,a,{claimId:claimA.claimId,requestId:requestA},new Date(now.getTime()+9000)),confirmSharedAttendance(ctx.env,b,{claimId:claimB.claimId,requestId:requestB},new Date(now.getTime()+12000))]);
 assert.equal(resultA.eventType,'in');
 assert.equal(resultB.eventType,'in');
 assert.equal((await ctx.env.DB.prepare('SELECT COUNT(*) n FROM attendance_events').first()).n,2);
});

test('QR 세션 날짜 만료, claim 유예시간 만료, 운영 중지는 각각 거부된다',async()=>{
 const ctx=database(),admin={id:1,role:'admin',status:'approved'},user={id:2,role:'employee',name:'근로자 A',employee_no:'FP-A',department:'생산',status:'approved'},now=new Date('2026-11-09T14:00:00Z');
 await setSharedQrEnabled(ctx.env,admin,true,now);
 const qr=await issueSharedQr(ctx.env,admin,'https://factorypass.pages.dev',now);
 await assert.rejects(()=>verifySharedQr(ctx.env,user,qr.token,new Date('2026-11-09T15:00:00.000Z')),error=>error.status===410);
 const claim=await verifySharedQr(ctx.env,user,qr.token,new Date(now.getTime()+1000));
 await assert.rejects(()=>confirmSharedAttendance(ctx.env,user,{claimId:claim.claimId,requestId:randomUUID()},new Date(now.getTime()+62000)),error=>error.status===410);
 const nextClaim=await verifySharedQr(ctx.env,user,qr.token,new Date(now.getTime()+2000));
 await setSharedQrEnabled(ctx.env,admin,false,new Date(now.getTime()+3000));
 await assert.rejects(()=>confirmSharedAttendance(ctx.env,user,{claimId:nextClaim.claimId,requestId:randomUUID()},new Date(now.getTime()+4000)),error=>error.status===423);
});

test('한 사용자의 활성 claim 재사용과 같은 confirm 요청 재전송을 거부한다',async()=>{
 const ctx=database(),admin={id:1,role:'admin',status:'approved'},user={id:2,role:'employee',name:'근로자 A',employee_no:'FP-A',department:'생산',status:'approved'},now=new Date('2026-11-09T00:00:00Z');
 await setSharedQrEnabled(ctx.env,admin,true,now);
 const qr=await issueSharedQr(ctx.env,admin,'https://factorypass.pages.dev',now),claim=await verifySharedQr(ctx.env,user,qr.token,new Date(now.getTime()+1000));
 const repeatedClaim=await verifySharedQr(ctx.env,user,qr.token,new Date(now.getTime()+2000));
 assert.equal(repeatedClaim.claimId,claim.claimId,'re-scan of the same active QR reuses the existing claim');
 const requestId=randomUUID();
 assert.equal((await confirmSharedAttendance(ctx.env,user,{claimId:claim.claimId,requestId},new Date(now.getTime()+3000))).eventType,'in');
 await assert.rejects(()=>confirmSharedAttendance(ctx.env,user,{claimId:claim.claimId,requestId},new Date(now.getTime()+4000)),error=>error.status===409);
});

test('이벤트 상태는 in/out/in/out 순환하고 자정 이후에도 마지막 이벤트를 따른다',async()=>{
 const ctx=database(),admin={id:1,role:'admin',status:'approved'},user={id:2,role:'employee',name:'근로자 A',employee_no:'FP-A',department:'생산',status:'approved'},now=new Date('2026-11-09T14:59:40Z');
 await setSharedQrEnabled(ctx.env,admin,true,now);
 const results=[];
 for(let i=0;i<4;i++){
  const issued=await issueSharedQr(ctx.env,admin,'https://factorypass.pages.dev',new Date(now.getTime()+i*30000));
  const scannedAt=new Date(now.getTime()+i*30000+1000),claim=await verifySharedQr(ctx.env,user,issued.token,scannedAt);
  results.push(await confirmSharedAttendance(ctx.env,user,{claimId:claim.claimId,requestId:randomUUID()},new Date(scannedAt.getTime()+1000)));
 }
 assert.deepEqual(results.map(result=>result.eventType),['in','out','in','out']);
 assert.notEqual(results[0].workDate,results[1].workDate);
});

test('same-day QR expires at midnight and cannot create attendance events on the next Seoul date',async()=>{
 const ctx=database(),admin={id:1,role:'admin',status:'approved'},user={id:2,role:'employee',name:'근로자 A',employee_no:'FP-A',department:'생산',status:'approved'},issuedAt=new Date('2026-11-09T14:59:59.000Z');
 await setSharedQrEnabled(ctx.env,admin,true,issuedAt);
 const qr=await issueSharedQr(ctx.env,admin,'https://factorypass.pages.dev',issuedAt);
 assert.equal(qr.expiresAt,'2026-11-09T15:00:00.000Z');
 const claim=await verifySharedQr(ctx.env,user,qr.token,issuedAt);
 assert.equal(claim.claimExpiresAt,qr.expiresAt);
 await assert.rejects(()=>confirmSharedAttendance(ctx.env,user,{claimId:claim.claimId,requestId:randomUUID()},new Date('2026-11-09T15:00:00.000Z')),error=>error.status===410);
 assert.equal(ctx.state.events.length,0);
});

test('same-day QR expires at midnight and cannot create attendance events on the next Seoul date',async()=>{
 const ctx=database(),admin={id:1,role:'admin',status:'approved'},user={id:2,role:'employee',name:'근로자 A',employee_no:'FP-A',department:'생산',status:'approved'},issuedAt=new Date('2026-11-09T14:59:59.000Z');
 await setSharedQrEnabled(ctx.env,admin,true,issuedAt);
 const qr=await issueSharedQr(ctx.env,admin,'https://factorypass.pages.dev',issuedAt);
 assert.equal(qr.expiresAt,'2026-11-09T15:00:00.000Z');
 const claim=await verifySharedQr(ctx.env,user,qr.token,issuedAt);
 assert.equal(claim.claimExpiresAt,qr.expiresAt);
 await assert.rejects(()=>confirmSharedAttendance(ctx.env,user,{claimId:claim.claimId,requestId:randomUUID()},new Date('2026-11-09T15:00:00.000Z')),error=>error.status===410);
 assert.equal(ctx.state.events.length,0);
});

test('비로그인·다른 역할은 공용 QR verify/confirm에 접근할 수 없다',async()=>{
 const ctx=database();
 await ctx.env.DB.prepare('INSERT INTO sessions(id,user_id,csrf_token,expires_at) VALUES(?,?,?,?)').bind('worker-session',2,'csrf-worker',new Date(Date.now()+60000).toISOString()).run();
 await ctx.env.DB.prepare('INSERT INTO sessions(id,user_id,csrf_token,expires_at) VALUES(?,?,?,?)').bind('admin-session',1,'csrf-admin',new Date(Date.now()+60000).toISOString()).run();
 const call=async(path,{method='GET',cookie,csrf,body}={})=>onRequest({request:new Request(`https://factorypass.pages.dev/api${path}`,{method,headers:{...(cookie?{Cookie:`fp_session=${cookie}`}:{ }),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env:ctx.env});
 assert.equal((await call('/employee/qr/verify',{method:'POST',body:{token:'a'.repeat(64)}})).status,401);
 assert.equal((await call('/admin/shared-qr',{cookie:'worker-session',csrf:'csrf-worker'})).status,403);
 assert.equal((await call('/employee/qr/confirm',{method:'POST',cookie:'admin-session',csrf:'csrf-admin',body:{claimId:'a'.repeat(64),requestId:randomUUID()}})).status,403);
});

test('route와 UI는 관리자 공용 QR, 공용 표시, 로그인 복귀, 최종 확인 API를 연결한다',async()=>{
 const app=await readFile(resolve(root,'app.js'),'utf8'),api=await readFile(resolve(root,'functions/api/[[path]].js'),'utf8');
  assert.match(app,/sharedQrAdmin/);
 assert.doesNotMatch(app,/function kioskPage\(|\/admin\/devices/);
  const start=app.indexOf('async function sharedQrAdmin('),end=app.indexOf('async function settings(',start),adminQr=app.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(adminQr,/shared-display-open|display-key|attendance-display|window\.open/);
  assert.match(adminQr,/\/admin\/shared-qr\/issue/);
  assert.match(adminQr,/new QRCode\(/);
  assert.match(adminQr,/setTimeout\(tick/);
 assert.match(adminQr,/Asia\/Seoul/);
 assert.match(app,/crypto\.randomUUID/);
 assert.match(api,/requireRole\(request,env,'admin'\)/);
 assert.doesNotMatch(api,/attendance-display\/issue|\/admin\/devices|qr_devices|qr_device_usage_logs|isDeviceCodeConflict/);
 assert.doesNotMatch(api,/\/admin\/shared-qr\/display-key|attendance-display\/issue/);
 assert.match(api,/\/admin\/shared-qr\/issue/);
 assert.match(api,/confirmSharedAttendance/);
 assert.match(app,/sessionStorage\.setItem\('fp_pending_verify'/);
});
