import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  WEEKLY_USAGE_RSS_ITEM_LIMIT,
  WEEKLY_USAGE_RSS_QUERY,
  buildWeeklyUsageRssDocument
} from "../src/rss.js";
import worker from "../src/worker.js";

test("weekly RSS query keeps only actual value changes", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE codex_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usage_type TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      used_percent REAL NOT NULL
    );
    INSERT INTO codex_usage (usage_type, recorded_at, used_percent) VALUES
      ('week', 100, 10),
      ('week', 200, 10),
      ('5h',   250, 99),
      ('week', 300, 15),
      ('week', 400, 15),
      ('week', 500, 10);
  `);

  const rows = database
    .prepare(WEEKLY_USAGE_RSS_QUERY)
    .all(WEEKLY_USAGE_RSS_ITEM_LIMIT);

  assert.deepEqual(
    rows.map(({ recordedAt, usedPercent }) => [recordedAt, usedPercent]),
    [[500, 10], [300, 15], [100, 10]]
  );
  database.close();
});

test("weekly RSS items expose numeric values without record metadata", () => {
  const rss = buildWeeklyUsageRssDocument(
    [
      {
        id: 7,
        recordedAt: 1_784_340_000,
        usedPercent: 42.5,
        source: "collector",
        note: "must stay private"
      }
    ],
    "https://usage.example.com/rss.xml"
  );

  assert.match(rss, /<title>42\.5<\/title>/);
  assert.match(rss, /<description>42\.5<\/description>/);
  assert.match(rss, /<guid isPermaLink="false">week:7:1784340000:42\.5<\/guid>/);
  assert.doesNotMatch(rss, /collector|must stay private/);
});

test("GET /rss.xml returns a public RSS response", async () => {
  const rows = [{ id: 9, recordedAt: 1_784_340_000, usedPercent: 68.2 }];
  const env = {
    DB: {
      prepare(query) {
        assert.equal(query, WEEKLY_USAGE_RSS_QUERY);
        return {
          bind(limit) {
            assert.equal(limit, WEEKLY_USAGE_RSS_ITEM_LIMIT);
            return {
              async all() {
                return { results: rows };
              }
            };
          }
        };
      }
    },
    ASSETS: {
      fetch() {
        throw new Error("RSS route must not fall through to static assets");
      }
    }
  };

  const response = await worker.fetch(
    new Request("https://usage.example.com/rss.xml"),
    env
  );
  const rss = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/rss+xml; charset=utf-8");
  assert.match(rss, /<description>68\.2<\/description>/);
});
