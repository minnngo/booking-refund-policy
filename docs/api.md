# API 레퍼런스

모든 공개 API는 `booking-refund-policy`에서 가져옵니다.

```ts
import { calculateRefundQuote, processRefund } from "booking-refund-policy";
```

## 환불 계산

### `calculateRefundQuote(input): RefundQuote`

| 입력 | 타입 | 설명 |
| --- | --- | --- |
| `amountKrw` | `number` | 결제 금액(원). 양의 정수가 아니면 `invalid_refund_context` |
| `startsAt` | `string \| Date` | 예약 시작 시각 |
| `now?` | `Date` | 기준 시각. 기본값은 현재 시각 |
| `policy?` | `RefundPolicy` | 기본값 `DEFAULT_REFUND_POLICY` |

정책 값이 올바르지 않으면 `RangeError`를 던집니다. 그 밖의 잘못된 입력(금액, 시각)은 던지지 않고 `reason: "invalid_refund_context"`로 돌려줍니다.

### `RefundQuote`

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `canCancel` | `boolean` | 취소 가능 여부. 환불 0원이어도 `true`일 수 있음 |
| `isFullRefund` | `boolean` | 전액 환불 여부 |
| `refundAmountKrw` | `number` | 환불액 |
| `cancellationFeeKrw` | `number` | 결제 금액 − 환불액 |
| `refundRate` | `number` | 0~100 |
| `reason` | `RefundReason` | 아래 참고 |

### `RefundReason`

```ts
type RefundReason =
  | "standard_full_refund"
  | "late_cancellation_partial_refund"
  | "imminent_cancellation_no_refund"
  | "session_started"
  | "invalid_refund_context";
```

### `RefundPolicy` / `DEFAULT_REFUND_POLICY`

```ts
type RefundPolicy = {
  readonly fullRefundHours: number;   // 기본 24
  readonly partialRefundRate: number; // 기본 50
  readonly noRefundHours: number;     // 기본 2
};
```

### `assertValidRefundPolicy(policy): void`

정책이 모순되면 `RangeError`. 기준은 [policy.md](policy.md#정책-검증)에 있습니다.

## 환불 요청과 복구

### `processRefund(request, provider): Promise<RefundOutcome>`

결제사에 환불을 요청하고, 응답이 불확실하면 결제사 상태를 한 번 조회해 결과를 확정합니다. 결제사 호출은 `cancel` 최대 1번, `query` 최대 1번입니다.

| `request` 필드 | 타입 | 설명 |
| --- | --- | --- |
| `paymentKey` | `string` | 결제사 결제 키 |
| `amountKrw` | `number` | 원래 결제 금액 (양의 정수) |
| `refundAmountKrw` | `number` | 환불 금액 (1 이상, `amountKrw` 이하 정수) |
| `reason` | `string` | 결제사에 보낼 취소 사유 |
| `idempotencyKey` | `string` | 같은 환불에는 항상 같은 값. 빈 문자열 불가 |

입력이 올바르지 않으면 결제사를 호출하기 전에 `RangeError`로 reject합니다.

### `RefundOutcome`

```ts
type RefundOutcome =
  | { status: "refunded" }
  | { status: "unchanged"; error: string }
  | { status: "uncertain"; error: string };
```

각 결과에서 호출한 쪽이 할 일은 [policy.md](policy.md#호출한-쪽이-할-일)에 있습니다.

### `PaymentProvider`

```ts
type PaymentProvider = {
  cancel(request: CancelRequest): Promise<PaymentSnapshot>;
  query(paymentKey: string): Promise<PaymentSnapshot>;
};

type CancelRequest = {
  paymentKey: string;
  cancelAmount: number;
  cancelReason: string;
  idempotencyKey: string;
};

type PaymentSnapshot = {
  paymentKey: string;
  totalAmount: number;
  balanceAmount: number;
  status: "DONE" | "CANCELED" | "PARTIAL_CANCELED" | (string & {});
};
```

`status`는 결제사가 다른 값을 돌려줄 수 있어 열린 문자열이지만, 주요 값은 자동 완성됩니다.

### `RefundNotSentError`

결제사에 요청이 **전송되지 않았음이 확실할 때** `PaymentProvider.cancel`이 던집니다. (예: secret key 미설정) 이 에러는 조회 없이 `unchanged`로 처리됩니다. 전송 여부가 불확실한 네트워크 오류에는 쓰지 마세요.

### `isExpectedRefund(payment, request): boolean`
### `isUntouchedPayment(payment, request): boolean`

`processRefund`가 내부에서 쓰는 판단 함수입니다. webhook 처리나 정기 점검(watchdog)에서 같은 기준으로 결제 상태를 판단할 때 씁니다.

## 기타

### `isWithinUpcomingWindow(startsAt, hours, now?): boolean`

`now < startsAt ≤ now + hours`이면 `true`. 지난 시각, 해석할 수 없는 값은 `false`. `hours`가 음수면 `RangeError`.

```ts
// 24시간 안에 시작하는 상담만 화상 회의를 미리 만든다
if (isWithinUpcomingWindow(reservation.startsAt, 24)) await createMeeting(reservation);
```
