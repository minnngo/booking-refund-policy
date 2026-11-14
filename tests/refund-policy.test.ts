import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_REFUND_POLICY,
  assertValidRefundPolicy,
  calculateRefundQuote,
} from "../src/refund-policy.ts";

const AMOUNT_KRW = 49_000;
const NOW = new Date("2026-09-14T00:00:00.000Z");

describe("calculateRefundQuote: 기본 정책 (24시간 / 50% / 2시간)", () => {
  // 경계값과 그 앞뒤 1ms를 모두 확인한다.
  const cases = [
    ["24시간 이상 남음", "2026-09-15T00:00:00.001Z", 100, "standard_full_refund"],
    ["정확히 24시간", "2026-09-15T00:00:00.000Z", 100, "standard_full_refund"],
    ["24시간에서 1ms 모자람", "2026-09-14T23:59:59.999Z", 50, "late_cancellation_partial_refund"],
    ["2시간에서 1ms 넘음", "2026-09-14T02:00:00.001Z", 50, "late_cancellation_partial_refund"],
    ["정확히 2시간", "2026-09-14T02:00:00.000Z", 0, "imminent_cancellation_no_refund"],
    ["2시간에서 1ms 모자람", "2026-09-14T01:59:59.999Z", 0, "imminent_cancellation_no_refund"],
    ["시작하고 1ms 지남", "2026-09-13T23:59:59.999Z", 0, "session_started"],
  ] as const;

  for (const [label, startsAt, rate, reason] of cases) {
    test(`${label} → ${String(rate)}% (${reason})`, () => {
      const quote = calculateRefundQuote({ amountKrw: AMOUNT_KRW, startsAt, now: NOW });
      assert.equal(quote.reason, reason);
      assert.equal(quote.refundRate, rate);
      assert.equal(quote.refundAmountKrw, (AMOUNT_KRW * rate) / 100);
      assert.equal(quote.cancellationFeeKrw, AMOUNT_KRW - quote.refundAmountKrw);
    });
  }

  test("정확히 시작 시각이면 취소할 수 없다", () => {
    const quote = calculateRefundQuote({ amountKrw: AMOUNT_KRW, startsAt: NOW, now: NOW });
    assert.equal(quote.canCancel, false);
    assert.equal(quote.reason, "session_started");
  });

  test("2시간 이내는 환불 0원이지만 취소는 가능하다", () => {
    const quote = calculateRefundQuote({
      amountKrw: AMOUNT_KRW,
      startsAt: "2026-09-14T01:00:00.000Z",
      now: NOW,
    });
    assert.equal(quote.canCancel, true);
    assert.equal(quote.refundAmountKrw, 0);
  });

  test("부분 환불은 원 단위 내림, 나머지는 수수료", () => {
    const quote = calculateRefundQuote({
      amountKrw: 24_501,
      startsAt: "2026-09-14T12:00:00.000Z",
      now: NOW,
    });
    assert.equal(quote.refundAmountKrw, 12_250);
    assert.equal(quote.cancellationFeeKrw, 12_251);
  });

  test("Date와 오프셋이 있는 문자열을 같은 시각으로 다룬다", () => {
    const fromString = calculateRefundQuote({
      amountKrw: AMOUNT_KRW,
      startsAt: "2026-09-14T21:00:00+09:00",
      now: NOW,
    });
    const fromDate = calculateRefundQuote({
      amountKrw: AMOUNT_KRW,
      startsAt: new Date("2026-09-14T12:00:00.000Z"),
      now: NOW,
    });
    assert.deepEqual(fromString, fromDate);
  });

  for (const amountKrw of [0, -1, 1.5, Number.NaN]) {
    test(`잘못된 금액(${String(amountKrw)})은 invalid_refund_context`, () => {
      const quote = calculateRefundQuote({ amountKrw, startsAt: "2026-09-20T00:00:00Z", now: NOW });
      assert.equal(quote.reason, "invalid_refund_context");
      assert.equal(quote.canCancel, false);
    });
  }

  test("해석할 수 없는 시각은 invalid_refund_context", () => {
    const quote = calculateRefundQuote({ amountKrw: AMOUNT_KRW, startsAt: "not-a-date", now: NOW });
    assert.equal(quote.reason, "invalid_refund_context");
  });
});

describe("calculateRefundQuote: 정책 바꾸기", () => {
  test("48시간 / 30% / 6시간 정책", () => {
    const policy = { fullRefundHours: 48, partialRefundRate: 30, noRefundHours: 6 };
    const quote = calculateRefundQuote({
      amountKrw: 10_000,
      startsAt: "2026-09-15T00:00:00.000Z",
      now: NOW,
      policy,
    });
    assert.equal(quote.refundRate, 30);
    assert.equal(quote.refundAmountKrw, 3_000);
  });
});

describe("assertValidRefundPolicy", () => {
  test("기본 정책은 유효하다", () => {
    assert.doesNotThrow(() => {
      assertValidRefundPolicy(DEFAULT_REFUND_POLICY);
    });
  });

  const invalid = [
    ["환불 불가 구간이 전액 환불 구간보다 길다", { fullRefundHours: 2, partialRefundRate: 50, noRefundHours: 24 }],
    ["두 구간이 같다", { fullRefundHours: 24, partialRefundRate: 50, noRefundHours: 24 }],
    ["음수 시간", { fullRefundHours: 24, partialRefundRate: 50, noRefundHours: -1 }],
    ["비율이 100 초과", { fullRefundHours: 24, partialRefundRate: 150, noRefundHours: 2 }],
    ["비율이 정수가 아님", { fullRefundHours: 24, partialRefundRate: 33.3, noRefundHours: 2 }],
    ["시간이 무한대", { fullRefundHours: Number.POSITIVE_INFINITY, partialRefundRate: 50, noRefundHours: 2 }],
  ] as const;

  for (const [label, policy] of invalid) {
    test(`${label} → RangeError`, () => {
      assert.throws(() => {
        assertValidRefundPolicy(policy);
      }, RangeError);
    });
  }
});
