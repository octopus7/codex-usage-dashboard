export const RESET_VALUE_THRESHOLD = 1;
export const RESET_FORECAST_DEFAULT_DAYS = 7;
export const RESET_FORECAST_MIN_DAYS = 1;
export const RESET_FORECAST_MAX_DAYS = 7;
export const RESET_FORECAST_INCREASE = 100;

export function forecastDurationSeconds(days = RESET_FORECAST_DEFAULT_DAYS) {
  const normalizedDays = Math.max(
    RESET_FORECAST_MIN_DAYS,
    Math.min(RESET_FORECAST_MAX_DAYS, Number(days) || RESET_FORECAST_DEFAULT_DAYS)
  );
  return normalizedDays * 24 * 60 * 60;
}

export function isForecastReset(previous, reset, next) {
  if (!previous || !reset || !next) return false;
  if (![previous.value, reset.value, next.value].every(Number.isFinite)) return false;
  if (reset.synthetic || next.synthetic) return false;
  if (reset.value > RESET_VALUE_THRESHOLD || next.value <= reset.value) return false;

  const dropBeforeReset = previous.value - reset.value;
  const increaseAfterReset = next.value - reset.value;
  return dropBeforeReset > increaseAfterReset;
}

export function buildResetForecasts(points, nowTimestamp, durationDays = RESET_FORECAST_DEFAULT_DAYS) {
  const durationSeconds = forecastDurationSeconds(durationDays);
  const sortedPoints = points
    .filter((point) => point && Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp);
  const forecasts = [];

  for (let index = 1; index < sortedPoints.length - 1; index += 1) {
    const previous = sortedPoints[index - 1];
    const reset = sortedPoints[index];
    const next = sortedPoints[index + 1];
    if (!isForecastReset(previous, reset, next)) continue;

    const nextReset = sortedPoints.slice(index + 1).find((point, offset) => {
      const prior = sortedPoints[index + offset];
      const following = sortedPoints[index + offset + 2];
      return isForecastReset(prior, point, following);
    });
    const forecastEnd = Math.min(
      reset.timestamp + durationSeconds,
      nextReset?.timestamp ?? Number.POSITIVE_INFINITY
    );
    const currentTimestamp = Math.max(
      reset.timestamp,
      Math.min(Number.isFinite(nowTimestamp) ? nowTimestamp : reset.timestamp, forecastEnd)
    );
    const elapsedSeconds = currentTimestamp - reset.timestamp;

    forecasts.push({
      startTimestamp: reset.timestamp,
      endTimestamp: forecastEnd,
      startValue: reset.value,
      currentTimestamp,
      currentValue: reset.value +
        (RESET_FORECAST_INCREASE * elapsedSeconds) / durationSeconds,
      increase: RESET_FORECAST_INCREASE,
      durationSeconds
    });
  }

  return forecasts;
}
