import {digest,HttpError,randomToken} from './auth.js';
import {seoulDate} from './attendance.js';

const TOKEN_PATTERN=/^[a-f\d]{64}$/i;
const REQUEST_PATTERN=/^[a-f\d-]{36}$/i;
const CLAIM_ID_PATTERN=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const DISPLAY_QR_TTL_SECONDS=30;
const SEOUL_DAY_MILLISECONDS=24*60*60*1000;
const CLAIM_TTL_SECONDS=60;
const DISPLAY_KEY_TTL_SECONDS=30*24*60*60;

function randomId(){return crypto.randomUUID()}
function isUniqueError(error){return /UNIQUE constraint failed|constraint failed/i.test(String(error?.message||error))}
function nextSeoulMidnight(date){const day=seoulDate(date);return new Date(new Date(`${day}T00:00:00+09:00`).getTime()+SEOUL_DAY_MILLISECONDS)}
function secondsUntilSeoulMidnight(date){return Math.max(1,Math.ceil((nextSeoulMidnight(date).getTime()-date.getTime())/1000))}

export async function sharedQrStatus(env){
 const control=await env.DB.prepare('SELECT enabled,generation,updated_at FROM shared_qr_control WHERE id=1').first();
 return{enabled:control?.enabled===1,generation:control?.generation||0,updatedAt:control?.updated_at||null,rotationSeconds:secondsUntilSeoulMidnight(new Date())}
}

export async function setSharedQrEnabled(env,admin,enabled,now=new Date()){
 const timestamp=now.toISOString();
 await env.DB.prepare(`UPDATE shared_qr_control SET enabled=?,generation=generation+1,updated_by=?,updated_at=? WHERE id=1`).bind(enabled?1:0,admin.id,timestamp).run();
 if(!enabled)await revokeDisplayKeys(env,admin,now);
 return sharedQrStatus(env)
}

export async function createDisplayKey(env,admin,now=new Date()){
 const control=await sharedQrStatus(env);if(!control.enabled)throw new HttpError(423,'공용 QR을 먼저 활성화해 주세요.');
 const key=await randomToken(32),id=randomId(),createdAt=now.toISOString(),expiresAt=new Date(now.getTime()+DISPLAY_KEY_TTL_SECONDS*1000).toISOString();
 await env.DB.prepare('INSERT INTO shared_qr_display_keys(id,key_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?)').bind(id,await digest(key),admin.id,createdAt,expiresAt).run();
 return{key,expiresAt}
}

export async function issueDisplayQr(env,key,origin,now=new Date()){
 if(typeof key!=='string'||!TOKEN_PATTERN.test(key))throw new HttpError(401,'공용 화면 표시 키가 필요합니다. 관리자 화면에서 다시 여세요.');
 const row=await env.DB.prepare(`SELECT id FROM shared_qr_display_keys WHERE key_hash=? AND revoked_at IS NULL AND expires_at>?`).bind(await digest(key),now.toISOString()).first();
 if(!row)throw new HttpError(401,'공용 화면 표시 키가 만료되었거나 폐기되었습니다. 관리자 화면에서 다시 여세요.');
 const status=await sharedQrStatus(env);if(!status.enabled)throw new HttpError(423,'회사 공용 QR이 중지되었습니다.');
 const token=await randomToken(32),tokenHash=await digest(token),id=randomId(),issuedAt=now.toISOString(),expiresAt=new Date(now.getTime()+DISPLAY_QR_TTL_SECONDS*1000).toISOString();
 const result=await env.DB.prepare(`INSERT INTO shared_qr_sessions(id,token_hash,generation,issued_at,expires_at,created_by) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shared_qr_display_keys k JOIN shared_qr_control c ON c.id=1 WHERE k.id=? AND k.revoked_at IS NULL AND k.expires_at>? AND c.enabled=1 AND c.generation=?)`).bind(id,tokenHash,status.generation,issuedAt,expiresAt,row.id,row.id,now.toISOString(),status.generation).run();
 if(!result.meta?.changes)throw new HttpError(423,'표시 키가 폐기되었거나 공용 QR이 중지되었습니다. 관리자 화면에서 다시 여세요.');
 return{sessionId:id,token,issuedAt,expiresAt,rotationSeconds:DISPLAY_QR_TTL_SECONDS,verifyUrl:`${origin}/employee/verify#t=${token}`}
}

export async function revokeDisplayKeys(env,admin,now=new Date()){
 const revokedAt=now.toISOString();
 await env.DB.prepare('UPDATE shared_qr_display_keys SET revoked_at=? WHERE revoked_at IS NULL').bind(revokedAt).run();
 return{ok:true,revokedAt}
}

export async function issueSharedQr(env,admin,origin,now=new Date()){
 const status=await sharedQrStatus(env);
 if(!status.enabled)throw new HttpError(423,'회사 공용 QR이 중지되었습니다. 관리자에게 문의하세요.');
 const token=await randomToken(32),tokenHash=await digest(token),id=randomId();
 const issuedAt=now.toISOString(),expiresAt=nextSeoulMidnight(now).toISOString();
 const result=await env.DB.prepare(`INSERT INTO shared_qr_sessions(id,token_hash,generation,issued_at,expires_at,created_by) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shared_qr_control WHERE id=1 AND enabled=1 AND generation=?)`).bind(id,tokenHash,status.generation,issuedAt,expiresAt,admin.id,status.generation).run();
 if(!result.meta?.changes)throw new HttpError(423,'회사 공용 QR이 중지되거나 갱신되었습니다. 다시 시도해 주세요.');
 return{sessionId:id,token,issuedAt,expiresAt,rotationSeconds:secondsUntilSeoulMidnight(now),verifyUrl:`${origin}/employee/verify#t=${token}`}
}

async function findSession(env,token){
 if(typeof token!=='string'||!TOKEN_PATTERN.test(token))throw new HttpError(400,'공용 QR 토큰 형식이 올바르지 않습니다.');
 const row=await env.DB.prepare(`SELECT s.id,s.generation,s.issued_at,s.expires_at,s.revoked_at,c.enabled,c.generation current_generation FROM shared_qr_sessions s JOIN shared_qr_control c ON c.id=1 WHERE s.token_hash=?`).bind(await digest(token)).first();
 if(!row)throw new HttpError(404,'공용 QR을 찾을 수 없습니다. 새 QR을 촬영해 주세요.');
 if(row.enabled!==1||row.revoked_at||row.generation!==row.current_generation)throw new HttpError(423,'회사 공용 QR이 중지되었거나 폐기되었습니다. 관리자에게 문의하세요.');
 return row
}

async function latestEvent(env,userId){
 const state=await env.DB.prepare(`SELECT last_type event_type,last_at occurred_at FROM attendance_event_state WHERE user_id=?`).bind(userId).first();
 const old=await env.DB.prepare(`SELECT check_in,check_out FROM attendance_records WHERE user_id=? ORDER BY work_date DESC LIMIT 1`).bind(userId).first();
 if(!state?.event_type)return old?.check_out?{event_type:'out',occurred_at:old.check_out}:old?.check_in?{event_type:'in',occurred_at:old.check_in}:null;
 const legacyAt=old?.check_out||old?.check_in;
 return legacyAt&&Date.parse(legacyAt)>Date.parse(state.occurred_at)?{event_type:old.check_out?'out':'in',occurred_at:legacyAt}:state
}

function nextType(event){return event?.event_type==='in'?'out':'in'}

export async function verifySharedQr(env,user,token,now=new Date()){
 if(user.role!=='employee'||user.status!=='approved')throw new HttpError(403,'승인된 근로자만 공용 QR을 인증할 수 있습니다.');
 const session=await findSession(env,token),timestamp=now.toISOString();
 if(seoulDate(new Date(session.issued_at))!==seoulDate(now)||Date.parse(session.expires_at)<=now.getTime())throw new HttpError(410,'공용 QR이 만료되었습니다. 회사 출퇴근 장소에서 새 QR을 촬영해 주세요.');
 // Resolve abandoned claims before inserting a new one under the active-user unique index.
 await env.DB.prepare(`UPDATE shared_qr_claims SET used_at=? WHERE user_id=? AND used_at IS NULL AND (expires_at<=? OR generation<>? OR EXISTS(SELECT 1 FROM shared_qr_sessions s WHERE s.id=shared_qr_claims.session_id AND s.revoked_at IS NOT NULL))`).bind(timestamp,user.id,timestamp,session.generation).run();
 const existing=await env.DB.prepare(`SELECT id,session_id,generation,claimed_at,expires_at,used_at FROM shared_qr_claims WHERE user_id=? AND used_at IS NULL AND expires_at>? ORDER BY claimed_at DESC LIMIT 1`).bind(user.id,timestamp).first();
 let claim=existing;
 if(claim){
  if(claim.session_id!==session.id)throw new HttpError(409,'이미 다른 QR 인증을 진행 중입니다. 기존 확인을 완료하거나 QR을 다시 촬영해 주세요.');
 }else{
  const id=randomId(),expiresAt=new Date(Math.min(now.getTime()+CLAIM_TTL_SECONDS*1000,Date.parse(session.expires_at))).toISOString();
  try{
   const result=await env.DB.prepare(`INSERT INTO shared_qr_claims(id,session_id,user_id,generation,claimed_at,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shared_qr_sessions s JOIN shared_qr_control c ON c.id=1 WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.enabled=1 AND c.generation=s.generation) ON CONFLICT(user_id) WHERE used_at IS NULL DO NOTHING`).bind(id,session.id,user.id,session.generation,timestamp,expiresAt,session.id,await digest(token),timestamp).run();
   if(!result.meta?.changes){const existingClaim=await env.DB.prepare(`SELECT id,session_id,generation,claimed_at,expires_at,used_at FROM shared_qr_claims WHERE user_id=? AND used_at IS NULL AND expires_at>?`).bind(user.id,timestamp).first();if(!existingClaim)throw new HttpError(410,'공용 QR이 만료되었거나 중지되었습니다. 새 QR을 촬영해 주세요.');if(existingClaim.session_id!==session.id)throw new HttpError(409,'이미 다른 QR 인증을 진행 중입니다. 기존 확인을 완료하거나 QR을 다시 촬영해 주세요.');claim=existingClaim}else claim={id,session_id:session.id,generation:session.generation,claimed_at:timestamp,expires_at:expiresAt,used_at:null}
  }catch(error){if(error instanceof HttpError)throw error;if(isUniqueError(error))throw new HttpError(409,'이미 진행 중인 QR 인증이 있습니다. 화면을 새로고침해 주세요.');throw error}
 }
 const previous=await latestEvent(env,user.id);
 return{valid:true,claimId:claim.id,employee:{id:user.id,name:user.name,employeeNo:user.employee_no,department:user.department},previewType:nextType(previous),lastEventAt:previous?.occurred_at||null,claimedAt:claim.claimed_at,claimExpiresAt:claim.expires_at,qrExpiresAt:session.expires_at,serverTime:timestamp,recordingEnabled:true}
}

export async function confirmSharedAttendance(env,user,{claimId,requestId},now=new Date()){
 if(user.role!=='employee'||user.status!=='approved')throw new HttpError(403,'승인된 근로자만 출퇴근을 인증할 수 있습니다.');
 if(typeof claimId!=='string'||!CLAIM_ID_PATTERN.test(claimId))throw new HttpError(400,'인증 정보가 올바르지 않습니다. QR을 다시 촬영해 주세요.');
 if(typeof requestId!=='string'||!REQUEST_PATTERN.test(requestId))throw new HttpError(400,'요청 식별 정보가 올바르지 않습니다. 다시 시도해 주세요.');
 const claim=await env.DB.prepare(`SELECT c.id,c.session_id,c.generation,c.claimed_at,c.expires_at,c.used_at,s.revoked_at,s.generation session_generation,q.enabled,q.generation current_generation FROM shared_qr_claims c JOIN shared_qr_sessions s ON s.id=c.session_id JOIN shared_qr_control q ON q.id=1 WHERE c.id=? AND c.user_id=?`).bind(claimId,user.id).first();
 if(!claim)throw new HttpError(404,'인증 요청을 찾을 수 없습니다. QR을 다시 촬영해 주세요.');
 if(claim.enabled!==1||claim.revoked_at||claim.generation!==claim.current_generation||claim.session_generation!==claim.current_generation)throw new HttpError(423,'회사 공용 QR이 중지되거나 인증 요청이 취소되었습니다.');
 if(claim.used_at)throw new HttpError(409,'이미 처리된 인증 요청입니다.');
 if(Date.parse(claim.expires_at)<=now.getTime()||seoulDate(new Date(claim.claimed_at))!==seoulDate(now))throw new HttpError(410,'출퇴근 확인 유예시간이 만료되었습니다. 회사 출퇴근 장소에서 QR을 다시 촬영해 주세요.');
 const timestamp=now.toISOString(),workDate=seoulDate(now);
 try{
  const results=await env.DB.batch([
   env.DB.prepare(`UPDATE shared_qr_claims SET used_at=?,request_id=? WHERE id=? AND user_id=? AND used_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM shared_qr_sessions s JOIN shared_qr_control q ON q.id=1 WHERE s.id=shared_qr_claims.session_id AND s.revoked_at IS NULL AND q.enabled=1 AND q.generation=shared_qr_claims.generation AND s.generation=shared_qr_claims.generation)`).bind(timestamp,requestId,claim.id,user.id,timestamp),
   env.DB.prepare(`UPDATE attendance_event_state SET last_type=CASE WHEN last_type='in' THEN 'out' ELSE 'in' END,last_at=?,revision=revision+1 WHERE user_id=? AND EXISTS(SELECT 1 FROM shared_qr_claims c WHERE c.id=? AND c.user_id=? AND c.used_at=?) RETURNING last_type`).bind(timestamp,user.id,claim.id,user.id,timestamp),
   env.DB.prepare(`INSERT INTO attendance_events(user_id,event_type,occurred_at,work_date,shared_qr_session_id,claim_id,request_id) SELECT ?,last_type,?,?,?, ?,? FROM attendance_event_state WHERE user_id=? AND last_at=?`).bind(user.id,timestamp,workDate,claim.session_id,claim.id,requestId,user.id,timestamp)
  ]);
  if(!results?.[0]?.meta?.changes||!results?.[1]?.meta?.changes||!results?.[2]?.meta?.changes)throw new HttpError(409,'출퇴근 상태가 변경되었거나 요청이 만료되었습니다. 화면을 새로고침해 다시 인증해 주세요.')
 }catch(error){if(error instanceof HttpError)throw error;if(isUniqueError(error))throw new HttpError(409,'이 인증 요청은 이미 처리되었습니다.');throw error}
 const event=await env.DB.prepare('SELECT event_type FROM attendance_events WHERE request_id=? AND user_id=?').bind(requestId,user.id).first();
 if(!event)throw new HttpError(409,'출퇴근 인증 결과를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
 return{ok:true,eventType:event.event_type,employee:{name:user.name,employeeNo:user.employee_no},recordedAt:timestamp,workDate,seoulTime:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now),message:event.event_type==='in'?'출근 인증이 완료되었습니다.':'퇴근 인증이 완료되었습니다.'}
}
