(() => {
  const config = window.FACTORYPASS_TRACKING || {},
    key = 'fp_analytics_consent';
  const configured =
    /^GTM-[A-Z0-9]+$/.test(config.containerId || '') ||
    /^G-[A-Z0-9]+$/.test(config.measurementId || '');
  let consent = false,
    started = false;
  const safeUrl = (value) => {
    try {
      const u = new URL(value, location.origin);
      return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : '';
    } catch {
      return '';
    }
  };
  function pageInfo() {
    const u = new URL(location.href);
    const safe = new URL(u.origin + u.pathname);
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
    ]) {
      const value = u.searchParams.get(key);
      if (value && /^[a-zA-Z0-9_.-]{1,80}$/.test(value))
        safe.searchParams.set(key, value);
    }
    return {
      page_location: safe.href,
      page_title: document.title,
      page_referrer: safeUrl(document.referrer),
    };
  }
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  function load(src) {
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    document.head.append(script);
  }
  function start() {
    if (
      started ||
      !consent ||
      !configured ||
      location.hostname !== 'factorypass.pages.dev'
    )
      return;
    started = true;
    if (config.containerId) {
      window.dataLayer.push({
        'gtm.start': Date.now(),
        event: 'gtm.js',
        ...pageInfo(),
      });
      load(
        'https://www.googletagmanager.com/gtm.js?id=' +
          encodeURIComponent(config.containerId),
      );
      window.dataLayer.push({ event: 'fp_page_view', ...pageInfo() });
    } else {
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', config.measurementId, {
        ...pageInfo(),
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
      load(
        'https://www.googletagmanager.com/gtag/js?id=' +
          encodeURIComponent(config.measurementId),
      );
      gtag('event', 'page_view', pageInfo());
    }
  }
  function track(event, values = {}) {
    if (
      !consent ||
      !started ||
      !['login', 'attendance_confirmed', 'qr_verified'].includes(event)
    )
      return Promise.resolve();
    const params = { ...pageInfo() };
    if (event === 'login') params.method = 'password';
    if (
      event === 'attendance_confirmed' &&
      ['in', 'out'].includes(values.attendance_type)
    )
      params.attendance_type = values.attendance_type;
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      if (config.containerId)
        window.dataLayer.push({
          event,
          ...params,
          eventCallback: done,
          eventTimeout: 900,
        });
      else
        gtag('event', event, {
          ...params,
          transport_type: 'beacon',
          event_callback: done,
          event_timeout: 900,
        });
    });
  }
  function preferences() {
    document.getElementById('analytics-consent')?.remove();
    if (!configured) return;
    const panel = document.createElement('section');
    panel.id = 'analytics-consent';
    panel.className = 'analytics-consent';
    panel.setAttribute('aria-label', '이용 통계 설정');
    panel.innerHTML =
      '<div><strong>이용 통계 수집에 동의하시나요?</strong><p>방문 경로와 로그인·출퇴근 인증 성공 여부를 Google Analytics로 측정합니다. 이름, 사번, 이메일과 QR 토큰은 보내지 않습니다.</p></div><div class="consent-actions"><button type="button" class="small-btn" data-consent="denied">동의하지 않음</button><button type="button" class="btn btn-primary" data-consent="granted">동의</button></div>';
    panel.addEventListener('click', (e) => {
      const button = e.target.closest('[data-consent]');
      if (!button) return;
      const value = button.dataset.consent;
      try {
        localStorage.setItem(key, value);
      } catch {}
      consent = value === 'granted';
      panel.remove();
      if (consent) start();
      else if (started) location.reload();
    });
    document.body.append(panel);
  }
  window.FactoryPassAnalytics = { track, preferences };
  try {
    consent = localStorage.getItem(key) === 'granted';
    if (configured && !localStorage.getItem(key)) preferences();
  } catch {}
  start();
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-analytics-settings]')) {
      e.preventDefault();
      preferences();
    }
  });
})();
