/**
 * 결제사 환불 요청의 응답이 끊겼을 때, 이중 환불 없이 상태를 확정하는 로직.
 *
 * 결제사에서는 환불이 끝났는데 응답만 유실되는 경우가 있다. 이때 결제를 바로
 * "환불 안 됨"으로 되돌리면 다음 재시도에서 두 번 환불될 수 있다.
 * 그래서 응답을 받지 못하면 결제사에 실제 상태를 다시 조회하고,
 * 확실히 판단할 수 있을 때만 `refunded` 또는 `unchanged`를 돌려준다.
 */

/** 결제사 응답에서 이 로직이 필요로 하는 최소 필드. */
export type PaymentSnapshot = {
  readonly paymentKey: string;
  readonly totalAmount: number;
  readonly balanceAmount: number;
  readonly status: "DONE" | "CANCELED" | "PARTIAL_CANCELED" | (string & {});
};

export type CancelRequest = {
  readonly paymentKey: string;
  readonly cancelAmount: number;
  readonly cancelReason: string;
  /** 같은 환불에는 항상 같은 키를 보내 결제사가 중복 요청을 걸러 내게 한다. */
  readonly idempotencyKey: string;
};

/** 결제사 연동을 주입받기 위한 인터페이스. Toss 등 실제 클라이언트나 테스트용 가짜 구현을 넣는다. */
export type PaymentProvider = {
  cancel(request: CancelRequest): Promise<PaymentSnapshot>;
  query(paymentKey: string): Promise<PaymentSnapshot>;
};

export type RefundRequest = {
  readonly paymentKey: string;
  /** 원래 결제 금액 */
  readonly amountKrw: number;
  /** 이번에 환불할 금액 (1 이상, amountKrw 이하) */
  readonly refundAmountKrw: number;
  readonly reason: string;
  readonly idempotencyKey: string;
};

export type RefundOutcome =
  /** 결제사에서 기대한 환불이 확인됨 → DB를 환불 완료로 마무리해도 안전 */
  | { readonly status: "refunded" }
  /** 결제사 상태가 결제 직후 그대로임 → 결제를 원래 상태로 되돌리고 재시도 가능 */
  | { readonly status: "unchanged"; readonly error: string }
  /** 판단 불가 → 재환불을 막고 운영자가 확인해야 함 */
  | { readonly status: "uncertain"; readonly error: string };

/**
 * 결제사에 요청이 전송되지 않았음이 확실할 때 PaymentProvider가 던지는 에러.
 * (예: secret key가 설정되지 않아 요청을 보내기 전에 실패)
 */
export class RefundNotSentError extends Error {
  override readonly name = "RefundNotSentError";
}

/** 결제 스냅샷이 이번 환불이 정확히 반영된 상태인지 확인한다. */
export function isExpectedRefund(
  payment: PaymentSnapshot,
  request: RefundRequest,
): boolean {
  const isFull = request.refundAmountKrw === request.amountKrw;
  return (
    payment.paymentKey === request.paymentKey &&
    payment.totalAmount === request.amountKrw &&
    payment.balanceAmount === request.amountKrw - request.refundAmountKrw &&
    payment.status === (isFull ? "CANCELED" : "PARTIAL_CANCELED")
  );
}

/** 결제 스냅샷이 환불 전 그대로인지 확인한다. */
export function isUntouchedPayment(
  payment: PaymentSnapshot,
  request: RefundRequest,
): boolean {
  return (
    payment.paymentKey === request.paymentKey &&
    payment.totalAmount === request.amountKrw &&
    payment.balanceAmount === request.amountKrw &&
    payment.status === "DONE"
  );
}

function assertValidRequest(request: RefundRequest): void {
  if (!Number.isInteger(request.amountKrw) || request.amountKrw <= 0) {
    throw new RangeError("amountKrw must be a positive integer");
  }
  if (
    !Number.isInteger(request.refundAmountKrw) ||
    request.refundAmountKrw <= 0 ||
    request.refundAmountKrw > request.amountKrw
  ) {
    throw new RangeError(
      "refundAmountKrw must be a positive integer not greater than amountKrw",
    );
  }
  if (request.idempotencyKey.trim() === "") {
    throw new RangeError("idempotencyKey must not be empty");
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * 환불을 요청하고, 응답이 불확실하면 결제사 상태를 다시 조회해 결과를 확정한다.
 *
 * - 결제사 호출은 `cancel` 1번, 필요할 때 `query` 1번만 한다. 스스로 재시도하지 않는다.
 * - `uncertain`이 나오면 호출한 쪽은 결제를 환불 진행 상태로 유지해야 한다.
 *
 * @throws {RangeError} 금액이나 멱등성 키가 올바르지 않을 때 (결제사를 호출하기 전)
 */
export async function processRefund(
  request: RefundRequest,
  provider: PaymentProvider,
): Promise<RefundOutcome> {
  assertValidRequest(request);

  let failure = "provider_refund_requires_review";
  try {
    const refunded = await provider.cancel({
      paymentKey: request.paymentKey,
      cancelAmount: request.refundAmountKrw,
      cancelReason: request.reason,
      idempotencyKey: request.idempotencyKey,
    });
    if (isExpectedRefund(refunded, request)) return { status: "refunded" };
  } catch (error) {
    if (error instanceof RefundNotSentError) {
      return { status: "unchanged", error: error.message };
    }
    failure = errorMessage(error, "provider_cancel_failed");
  }

  try {
    const current = await provider.query(request.paymentKey);
    if (isExpectedRefund(current, request)) return { status: "refunded" };
    if (isUntouchedPayment(current, request)) {
      return { status: "unchanged", error: failure };
    }
  } catch {
    // 결제사에 닿지 않으면 판단할 수 없으므로 uncertain으로 남긴다.
  }
  return { status: "uncertain", error: failure };
}
