import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  RefundNotSentError,
  processRefund,
  type CancelRequest,
  type PaymentProvider,
  type PaymentSnapshot,
  type RefundRequest,
} from "../src/refund-recovery.ts";

const PARTIAL: RefundRequest = {
  paymentKey: "payment-1",
  amountKrw: 49_000,
  refundAmountKrw: 24_500,
  reason: "학생 취소",
  idempotencyKey: "student-cancel-reservation-1",
};
const FULL: RefundRequest = { ...PARTIAL, refundAmountKrw: 49_000 };

const snapshot = (overrides: Partial<PaymentSnapshot> = {}): PaymentSnapshot => ({
  paymentKey: "payment-1",
  totalAmount: 49_000,
  balanceAmount: 24_500,
  status: "PARTIAL_CANCELED",
  ...overrides,
});

type FakeProvider = PaymentProvider & {
  readonly cancelCalls: CancelRequest[];
  queryCalls: number;
};

/** 결제사 응답을 고정한 가짜 provider. 호출 기록을 남겨 이중 호출이 없는지 확인한다. */
function fakeProvider(options: {
  cancel: () => Promise<PaymentSnapshot>;
  query?: () => Promise<PaymentSnapshot>;
}): FakeProvider {
  const provider: FakeProvider = {
    cancelCalls: [],
    queryCalls: 0,
    cancel(request) {
      provider.cancelCalls.push(request);
      return options.cancel();
    },
    query() {
      provider.queryCalls += 1;
      return options.query?.() ?? Promise.reject(new Error("query not expected"));
    },
  };
  return provider;
}

const lostResponse = () => Promise.reject(new TypeError("Simulated lost refund response"));

describe("processRefund: 정상 응답", () => {
  test("환불 응답이 기대와 같으면 조회 없이 refunded", async () => {
    const provider = fakeProvider({ cancel: () => Promise.resolve(snapshot()) });
    assert.deepEqual(await processRefund(PARTIAL, provider), { status: "refunded" });
    assert.equal(provider.queryCalls, 0);
  });

  test("결제사에 멱등성 키와 환불 금액을 그대로 전달한다", async () => {
    const provider = fakeProvider({ cancel: () => Promise.resolve(snapshot()) });
    await processRefund(PARTIAL, provider);
    assert.deepEqual(provider.cancelCalls, [
      {
        paymentKey: "payment-1",
        cancelAmount: 24_500,
        cancelReason: "학생 취소",
        idempotencyKey: "student-cancel-reservation-1",
      },
    ]);
  });
});

describe("processRefund: 환불 응답이 끊겼을 때 결제사 상태로 판단", () => {
  // 응답이 유실되면 반드시 1번 조회하고, 다시 환불하지 않는다.
  const scenarios = [
    ["부분 환불이 실제로 됨", PARTIAL, () => Promise.resolve(snapshot()), "refunded"],
    [
      "전액 환불이 실제로 됨",
      FULL,
      () => Promise.resolve(snapshot({ status: "CANCELED", balanceAmount: 0 })),
      "refunded",
    ],
    [
      "결제가 그대로 남아 있음",
      PARTIAL,
      () => Promise.resolve(snapshot({ status: "DONE", balanceAmount: 49_000 })),
      "unchanged",
    ],
    ["결제사 조회도 실패", PARTIAL, () => Promise.reject(new TypeError("outage")), "uncertain"],
    ["다른 결제 키가 돌아옴", PARTIAL, () => Promise.resolve(snapshot({ paymentKey: "payment-2" })), "uncertain"],
    ["총액이 다름", PARTIAL, () => Promise.resolve(snapshot({ totalAmount: 98_000 })), "uncertain"],
    ["잔액이 기대와 다름", PARTIAL, () => Promise.resolve(snapshot({ balanceAmount: 24_000 })), "uncertain"],
    [
      "잔액은 맞지만 상태가 DONE",
      PARTIAL,
      () => Promise.resolve(snapshot({ status: "DONE" })),
      "uncertain",
    ],
  ] as const;

  for (const [label, request, query, expected] of scenarios) {
    test(`${label} → ${expected}`, async () => {
      const provider = fakeProvider({ cancel: lostResponse, query });
      const outcome = await processRefund(request, provider);
      assert.equal(outcome.status, expected);
      assert.equal(provider.cancelCalls.length, 1, "환불 요청은 한 번만 보낸다");
      assert.equal(provider.queryCalls, 1, "응답이 끊기면 결제사 상태를 한 번 조회한다");
    });
  }

  test("uncertain에는 원래 실패 사유가 남는다", async () => {
    const provider = fakeProvider({
      cancel: lostResponse,
      query: () => Promise.reject(new TypeError("outage")),
    });
    assert.deepEqual(await processRefund(PARTIAL, provider), {
      status: "uncertain",
      error: "Simulated lost refund response",
    });
  });

  test("환불 응답은 왔지만 내용이 다르면 조회로 다시 확인한다", async () => {
    const provider = fakeProvider({
      cancel: () => Promise.resolve(snapshot({ balanceAmount: 0 })),
      query: () => Promise.resolve(snapshot()),
    });
    assert.deepEqual(await processRefund(PARTIAL, provider), { status: "refunded" });
    assert.equal(provider.queryCalls, 1);
  });
});

describe("processRefund: 요청이 결제사에 가지 않은 경우", () => {
  test("RefundNotSentError면 조회 없이 unchanged", async () => {
    const provider = fakeProvider({
      cancel: () => Promise.reject(new RefundNotSentError("secret_key_not_set")),
    });
    assert.deepEqual(await processRefund(PARTIAL, provider), {
      status: "unchanged",
      error: "secret_key_not_set",
    });
    assert.equal(provider.queryCalls, 0);
  });

  const invalidRequests = [
    ["환불 금액 0", { ...PARTIAL, refundAmountKrw: 0 }],
    ["환불 금액이 결제 금액보다 큼", { ...PARTIAL, refundAmountKrw: 50_000 }],
    ["결제 금액이 정수가 아님", { ...PARTIAL, amountKrw: 49_000.5 }],
    ["빈 멱등성 키", { ...PARTIAL, idempotencyKey: "  " }],
  ] as const;

  for (const [label, request] of invalidRequests) {
    test(`${label} → 결제사를 호출하기 전에 RangeError`, async () => {
      const provider = fakeProvider({ cancel: () => Promise.resolve(snapshot()) });
      await assert.rejects(processRefund(request, provider), RangeError);
      assert.equal(provider.cancelCalls.length, 0);
    });
  }
});
