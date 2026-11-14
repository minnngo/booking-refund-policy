import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/cli.ts";

function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

const BASE = ["--amount", "49000", "--now", "2026-11-19T16:00:00+09:00"];

test("부분 환불 구간을 사람이 읽는 형식으로 출력한다", () => {
  const result = capture([...BASE, "--starts-at", "2026-11-20T15:00:00+09:00"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /시작까지 23시간 0분 남음/);
  assert.match(result.stdout, /환불 금액: 24,500원 \(50%\)/);
  assert.match(result.stdout, /late_cancellation_partial_refund/);
});

test("--json은 파싱 가능한 결과를 낸다", () => {
  const result = capture([...BASE, "--starts-at", "2026-11-21T16:00:00+09:00", "--json"]);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as { refundAmountKrw: number; reason: string };
  assert.equal(parsed.refundAmountKrw, 49_000);
  assert.equal(parsed.reason, "standard_full_refund");
});

test("정책 옵션으로 기준을 바꿀 수 있다", () => {
  const result = capture([
    ...BASE,
    "--starts-at",
    "2026-11-20T15:00:00+09:00",
    "--partial-rate",
    "30",
    "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as { refundAmountKrw: number; reason: string };
  assert.equal(parsed.refundAmountKrw, 14_700);
});

test("필수 옵션이 없으면 종료 코드 2와 사용법", () => {
  const result = capture(["--amount", "49000"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /사용법/);
});

test("모르는 옵션은 종료 코드 2", () => {
  assert.equal(capture([...BASE, "--starts-at", "2026-11-20T15:00:00Z", "--foo"]).code, 2);
});

test("잘못된 값은 종료 코드 1과 이유", () => {
  const badAmount = capture([...BASE, "--amount", "abc", "--starts-at", "2026-11-20T15:00:00Z"]);
  assert.equal(badAmount.code, 1);
  assert.match(badAmount.stderr, /숫자가 아닙니다/);

  const badDate = capture([...BASE, "--starts-at", "tomorrow"]);
  assert.equal(badDate.code, 1);
  assert.match(badDate.stderr, /시각으로 해석할 수 없습니다/);

  const badPolicy = capture([
    ...BASE,
    "--starts-at",
    "2026-11-20T15:00:00Z",
    "--no-refund-hours",
    "30",
  ]);
  assert.equal(badPolicy.code, 1);
  assert.match(badPolicy.stderr, /noRefundHours/);
});

test("--help는 종료 코드 0", () => {
  const result = capture(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /refund-quote/);
});
