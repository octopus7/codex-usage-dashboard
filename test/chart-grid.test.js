import assert from "node:assert/strict";
import test from "node:test";

import {
  DATE_CHANGE_GUIDE_SCALES,
  dateChangeGuideTimestamps
} from "../public/chart-grid.js";

const utcSeconds = (year, month, day, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) / 1000;

test("uses date-change guides for the two, four, seven, and fourteen day scales", () => {
  assert.deepEqual([...DATE_CHANGE_GUIDE_SCALES].sort(), ["1w", "2d", "2w", "4d"].sort());
  const range = { start: utcSeconds(2026, 1, 1, 16), end: utcSeconds(2026, 1, 3, 16) };

  const expected = [utcSeconds(2026, 1, 2, 15), utcSeconds(2026, 1, 3, 15)];
  assert.deepEqual(dateChangeGuideTimestamps(range, "2d"), expected);
  assert.deepEqual(dateChangeGuideTimestamps(range, "4d"), expected);
  assert.deepEqual(dateChangeGuideTimestamps(range, "1w"), expected);
  assert.deepEqual(dateChangeGuideTimestamps(range, "2w"), expected);
});

test("uses fifteen-minute guides for the one-hour scale", () => {
  const range = {
    start: utcSeconds(2026, 1, 1, 15, 7),
    end: utcSeconds(2026, 1, 1, 16, 7)
  };

  assert.deepEqual(dateChangeGuideTimestamps(range, "1h"), [
    utcSeconds(2026, 1, 1, 15, 15),
    utcSeconds(2026, 1, 1, 15, 30),
    utcSeconds(2026, 1, 1, 15, 45),
    utcSeconds(2026, 1, 1, 16)
  ]);
});

test("uses hourly guides for scales longer than one hour through one day", () => {
  const range = {
    start: utcSeconds(2026, 1, 1, 15, 7),
    end: utcSeconds(2026, 1, 1, 21, 7)
  };
  const expected = [
    utcSeconds(2026, 1, 1, 16),
    utcSeconds(2026, 1, 1, 17),
    utcSeconds(2026, 1, 1, 18),
    utcSeconds(2026, 1, 1, 19),
    utcSeconds(2026, 1, 1, 20),
    utcSeconds(2026, 1, 1, 21)
  ];

  for (const scale of ["6h", "12h", "1d"]) {
    assert.deepEqual(dateChangeGuideTimestamps(range, scale), expected, scale);
  }
});

test("does not draw a guide at the left edge when a range starts at midnight", () => {
  const range = { start: utcSeconds(2026, 1, 2, 15), end: utcSeconds(2026, 1, 4, 15) };

  assert.deepEqual(dateChangeGuideTimestamps(range, "2d"), [
    utcSeconds(2026, 1, 3, 15)
  ]);
});
