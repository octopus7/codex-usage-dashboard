const USAGE_TYPES = ["5h", "week"];

const SERIES_META = {
  "5h": { label: "5시간", cssSuffix: "5h" },
  week: { label: "주간", cssSuffix: "week" }
};

const SCALES = {
  "1h": { label: "1시간", seconds: 60 * 60, bucket: 60 },
  "6h": { label: "6시간", seconds: 6 * 60 * 60, bucket: 5 * 60 },
  "12h": { label: "12시간", seconds: 12 * 60 * 60, bucket: 10 * 60 },
  "1d": { label: "1일", seconds: 24 * 60 * 60, bucket: 20 * 60 },
  "2d": { label: "2일", seconds: 2 * 24 * 60 * 60, bucket: 30 * 60 },
  "1w": { label: "1주", seconds: 7 * 24 * 60 * 60, bucket: 2 * 60 * 60 },
  "2w": { label: "2주", seconds: 14 * 24 * 60 * 60, bucket: 4 * 60 * 60 },
  "4w": { label: "4주", seconds: 28 * 24 * 60 * 60, bucket: 8 * 60 * 60 }
};

const METRICS = {
  percent: {
    label: "사용률",
    value: (row) => row?.usedPercent ?? null,
    format: (value) => `${formatNumber(value, 1)}%`,
    axisFloor: 0,
    axisPreferredMax: 100
  }
};

const params = new URLSearchParams(location.search);
const initialScale = SCALES[params.get("scale")] ? params.get("scale") : "1d";
const initialPage = Math.max(0, Number.parseInt(params.get("page") || "0", 10) || 0);
const initialMetric = METRICS[params.get("metric")] ? params.get("metric") : "percent";
const initialVisibleTypes = new Set(
  (params.get("series") || "5h,week")
    .split(",")
    .filter((usageType) => USAGE_TYPES.includes(usageType))
);

if (initialVisibleTypes.size === 0) {
  initialVisibleTypes.add("5h");
  initialVisibleTypes.add("week");
}

const state = {
  scale: initialScale,
  page: initialPage,
  metric: initialMetric,
  visibleTypes: initialVisibleTypes,
  loading: false,
  data: null,
  chartGeometry: null,
  adminConfigured: false,
  adminAuthenticated: false,
  authLoading: false
};

const elements = {
  connectionStatus: document.querySelector("#connection-status"),
  scaleSelector: document.querySelector("#scale-selector"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  rangeTitle: document.querySelector("#range-title"),
  rangeSubtitle: document.querySelector("#range-subtitle"),
  fiveHourLatest: document.querySelector("#summary-5h-value"),
  fiveHourMeta: document.querySelector("#summary-5h-detail"),
  fiveHourChange: document.querySelector("#change-5h-value"),
  fiveHourCount: document.querySelector("#change-5h-detail"),
  weekLatest: document.querySelector("#summary-week-value"),
  weekMeta: document.querySelector("#summary-week-detail"),
  weekChange: document.querySelector("#change-week-value"),
  weekCount: document.querySelector("#change-week-detail"),
  chartCard: document.querySelector("#chart-card"),
  chartWrap: document.querySelector("#chart-wrap"),
  chart: document.querySelector("#usage-chart"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  chartEmpty: document.querySelector("#chart-empty"),
  seriesLegend: document.querySelector("#series-legend"),
  tableBody: document.querySelector("#usage-table-body"),
  tableDescription: document.querySelector("#table-description"),
  refreshButton: document.querySelector("#refresh-button"),
  adminActionsHeader: document.querySelector("#admin-action-header"),
  adminLoginButton: document.querySelector("#admin-login-button"),
  adminLogoutButton: document.querySelector("#admin-logout-button"),
  setupDialog: document.querySelector("#admin-setup-dialog"),
  setupForm: document.querySelector("#admin-setup-form"),
  setupPassword: document.querySelector("#setup-password"),
  setupPasswordConfirm: document.querySelector("#setup-password-confirm"),
  setupSubmitButton: document.querySelector("#setup-submit-button"),
  loginDialog: document.querySelector("#admin-login-dialog"),
  loginForm: document.querySelector("#admin-login-form"),
  loginPassword: document.querySelector("#login-password"),
  loginSubmitButton: document.querySelector("#login-submit-button"),
  addButton: document.querySelector("#add-button"),
  addDialog: document.querySelector("#add-dialog"),
  addForm: document.querySelector("#add-form"),
  addSubmitButton: document.querySelector("#add-submit-button"),
  fieldRecordedAt: document.querySelector("#field-recorded-at"),
  toast: document.querySelector("#toast"),
  deployInfo: document.querySelector("#deploy-info")
};

let toastTimer;
let swipeStart = null;

initialize();

async function initialize() {
  bindEvents();
  updateScaleButtons();
  updateLegendButtons();
  updateAdminUi();
  loadDeployInfo();

  await Promise.allSettled([
    refreshAdminStatus({ autoPrompt: true, quiet: true }),
    checkHealth()
  ]);
  await loadUsage();

  window.setInterval(() => {
    if (state.page === 0 && !document.hidden) loadUsage({ quiet: true });
  }, 60_000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAdminStatus({ quiet: true });
  });
}

async function loadDeployInfo() {
  if (!elements.deployInfo) return;

  try {
    const response = await fetch("/deploy-info.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Deployment information unavailable");

    const info = await response.json();
    const deployedAt = new Date(info.deployedAt);
    if (Number.isNaN(deployedAt.getTime())) throw new Error("Invalid deployment date");

    const pad = (value) => String(value).padStart(2, "0");
    const localDate = [
      deployedAt.getFullYear(),
      pad(deployedAt.getMonth() + 1),
      pad(deployedAt.getDate())
    ].join(". ");
    const localTime = [
      pad(deployedAt.getHours()),
      pad(deployedAt.getMinutes()),
      pad(deployedAt.getSeconds())
    ].join(":");

    elements.deployInfo.textContent =
      `Deployed: ${localDate}. ${localTime} · Commit: ${info.commitSha} · Run: #${info.runNumber}`;
  } catch {
    elements.deployInfo.textContent = "Deployment information unavailable";
  }
}

function bindEvents() {
  elements.scaleSelector.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scale]");
    if (!button || !SCALES[button.dataset.scale]) return;

    state.scale = button.dataset.scale;
    state.page = 0;
    updateScaleButtons();
    loadUsage();
  });

  elements.previousButton.addEventListener("click", navigateOlder);
  elements.nextButton.addEventListener("click", navigateNewer);
  elements.refreshButton.addEventListener("click", () => loadUsage());


  elements.seriesLegend.addEventListener("click", (event) => {
    const button = event.target.closest("[data-series-toggle]");
    if (!button) return;

    const usageType = button.dataset.seriesToggle;
    if (state.visibleTypes.has(usageType)) state.visibleTypes.delete(usageType);
    else state.visibleTypes.add(usageType);

    updateLegendButtons();
    syncUrl();
    renderChart();
  });

  elements.adminLoginButton.addEventListener("click", openAdminDialog);
  elements.adminLogoutButton.addEventListener("click", submitAdminLogout);
  elements.setupForm.addEventListener("submit", submitAdminSetup);
  elements.loginForm.addEventListener("submit", submitAdminLogin);

  elements.addButton.addEventListener("click", () => {
    if (!requireAdminSession()) return;
    elements.fieldRecordedAt.value = toLocalDateTimeInput(new Date());
    elements.addDialog.showModal();
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  elements.addForm.addEventListener("submit", submitManualUsage);

  elements.tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (!button) return;
    await deleteEntry(
      Number(button.dataset.deleteId),
      button.dataset.usageType,
      button.dataset.recordedAt
    );
  });

  elements.chart.addEventListener("pointermove", updateChartTooltip);
  elements.chart.addEventListener("pointerleave", hideChartTooltip);

  elements.chartCard.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      swipeStart = { x: touch.clientX, y: touch.clientY };
    },
    { passive: true }
  );

  elements.chartCard.addEventListener(
    "touchend",
    (event) => {
      if (!swipeStart) return;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - swipeStart.x;
      const deltaY = touch.clientY - swipeStart.y;
      swipeStart = null;

      if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
      if (deltaX < 0) navigateOlder();
      else navigateNewer();
    },
    { passive: true }
  );

  window.addEventListener("resize", hideChartTooltip);
}

function navigateOlder() {
  if (state.loading) return;
  state.page += 1;
  loadUsage();
}

function navigateNewer() {
  if (state.loading || state.page === 0) return;
  state.page -= 1;
  loadUsage();
}

function calculateRange() {
  const scale = SCALES[state.scale];
  const now = Math.floor(Date.now() / 1000);
  const end = now - state.page * scale.seconds;
  return {
    start: end - scale.seconds,
    end,
    bucket: scale.bucket
  };
}

async function loadUsage({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  setControlsDisabled(true);

  const range = calculateRange();
  renderRange(range);
  syncUrl();

  try {
    const query = new URLSearchParams({
      start: String(range.start),
      end: String(range.end),
      bucket: String(range.bucket)
    });

    const response = await fetch(`/api/usage?${query}`, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "조회에 실패했습니다.");

    state.data = result;
    renderSummary();
    renderChart();
    renderTable();
    setConnectionStatus(true, "D1 연결됨");
  } catch (error) {
    setConnectionStatus(false, "연결 오류");
    if (!quiet) showToast(error.message, true);
    renderLoadError(error.message);
  } finally {
    state.loading = false;
    setControlsDisabled(false);
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error();
    setConnectionStatus(true, "D1 연결됨");
  } catch {
    setConnectionStatus(false, "설정 확인 필요");
  }
}


async function refreshAdminStatus({ autoPrompt = false, quiet = false } = {}) {
  let loaded = false;
  try {
    const response = await fetch("/api/admin/status", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "관리자 상태 확인에 실패했습니다.");

    state.adminConfigured = Boolean(result.configured);
    state.adminAuthenticated = Boolean(result.authenticated);
    loaded = true;
  } catch (error) {
    state.adminAuthenticated = false;
    if (!quiet) showToast(error.message, true);
  } finally {
    updateAdminUi();
    if (state.data) renderTable();
  }

  if (loaded && autoPrompt && !state.adminConfigured && !elements.setupDialog.open) {
    elements.setupForm.reset();
    elements.setupDialog.showModal();
    window.setTimeout(() => elements.setupPassword.focus(), 0);
  }
  return loaded;
}

function openAdminDialog() {
  if (state.authLoading || state.adminAuthenticated) return;

  if (!state.adminConfigured) {
    elements.setupForm.reset();
    if (!elements.setupDialog.open) elements.setupDialog.showModal();
    window.setTimeout(() => elements.setupPassword.focus(), 0);
    return;
  }

  elements.loginForm.reset();
  if (!elements.loginDialog.open) elements.loginDialog.showModal();
  window.setTimeout(() => elements.loginPassword.focus(), 0);
}

async function submitAdminSetup(event) {
  event.preventDefault();
  const password = elements.setupPassword.value;
  const confirmation = elements.setupPasswordConfirm.value;

  if (password !== confirmation) {
    showToast("비밀번호 확인 값이 일치하지 않습니다.", true);
    elements.setupPasswordConfirm.focus();
    return;
  }
  if (password.length < 10) {
    showToast("비밀번호는 10자 이상이어야 합니다.", true);
    elements.setupPassword.focus();
    return;
  }

  state.authLoading = true;
  elements.setupSubmitButton.disabled = true;
  try {
    const response = await fetch("/api/admin/setup", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        state.adminConfigured = true;
        elements.setupDialog.close();
        elements.loginForm.reset();
        if (!elements.loginDialog.open) elements.loginDialog.showModal();
        window.setTimeout(() => elements.loginPassword.focus(), 0);
      }
      throw new Error(result.message || "비밀번호 설정에 실패했습니다.");
    }

    state.adminConfigured = true;
    state.adminAuthenticated = true;
    elements.setupDialog.close();
    updateAdminUi();
    renderTable();
    showToast("관리자 비밀번호를 설정하고 로그인했습니다.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.authLoading = false;
    elements.setupSubmitButton.disabled = false;
  }
}

async function submitAdminLogin(event) {
  event.preventDefault();
  const password = elements.loginPassword.value;

  state.authLoading = true;
  elements.loginSubmitButton.disabled = true;
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        state.adminConfigured = false;
        elements.loginDialog.close();
        elements.setupForm.reset();
        if (!elements.setupDialog.open) elements.setupDialog.showModal();
        window.setTimeout(() => elements.setupPassword.focus(), 0);
      }
      throw new Error(result.message || "로그인에 실패했습니다.");
    }

    state.adminConfigured = true;
    state.adminAuthenticated = true;
    elements.loginDialog.close();
    elements.loginForm.reset();
    updateAdminUi();
    renderTable();
    showToast("관리자로 로그인했습니다.");
  } catch (error) {
    showToast(error.message, true);
    elements.loginPassword.select();
  } finally {
    state.authLoading = false;
    elements.loginSubmitButton.disabled = false;
  }
}

async function submitAdminLogout() {
  if (state.authLoading) return;
  state.authLoading = true;
  elements.adminLogoutButton.disabled = true;
  try {
    const response = await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "로그아웃에 실패했습니다.");

    state.adminAuthenticated = false;
    updateAdminUi();
    renderTable();
    showToast("로그아웃했습니다.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.authLoading = false;
    elements.adminLogoutButton.disabled = false;
  }
}

async function handleAdminSessionExpired() {
  state.adminAuthenticated = false;
  updateAdminUi();
  renderTable();
  if (elements.addDialog.open) elements.addDialog.close();
  await refreshAdminStatus({ quiet: true });
  showToast("관리자 세션이 만료되었습니다. 다시 로그인하세요.", true);
  openAdminDialog();
}

function requireAdminSession() {
  if (state.adminAuthenticated) return true;
  openAdminDialog();
  showToast(
    state.adminConfigured
      ? "추가·삭제를 위해 관리자 로그인이 필요합니다."
      : "먼저 관리자 비밀번호를 설정하세요.",
    true
  );
  return false;
}

function updateAdminUi() {
  elements.adminLoginButton.hidden = state.adminAuthenticated;
  elements.adminLogoutButton.hidden = !state.adminAuthenticated;
  elements.adminActionsHeader.hidden = !state.adminAuthenticated;
  elements.addButton.hidden = !state.adminAuthenticated;
}

function renderRange(range) {
  const format = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  elements.rangeTitle.textContent =
    `${format.format(new Date(range.start * 1000))} – ${format.format(new Date(range.end * 1000))}`;

  elements.rangeSubtitle.textContent =
    state.page === 0
      ? `${SCALES[state.scale].label} · 현재 구간 · 두 시계열 동시 조회`
      : `${SCALES[state.scale].label} · 현재보다 ${state.page}구간 이전`;

  elements.nextButton.disabled = state.page === 0 || state.loading;
}

function renderSummary() {
  renderTypeSummary("5h", {
    latest: elements.fiveHourLatest,
    meta: elements.fiveHourMeta,
    change: elements.fiveHourChange,
    count: elements.fiveHourCount
  });

  renderTypeSummary("week", {
    latest: elements.weekLatest,
    meta: elements.weekMeta,
    change: elements.weekChange,
    count: elements.weekCount
  });
}

function renderTypeSummary(usageType, targets) {
  const summary = state.data?.summaries?.[usageType];
  const latest = summary?.latest;

  if (!latest) {
    targets.latest.textContent = "-";
    targets.meta.textContent = "데이터 없음";
    targets.change.textContent = "-";
    targets.count.textContent = "0회 갱신";
    return;
  }

  const percent = utilizationPercent(latest);
  targets.latest.textContent = percent === null ? "-" : `${formatNumber(percent, 1)}%`;
  const carriedText = summary.eventCount === 0 && summary.carriedAtStart ? " · 이전 값 유지" : "";
  targets.meta.textContent = `갱신 ${formatDateTime(latest.recordedAt)}${carriedText}`;
  targets.change.textContent = summary.utilizationChange === null
    ? "-"
    : formatSigned(summary.utilizationChange, "%p", 1);
  targets.count.textContent =
    `${formatNumber(summary.eventCount, 0)}회 갱신` +
    (summary.carriedAtStart ? " · 범위 시작 전 기준점 포함" : "");
}

function renderChart() {
  const metric = METRICS[state.metric];
  const range = state.data?.range || calculateRange();
  const selectedTypes = USAGE_TYPES.filter((usageType) => state.visibleTypes.has(usageType));

  hideChartTooltip();

  if (selectedTypes.length === 0) {
    elements.chart.innerHTML = "";
    elements.chartEmpty.textContent = "범례에서 표시할 시계열을 선택하세요.";
    elements.chartEmpty.hidden = false;
    state.chartGeometry = null;
    return;
  }

  const rawSeries = {};
  const allValues = [];

  for (const usageType of selectedTypes) {
    const points = buildMetricPoints(usageType, metric, range);
    rawSeries[usageType] = points;
    for (const point of points) allValues.push(point.value);
  }

  if (allValues.length === 0) {
    elements.chart.innerHTML = "";
    elements.chartEmpty.textContent = `선택한 기간에 ${metric.label} 데이터가 없습니다.`;
    elements.chartEmpty.hidden = false;
    state.chartGeometry = null;
    return;
  }

  elements.chartEmpty.hidden = true;

  const width = 900;
  const height = 340;
  const padding = { left: 68, right: 68, top: 24, bottom: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const minValue = 0;
  const maxValue = 100;

  const xFor = (timestamp) =>
    padding.left + ((timestamp - range.start) / (range.end - range.start)) * plotWidth;
  const yFor = (value) => {
    const clampedValue = Math.max(minValue, Math.min(maxValue, value));
    return padding.top
      + plotHeight
      - ((clampedValue - minValue) / (maxValue - minValue)) * plotHeight;
  };

  const geometrySeries = {};
  for (const usageType of selectedTypes) {
    geometrySeries[usageType] = rawSeries[usageType].map((point) => ({
      ...point,
      x: xFor(point.timestamp),
      y: yFor(point.value)
    }));
  }

  state.chartGeometry = {
    width,
    height,
    padding,
    plotWidth,
    plotHeight,
    range,
    minValue,
    maxValue,
    metric,
    xFor,
    yFor,
    series: geometrySeries
  };

  const gridLines = [];
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = padding.top + ratio * plotHeight;
    const value = maxValue - ratio * (maxValue - minValue);
    gridLines.push(`
      <line class="chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>
      <text class="chart-axis-label" x="${padding.left - 10}" y="${y + 4}" text-anchor="end">${escapeHtml(metric.format(value))}</text>
      <text class="chart-axis-label" x="${width - padding.right + 10}" y="${y + 4}" text-anchor="start">${escapeHtml(metric.format(value))}</text>
    `);
  }

  const timeLabels = [];
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const timestamp = range.start + ratio * (range.end - range.start);
    const x = padding.left + ratio * plotWidth;
    timeLabels.push(`
      <text class="chart-axis-label" x="${x}" y="${height - 14}" text-anchor="${index === 0 ? "start" : index === 4 ? "end" : "middle"}">
        ${escapeHtml(formatChartTime(timestamp, SCALES[state.scale].seconds))}
      </text>
    `);
  }

  const seriesMarkup = [];
  const totalRealPoints = Object.values(geometrySeries)
    .flat()
    .filter((point) => !point.synthetic).length;
  const showEventDots = totalRealPoints <= 160;

  for (const usageType of selectedTypes) {
    const points = geometrySeries[usageType];
    if (!points.length) continue;

    const suffix = SERIES_META[usageType].cssSuffix;
    seriesMarkup.push(
      `<path class="chart-line chart-line-${suffix}" d="${createLinearResetPath(points, width - padding.right)}"></path>`
    );

    if (showEventDots) {
      for (const point of points.filter((candidate) => !candidate.synthetic)) {
        seriesMarkup.push(
          `<circle class="chart-event-dot chart-event-dot-${suffix}" cx="${point.x}" cy="${point.y}" r="3.5"></circle>`
        );
      }
    }
  }

  elements.chart.innerHTML = `
    ${gridLines.join("")}
    ${timeLabels.join("")}
    ${seriesMarkup.join("")}
    <line id="chart-hover-line" class="chart-hover-line" y1="${padding.top}" y2="${padding.top + plotHeight}" hidden></line>
    <g id="chart-hover-dots"></g>
    <rect x="${padding.left}" y="${padding.top}" width="${plotWidth}" height="${plotHeight}" fill="transparent"></rect>
  `;
}

function buildMetricPoints(usageType, metric, range) {
  const points = [];
  const baseline = state.data?.baselines?.[usageType];

  if (baseline) {
    const baselineValue = metric.value(baseline);
    if (Number.isFinite(baselineValue)) {
      points.push({
        usageType,
        timestamp: range.start,
        actualRecordedAt: baseline.recordedAt,
        value: baselineValue,
        row: baseline,
        synthetic: true
      });
    }
  }

  for (const row of state.data?.series?.[usageType] || []) {
    const value = metric.value(row);
    if (!Number.isFinite(value)) continue;
    points.push({
      usageType,
      timestamp: row.recordedAt,
      actualRecordedAt: row.recordedAt,
      value,
      row,
      synthetic: false
    });
  }

  points.sort(
    (left, right) =>
      left.timestamp - right.timestamp ||
      Number(right.synthetic) - Number(left.synthetic) ||
      left.row.id - right.row.id
  );

  return points.filter(
    (point, index) =>
      index === 0 ||
      point.timestamp !== points[index - 1].timestamp ||
      point.row.id !== points[index - 1].row.id ||
      point.synthetic !== points[index - 1].synthetic
  );
}

function createLinearResetPath(points, endX) {
  const [first, ...rest] = points;
  if (!first) return "";
  const parts = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  let previous = first;

  for (const point of rest) {
    const command = isUsageReset(previous, point) ? "M" : "L";
    parts.push(`${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
    previous = point;
  }

  const last = points[points.length - 1];
  if (last.x < endX) parts.push(`L ${endX.toFixed(2)} ${last.y.toFixed(2)}`);
  return parts.join(" ");
}

function isUsageReset(previous, current) {
  const previousProgress = usageProgress(previous?.row);
  const currentProgress = usageProgress(current?.row);
  if (!Number.isFinite(previousProgress) || !Number.isFinite(currentProgress)) return false;
  return currentProgress < previousProgress - 0.000000001;
}

function usageProgress(row) {
  if (!row || row.usedPercent === null || row.usedPercent === undefined) return null;
  return row.usedPercent;
}

function updateChartTooltip(event) {
  const geometry = state.chartGeometry;
  if (!geometry) return;

  const bounds = elements.chart.getBoundingClientRect();
  const rawSvgX = ((event.clientX - bounds.left) / bounds.width) * geometry.width;
  const svgX = clamp(
    rawSvgX,
    geometry.padding.left,
    geometry.width - geometry.padding.right
  );
  const timestamp =
    geometry.range.start +
    ((svgX - geometry.padding.left) / geometry.plotWidth) *
      (geometry.range.end - geometry.range.start);

  const active = [];
  for (const usageType of USAGE_TYPES) {
    if (!state.visibleTypes.has(usageType)) continue;
    const point = findChartPointAtTimestamp(geometry.series[usageType] || [], timestamp);
    if (point) active.push(point);
  }

  if (active.length === 0) {
    hideChartTooltip();
    return;
  }

  const hoverLine = elements.chart.querySelector("#chart-hover-line");
  const hoverDots = elements.chart.querySelector("#chart-hover-dots");
  if (!hoverLine || !hoverDots) return;

  hoverLine.hidden = false;
  hoverLine.setAttribute("x1", String(svgX));
  hoverLine.setAttribute("x2", String(svgX));
  hoverDots.innerHTML = active
    .map((point) => {
      const suffix = SERIES_META[point.usageType].cssSuffix;
      return `<circle class="chart-hover-dot chart-hover-dot-${suffix}" cx="${svgX}" cy="${point.y}" r="5"></circle>`;
    })
    .join("");

  elements.chartTooltip.innerHTML = `
    <span class="tooltip-time">${escapeHtml(formatFullDateTime(timestamp))}</span>
    ${active
      .map((point) => {
        const meta = SERIES_META[point.usageType];
        return `
          <div class="tooltip-series-row">
            <i class="series-dot dot-${meta.cssSuffix}"></i>
            <strong>${escapeHtml(meta.label)}</strong>
            <span>${escapeHtml(geometry.metric.format(point.value))}</span>
            <small>${escapeHtml(
              point.interpolated
                ? `${formatFullDateTime(point.segmentStartAt)} → ${formatFullDateTime(point.segmentEndAt)} 직선 구간`
                : `마지막 갱신 ${formatFullDateTime(point.actualRecordedAt)}`
            )}</small>
          </div>
        `;
      })
      .join("")}
  `;
  elements.chartTooltip.hidden = false;

  const tooltipWidth = elements.chartTooltip.offsetWidth;
  const tooltipHeight = elements.chartTooltip.offsetHeight;
  const localX = (svgX / geometry.width) * bounds.width;
  const activeY = Math.min(...active.map((point) => point.y));
  const localY = (activeY / geometry.height) * bounds.height;

  const left =
    localX + tooltipWidth + 20 < bounds.width
      ? localX + 12
      : localX - tooltipWidth - 12;
  const top = clamp(localY - tooltipHeight - 12, 8, bounds.height - tooltipHeight - 8);

  elements.chartTooltip.style.left = `${Math.max(8, left)}px`;
  elements.chartTooltip.style.top = `${top}px`;
}

function findChartPointAtTimestamp(points, timestamp) {
  if (!points.length || timestamp < points[0].timestamp) return null;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (Math.abs(timestamp - current.timestamp) < 0.000001) return current;
    if (!next) return current;
    if (timestamp >= next.timestamp) continue;
    if (isUsageReset(current, next)) return null;

    const duration = next.timestamp - current.timestamp;
    if (duration <= 0) return next;
    const ratio = (timestamp - current.timestamp) / duration;
    return {
      ...current,
      timestamp,
      value: current.value + (next.value - current.value) * ratio,
      y: current.y + (next.y - current.y) * ratio,
      interpolated: true,
      segmentStartAt: current.actualRecordedAt,
      segmentEndAt: next.actualRecordedAt
    };
  }

  return points[points.length - 1] || null;
}

function hideChartTooltip() {
  elements.chartTooltip.hidden = true;
  const hoverLine = elements.chart.querySelector("#chart-hover-line");
  const hoverDots = elements.chart.querySelector("#chart-hover-dots");
  if (hoverLine) hoverLine.hidden = true;
  if (hoverDots) hoverDots.innerHTML = "";
}

function renderTable() {
  const entries = state.data?.entries || [];
  const total = state.data?.totalCount || 0;
  const fiveHourCount = state.data?.counts?.["5h"] || 0;
  const weekCount = state.data?.counts?.week || 0;
  const columnCount = state.adminAuthenticated ? 6 : 5;

  elements.tableDescription.textContent = state.data?.entriesTruncated
    ? `전체 ${formatNumber(total, 0)}건(5시간 ${formatNumber(fiveHourCount, 0)} · 주간 ${formatNumber(weekCount, 0)}) 중 최근 300건을 표시합니다.`
    : `전체 ${formatNumber(total, 0)}건 · 5시간 ${formatNumber(fiveHourCount, 0)}건 · 주간 ${formatNumber(weekCount, 0)}건`;

  if (!entries.length) {
    elements.tableBody.innerHTML =
      `<tr class="empty-row"><td colspan="${columnCount}">이 기간에는 변경 기록이 없습니다. 범위 시작 전 값은 그래프의 기준점으로 사용될 수 있습니다.</td></tr>`;
    return;
  }

  elements.tableBody.innerHTML = entries
    .map((row) => {
      const percent = utilizationPercent(row);
      const meta = SERIES_META[row.usageType] || SERIES_META["5h"];
      const adminCell = state.adminAuthenticated
        ? `<td><button class="delete-button" type="button" data-delete-id="${row.id}" data-usage-type="${escapeHtml(row.usageType)}" data-recorded-at="${row.recordedAt}">삭제</button></td>`
        : "";

      return `
        <tr>
          <td><span class="type-badge type-badge-${meta.cssSuffix}"><i class="series-dot dot-${meta.cssSuffix}"></i>${escapeHtml(meta.label)}</span></td>
          <td title="${escapeHtml(new Date(row.recordedAt * 1000).toISOString())}">${escapeHtml(formatDateTime(row.recordedAt))}</td>
          <td>${percent === null ? "-" : `${formatNumber(percent, 1)}%`}</td>
          <td>${escapeHtml(row.source || "-")}</td>
          <td class="note-cell" title="${escapeHtml(row.note || "")}">${escapeHtml(row.note || "-")}</td>
          ${adminCell}
        </tr>
      `;
    })
    .join("");
}

function renderLoadError(message) {
  elements.chart.innerHTML = "";
  elements.chartEmpty.hidden = false;
  elements.chartEmpty.textContent = message;
  elements.tableBody.innerHTML =
    `<tr class="empty-row"><td colspan="${state.adminAuthenticated ? 6 : 5}">${escapeHtml(message)}</td></tr>`;
}

async function submitManualUsage(event) {
  event.preventDefault();
  if (!requireAdminSession()) {
    elements.addDialog.close();
    return;
  }

  const formData = new FormData(elements.addForm);
  const payload = {
    usageType: String(formData.get("usageType")),
    recordedAt: new Date(String(formData.get("recordedAt"))).toISOString(),
    usedPercent: numberFromForm(formData.get("usedPercent")),
    source: String(formData.get("source") || "manual"),
    note: String(formData.get("note") || "")
  };

  elements.addSubmitButton.disabled = true;
  try {
    const response = await fetch("/api/usage/manual", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (response.status === 401) {
      await handleAdminSessionExpired();
      return;
    }
    if (!response.ok) throw new Error(result.message || "저장에 실패했습니다.");

    elements.addDialog.close();
    elements.addForm.reset();
    showToast(`${SERIES_META[payload.usageType].label} 사용량을 추가했습니다.`);
    await loadUsage();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.addSubmitButton.disabled = false;
  }
}

async function deleteEntry(id, usageType, recordedAt) {
  if (!requireAdminSession()) return;

  const label = SERIES_META[usageType]?.label || usageType;
  const time = recordedAt ? formatFullDateTime(Number(recordedAt)) : "";
  if (!window.confirm(`${label} 데이터(ID ${id}, ${time})를 삭제하시겠습니까?`)) return;

  try {
    const response = await fetch(`/api/usage/${id}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
    const result = await response.json();
    if (response.status === 401) {
      await handleAdminSessionExpired();
      return;
    }
    if (!response.ok) throw new Error(result.message || "삭제에 실패했습니다.");

    showToast(`${label} 데이터를 삭제했습니다.`);
    await loadUsage();
  } catch (error) {
    showToast(error.message, true);
  }
}

function updateScaleButtons() {
  elements.scaleSelector.querySelectorAll("[data-scale]").forEach((button) => {
    const active = button.dataset.scale === state.scale;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateLegendButtons() {
  elements.seriesLegend.querySelectorAll("[data-series-toggle]").forEach((button) => {
    const active = state.visibleTypes.has(button.dataset.seriesToggle);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setControlsDisabled(disabled) {
  elements.previousButton.disabled = disabled;
  elements.nextButton.disabled = disabled || state.page === 0;
  elements.refreshButton.disabled = disabled;
}

function setConnectionStatus(ok, text) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.className = `status-pill ${ok ? "status-ok" : "status-error"}`;
}

function syncUrl() {
  const query = new URLSearchParams(location.search);
  query.set("scale", state.scale);
  query.set("page", String(state.page));
  query.set("metric", state.metric);
  query.set("series", USAGE_TYPES.filter((type) => state.visibleTypes.has(type)).join(","));
  history.replaceState(null, "", `${location.pathname}?${query}${location.hash}`);
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3600);
}

function utilizationPercent(row) {
  if (!row || row.usedPercent === null || row.usedPercent === undefined) return null;
  return row.usedPercent;
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: SCALES[state.scale].seconds <= 60 * 60 ? "2-digit" : undefined
  }).format(new Date(timestamp * 1000));
}

function formatFullDateTime(timestamp) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp * 1000));
}

function formatChartTime(timestamp, rangeSeconds) {
  const options =
    rangeSeconds <= 24 * 60 * 60
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "2-digit", day: "2-digit", hour: "2-digit" };

  return new Intl.DateTimeFormat("ko-KR", options).format(new Date(timestamp * 1000));
}

function formatNumber(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(Number(value));
}

function formatCompact(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("ko-KR", {
    notation: Math.abs(Number(value)) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(Number(value));
}

function formatSigned(value, suffix = "", maximumFractionDigits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${formatNumber(numeric, maximumFractionDigits)}${suffix}`;
}

function formatNullable(value) {
  return value === null || value === undefined ? "-" : formatNumber(value);
}

function formatNullableCompact(value) {
  return value === null || value === undefined ? "-" : formatCompact(value);
}

function numberFromForm(value) {
  return Number(value);
}

function optionalNumberFromForm(value) {
  return value === "" || value === null ? null : Number(value);
}

function optionalIntegerFromForm(value) {
  return value === "" || value === null ? null : Number.parseInt(String(value), 10);
}

function toLocalDateTimeInput(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
