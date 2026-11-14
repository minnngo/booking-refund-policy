import assert from "node:assert/strict";
import { test } from "node:test";
import { isWithinUpcomingWindow } from "../src/time-window.ts";

const NOW = new Date("2026-07-31T07:05:00.000Z");

test("24시간 창의 끝은 포함하고, 1초 넘으면 제외한다", () => {
  assert.equal(isWithinUpcomingWindow("2026-08-01T07:04:59.000Z", 24, NOW), true);
  assert.equal(isWithinUpcomingWindow("2026-08-01T07:05:00.000Z", 24, NOW), true);
  assert.equal(isWithinUpcomingWindow("2026-08-01T07:05:01.000Z", 24, NOW), false);
});

test("지금이거나 지난 시각, 해석할 수 없는 값은 false", () => {
  assert.equal(isWithinUpcomingWindow(NOW, 24, NOW), false);
  assert.equal(isWithinUpcomingWindow("2026-07-30T00:00:00.000Z", 24, NOW), false);
  assert.equal(isWithinUpcomingWindow("not-a-date", 24, NOW), false);
});

test("음수 시간은 RangeError", () => {
  assert.throws(() => isWithinUpcomingWindow(NOW, -1, NOW), RangeError);
});
