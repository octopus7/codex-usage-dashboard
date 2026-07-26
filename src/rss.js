export const WEEKLY_USAGE_RSS_ITEM_LIMIT = 50;

export const WEEKLY_USAGE_RSS_QUERY = `
  WITH ordered AS (
    SELECT
      id,
      recorded_at AS recordedAt,
      used_percent AS usedPercent,
      LAG(used_percent) OVER (
        ORDER BY recorded_at ASC, id ASC
      ) AS previousPercent
    FROM codex_usage
    WHERE usage_type = 'week'
  ),
  changes AS (
    SELECT id, recordedAt, usedPercent
    FROM ordered
    WHERE previousPercent IS NULL OR usedPercent <> previousPercent
    ORDER BY recordedAt DESC, id DESC
    LIMIT ?
  )
  SELECT id, recordedAt, usedPercent
  FROM changes
  ORDER BY recordedAt DESC, id DESC
`;

export function buildWeeklyUsageRssDocument(rows, dashboardUrl) {
  const dashboardLink = escapeXml(new URL("/", dashboardUrl).toString());
  const items = rows.map((row) => {
    const value = String(Number(row.usedPercent));
    const recordedAt = Number(row.recordedAt);
    const publishedAt = new Date(recordedAt * 1000).toUTCString();
    const guid = `week:${Number(row.id)}:${recordedAt}:${value}`;
    return [
      "    <item>",
      `      <title>${value}</title>`,
      `      <description>${value}</description>`,
      `      <guid isPermaLink="false">${guid}</guid>`,
      `      <pubDate>${publishedAt}</pubDate>`,
      "    </item>"
    ].join("\n");
  });

  const latestBuildDate = rows.length
    ? `    <lastBuildDate>${new Date(Number(rows[0].recordedAt) * 1000).toUTCString()}</lastBuildDate>`
    : null;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>Codex weekly usage</title>",
    `    <link>${dashboardLink}</link>`,
    "    <description>Weekly usage percentage changes</description>",
    latestBuildDate,
    ...items,
    "  </channel>",
    "</rss>",
    ""
  ].filter(Boolean).join("\n");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
