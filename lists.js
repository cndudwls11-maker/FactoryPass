(() => {
  const table = (headers, body) =>
    `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  const dateControls = (prefix) =>
    `<label class="sr-only" for="${prefix}-from">시작일</label><input type="date" id="${prefix}-from"><label class="sr-only" for="${prefix}-to">종료일</label><input type="date" id="${prefix}-to">`;
  async function employees(v) {
    v.innerHTML = `<div class="page-head"><div><h1>직원 관리</h1><p>직원 계정과 이용 상태를 관리합니다.</p></div></div><section class="panel table-panel"><div class="toolbar"><div class="toolbar-group"><input id="employee-search" type="search" aria-label="이름, 사번 또는 이메일 검색" placeholder="이름, 사번 또는 이메일 검색"><select id="employee-status" aria-label="계정 상태"><option value="">모든 계정 상태</option><option value="pending">기존 승인 대기</option><option value="approved">활성</option><option value="disabled">비활성</option><option value="rejected">거절됨</option></select><select id="employee-dept" aria-label="부서"><option value="">모든 부서</option></select></div><span class="muted" id="employee-count"></span></div><div id="employee-table"></div></section>`;
    let departmentsLoaded = false,
      timer;
    const list = FPUI.serverTable(
      $('#employee-table'),
      (page) =>
        api(
          '/admin/employees?' +
            new URLSearchParams({
              page,
              pageSize: 25,
              search: $('#employee-search').value.trim(),
              status: $('#employee-status').value,
              department: $('#employee-dept').value,
            }),
        ),
      (data) =>
        data.employees.length
          ? table(
              [
                '이름',
                '사번',
                '부서',
                '이메일 / 아이디',
                '가입일',
                '상태',
                '관리',
              ],
              data.employees
                .map(
                  (x) =>
                    `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.employee_no)}</td><td>${esc(x.department || '—')}</td><td>${esc(x.email || x.username)}</td><td>${shortDate(x.created_at?.slice(0, 10))}</td><td>${badge({ pending: '기존 승인 대기', approved: '활성', disabled: '비활성', rejected: '사용 제한' }[x.status] || x.status)}</td><td><div class="table-actions">${x.status === 'disabled' ? `<button class="small-btn" data-enable="${x.id}">재활성화</button>` : x.status === 'approved' ? `<button class="small-btn" data-disable="${x.id}">비활성화</button>` : ''}<button class="small-btn" data-records="${x.id}">근태</button><button class="small-btn btn-danger" data-delete="${x.id}" data-name="${esc(x.name)}" data-employee-no="${esc(x.employee_no)}">삭제</button></div></td></tr>`,
                )
                .join(''),
            )
          : empty('검색 조건에 맞는 직원이 없습니다.'),
      (data) => {
        if (!departmentsLoaded) {
          $('#employee-dept').innerHTML =
            '<option value="">모든 부서</option>' +
            data.departments
              .map((d) => `<option value="${esc(d)}">${esc(d)}</option>`)
              .join('');
          departmentsLoaded = true;
        }
        $('#employee-count').textContent = `총 ${data.pagination.total}명`;
      },
    );
    $('#employee-search').oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => list.refresh(), 250);
    };
    $('#employee-status').onchange = $('#employee-dept').onchange = () =>
      list.refresh();
    $('#employee-table').addEventListener('click', async (event) => {
      const b = event.target.closest(
        '[data-disable],[data-enable],[data-records],[data-delete]',
      );
      if (!b || b.disabled) return;
      if (b.dataset.records) {
        location.href =
          '/admin/attendance?employee=' + encodeURIComponent(b.dataset.records);
        return;
      }
      if (b.dataset.delete) {
        const dialog = document.createElement('dialog');
        dialog.className = 'employee-delete-dialog';
        dialog.setAttribute('aria-labelledby', 'employee-delete-title');
        dialog.innerHTML = `<form method="dialog"><h2 id="employee-delete-title">직원 계정을 삭제할까요?</h2><p><strong>${esc(b.dataset.name)}</strong> <span class="muted">${esc(b.dataset.employeeNo)}</span></p><p>계정은 비활성화되며 기존 출근·퇴근 기록과 수정 이력은 보존됩니다.</p><div class="dialog-actions"><button class="btn" value="cancel">취소</button><button class="btn btn-primary btn-danger" value="confirm">삭제 확인</button></div></form>`;
        document.body.append(dialog);
        const confirmed = await new Promise((resolve) => {
          dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
          dialog.addEventListener('cancel', () => resolve(false), { once: true });
          dialog.showModal();
        });
        dialog.remove();
        if (!confirmed) return;
        b.disabled = true;
        try {
          await api(`/admin/employees/${b.dataset.delete}`, {
            method: 'DELETE',
            body: '{}',
          });
          toast('직원이 삭제되었습니다. 기존 근태 기록은 보존됩니다.');
          await list.refresh(list.page);
        } catch (error) {
          toast(error.message);
          b.disabled = false;
        }
        return;
      }
      b.disabled = true;
      try {
        await api(
          `/admin/employees/${b.dataset.disable || b.dataset.enable}/${b.dataset.disable ? 'disable' : 'enable'}`,
          { method: 'POST', body: '{}' },
        );
        toast('계정 상태를 변경했습니다.');
        await list.refresh(list.page);
      } catch (error) {
        toast(error.message);
        b.disabled = false;
      }
    });
    await list.refresh();
  }
  async function attendance(v, employeeFilter = '') {
    v.innerHTML = `<div class="page-head"><div><h1>근태 출석부</h1><p>직원별 최근 출퇴근 상태를 조회합니다. CSV에는 조회 조건 전체가 적용됩니다.</p></div><button class="btn" id="csv">↓ CSV 다운로드</button></div><section class="panel table-panel"><div class="toolbar"><div class="toolbar-group">${dateControls('att')}<input type="search" id="att-search" aria-label="이름 또는 사번" placeholder="이름 또는 사번"><select id="att-status" aria-label="근태 상태"><option value="">모든 근태 상태</option>${['정상 출근', '지각', '근무 중', '퇴근 완료', '미출근', '결근'].map((x) => `<option>${x}</option>`).join('')}</select></div><button class="btn btn-soft" id="att-load">조회</button></div><div id="attendance-table"></div></section>`;
    $('#att-from').value = $('#att-to').value = today();
    const params = () => {
      const p = new URLSearchParams({
        from: $('#att-from').value,
        to: $('#att-to').value,
        search: $('#att-search').value.trim(),
        status: $('#att-status').value,
      });
      if (employeeFilter) p.set('employee', employeeFilter);
      return p;
    };
    const list = FPUI.serverTable(
      $('#attendance-table'),
      (page) => {
        const p = params();
        p.set('page', page);
        p.set('pageSize', 25);
        return api('/admin/attendance?' + p);
      },
      (d) =>
        d.records.length
          ? table(
              [
                '날짜',
                '사번',
                '직원 이름',
                '부서',
                '시각',
                '유형',
                '기록 방식',
                '상태',
                '관리',
              ],
              d.records
                .map(
                  (r) =>
                    `<tr><td>${esc(r.work_date)}</td><td>${esc(r.employee_no)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.department || '—')}</td><td>${timeFmt(r.occurred_at)}</td><td>${r.event_type === 'in' ? '출근' : r.event_type === 'out' ? '퇴근' : '기존 일일 기록'}</td><td>${r.source === 'shared_qr' ? '회사 공용 QR' : '기존 기록'}</td><td>${badge(r.status)}</td><td>${r.source === 'legacy' ? `<button class="small-btn" data-edit-record="${r.id}" data-in="${esc(r.check_in || '')}" data-out="${esc(r.check_out || '')}">수정</button>` : '—'}</td></tr>`,
                )
                .join(''),
            )
          : empty('선택한 조건의 기록이 없습니다.'),
    );
    $('#att-load').onclick = () => list.refresh();
    $('#att-search').onkeydown = (event) => {
      if (event.key === 'Enter') list.refresh();
    };
    $('#csv').onclick = async () => {
      const b = $('#csv');
      b.disabled = true;
      try {
        const r = await fetch('/api/admin/attendance.csv?' + params(), {
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error((await r.json()).error);
        const link = document.createElement('a'),
          url = URL.createObjectURL(await r.blob());
        link.href = url;
        link.download = `factorypass-attendance-${today()}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        toast(error.message);
      } finally {
        b.disabled = false;
      }
    };
    $('#attendance-table').addEventListener('click', async (event) => {
      const b = event.target.closest('[data-edit-record]');
      if (!b) return;
      const checkIn = prompt(
        '출근 시각 (ISO 형식, 비우면 변경 없음)',
        b.dataset.in,
      );
      if (checkIn === null) return;
      const checkOut = prompt(
        '퇴근 시각 (ISO 형식, 비우면 변경 없음)',
        b.dataset.out,
      );
      if (checkOut === null) return;
      const reason = prompt('수정 사유를 입력하세요');
      if (!reason) return;
      const body = { reason };
      if (checkIn) body.checkIn = checkIn;
      if (checkOut) body.checkOut = checkOut;
      try {
        await api('/admin/attendance/' + b.dataset.editRecord, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast('기록과 수정 이력을 저장했습니다.');
        await list.refresh(list.page);
      } catch (error) {
        toast(error.message);
      }
    });
    await list.refresh();
  }
  async function employeeAttendance(v) {
    v.innerHTML = `<div class="page-head"><div><h1>내 근태 기록</h1><p>본인의 출퇴근 내역과 월별 현황입니다.</p></div></div><div class="stats-grid" id="my-stats">${FPUI.skeleton(2)}</div><section class="panel table-panel"><div class="toolbar"><div class="toolbar-group">${dateControls('my')}</div><button class="btn btn-soft" id="my-load">조회</button></div><div id="my-table"></div></section>`;
    $('#my-to').value = today();
    $('#my-from').value = today().slice(0, 7) + '-01';
    const list = FPUI.serverTable(
      $('#my-table'),
      (page) =>
        api(
          '/employee/attendance?' +
            new URLSearchParams({
              from: $('#my-from').value,
              to: $('#my-to').value,
              page,
              pageSize: 25,
            }),
        ),
      (x) =>
        x.records.length
          ? table(
              ['날짜', '시각', '유형', '인증 경로'],
              x.records
                .map(
                  (r) =>
                    `<tr><td>${esc(r.work_date)}</td><td>${timeFmt(r.occurred_at)}</td><td>${badge(r.event_type === 'in' ? '출근' : r.event_type === 'out' ? '퇴근' : '기존 일일 기록')}</td><td>${r.source === 'shared_qr' ? '회사 공용 QR' : '기존 기록'}</td></tr>`,
                )
                .join(''),
            )
          : empty(),
      (x) => {
        $('#my-stats').innerHTML = [
          ['출근 이벤트', x.summary.present],
          ['퇴근 이벤트', x.summary.checkouts],
          ['미완료 근무 구간', x.summary.openShifts],
          [
            '근무 시간',
            `${Math.floor(x.summary.minutes / 60)}시간 ${x.summary.minutes % 60}분`,
          ],
        ]
          .map(
            (a) =>
              `<article class="stat-card"><div class="stat-label">${a[0]}</div><div class="stat-value">${a[1]}</div></article>`,
          )
          .join('');
      },
    );
    $('#my-load').onclick = () => list.refresh();
    await list.refresh();
  }
  window.FactoryPassLists = { employees, attendance, employeeAttendance };
})();
