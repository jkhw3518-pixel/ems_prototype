# 새한프라텍 EMS 비가동 분석 시스템

`PRD_v2.md` 기준 구현. Next.js 15 (App Router) · TypeScript · Tailwind · Recharts · Drizzle ORM · PostgreSQL.

## 빠른 시작 (로컬, DB 설치 불필요)

```bash
pnpm install
pnpm db:seed-demo 56     # 가상 데이터 56일 생성 (로컬 PGlite: ./.pglite)
pnpm dev                 # http://localhost:3000
```

`DATABASE_URL` 이 없으면 내장 PGlite(WASM Postgres)로 동작하고, 첫 접속 시 스키마·시드가 자동 적용됩니다.
헤더의 **로컬 DB** 배지로 현재 모드를 확인할 수 있습니다.

## 운영 DB 연결

```bash
# .env.local
DATABASE_URL=postgresql://...:15432/saehan?sslmode=require
pnpm db:migrate          # v1 스키마 위에 v2 테이블/컬럼 추가 (멱등, 기존 데이터 유지)
```

마이그레이션은 `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` 만 사용하며, v1 `cause` 문자열을 §7.2 매핑에 따라 `cause_code` 로 옮깁니다.

원격 데이터를 로컬에서 먼저 확인하려면 (원격은 읽기 전용 세션으로 접속):

```bash
SOURCE_DATABASE_URL=postgresql://... pnpm db:import-remote
```

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 대시보드 — 평균 가동율(분 가중) + 전일/전주 증감, KPI 3종, 설비별 스택바(알림 임계 미달 🔔), TOP5 구간, 원인 분류율, 전력 추가 사용분 |
| `/equipment/:code` | 1분 전류 그래프 + 상태 타임라인(원인 색 오버레이), 2단 원인 선택·추천 원클릭 확정·일괄 분류, 30일 스파크라인, MOLD 실적 |
| `/causes` | 원인 파레토(대분류 → 세부원인 → 구간 드릴다운), 설비×원인 히트맵, 분류율·MTBF·MTTR, 미분류 작업함 |
| `/trends` | 일/주/월 가동율 꺾은선(최대 8대), 95%/80%/알림 기준선, 계획정지 제외·동일 경과일수 비교, 공장/그룹 평균·하위 5대 프리셋 |
| `/alerts` | 알림 이력 (미확인/진행 중/확인됨/복구됨), 채널별 발송 결과, 확인 처리 |
| `/upload` | EMS JSON / MOLD xls 드래그앤드롭 → 자동 분석 → 원인 추천 → 알림 평가 |
| `/settings` | 판정 기준 · 설비 · 비가동 원인 · 알림 규칙(미리보기 포함) · 수신 채널(테스트 발송) |

## 분석 규칙 요약

- 하루 = 07:00 ~ 익일 07:00 (KST). 타임존 없는 시각은 KST 로 해석합니다.
- 전류 ≤ 완전정지 임계 → 완전정지, ≤ 비가동 상한이 지속 조건 이상 → 비가동, 그 외 정상가동.
- 정상가동 10분 이하 → 종일 정지. 연속 정지 또는 정지 합계 ≥ 1,320분 → 미가동 설비로 제외(가동율 분모·알림 대상 제외).
- 데이터가 하루 중간에 끝나면 마지막 데이터 시각까지만 대상분으로 계산합니다 (대시보드에 경고 표시).
- 1~2분 결측은 직전 값으로 보정, 3분 이상 결측은 0A 로 간주합니다.
- 재분석해도 같은 구간(설비·상태·시작분)의 원인 분류·메모는 유지됩니다.

## 알림

- Vercel Cron 이 매일 07:30(KST) `GET /api/alerts/evaluate` 호출 (`vercel.json`, `Authorization: Bearer $CRON_SECRET`). Hobby 요금제는 하루 1회까지만 가능 — Pro 에서 실시간 수집 시 `*/5 * * * *` 로 변경.
- 업로드/분석 직후에는 서버 내부에서 바로 평가합니다 (배치 업로드 시 지속시간 알림은 "사후 탐지"로 표기).
- 최근 10분 내 리딩이 들어오는 실시간 수집 환경에서는 진행 중인 정지 구간·최근 2시간 가동율도 평가합니다.
- 중복 억제(dedup_key) · 쿨다운 · 설비·사유별 일 10건 제한 · 방해금지(위험 등급 제외, 해제 후 묶음 발송) · 3회 재시도.
- 채널: 이메일(SMTP 또는 Resend) · Slack Incoming Webhook · 카카오 알림톡(Solapi). 설정은 `.env.example` 참고.
- `ALERT_DRY_RUN=true` 이면 실제 발송 없이 콘솔에만 출력합니다.

## 명령어

| 명령 | 설명 |
|---|---|
| `pnpm dev` / `pnpm build` | 개발 서버 / 프로덕션 빌드 |
| `pnpm test` | 파서·분석 엔진 자체 점검 (+ `samples/` 업로드 예시 생성) |
| `pnpm db:migrate` | 스키마·기본 시드 적용 |
| `pnpm db:seed-demo [일수]` | 로컬 데모 데이터 생성 (`DATABASE_URL` 설정 시 거부) |
| `pnpm db:import-remote` | 원격 DB 데이터를 현재 DB 로 복사 후 분석 |
| `pnpm db:sql "select ..."` | 현재 DB 에 SQL 실행 (점검용) |
