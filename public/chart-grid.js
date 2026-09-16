const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_QUARTER_HOUR = 15 * 60;
const KOREA_OFFSET_SECONDS = 9 * 60 * 60;

export const DATE_CHANGE_GUIDE_SCALES = new Set(["2d", "1w", "2w"]);
const GUIDE_INTERVAL_SECONDS_BY_SCALE = new Map([
  ["1h", SECONDS_PER_QUARTER_HOUR],
  ["6h", SECONDS_PER_HOUR],
  ["12h", SECONDS_PER_HOUR],
  ["1d", SECONDS_PER_HOUR],
  ["2d", SECONDS_PER_DAY],
  ["1w", SECONDS_PER_DAY],
  ["2w", SECONDS_PER_DAY]
]);

export function dateChangeGuideTimestamps(range, scale) {
  const intervalSeconds = GUIDE_INTERVAL_SECONDS_BY_SCALE.get(scale);
  if (!intervalSeconds) return [];

  const start = Number(range?.start);
  const end = Number(range?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  let nextGuide = Math.floor(
    (start + KOREA_OFFSET_SECONDS) / intervalSeconds
  ) * intervalSeconds - KOREA_OFFSET_SECONDS;

  if (nextGuide <= start) nextGuide += intervalSeconds;

  const timestamps = [];
  for (let timestamp = nextGuide; timestamp < end; timestamp += intervalSeconds) {
    timestamps.push(timestamp);
  }
  return timestamps;
}
