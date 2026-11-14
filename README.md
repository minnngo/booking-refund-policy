# booking-refund-policy

[![CI](https://github.com/minnngo/booking-refund-policy/actions/workflows/ci.yml/badge.svg)](https://github.com/minnngo/booking-refund-policy/actions/workflows/ci.yml)

예약 서비스에서 **취소 시점에 따른 환불액을 계산**하고, **환불 응답이 끊겼을 때 이중 환불 없이 상태를 확정**하는 TypeScript 라이브러리와 CLI입니다.

실제 운영 중인 1:1 상담 예약 서비스 [Pincette Pacemaker](https://www.pincettepacemaker.com)의 백엔드에서 결제사 연동과 DB를 덜어 내고, 정책과 판단 로직만 옮겨 왔습니다.

```sh
$ refund-quote --amount 49000 --starts-at 2026-11-20T15:00+09:00 --now 2026-11-19T16:00+09:00
환불 예상 (시작까지 23시간 0분 남음)
- 결제 금액: 49,000원
- 환불 금액: 24,500원 (50%)
- 취소 수수료: 24,500원
- 취소 가능: 예
- 사유: late_cancellation_partial_refund
```

## 어떤 문제를 푸나요

### 1. 시간 경계에서 틀리기 쉬운 환불 계산

"24시간 전까지 전액, 2시간 전까지 50%" 같은 규칙은 간단해 보이지만, **정확히 24시간일 때**, **1ms 모자랄 때**, **금액이 홀수일 때** 결과가 코드마다 달라지기 쉽습니다. 이 라이브러리는 경계를 하나의 함수에 모으고, 현재 시각을 인자로 받아 경계 앞뒤 1ms까지 테스트합니다.

| 시작까지 남은 시간 | 환불 | `reason` |
| --- | --- | --- |
| 24시간 이상 | 100% | `standard_full_refund` |
| 2시간 초과 ~ 24시간 미만 | 50% (원 단위 내림) | `late_cancellation_partial_refund` |
| 0 초과 ~ 2시간 이하 | 0원, 취소는 가능 | `imminent_cancellation_no_refund` |
| 0 이하 | 취소 불가 | `session_started` |

기준 시간과 비율은 바꿀 수 있습니다. → [정책 문서](docs/policy.md)

### 2. 응답이 끊긴 환불을 다시 시도하면 두 번 환불될 수 있음

결제사에서는 환불이 끝났는데 응답만 유실되는 경우가 있습니다. 이때 결제를 "환불 안 됨"으로 되돌리면 다음 재시도에서 **두 번 환불**됩니다. 실제 서비스에서 테스트 시나리오를 돌리다 이 문제를 발견했고, 아래 방식으로 고쳤습니다.

- 같은 환불에는 항상 같은 **멱등성 키**를 보냅니다.
- 응답을 받지 못하면 결제사에 **실제 상태를 다시 조회**합니다.
- 결제 키·총액·잔액·상태가 모두 기대와 같을 때만 `refunded`, 결제 직후 그대로일 때만 `unchanged`를 돌려줍니다.
- 그 밖에는 `uncertain`을 돌려줘, 호출한 쪽이 **재환불을 막고 운영자가 확인**하게 합니다.

## 설치

아직 npm에 배포하지 않았습니다. 저장소를 받아 사용합니다.

```sh
git clone https://github.com/minnngo/booking-refund-policy.git
cd booking-refund-policy
corepack enable   # package.json의 pnpm 버전을 그대로 사용
pnpm install
pnpm build
```

Node.js 22.18 이상이 필요합니다. (TypeScript 파일을 빌드 없이 바로 실행하는 type stripping 사용)

## 사용법

### 환불 계산

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

정책 바꾸기:

```ts
calculateRefundQuote({
  amountKrw: 10_000,
  startsAt,
  policy: { fullRefundHours: 48, partialRefundRate: 30, noRefundHours: 6 },
});
```

`reason`은 문자열 유니온 타입이라, `switch`에서 빠뜨린 경우를 컴파일 단계에서 잡을 수 있습니다.

### 환불 요청과 복구

결제사 연동은 `PaymentProvider` 인터페이스로 주입합니다. 실제 Toss Payments 클라이언트나 테스트용 가짜 구현을 넣을 수 있습니다.

```ts
import { processRefund, RefundNotSentError, type PaymentProvider } from "booking-refund-policy";

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

switch (outcome.status) {
  case "refunded":  /* DB를 환불 완료로 마무리 */ break;
  case "unchanged": /* 결제를 원래 상태로 되돌림, 재시도 가능 */ break;
  case "uncertain": /* 환불 진행 상태 유지, 운영자 확인 대기 */ break;
}
```

### CLI

```sh
pnpm quote --amount 49000 --starts-at 2026-11-20T15:00+09:00          # 빌드 없이 실행
node dist/bin.js --amount 49000 --starts-at 2026-11-20T15:00+09:00 --json
node dist/bin.js --help
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

전체 API는 [docs/api.md](docs/api.md)에 있습니다.

## 설계 원칙

- **현재 시각을 숨기지 않습니다.** 시간에 따라 결과가 바뀌는 함수는 모두 `now`를 인자로 받아, 같은 입력에 항상 같은 결과를 냅니다.
- **결과의 종류를 타입으로 닫습니다.** `reason`과 `RefundOutcome.status`는 유니온 타입이며, `RefundOutcome`은 `status`에 따라 `error` 필드 유무가 정해집니다.
- **외부 서비스는 주입받습니다.** 결제사 호출을 인터페이스로 분리해, 실제 결제 없이 응답 유실·장애·잘못된 응답을 모두 테스트합니다.
- **결제사를 스스로 다시 호출하지 않습니다.** `processRefund`는 환불 1번, 필요할 때 조회 1번만 합니다. 재시도 여부는 호출한 쪽의 상태(DB)가 결정합니다.
- **잘못된 입력은 결제사에 닿기 전에 막습니다.** 환불 금액이 0이거나 결제 금액보다 크면 `RangeError`를 던집니다.

## 개발

```sh
pnpm typecheck   # tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
pnpm lint        # ESLint + typescript-eslint strictTypeChecked
pnpm test        # node:test, 테스트 51개
pnpm build       # dist/에 .js, .d.ts, source map 생성
pnpm check       # 위 4개를 순서대로
```

PR과 main push마다 GitHub Actions가 Node 22·24에서 위 검사를 모두 실행하고, 빌드 결과물로 CLI를 한 번 돌려 봅니다.

```
src/
  refund-policy.ts     # 시간 구간별 환불 계산
  refund-recovery.ts   # 멱등성 키 + 결제사 재조회로 환불 결과 확정
  time-window.ts       # "N시간 안에 시작하는가" 판별
  cli.ts               # CLI 로직 (테스트를 위해 입출력을 주입받음)
  bin.ts               # CLI 실행 파일
  index.ts             # 공개 API
tests/                 # 모듈별 테스트, 경계값·실패 시나리오
docs/
  api.md               # API 레퍼런스
  policy.md            # 환불 정책과 복구 판단 기준
AGENTS.md              # 이 저장소에서 일하는 AI 코딩 에이전트를 위한 규칙
```
