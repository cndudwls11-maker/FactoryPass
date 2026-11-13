window.__factoryPassBootTimer = setTimeout(() => {
  const app = document.getElementById('app');
  if (app?.querySelector('.boot')) app.innerHTML = '<main class="auth-main"><section class="auth-box"><h1>페이지를 불러오지 못했습니다.</h1><p>네트워크 상태를 확인하고 다시 시도해 주세요.</p><a class="btn btn-primary" href="/">다시 시도</a></section></main>';
}, 10000);
