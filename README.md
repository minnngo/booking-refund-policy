# booking-refund-policy

[![CI](https://github.com/minnngo/booking-refund-policy/actions/workflows/ci.yml/badge.svg)](https://github.com/minnngo/booking-refund-policy/actions/workflows/ci.yml)

1:1 상담 예약 서비스 [Pincette Pacemaker](https://www.pincettepacemaker.com)의 환불 로직을 떼어 낸 TypeScript 라이브러리 · CLI입니다.

> "환불 응답이 끊겼는데, 다시 환불해도 될까?"
> 취소 시점별 환불액을 계산하고, 결제사 응답이 유실돼도 두 번 환불하지 않도록 상태를 확정합니다.

## 📖 프로젝트 소개

Pacemaker는 학생이 선배(페이스메이커)를 고르고, 예약·결제한 뒤 Zoom으로 상담을 받는 서비스입니다. 서비스 레포는 Private이라, 서버에서 가장 많이 고치고 테스트한 환불 로직을 결제사·DB와 분리해 공개했습니다.

| 문제 | 이 라이브러리가 하는 일 |
| --- | --- |
| 시간 경계에서 틀리기 쉬운 환불 계산 | "정확히 24시간", "1ms 모자람", "홀수 금액" 같은 경계를 함수 하나에 모으고, 현재 시각을 인자로 받아 테스트 |
| 응답이 끊긴 환불을 다시 시도하면 이중 환불 | 멱등성 키를 보내고, 응답을 못 받으면 결제사 상태를 다시 조회해 확실할 때만 결과 확정 |

## 🔄 Core Flow

### 1. 환불 계산

```
           0          noRefundHours        fullRefundHours
───────────┼─────────────────┼─────────────────────┼────────────▶ 남은 시간
 취소 불가  │   환불 0원       │   partialRefundRate% │  전액 환불
```

| 시작까지 남은 시간 | 환불 | `reason` |
| --- | --- | --- |
| 24시간 이상 | 100% | `standard_full_refund` |
| 2시간 초과 ~ 24시간 미만 | 50% (원 단위 내림) | `late_cancellation_partial_refund` |
| 0 초과 ~ 2시간 이하 | 0원, 취소는 가능 | `imminent_cancellation_no_refund` |
| 0 이하 | 취소 불가 | `session_started` |

기준 시간과 비율은 바꿀 수 있습니다. 경계 포함 여부는 [docs/policy.md](docs/policy.md)에 있습니다.

### 2. 환불 요청과 복구

1. **입력 검증** 환불 금액이 0이거나 결제 금액보다 크면 결제사를 호출하기 전에 `RangeError`
2. **환불 요청** 같은 환불에는 항상 같은 멱등성 키로 `cancel` 1번
3. **응답 확인** 결제 키·총액·잔액·상태가 기대와 같으면 `refunded`
4. **응답 유실 시 재조회** 결제사 상태를 `query` 1번 조회
5. **결과 확정** 환불 확인 → `refunded` / 결제 직후 그대로 → `unchanged` / 그 밖 → `uncertain`

| 결과 | 호출한 쪽이 할 일 |
| --- | --- |
| `refunded` | DB를 환불 완료로 마무리 |
| `unchanged` | 결제 상태를 원래대로 되돌리고, 같은 멱등성 키로 재시도 가능 |
| `uncertain` | 환불 진행 상태 유지, **재시도하지 않고** 운영자 확인 |

```sh
$ refund-quote --amount 49000 --starts-at 2026-11-20T15:00+09:00 --now 2026-11-19T16:00+09:00
환불 예상 (시작까지 23시간 0분 남음)
- 결제 금액: 49,000원
- 환불 금액: 24,500원 (50%)
- 취소 수수료: 24,500원
- 취소 가능: 예
- 사유: late_cancellation_partial_refund
```

## 🛠️ Tech Stack

| Category | Stack |
| --- | --- |
| Language | TypeScript (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes) |
| Runtime | Node.js 22.18+ (type stripping으로 빌드 없이 실행) |
| Test | node:test |
| Lint | ESLint, typescript-eslint (strictTypeChecked) |
| Build | tsc (.js, .d.ts, source map) |
| Package Manager | pnpm 10 |
| CI | GitHub Actions (Node 22 · 24) |

런타임 의존성은 없습니다.

## ✨ Key Features

### 1. 환불 계산 `calculateRefundQuote`

```ts
import { calculateRefundQuote } from "booking-refund-policy";

const quote = calculateRefundQuote({
  amountKrw: 49_000,
  startsAt: "2026-11-20T15:00:00+09:00",
  now: new Date("2026-11-19T16:00:00+09:00"), // 생략하면 현재 시각
});

quote.refundAmountKrw; // 24500
quote.reason;          // "late_cancellation_partial_refund"
```

- 정책 변경: `policy: { fullRefundHours: 48, partialRefundRate: 30, noRefundHours: 6 }`
- 모순된 정책(환불 불가 구간 ≥ 전액 환불 구간 등)은 `RangeError`
- `환불액 + 수수료 = 결제 금액`이 항상 성립

### 2. 환불 요청과 복구 `processRefund`

결제사 연동은 `PaymentProvider` 인터페이스로 주입합니다. 실제 Toss Payments 클라이언트나 테스트용 가짜 구현을 넣을 수 있습니다.

```ts
import { processRefund, type PaymentProvider } from "booking-refund-policy";

const toss: PaymentProvider = {
  cancel: ({ paymentKey, cancelAmount, cancelReason, idempotencyKey }) =>
    tossClient.cancel(paymentKey, { cancelAmount, cancelReason }, { idempotencyKey }),
  query: (paymentKey) => tossClient.getPayment(paymentKey),
};

const outcome = await processRefund(
  {
    paymentKey: "pay_...",
    amountKrw: 49_000,
    refundAmountKrw: 24_500,
    reason: "학생 취소",
    idempotencyKey: `student-cancel-${reservationId}`, // 예약마다 고정
  },
  toss,
);
```

- 결제사 호출은 `cancel` 최대 1번, `query` 최대 1번. 스스로 재시도하지 않습니다.
- 요청이 나가지 않았음이 확실하면 `RefundNotSentError`를 던져 조회 없이 `unchanged` 처리
- `RefundOutcome`은 `status`에 따라 `error` 필드 유무가 정해지는 유니온 타입

### 3. CLI `refund-quote`

```sh
pnpm quote --amount 49000 --starts-at 2026-11-20T15:00+09:00          # 빌드 없이 실행
node dist/bin.js --amount 49000 --starts-at 2026-11-20T15:00+09:00 --json
```

| 옵션 | 설명 | 기본값 |
| --- | --- | --- |
| `--amount` | 결제 금액(원), 필수 | |
| `--starts-at` | 예약 시작 시각(ISO 8601), 필수 | |
| `--now` | 기준 시각 | 현재 시각 |
| `--full-refund-hours` | 전액 환불 기준 시간 | 24 |
| `--partial-rate` | 부분 환불 비율(%) | 50 |
| `--no-refund-hours` | 환불 불가 기준 시간 | 2 |
| `--json` | JSON 출력 | |

종료 코드: `0` 성공 · `1` 입력값 오류 · `2` 사용법 오류

### 4. 기타 `isWithinUpcomingWindow`

`now < startsAt ≤ now + hours`인지 판별합니다. 예: 상담 24시간 전부터 화상 회의를 만드는 작업의 대상 판별.

전체 API는 [docs/api.md](docs/api.md)에 있습니다.

## 📐 Design Principles

- **현재 시각을 숨기지 않습니다.** 시간에 따라 결과가 바뀌는 함수는 모두 `now`를 인자로 받습니다.
- **결과의 종류를 타입으로 닫습니다.** `reason`과 `RefundOutcome.status`는 유니온 타입입니다.
- **외부 서비스는 주입받습니다.** 실제 결제 없이 응답 유실 · 장애 · 잘못된 응답을 모두 테스트합니다.
- **판단할 수 없으면 멈춥니다.** `uncertain`을 `unchanged`처럼 처리하면 이중 환불이 생길 수 있습니다.

## 📂 Project Structure

```
booking-refund-policy
├── src
│   ├── refund-policy.ts     # 시간 구간별 환불 계산
│   ├── refund-recovery.ts   # 멱등성 키 + 결제사 재조회로 환불 결과 확정
│   ├── time-window.ts       # "N시간 안에 시작하는가" 판별
│   ├── cli.ts               # CLI 옵션, 출력, 종료 코드
│   ├── bin.ts               # 실행 파일
│   └── index.ts             # 공개 API
├── tests                    # 경계값 · 실패 시나리오 테스트
├── docs
│   ├── api.md               # API 레퍼런스
│   └── policy.md            # 환불 정책과 복구 판단 기준
└── AGENTS.md                # AI 코딩 에이전트용 규칙
```

## 🧪 Test

```sh
corepack enable   # 또는 npx pnpm@10.25.0
pnpm install

pnpm typecheck    # tsc
pnpm lint         # ESLint
pnpm test         # node:test, 테스트 51개
pnpm build        # dist/
pnpm check        # 위 4개를 순서대로
```

| 테스트 | 확인하는 것 |
| --- | --- |
| `refund-policy.test.ts` | 정확히 24시간 · 2시간과 앞뒤 1ms, 원 단위 내림, 잘못된 금액 · 시각 · 정책 |
| `refund-recovery.test.ts` | 응답 유실 8가지 시나리오, 멱등성 키 전달, 결제사 호출 횟수 |
| `time-window.test.ts` | 창의 끝 포함 여부, 지난 시각 · 잘못된 값 |
| `cli.test.ts` | 출력 형식, JSON, 정책 옵션, 종료 코드 |

PR과 main push마다 GitHub Actions가 Node 22 · 24에서 typecheck → lint → test → build를 실행하고, 빌드 결과물로 CLI를 한 번 실행합니다.

## 📌 현재 구현 범위

- 시간 구간별 환불 계산과 정책 검증
- 멱등성 키 + 결제사 재조회 기반 환불 결과 확정
- 예약 시작 시간 창 판별
- `refund-quote` CLI (사람이 읽는 출력 / JSON)
- API 레퍼런스와 정책 문서
- GitHub Actions CI
