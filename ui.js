(() => {
  const loaded = new Map();
  function loadScript(src) {
    if (loaded.has(src)) return loaded.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        loaded.delete(src);
        script.remove();
        reject(
          new Error('필요한 기능을 불러오지 못했습니다. 다시 시도해 주세요.'),
        );
      };
      document.head.append(script);
    });
    loaded.set(src, promise);
    return promise;
  }
  function skeleton(rows = 5) {
    return `<div class="skeleton-table" role="status" aria-label="목록을 불러오는 중"><span class="sr-only">불러오는 중…</span>${Array.from({ length: rows }, () => '<div class="skeleton-row" aria-hidden="true"><span></span><span></span><span></span><span></span></div>').join('')}</div>`;
  }
  function pager(page, pages, total) {
    return `<nav class="pagination" aria-label="목록 페이지"><span aria-live="polite">총 ${Number(total)}개 · ${Number(page)} / ${Number(pages)} 페이지</span><div><button type="button" class="small-btn" data-list-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="이전 페이지">이전</button><button type="button" class="small-btn" data-list-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="다음 페이지">다음</button></div></nav>`;
  }
  function serverTable(container, fetchPage, renderRows, onData = () => {}) {
    let generation = 0,
      current = 1;
    async function refresh(page = 1) {
      const token = ++generation;
      container.setAttribute('aria-busy', 'true');
      container.innerHTML = skeleton();
      try {
        const data = await fetchPage(page);
        if (token !== generation) return;
        const p = data.pagination;
        current = p.page;
        container.innerHTML =
          renderRows(data) + pager(p.page, p.pages, p.total);
        onData(data);
      } catch (error) {
        if (token === generation) {
          container.innerHTML =
            '<div class="empty"><p role="alert"></p><button type="button" class="small-btn" data-list-retry>다시 시도</button></div>';
          container.querySelector('p').textContent = error.message;
        }
      } finally {
        if (token === generation) container.setAttribute('aria-busy', 'false');
      }
    }
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-list-page],[data-list-retry]');
      if (button && !button.disabled)
        refresh(
          button.hasAttribute('data-list-retry')
            ? current
            : Number(button.dataset.listPage),
        );
    });
    return {
      refresh,
      get page() {
        return current;
      },
    };
  }
  function localTable(container, rows, renderRows, pageSize = 25) {
    let page = 1;
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    function render() {
      container.innerHTML =
        renderRows(rows.slice((page - 1) * pageSize, page * pageSize)) +
        pager(page, pages, rows.length);
    }
    container.onclick = (event) => {
      const button = event.target.closest('[data-list-page]');
      if (button && !button.disabled) {
        page = Number(button.dataset.listPage);
        render();
      }
    };
    render();
  }
  window.FPUI = { loadScript, skeleton, pager, serverTable, localTable };
})();
