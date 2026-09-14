import assert from "node:assert/strict";
import test from "node:test";

import {
  DATE_CHANGE_GUIDE_SCALES,
  dateChangeGuideTimestamps
} from "../public/chart-grid.js";

const utcSeconds = (year, month, day, hour = 0) => Date.UTC(year, month - 1, day, hour) / 1000;

test("uses date-change guides only for the two, seven, and fourteen day scales", () => {
  assert.deepEqual([...DATE_CHANGE_GUIDE_SCALES].sort(), ["1w", "2d", "2w"]);
  const range = { start: utcSeconds(2026, 1, 1, 16), end: utcSeconds(2026, 1, 3, 16) };

  const expected = [utcSeconds(2026, 1, 2, 15), utcSeconds(2026, 1, 3, 15)];
  assert.deepEqual(dateChangeGuideTimestamps(range, "2d"), expected);
  assert.deepEqual(dateChangeGuideTimestamps(range, "1w"), expected);
  assert.deepEqual(dateChangeGuideTimestamps(range, "2w"), expected);
  assert.deepEqual(dateChangeGuideTimestamps(range, "1d"), []);
});

test("does not draw a guide at the left edge when a range starts at midnight", () => {
  const range = { start: utcSeconds(2026, 1, 2, 15), end: utcSeconds(2026, 1, 4, 15) };

  assert.deepEqual(dateChangeGuideTimestamps(range, "2d"), [
    utcSeconds(2026, 1, 3, 15)
  ]);
});
