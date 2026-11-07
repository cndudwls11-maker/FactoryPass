# FactoryPass

QR 코드 기반 단일 회사 스마트 공장 근태관리 서비스입니다. 정적 화면뿐 아니라 Cloudflare Pages Functions와 D1을 이용하는 서버/API 및 SQL 스키마를 포함합니다. 실제 직원 데이터용 운영 전에는 반드시 HTTPS, D1, 관리자 시크릿 설정을 완료하세요.

## 들어 있는 구현

- `/` 공개 서비스 소개, `/login`, `/signup`, `/pending`
- `/admin`, `/admin/employees`, `/admin/scanner`, `/admin/attendance`, `/admin/schedules`, `/admin/statistics`, `/admin/settings`
- `/employee`, `/employee/attendance`, `/employee/profile`
- 로그인 공통 처리와 서버 측 역할/승인 검증, HttpOnly 세션 쿠키, CSRF 토큰, PBKDF2-SHA256 비밀번호 해시
- 승인 대기 근로자 가입, 관리자 승인/비활성화, 매일 직원별 랜덤 QR 토큰, QR 스캔 출퇴근 기록, D1 기반 조회/통계/CSV, 기록 수정 이력
- 카메라 기반 QR 스캔(html5-qrcode), QR 표시(qrcodejs), 그래프(Chart.js)
- 반응형 PC/태블릿/모바일 UI

## Cloudflare 배포 준비

1. Node.js LTS 및 Wrangler를 준비합니다. 프로젝트 폴더에서 `npm install -g wrangler` 후 `wrangler login`을 실행합니다.
2. D1 DB를 생성합니다: `wrangler d1 create factorypass-db`. 출력된 database ID를 `wrangler.toml`의 `database_id`에 입력하세요. 이 파일의 `REPLACE_WITH_D1_DATABASE_ID`는 교체 전에는 유효한 배포 설정이 아닙니다.
3. 스키마 적용: `wrangler d1 migrations apply factorypass-db --remote`. 로컬 테스트에는 `--local`을 사용합니다. `migrations/0001_initial.sql`이 실제 migration입니다. `schema.sql`은 참고용 전체 초기화 SQL입니다.
4. 최초 관리자 생성용 강력한 일회용 비밀을 Cloudflare secret으로 등록합니다: `wrangler secret put INIT_ADMIN_SECRET`. 무작위 32바이트 이상의 값을 안전한 비밀 관리 도구로 생성하고 CLI 입력 프롬프트에만 붙여 넣으세요. 값은 코드/저장소에 입력하지 않습니다.
5. `wrangler pages dev .`로 Pages Functions를 로컬 구동하거나 Cloudflare Pages 프로젝트에 저장소를 연결해 배포합니다. 정적 빌드 명령은 없으며 output directory는 프로젝트 루트(`.`)입니다. Cloudflare Dashboard에서도 D1 binding 이름을 정확히 `DB`로 연결해야 합니다. `_routes.json`은 `/api/*`만 Function에 보내고 정적 UI 경로는 Pages 정적 자산으로 처리합니다.
6. HTTPS 배포 후 관리자 계정을 **한 번만** 초기 생성합니다. 브라우저 개발자 도구가 아닌 안전한 운영 터미널에서 아래 명령으로 비밀 입력을 읽어 초기 API에 전송하세요. 비밀번호와 초기 비밀을 명령 인자/셸 기록에 넣지 마세요.

```powershell
$initSecret = Read-Host 'INIT_ADMIN_SECRET'
$adminName = Read-Host '관리자 표시 이름'
$adminId = Read-Host '관리자 아이디 또는 이메일'
$adminPassword = Read-Host '14자 이상 관리자 비밀번호' -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $adminPassword).Password
$body = @{ name=$adminName; identity=$adminId; password=$plain } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://YOUR-PAGES-DOMAIN/api/admin/init' -Headers @{ 'X-Init-Secret'=$initSecret } -ContentType 'application/json' -Body $body
Remove-Variable initSecret,adminPassword,plain,body
```

`YOUR-PAGES-DOMAIN`을 실제 HTTPS 주소로 바꾸세요. 초기화 엔드포인트는 이미 admin이 존재하면 409로 거부합니다. 성공하면 `INIT_ADMIN_SECRET`을 Cloudflare에서 제거하거나 교체하고 안전하게 폐기하세요. 운영 셸/프로세스의 메모리·기록 보호는 조직 보안 정책에 따르세요.

## 개발/로컬 실행

`wrangler.toml`의 D1 ID를 설정한 뒤 `wrangler d1 migrations apply factorypass-db --local` 및 `wrangler pages dev .`를 실행합니다. 카메라 API는 localhost 또는 HTTPS에서만 브라우저가 허용합니다. Wrangler/Cloudflare 계정 설정 없이는 브라우저에서 `index.html`만 열어 실제 로그인·저장·스캔이 되지 않습니다. D1 바인딩이 없을 경우 API는 503을 반환하며 UI에서 설정 안내를 보여줍니다.

가입은 일반 근로자 역할로만 생성되고 승인 대기 상태입니다. 관리자가 `/admin/employees`에서 승인해야 근로자 화면 및 QR 발급을 사용할 수 있습니다. 부서별 근무 일정을 쓰려면 먼저 환경설정에서 부서를 등록하세요.

## 보안·기능 참고

- 비밀번호는 PBKDF2-HMAC-SHA256 310,000회로 해시되며 세션 ID는 HttpOnly/Secure/SameSite=Strict 쿠키에만 보관합니다. API는 서버 역할과 승인 상태를 검사합니다.
- 가입과 QR 모두 개인정보 대신 난수/해시 토큰을 씁니다. 동일 직원·근무일 출석 행과 토큰 행에 DB uniqueness 제약을 적용합니다. 하루 QR은 한국 날짜 자정 만료이며 화면 조회 시 재발급되어 이전 토큰을 폐기합니다.
- 근로자 QR은 해당 근무일에 유효하고, 지금 구현은 일일 고정 토큰입니다. 짧은 주기 동적 회전은 UI 안내만 있는 확장 포인트이며 아직 구현되지 않았습니다. 대리 출퇴근 방지를 위해 실제 도입 전 생체 확인/현장 키오스크 등 추가 수단 검토가 필요합니다.
- 야간 시간대를 일정으로 지원하고 다음 날짜 퇴근 예정 시각을 계산합니다. 스케줄의 휴무 요일 및 휴무일을 체크하며, 과거 일정 종료 후 기록이 없는 사람은 조회 결과에서 결근으로 분류합니다. 아직 정기적인 자동 결근 레코드 생성 작업은 없습니다.
- 근태 수정은 사유, 수정자, 변경 전후 JSON을 `attendance_edit_logs`에 남깁니다. 사용자 접근 제한은 서버 API에서 강제합니다.
- 웹 폰트·QR/차트 라이브러리는 외부 CDN에서 로드합니다. 오프라인 캐시/PWA, 비밀번호 재설정 메일, 개인정보·약관 실제 법무 문구, 조직별 근무 스케줄 달력 대량 편집, 자동 결근 배치 작업은 구현 범위 밖입니다.
- 실제 운영 배포 전에 보안 검토(시크릿 회전, 백업/복구, 접근 로그, 데이터 보존 기간, HTTPS 도메인, 개인정보 처리 고지)를 수행하세요. 본 코드는 법률/보안 감사를 대체하지 않습니다.

## 파일

- `index.html`, `styles.css`, `app.js`: 반응형 프런트엔드
- `functions/api/[[path]].js`: Pages Functions API
- `functions/_lib/`: 인증과 일정 도메인 로직
- `functions/_middleware.js`: 보안 응답 헤더
- `schema.sql`, `migrations/0001_initial.sql`: D1 스키마와 초기 migration
- `wrangler.toml`: Cloudflare Pages/D1 설정 템플릿