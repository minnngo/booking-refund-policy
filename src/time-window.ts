const HOUR_MS = 60 * 60 * 1000;

/**
 * `startsAt`이 지금부터 `hours`시간 안에 시작하는지 확인한다. (지금 < startsAt ≤ 지금 + hours)
 *
 * 예: 상담 24시간 전부터 화상 회의를 만들고 사전질문 안내를 보내는 작업의 대상 판별.
 * 이미 지난 시각이나 해석할 수 없는 값은 `false`.
 */
export function isWithinUpcomingWindow(
  startsAt: string | Date,
  hours: number,
  now: Date = new Date(),
): boolean {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new RangeError("hours must be a finite number 0 or greater");
  }
  const startsAtMs = (
    typeof startsAt === "string" ? new Date(startsAt) : startsAt
  ).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(nowMs)) return false;
  return startsAtMs > nowMs && startsAtMs <= nowMs + hours * HOUR_MS;
}
