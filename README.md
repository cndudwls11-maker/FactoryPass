# FactoryPass

QR 코드 기반 단일 회사 스마트 공장 근태관리 서비스입니다. 정적 화면뿐 아니라 Cloudflare Pages Functions와 D1을 이용하는 서버/API 및 SQL 스키마를 포함합니다. 실제 직원 데이터용 운영 전에는 반드시 HTTPS, D1, 관리자 시크릿 설정을 완료하세요.

## 들어 있는 구현

- `/`, `/login`, `/signup`, `/signup-complete` (`/pending`는 이전 북마크용으로 로그인 화면으로 이동)
- `/admin`, `/admin/employees`, `/admin/scanner`, `/admin/attendance`, `/admin/schedules`, `/admin/statistics`, `/admin/settings`
- `/employee`, `/employee/attendance`, `/employee/profile`
- 로그인 공통 처리와 서버 측 역할/계정 상태 검증, HttpOnly 세션 쿠키, CSRF 토큰, PBKDF2-SHA256 비밀번호 해시
- 근로자 즉시 활성 가입, 관리자 직원 계정 비활성화/재활성화, 매일 직원별 랜덤 QR 토큰, QR 스캔 출퇴근 기록, D1 기반 조회/통계/CSV, 기록 수정 이력
- 카메라 기반 QR 스캔(html5-qrcode), QR 표시(qrcodejs), 그래프(Chart.js)
- 반응형 PC/태블릿/모바일 UI

## Cloudflare 배포 준비

1. Node.js LTS 및 Wrangler를 준비합니다. 프로젝트 폴더에서 `npm install -g wrangler` 후 `wrangler login`을 실행합니다.
2. 기존 D1 데이터베이스 `factorypass-db`를 사용합니다. 설정에는 Database ID `7baf97be-a716-4938-b95d-8b4434df4fff`와 바인딩 `DB`가 지정되어 있습니다. 새 데이터베이스를 만들거나 기존 데이터베이스를 삭제하지 마세요.
3. 스키마 적용/확인: `wrangler d1 migrations list factorypass-db --remote`로 상태를 조회한 뒤 `wrangler d1 migrations apply factorypass-db --remote`를 실행합니다. `0001_initial.sql`은 앱에서 필요한 테이블과 기본 설정을 생성하며 `0002_query_indexes.sql`은 조회 성능 인덱스를 추가합니다. 모두 비파괴적이고 기존 레코드를 삭제하지 않습니다. 이미 0001이 적용된 환경에는 0002만 적용됩니다. 로컬 테스트에는 `--local`을 사용합니다. `schema.sql`은 참고용 전체 스키마입니다.
4. 최초 관리자 생성용 강력한 일회용 비밀을 Cloudflare Pages Functions secret으로 등록합니다: `wrangler pages secret put INIT_ADMIN_SECRET --project-name factorypass`. Pages 프로젝트 이름이 다르면 실제 이름을 사용하세요. 무작위 32바이트 이상의 값을 안전한 비밀 관리 도구로 생성하고 CLI 입력 프롬프트에만 붙여 넣으세요. 값은 코드/저장소에 입력하지 않습니다.
5. Cloudflare Pages 프로젝트는 GitHub 저장소 `cndudwls11-maker/FactoryPass`의 `main` 브랜치에 연결하고, Framework preset은 None, Build command는 비워 두며 Build output directory는 `.` (저장소 루트)로 지정합니다. `wrangler.toml`의 `pages_build_output_dir = "."`도 정적 파일 출력 경로입니다. Functions는 저장소 루트의 `functions/`에서 배포됩니다. `_routes.json`은 `/api/*`만 Function에 보내고 나머지 정적 경로는 정적 자산으로 처리합니다.
6. Cloudflare Dashboard의 Pages > Settings > Functions > D1 database bindings에서 **Production과 Preview 각각** 변수 이름 `DB`를 위 D1 데이터베이스에 연결하세요. 이름은 코드의 `env.DB`와 정확히 같아야 합니다. `APP_TIMEZONE=Asia/Seoul`은 wrangler 설정의 변수입니다. `INIT_ADMIN_SECRET`은 환경 변수로 공개하지 말고 Pages secret으로 설정합니다. Cloudflare Dashboard에서 직접 설정한 bindings/secrets가 배포 환경에 실제 연결됐는지 확인하세요.
7. HTTPS 배포 후 관리자 계정을 **한 번만** 초기 생성합니다. 브라우저 개발자 도구가 아닌 안전한 운영 터미널에서 아래 명령으로 비밀 입력을 읽어 초기 API에 전송하세요. 비밀번호와 초기 비밀을 명령 인자/셸 기록에 넣지 마세요.

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

`YOUR-PAGES-DOMAIN`을 실제 HTTPS 주소로 바꾸세요. 초기화 엔드포인트는 이미 admin이 존재하면 409로 거부합니다. 성공하면 `INIT_ADMIN_SECRET`을 Cloudflare Pages secret에서 제거하거나 교체하고 안전하게 폐기하세요. 운영 셸/프로세스의 메모리·기록 보호는 조직 보안 정책에 따르세요.

## 개발/로컬 실행

`FactoryPass/` 작업 폴더에서 `wrangler d1 migrations apply factorypass-db --local` 및 `wrangler pages dev . --d1 DB=factorypass-db`를 실행합니다. Pages 배포에서 실제 DB 연결은 Dashboard D1 binding으로 별도 검증하세요. 카메라 API는 localhost 또는 HTTPS에서만 브라우저가 허용합니다. Wrangler/Cloudflare 계정 설정 없이는 브라우저에서 `index.html`만 열어 실제 로그인·저장·스캔이 되지 않습니다. D1 바인딩이 없을 경우 API는 503을 반환하며 UI에서 설정 안내를 보여줍니다.

회원가입은 `employee` 역할과 `approved` 상태로 즉시 생성되어 가입 완료 후 바로 로그인할 수 있습니다. 관리자는 `/admin/employees`에서 계정을 비활성화하거나 재활성화할 수 있습니다. 변경 이전에 가입된 `pending` 상태 사용자는 자동 승인하지 않으며 로그인도 차단된 채로 유지됩니다. 기존 계정은 별도 관리자 판단과 지원 절차로 처리해야 합니다. 부서별 근무 일정을 쓰려면 먼저 환경설정에서 부서를 등록하세요.

## 보안·기능 참고

- 비밀번호는 PBKDF2-HMAC-SHA256 310,000회로 해시되며 세션 ID는 HttpOnly/Secure/SameSite=Strict 쿠키에만 보관합니다. API는 서버 역할과 계정 상태를 검사합니다.
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