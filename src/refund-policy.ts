const HOUR_MS = 60 * 60 * 1000;

/**
 * 시작 시각까지 남은 시간에 따라 환불 비율을 정하는 정책.
 *
 * - 남은 시간 ≥ `fullRefundHours` → 전액 환불
 * - `noRefundHours` < 남은 시간 < `fullRefundHours` → `partialRefundRate`% 환불
 * - 0 < 남은 시간 ≤ `noRefundHours` → 취소는 가능하지만 환불 0원
 * - 남은 시간 ≤ 0 → 이미 시작해서 취소 불가
 */
export type RefundPolicy = {
  readonly fullRefundHours: number;
  readonly partialRefundRate: number;
  readonly noRefundHours: number;
};

/** Pincette Pacemaker 상담 서비스에서 실제로 쓰는 정책 (24시간 / 50% / 2시간). */
export const DEFAULT_REFUND_POLICY = {
  fullRefundHours: 24,
  partialRefundRate: 50,
  noRefundHours: 2,
} as const satisfies RefundPolicy;

export type RefundReason =
  | "standard_full_refund"
  | "late_cancellation_partial_refund"
  | "imminent_cancellation_no_refund"
  | "session_started"
  | "invalid_refund_context";

export type RefundQuote = {
  /** 취소 자체가 가능한지. 환불이 0원이어도 취소는 가능할 수 있다. */
  readonly canCancel: boolean;
  readonly isFullRefund: boolean;
  readonly refundAmountKrw: number;
  readonly cancellationFeeKrw: number;
  /** 0~100 사이 정수 */
  readonly refundRate: number;
  readonly reason: RefundReason;
};

export type RefundQuoteInput = {
  /** 실제 결제 금액(원). 양의 정수가 아니면 `invalid_refund_context`. */
  readonly amountKrw: number;
  /** 예약 시작 시각. ISO 8601 문자열 또는 Date. */
  readonly startsAt: string | Date;
  /** 기준 시각. 테스트에서 시간 경계를 고정하기 위해 주입한다. 기본값은 현재 시각. */
  readonly now?: Date;
  readonly policy?: RefundPolicy;
};

/**
 * 정책 값이 서로 모순되지 않는지 확인한다.
 * @throws {RangeError} 음수, 비율 범위 초과, 환불 불가 구간이 전액 환불 구간보다 길 때
 */
export function assertValidRefundPolicy(policy: RefundPolicy): void {
  const { fullRefundHours, partialRefundRate, noRefundHours } = policy;
  if (!Number.isFinite(fullRefundHours) || !Number.isFinite(noRefundHours)) {
    throw new RangeError("refund policy hours must be finite numbers");
  }
  if (noRefundHours < 0) {
    throw new RangeError("noRefundHours must be 0 or greater");
  }
  if (noRefundHours >= fullRefundHours) {
    throw new RangeError("noRefundHours must be less than fullRefundHours");
  }
  if (
    !Number.isInteger(partialRefundRate) ||
    partialRefundRate < 0 ||
    partialRefundRate > 100
  ) {
    throw new RangeError("partialRefundRate must be an integer from 0 to 100");
  }
}

function toTime(value: string | Date): number {
  return (typeof value === "string" ? new Date(value) : value).getTime();
}

/**
 * 결제 금액과 남은 시간으로 환불 예상액을 계산한다.
 *
 * 부분 환불은 원 단위 내림이며, 남는 금액은 취소 수수료가 된다.
 * 같은 입력에는 항상 같은 결과를 돌려준다 (현재 시각은 `now`로 주입).
 */
export function calculateRefundQuote(input: RefundQuoteInput): RefundQuote {
  const policy = input.policy ?? DEFAULT_REFUND_POLICY;
  assertValidRefundPolicy(policy);

  const nowMs = (input.now ?? new Date()).getTime();
  const startsAtMs = toTime(input.startsAt);
  const amountKrw =
    Number.isInteger(input.amountKrw) && input.amountKrw > 0
      ? input.amountKrw
      : 0;

  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(startsAtMs) ||
    amountKrw === 0
  ) {
    return {
      canCancel: false,
      isFullRefund: false,
      refundAmountKrw: 0,
      cancellationFeeKrw: 0,
      refundRate: 0,
      reason: "invalid_refund_context",
    };
  }

  const remainingMs = startsAtMs - nowMs;

  if (remainingMs <= 0) {
    return {
      canCancel: false,
      isFullRefund: false,
      refundAmountKrw: 0,
      cancellationFeeKrw: amountKrw,
      refundRate: 0,
      reason: "session_started",
    };
  }

  if (remainingMs <= policy.noRefundHours * HOUR_MS) {
    return {
      canCancel: true,
      isFullRefund: false,
      refundAmountKrw: 0,
      cancellationFeeKrw: amountKrw,
      refundRate: 0,
      reason: "imminent_cancellation_no_refund",
    };
  }

  if (remainingMs >= policy.fullRefundHours * HOUR_MS) {
    return {
      canCancel: true,
      isFullRefund: true,
      refundAmountKrw: amountKrw,
      cancellationFeeKrw: 0,
      refundRate: 100,
      reason: "standard_full_refund",
    };
  }

  const refundAmountKrw = Math.floor(
    (amountKrw * policy.partialRefundRate) / 100,
  );
  return {
    canCancel: true,
    isFullRefund: false,
    refundAmountKrw,
    cancellationFeeKrw: amountKrw - refundAmountKrw,
    refundRate: policy.partialRefundRate,
    reason: "late_cancellation_partial_refund",
  };
}
