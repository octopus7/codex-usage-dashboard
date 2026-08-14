import assert from "node:assert/strict";
import test from "node:test";

import { resolveResetForecastDays } from "../public/reset-forecast-state.js";

test("keeps the modified days while the forecast remains enabled", () => {
  assert.equal(resolveResetForecastDays(true, 5), 5);
});

test("resets to seven days when the forecast is disabled", () => {
  assert.equal(resolveResetForecastDays(false, 5), 7);
});

test("clamps enabled values to the supported range", () => {
  assert.equal(resolveResetForecastDays(true, 30), 7);
  assert.equal(resolveResetForecastDays(true, 0), 1);
});
