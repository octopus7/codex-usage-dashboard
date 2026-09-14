import assert from "node:assert/strict";
import test from "node:test";

import {
  RESET_FORECAST_DEFAULT_DAYS,
  RESET_FORECAST_INCREASE,
  forecastDurationSeconds,
  buildResetForecasts,
  isForecastReset,
  isResetNote,
  isTiboResetNote
} from "../public/chart-projection.js";

const point = (timestamp, value, extra = {}) => ({ timestamp, value, synthetic: false, ...extra });

test("recognizes a low reset followed by a smaller recovery step", () => {
  assert.equal(
    isForecastReset(point(100, 72), point(200, 1), point(300, 14)),
    true
  );
});

test("rejects a downward query spike when the next jump is larger", () => {
  assert.equal(
    isForecastReset(point(100, 20), point(200, 1), point(300, 50)),
    false
  );
});

test("builds a seven-day forecast and separates elapsed and future areas", () => {
  const forecasts = buildResetForecasts([
    point(0, 0),
    point(1_000, 80),
    point(2_000, 1),
    point(3_000, 15)
  ], 2_000 + forecastDurationSeconds() / 7);

  assert.equal(forecasts.length, 1);
  assert.deepEqual(forecasts[0], {
    startTimestamp: 2_000,
    endTimestamp: 2_000 + forecastDurationSeconds(),
    startValue: 1,
    currentTimestamp: 2_000 + forecastDurationSeconds() / 7,
    currentValue: 1 + RESET_FORECAST_INCREASE / RESET_FORECAST_DEFAULT_DAYS,
    increase: RESET_FORECAST_INCREASE,
    durationSeconds: forecastDurationSeconds()
  });
});

test("uses the selected arrival days up to the seven-day maximum", () => {
  const forecasts = buildResetForecasts([
    point(0, 80),
    point(1_000, 1),
    point(2_000, 15)
  ], 1_000 + 24 * 60 * 60, 7);

  assert.equal(forecasts[0].durationSeconds, 7 * 24 * 60 * 60);
  assert.equal(forecasts[0].currentValue, 1 + 100 / 7);
});

test("caps the arrival days at seven", () => {
  assert.equal(forecastDurationSeconds(8), 7 * 24 * 60 * 60);
  assert.equal(forecastDurationSeconds(30), 7 * 24 * 60 * 60);
});

test("recognizes the exact 티보리셋 note", () => {
  assert.equal(isTiboResetNote({ note: "티보리셋" }), true);
  assert.equal(isTiboResetNote({ note: " 티보리셋 " }), true);
  assert.equal(isTiboResetNote({ note: "리셋" }), false);
});

test("recognizes any note containing 리셋 as a forced reset", () => {
  assert.equal(isResetNote({ note: "리셋" }), true);
  assert.equal(isResetNote({ note: "수동 리셋 처리" }), true);
  assert.equal(isResetNote({ note: "티보리셋" }), true);
  assert.equal(isResetNote({ note: "리셋 아님" }), true);
  assert.equal(isResetNote({ note: "정상 갱신" }), false);
});

test("starts a forecast at a note containing 리셋 even without a numeric reset pattern", () => {
  const forecasts = buildResetForecasts([
    point(0, 20),
    point(1_000, 40, { row: { note: "수동 리셋 후 시작" } }),
    point(2_000, 50)
  ], 1_000);

  assert.equal(forecasts.length, 1);
  assert.equal(forecasts[0].startTimestamp, 1_000);
  assert.equal(forecasts[0].startValue, 40);
});

test("uses a later 티보리셋 as the latest reset", () => {
  const forecasts = buildResetForecasts([
    point(0, 80),
    point(1_000, 1),
    point(2_000, 15),
    point(3_000, 42, { row: { note: "티보리셋" } }),
    point(4_000, 50)
  ], 4_000);

  assert.equal(forecasts.length, 2);
  assert.equal(forecasts[0].startTimestamp, 1_000);
  assert.equal(forecasts[0].endTimestamp, 3_000);
  assert.equal(forecasts[1].startTimestamp, 3_000);
  assert.equal(forecasts[1].startValue, 42);
});

test("starts separate forecasts at every 티보리셋", () => {
  const forecasts = buildResetForecasts([
    point(0, 80),
    point(1_000, 0, { row: { note: "티보리셋" } }),
    point(2_000, 0),
    point(3_000, 8),
    point(4_000, 0, { row: { note: "티보리셋" } }),
    point(5_000, 0),
    point(6_000, 1)
  ], 6_000);

  assert.equal(forecasts.length, 2);
  assert.deepEqual(
    forecasts.map(({ startTimestamp, endTimestamp, startValue }) => ({ startTimestamp, endTimestamp, startValue })),
    [
      { startTimestamp: 1_000, endTimestamp: 4_000, startValue: 0 },
      { startTimestamp: 4_000, endTimestamp: 4_000 + forecastDurationSeconds(), startValue: 0 }
    ]
  );
});

test("stops a prior forecast when a later reset begins", () => {
  const forecasts = buildResetForecasts([
    point(0, 50),
    point(10, 1),
    point(20, 10),
    point(30, 0),
    point(40, 8)
  ], 40);

  assert.equal(forecasts.length, 2);
  assert.equal(forecasts[0].endTimestamp, 30);
  assert.equal(forecasts[1].endTimestamp, 30 + forecastDurationSeconds());
});
