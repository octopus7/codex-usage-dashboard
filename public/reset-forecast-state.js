export const RESET_FORECAST_DEFAULT_DAYS = 7;
export const RESET_FORECAST_MIN_DAYS = 1;
export const RESET_FORECAST_MAX_DAYS = 7;

export function resolveResetForecastDays(
  enabled,
  days,
  {
    defaultDays = RESET_FORECAST_DEFAULT_DAYS,
    minDays = RESET_FORECAST_MIN_DAYS,
    maxDays = RESET_FORECAST_MAX_DAYS
  } = {}
) {
  if (!enabled) return defaultDays;

  const parsedDays = Number.parseInt(String(days), 10);
  if (!Number.isFinite(parsedDays)) return defaultDays;
  return Math.min(maxDays, Math.max(minDays, parsedDays));
}
