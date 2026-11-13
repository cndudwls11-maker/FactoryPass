import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(
  new URL('../analytics.js', import.meta.url),
  'utf8',
);
function runtime(consent = 'granted') {
  const events = [],
    scripts = [];
  const dataLayer = {
    push(event) {
      events.push(event);
      event.eventCallback?.();
    },
  };
  const window = {
    FACTORYPASS_TRACKING: {
      containerId: 'GTM-TEST123',
      measurementId: 'G-TEST123',
    },
    dataLayer,
  };
  const location = {
    href: 'https://factorypass.pages.dev/employee/verify?email=secret%40example.com&next=private&utm_source=newsletter#t=secret-qr-token',
    origin: 'https://factorypass.pages.dev',
    hostname: 'factorypass.pages.dev',
  };
  const document = {
    title: '출퇴근 인증 | FactoryPass',
    referrer: 'https://referrer.example/article?email=secret%40example.com',
    head: { append: (s) => scripts.push(s.src) },
    createElement: () => ({}),
    addEventListener() {},
  };
  const context = vm.createContext({
    window,
    location,
    document,
    localStorage: { getItem: () => consent },
    URL,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(source, context);
  return { events, scripts, analytics: window.FactoryPassAnalytics };
}
test('분석 이벤트는 QR 토큰·이메일·임의 입력값을 전송하지 않고 안전한 유입 정보만 보존한다', async () => {
  const r = runtime();
  await r.analytics.track('login', {
    name: 'SECRET-NAME',
    identity: 'secret@example.com',
  });
  await r.analytics.track('attendance_confirmed', {
    attendance_type: 'in',
    employee_no: 'SECRET-EMPLOYEE',
  });
  assert.equal(r.scripts.length, 1);
  assert.ok(r.scripts[0].includes('gtm.js?id=GTM-TEST123'));
  const serialized = JSON.stringify(r.events);
  for (const secret of [
    'secret@example.com',
    'secret%40example.com',
    'secret-qr-token',
    'SECRET-NAME',
    'SECRET-EMPLOYEE',
    'next=',
  ])
    assert.ok(!serialized.includes(secret), secret);
  const login = r.events.find((e) => e.event === 'login');
  assert.equal(login.method, 'password');
  assert.equal(
    login.page_location,
    'https://factorypass.pages.dev/employee/verify?utm_source=newsletter',
  );
  assert.equal(login.page_referrer, 'https://referrer.example/article');
  assert.equal(
    r.events.find((e) => e.event === 'attendance_confirmed').attendance_type,
    'in',
  );
});
test('통계 수집에 동의하지 않으면 Google 스크립트와 목표 이벤트를 보내지 않는다', async () => {
  const r = runtime('denied');
  await r.analytics.track('login');
  assert.equal(r.scripts.length, 0);
  assert.equal(r.events.length, 0);
});
