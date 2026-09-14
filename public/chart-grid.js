const SECONDS_PER_DAY = 24 * 60 * 60;
const KOREA_OFFSET_SECONDS = 9 * 60 * 60;

export const DATE_CHANGE_GUIDE_SCALES = new Set(["2d", "1w", "2w"]);

export function dateChangeGuideTimestamps(range, scale) {
  if (!DATE_CHANGE_GUIDE_SCALES.has(scale)) return [];

  const start = Number(range?.start);
  const end = Number(range?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const startInKorea = new Date((start + KOREA_OFFSET_SECONDS) * 1000);
  let nextDateStart = Date.UTC(
    startInKorea.getUTCFullYear(),
    startInKorea.getUTCMonth(),
    startInKorea.getUTCDate()
  ) / 1000 - KOREA_OFFSET_SECONDS;

  if (nextDateStart <= start) nextDateStart += SECONDS_PER_DAY;

  const timestamps = [];
  for (let timestamp = nextDateStart; timestamp < end; timestamp += SECONDS_PER_DAY) {
    timestamps.push(timestamp);
  }
  return timestamps;
}
