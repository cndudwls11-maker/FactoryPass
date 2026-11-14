# FactoryPass

FactoryPass는 회사 공용 QR 코드로 출퇴근을 기록하고 관리하는 스마트 근태관리 웹 서비스입니다. Cloudflare Pages Functions와 D1을 사용해 로그인, 권한 확인, 근태 이벤트 저장을 서버에서 처리합니다.

**배포 서비스:** [https://factorypass.pages.dev](https://factorypass.pages.dev)\
**소스 코드:** [GitHub 저장소](https://github.com/cndudwls11-maker/FactoryPass)

## 주요 기능

관리자는 직원과 부서, 근무 일정, 공용 QR, 출퇴근 기록을 한곳에서 관리할 수 있습니다. 관리자 화면에는 대시보드, 직원 관리, 공용 QR, 근태 기록, 일정, 통계, 환경설정 메뉴가 있습니다.

직원은 계정을 만들고 로그인한 뒤 스마트폰으로 관리자가 발급한 공용 QR을 스캔해 출퇴근을 확인·기록합니다. QR은 30초 동안 유효하며, 기록은 직원별 출퇴근 이벤트로 저장되어 하루 여러 차례의 출근·퇴근도 지원합니다.

서비스는 반응형 PC·태블릿·모바일 화면, 근태 통계와 CSV 내보내기, 근태 수정 이력, 야간 근무 일정 계산을 지원합니다. 과거 개인 QR 발급 기능은 비활성화되어 있으며, 기존 데이터는 호환성과 보존을 위해 유지합니다.

## 기술 구성

FactoryPass의 화면은 HTML, CSS, JavaScript로 구성하고, 서버 API는 Cloudflare Pages Functions에서 실행합니다. Cloudflare D1이 계정·근태 데이터를 저장하며, SQL 스키마와 순차 migration은 `schema.sql`과 `migrations/`에서 관리합니다.

인증에는 서버 측 역할 및 계정 상태 검사, HttpOnly 세션 쿠키, CSRF 토큰, PBKDF2-SHA256 비밀번호 해시를 적용했습니다. QR 토큰은 URL fragment를 사용하고 데이터베이스에는 토큰 해시를 저장합니다.

## 배포 및 운영

서비스는 Cloudflare Pages에서 제공하며 현재 공개 주소는 [factorypass.pages.dev](https://factorypass.pages.dev)입니다. Pages 프로젝트는 GitHub 저장소의 `main` 브랜치에 연결하고, Framework preset은 None, Build command는 비워 두며 Build output directory는 `.`(저장소 루트)로 설정합니다. 정적 파일은 루트에서 제공하고 `functions/`의 API는 Pages Functions로 배포됩니다.

운영 배포에는 Cloudflare D1 데이터베이스와 Pages Functions의 `DB` 바인딩이 필요합니다. Cloudflare Dashboard에서 Production과 Preview 각각에 기존 `factorypass-db` 데이터베이스를 연결하세요. `wrangler.toml`에는 데이터베이스 ID와 `APP_TIMEZONE=Asia/Seoul`이 설정되어 있습니다. 기존 데이터베이스를 새로 만들거나 삭제하지 말고, migration 적용은 승인된 운영 절차를 따르세요.

최초 관리자를 만들기 전에 Pages secret `INIT_ADMIN_SECRET`을 설정하고, HTTPS 도메인에서 관리자 초기화 API를 한 번 호출해야 합니다. 강력한 일회용 비밀을 안전하게 관리하고 코드나 저장소에 기록하지 마세요. 초기화에 성공하면 해당 secret을 제거하거나 교체하고 안전하게 폐기하세요.

실제 직원 데이터를 사용하기 전에는 HTTPS, D1 연결, 관리자 secret, 백업·복구와 데이터 보존 절차를 확인하세요. 운영 환경 설정과 관리자 초기화의 상세 절차는 아래를 참고하세요.

<details>
<summary>Cloudflare Pages 상세 배포 및 최초 관리자 설정</summary>

1. Node.js LTS를 설치하고 Wrangler를 준비합니다.

   ```powershell
   npm install -g wrangler
   wrangler login
   ```

2. Pages 프로젝트에서 GitHub 저장소 `cndudwls11-maker/FactoryPass`의 `main` 브랜치를 연결합니다. Framework preset은 None, Build command는 비워 두고 Build output directory는 `.`로 설정합니다.

3. Cloudflare Dashboard의 Pages > Settings > Functions > D1 database bindings에서 Production과 Preview 모두 변수 이름 `DB`를 기존 `factorypass-db`에 연결합니다. 이름은 코드의 `env.DB`와 일치해야 합니다.

4. 무작위 32바이트 이상의 일회용 비밀을 안전한 도구로 생성하고, 프롬프트에 입력해 Pages secret으로 등록합니다. 값은 명령 인자나 저장소에 넣지 않습니다.

   ```powershell
   wrangler pages secret put INIT_ADMIN_SECRET --project-name factorypass
   ```

   Pages 프로젝트 이름이 다르면 실제 이름을 사용하세요.

5. HTTPS 배포 후 운영 터미널에서 아래 명령을 실행해 초기 관리자 정보를 입력합니다. `YOUR-PAGES-DOMAIN`을 실제 도메인으로 바꾸세요. 비밀번호와 초기 비밀은 명령 인자나 셸 기록에 넣지 마세요.

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

   초기화 엔드포인트는 관리자 계정이 이미 있으면 409를 반환합니다. 초기화가 끝나면 `INIT_ADMIN_SECRET`을 제거하거나 교체하고 안전하게 폐기하세요.

</details>

## 로컬 개발

로컬에서는 Wrangler Pages 개발 서버와 별도의 격리된 D1 데이터베이스를 사용해 화면과 API를 함께 실행합니다. 저장소 루트에서 의존 도구를 설치하고 로컬 migration을 적용한 다음 Pages 개발 서버를 시작하세요.

```powershell
npm install -g wrangler
wrangler d1 migrations apply factorypass-db --local
npm run dev
```

`npm run dev`는 빌드 산출물을 `dist/`에서 제공하고 포트 8788에서 실행합니다. 개발 의존성 설치가 필요하면 `npm install`을 먼저 실행하세요. 기본 Wrangler 실행 설정은 `wrangler.toml`의 D1 바인딩을 사용합니다.

카메라 기능은 브라우저 보안 정책에 따라 localhost 또는 HTTPS에서만 사용할 수 있습니다. `index.html`을 파일로 직접 열면 API와 데이터 저장이 동작하지 않으며, D1 바인딩이 없으면 API는 503을 반환합니다. 로컬 D1 검증에 운영 데이터베이스를 사용하지 마세요.

## 계정 및 근태 동작

신규 직원 계정은 `employee` 역할과 `approved` 상태로 생성되어 가입 후 바로 로그인할 수 있습니다. 관리자는 직원 화면에서 계정을 비활성화하거나 재활성화할 수 있습니다. 이전에 생성된 `pending` 계정은 자동 승인되지 않으며, 별도의 관리자 판단과 지원 절차가 필요합니다.

부서별 근무 일정을 설정하려면 먼저 환경설정에서 부서를 등록하세요. 일정에는 야간 근무와 휴무 요일·휴무일을 설정할 수 있습니다. 과거 일정 이후 기록이 없는 직원은 조회에서 결근으로 분류되지만, 정기 자동 결근 기록 생성은 제공하지 않습니다.

관리자는 근태 기록을 수정할 수 있으며, 수정 사유와 수정자, 변경 전후 내용은 `attendance_edit_logs`에 기록됩니다. 공용 QR 인증은 직원 계정으로 로그인한 스마트폰에서 마무리되며, 서버가 세션 상태와 직원 ID, claim 만료, 중복 요청을 검사합니다.

## 범위와 보안 참고

독립 키오스크와 QR 단말기 관리, 비밀번호 재설정 메일, 오프라인 PWA, 조직별 일정 대량 편집, 자동 결근 배치 작업은 현재 제공하지 않습니다. 과거 migration과 개인 QR·단말기 관련 데이터는 보존하며, 호환성을 깨뜨릴 수 있는 임의 삭제나 migration을 수행하지 마세요.

신규 비밀번호는 128-bit 무작위 salt와 PBKDF2-HMAC-SHA256 100,000회로 해시합니다. 기존 310,000회 해시는 현재 런타임의 검증 상한을 넘어 자동 변환할 수 없으므로, 해당 계정은 별도의 본인 확인 절차를 거쳐 비밀번호를 재설정해야 합니다.

웹 폰트와 QR·차트 라이브러리는 외부 CDN에서 불러옵니다. 운영 전에는 secret 회전, 접근 로그, 백업·복구, 데이터 보존 기간, 개인정보 고지와 HTTPS 도메인을 검토하세요. 이 프로젝트는 법률 또는 보안 감사를 대체하지 않습니다.

## 프로젝트 파일

- `index.html`, `styles.css`, `app.js`: 반응형 프런트엔드
- `functions/api/[[path]].js`: Pages Functions API
- `functions/_lib/`: 인증, 일정, 공용 QR 도메인 로직
- `functions/_middleware.js`: 보안 응답 헤더
- `schema.sql`, `migrations/`: D1 스키마와 migration
- `wrangler.toml`: Cloudflare Pages 및 D1 설정 템플릿