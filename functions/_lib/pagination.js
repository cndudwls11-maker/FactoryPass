import { HttpError } from './auth.js';

export function pageParams(url) {
  const p = url.searchParams.get('page') || '1',
    s = url.searchParams.get('pageSize') || '25';
  if (!/^[1-9]\d{0,5}$/.test(p) || !/^[1-9]\d{0,2}$/.test(s) || Number(s) > 100)
    throw new HttpError(400, '페이지 번호와 조회 개수를 확인해 주세요.');
  return { page: Number(p), pageSize: Number(s) };
}
export function pageInfo(total, { page, pageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(page, pages), pageSize, total, pages };
}
export function pageSlice(rows, url) {
  const pagination = pageInfo(rows.length, pageParams(url)),
    start = (pagination.page - 1) * pagination.pageSize;
  return {
    records: rows.slice(start, start + pagination.pageSize),
    pagination,
  };
}
export function dateRange(url, defaultFrom, defaultTo) {
  const from = url.searchParams.get('from') || defaultFrom,
    to = url.searchParams.get('to') || defaultTo;
  const valid = (value) =>
    /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to)
    throw new HttpError(400, '올바른 시작일과 종료일을 입력해 주세요.');
  if (Date.parse(to) - Date.parse(from) > 366 * 86400000)
    throw new HttpError(400, '한 번에 조회할 수 있는 기간은 최대 366일입니다.');
  return { from, to };
}
export async function employeesPage(env, url) {
  const query = (url.searchParams.get('search') || '')
      .trim()
      .toLocaleLowerCase('ko'),
    status = url.searchParams.get('status') || '',
    department = url.searchParams.get('department') || '';
  if (
    query.length > 120 ||
    department.length > 80 ||
    (status &&
      !['pending', 'approved', 'disabled', 'rejected'].includes(status))
  )
    throw new HttpError(400, '검색 조건을 확인해 주세요.');
  const like = '%' + query.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const where =
    "role='employee' AND status='approved' AND (?='' OR LOWER(name||' '||COALESCE(employee_no,'')||' '||COALESCE(email,'')||' '||COALESCE(username,'')) LIKE ? ESCAPE '\\') AND (?='' OR status=?) AND (?='' OR TRIM(department)=?)";
  const values = [query, like, status, status, department, department];
  const count = await env.DB.prepare(
    'SELECT COUNT(*) total FROM users WHERE ' + where,
  )
    .bind(...values)
    .first();
  const pagination = pageInfo(count?.total || 0, pageParams(url));
  const [rows, depts] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id,name,employee_no,department,email,username,status,created_at FROM users WHERE ' +
        where +
        " ORDER BY CASE WHEN status='disabled' THEN 1 ELSE 0 END,created_at DESC,id DESC LIMIT ? OFFSET ?",
    ).bind(
      ...values,
      pagination.pageSize,
      (pagination.page - 1) * pagination.pageSize,
    ),
    env.DB.prepare(
      "SELECT DISTINCT TRIM(department) name FROM users WHERE role='employee' AND status='approved' AND TRIM(COALESCE(department,''))<>'' ORDER BY name",
    ),
  ]);
  return {
    employees: rows.results || [],
    departments: (depts.results || []).map((d) => d.name),
    pagination,
  };
}
export async function employeeAttendancePage(
  env,
  userId,
  url,
  defaultFrom,
  defaultTo,
) {
  const { from, to } = dateRange(url, defaultFrom, defaultTo);
  const count = await env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM attendance_events WHERE user_id=? AND work_date BETWEEN ? AND ?)+(SELECT COUNT(*) FROM attendance_records WHERE user_id=? AND work_date BETWEEN ? AND ?) total',
  )
    .bind(userId, from, to, userId, from, to)
    .first();
  const pagination = pageInfo(count?.total || 0, pageParams(url));
  const [rows, events, legacy] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id,work_date,occurred_at,event_type,'shared_qr' source FROM attendance_events WHERE user_id=? AND work_date BETWEEN ? AND ? UNION ALL SELECT id,work_date,COALESCE(check_out,check_in) occurred_at,'legacy' event_type,'legacy' source FROM attendance_records WHERE user_id=? AND work_date BETWEEN ? AND ? ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?",
    ).bind(
      userId,
      from,
      to,
      userId,
      from,
      to,
      pagination.pageSize,
      (pagination.page - 1) * pagination.pageSize,
    ),
    env.DB.prepare(
      "WITH ordered AS (SELECT event_type,occurred_at,LEAD(event_type) OVER(ORDER BY occurred_at,id) next_type,LEAD(occurred_at) OVER(ORDER BY occurred_at,id) next_at FROM attendance_events WHERE user_id=? AND work_date BETWEEN ? AND ?) SELECT COALESCE(SUM(event_type='in'),0) present,COALESCE(SUM(event_type='out'),0) checkouts,COALESCE(SUM(event_type='in' AND next_type IS NULL),0) openShifts,COALESCE(SUM(CASE WHEN event_type='in' AND next_type='out' THEN MAX(0,CAST((strftime('%s',next_at)-strftime('%s',occurred_at))/60 AS INTEGER)) ELSE 0 END),0) minutes FROM ordered",
    ).bind(userId, from, to),
    env.DB.prepare(
      "SELECT COUNT(*) legacyRecords,COALESCE(SUM(check_in IS NOT NULL AND check_out IS NULL),0) openShifts,COALESCE(SUM(CASE WHEN check_in IS NOT NULL AND check_out IS NOT NULL THEN MAX(0,CAST((strftime('%s',check_out)-strftime('%s',check_in))/60 AS INTEGER)) ELSE 0 END),0) minutes FROM attendance_records WHERE user_id=? AND work_date BETWEEN ? AND ?",
    ).bind(userId, from, to),
  ]);
  const e = events.results?.[0] || {},
    l = legacy.results?.[0] || {};
  return {
    records: rows.results || [],
    pagination,
    summary: {
      present: e.present || 0,
      checkouts: e.checkouts || 0,
      openShifts: (e.openShifts || 0) + (l.openShifts || 0),
      minutes: (e.minutes || 0) + (l.minutes || 0),
      legacyRecords: l.legacyRecords || 0,
    },
  };
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (
    (typeof value !== 'number' && /^[\s]*[=+\-@]/.test(text)) ||
    /^[\t\r\n]/.test(text)
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
