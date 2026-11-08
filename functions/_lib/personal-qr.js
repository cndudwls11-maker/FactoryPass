import {digest,HttpError,randomToken} from './auth.js';
import {seoulDate} from './attendance.js';

const isToken=value=>typeof value==='string'&&/^[a-f\d]{64}$/i.test(value);

export async function issuePersonalQr(env,user,origin,now=new Date()){
 if(user.role!=='employee'||user.status!=='approved')throw new HttpError(403,'승인된 근로자만 개인 QR을 발급할 수 있습니다.');
 const workDate=seoulDate(now),setting=await env.DB.prepare("SELECT value FROM settings WHERE key='personal_qr_ttl_seconds'").first();
 const ttl=Math.max(15,Math.min(300,Number(setting?.value)||60));
 const dayEnd=new Date(`${workDate}T23:59:59.999+09:00`).getTime();
 const expiresAt=new Date(Math.min(now.getTime()+ttl*1000,dayEnd)).toISOString();
 const token=await randomToken(32),tokenHash=await digest(token);
 await env.DB.prepare(`INSERT INTO qr_tokens(user_id,work_date,token_hash,expires_at,revoked_at) VALUES(?,?,?, ?,NULL) ON CONFLICT(user_id,work_date) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revoked_at=NULL`).bind(user.id,workDate,tokenHash,expiresAt).run();
 return{token,workDate,expiresAt,verifyUrl:`${origin}/employee/verify#t=${token}`};
}

async function findQr(env,userId,token){
 if(!isToken(token))throw new HttpError(400,'QR 인증 정보가 올바르지 않습니다.');
 const row=await env.DB.prepare(`SELECT q.id,q.user_id,q.work_date,q.expires_at,q.revoked_at,u.name,u.employee_no,u.department,u.status FROM qr_tokens q JOIN users u ON u.id=q.user_id WHERE q.token_hash=?`).bind(await digest(token)).first();
 if(!row)throw new HttpError(404,'QR 인증 정보를 찾을 수 없습니다. 다시 발급해 주세요.');
 if(row.user_id!==userId)throw new HttpError(403,'이 QR은 다른 근로자 계정에서 발급되었습니다. QR을 발급한 본인 계정으로 로그인해 주세요.');
 if(row.status!=='approved')throw new HttpError(403,'사용할 수 없는 근로자 계정입니다.');
 return row;
}

export async function verifyPersonalQr(env,user,token,now=new Date()){
 const row=await findQr(env,user.id,token);
 if(row.revoked_at)throw new HttpError(409,'이 QR은 재발급되어 더 이상 유효하지 않습니다.');
 if(row.work_date!==seoulDate(now)||Date.parse(row.expires_at)<=now.getTime())throw new HttpError(410,'QR이 만료되었습니다. 근로자 PC에서 새 QR을 발급해 주세요.');
 const record=await env.DB.prepare('SELECT check_in,check_out FROM attendance_records WHERE user_id=? AND work_date=?').bind(user.id,row.work_date).first();
 const previewType=record?.check_in&&!record?.check_out?'out':'in';
 return{valid:true,employee:{name:row.name,employeeNo:row.employee_no,department:row.department},previewType,workDate:row.work_date,expiresAt:row.expires_at,serverTime:now.toISOString(),recordingEnabled:false};
}

export async function personalQrStatus(env,user,token,now=new Date()){
 const row=await findQr(env,user.id,token);
 if(row.revoked_at)return{state:'replaced',expiresAt:row.expires_at};
 if(row.work_date!==seoulDate(now)||Date.parse(row.expires_at)<=now.getTime())return{state:'expired',expiresAt:row.expires_at};
 return{state:'active',expiresAt:row.expires_at};
}