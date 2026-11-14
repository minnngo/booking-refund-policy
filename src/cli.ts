import { parseArgs } from "node:util";
import {
  DEFAULT_REFUND_POLICY,
  calculateRefundQuote,
  type RefundPolicy,
  type RefundQuote,
} from "./refund-policy.ts";

export const USAGE = `사용법: refund-quote --amount <원> --starts-at <ISO 시각> [옵션]

결제 금액과 예약 시작 시각으로 환불 예상액을 계산합니다.

필수
  --amount <number>           결제 금액(원), 양의 정수
  --starts-at <ISO 8601>      예약 시작 시각 (예: 2026-11-20T15:00:00+09:00)

옵션
  --now <ISO 8601>            기준 시각 (기본값: 현재 시각)
  --full-refund-hours <n>     전액 환불 기준 시간 (기본값: ${String(DEFAULT_REFUND_POLICY.fullRefundHours)})
  --partial-rate <n>          부분 환불 비율 % (기본값: ${String(DEFAULT_REFUND_POLICY.partialRefundRate)})
  --no-refund-hours <n>       환불 불가 기준 시간 (기본값: ${String(DEFAULT_REFUND_POLICY.noRefundHours)})
  --json                      결과를 JSON으로 출력
  -h, --help                  도움말

종료 코드
  0 계산 성공 · 1 입력값 오류 · 2 사용법 오류`;

/** 사용자가 고칠 수 있는 입력값 오류 (종료 코드 1) */
class InputError extends Error {}

export type Io = {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
};

const won = (value: number): string => `${value.toLocaleString("ko-KR")}원`;

function parseNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw new InputError(`--${name} 값이 숫자가 아닙니다: ${raw}`);
  }
  return value;
}

function parseDate(name: string, raw: string): Date {
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new InputError(`--${name} 값을 시각으로 해석할 수 없습니다: ${raw}`);
  }
  return date;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "이미 시작함";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `시작까지 ${String(hours)}시간 ${String(minutes)}분 남음`;
}

function formatText(quote: RefundQuote, amountKrw: number, remainingMs: number): string {
  return [
    `환불 예상 (${formatRemaining(remainingMs)})`,
    `- 결제 금액: ${won(amountKrw)}`,
    `- 환불 금액: ${won(quote.refundAmountKrw)} (${String(quote.refundRate)}%)`,
    `- 취소 수수료: ${won(quote.cancellationFeeKrw)}`,
    `- 취소 가능: ${quote.canCancel ? "예" : "아니오"}`,
    `- 사유: ${quote.reason}`,
  ].join("\n");
}

/** CLI 진입점. 테스트할 수 있도록 출력과 종료 코드를 밖으로 돌려준다. */
export function run(argv: readonly string[], io: Io): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      options: {
        amount: { type: "string" },
        "starts-at": { type: "string" },
        now: { type: "string" },
        "full-refund-hours": { type: "string" },
        "partial-rate": { type: "string" },
        "no-refund-hours": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (values.amount === undefined || values["starts-at"] === undefined) {
    io.stderr(`--amount와 --starts-at은 필수입니다.\n\n${USAGE}`);
    return 2;
  }

  try {
    const amountKrw = parseNumber("amount", values.amount, 0);
    const startsAt = parseDate("starts-at", values["starts-at"]);
    const now = values.now === undefined ? new Date() : parseDate("now", values.now);
    const policy: RefundPolicy = {
      fullRefundHours: parseNumber(
        "full-refund-hours",
        values["full-refund-hours"],
        DEFAULT_REFUND_POLICY.fullRefundHours,
      ),
      partialRefundRate: parseNumber(
        "partial-rate",
        values["partial-rate"],
        DEFAULT_REFUND_POLICY.partialRefundRate,
      ),
      noRefundHours: parseNumber(
        "no-refund-hours",
        values["no-refund-hours"],
        DEFAULT_REFUND_POLICY.noRefundHours,
      ),
    };

    const quote = calculateRefundQuote({ amountKrw, startsAt, now, policy });
    if (quote.reason === "invalid_refund_context") {
      throw new InputError("--amount는 양의 정수여야 합니다.");
    }

    io.stdout(
      values.json
        ? JSON.stringify({ amountKrw, ...quote }, null, 2)
        : formatText(quote, amountKrw, startsAt.getTime() - now.getTime()),
    );
    return 0;
  } catch (error) {
    if (error instanceof InputError || error instanceof RangeError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }
}
