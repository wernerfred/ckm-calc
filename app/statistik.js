const CALC_ORDER = ["punsch", "cocktail", "wurstel"];
const CALC_LABELS = {
  punsch: "Punsch",
  cocktail: "Cocktail",
  wurstel: "Würstel"
};
const GRAPH_BUCKET_MS = 15 * 60 * 1000;

const refs = {
  content: document.getElementById("statsContent"),
  lastUpdated: document.getElementById("lastUpdated")
};

boot();
registerServiceWorker();

async function boot() {
  refs.content.innerHTML = '<p class="empty">Lade Statistik…</p>';

  const catalogs = await loadCatalogsSafe();
  const stats = await loadStatsSafe();
  render(catalogs, stats);
}

async function loadCatalogsSafe() {
  if (!window.CKM) {
    return {};
  }
  try {
    return await window.CKM.loadCatalogs();
  } catch {
    return window.CKM.loadCatalogsLocal();
  }
}

async function loadStats() {
  const statsUrl = window.CKM?.apiPath ? window.CKM.apiPath("/api/stats") : "/api/stats";
  const response = await fetch(statsUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("failed to load stats");
  }
  return response.json();
}

async function loadStatsSafe() {
  try {
    return await loadStats();
  } catch {
    refs.lastUpdated.textContent = "Statistik API derzeit nicht erreichbar. Es werden nur Artikel ohne Verlauf angezeigt.";
    return { updatedAt: null, items: {} };
  }
}

function render(catalogs, stats) {
  refs.content.innerHTML = "";
  refs.lastUpdated.textContent = formatUpdated(stats?.updatedAt);

  const statsItems = stats?.items && typeof stats.items === "object" ? stats.items : {};

  CALC_ORDER.forEach((calcId) => {
    const catalogItems = Array.isArray(catalogs?.[calcId]) ? catalogs[calcId] : [];
    const catalogById = new Map(catalogItems.map((item) => [item.id, item]));
    const merged = [];

    catalogItems.forEach((item) => {
      const key = `${calcId}:${item.id}`;
      const stat = statsItems[key];
      const totalPlus = Number.isFinite(stat?.totalPlus) ? stat.totalPlus : (Number.isFinite(stat?.total) ? stat.total : 0);
      const totalMinus = Number.isFinite(stat?.totalMinus) ? stat.totalMinus : 0;
      merged.push({
        calcId,
        itemId: item.id,
        name: item.name,
        total: totalPlus,
        totalPlus,
        totalMinus,
        series: Array.isArray(stat?.series) ? stat.series : []
      });
    });

    Object.values(statsItems)
      .filter((item) => item?.calcId === calcId && !catalogById.has(item.itemId))
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .forEach((item) => {
        const totalPlus = Number.isFinite(item.totalPlus) ? item.totalPlus : (Number.isFinite(item.total) ? item.total : 0);
        const totalMinus = Number.isFinite(item.totalMinus) ? item.totalMinus : 0;
        merged.push({
          calcId,
          itemId: item.itemId,
          name: item.itemName || item.itemId,
          total: totalPlus,
          totalPlus,
          totalMinus,
          series: Array.isArray(item.series) ? item.series : []
        });
      });

    const section = document.createElement("section");
    section.className = "calc-section";
    section.innerHTML = `<h2 class="calc-title">${escapeHtml(CALC_LABELS[calcId] || calcId)}</h2>`;

    const grid = document.createElement("div");
    grid.className = "item-grid";

    merged.forEach((entry) => {
      grid.appendChild(renderItemCard(entry));
    });

    if (!merged.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Keine Artikel verfügbar.";
      section.appendChild(empty);
    } else {
      section.appendChild(grid);
    }

    refs.content.appendChild(section);
  });
}

function renderItemCard(entry) {
  const isDepositItem = entry.itemId === "deposit";
  const countMarkup = isDepositItem
    ? `<div class="item-count item-count-split"><span class="count-plus">+${formatCount(entry.totalPlus)}</span><span class="count-minus">-${formatCount(entry.totalMinus)}</span></div>`
    : `<div class="item-count">${formatCount(entry.total)}</div>`;
  const card = document.createElement("article");
  card.className = "item-card";
  card.innerHTML = `
    <div class="item-top">
      <h3 class="item-name">${escapeHtml(entry.name)}</h3>
      ${countMarkup}
    </div>
    <p class="item-sub">${isDepositItem ? "Pfand-Presses (+ / -)" : "Verkäufe"}</p>
    <div class="graph-wrap"><svg class="graph" viewBox="0 0 320 124" aria-label="Verlauf"></svg></div>
  `;

  const svg = card.querySelector(".graph");
  renderGraph(svg, entry.series, isDepositItem);
  return card;
}

function renderGraph(svg, series, splitByDirection) {
  const width = 320;
  const height = 124;
  const top = 6;
  const bottom = 22;
  const left = 30;
  const right = 8;
  const plotBottom = height - bottom;
  const chartWidth = width - left - right;
  const chartHeight = plotBottom - top;
  const bins = buildTimeBins(series);
  const plusValues = bins.map((point) => point.countPlus);
  const minusValues = bins.map((point) => point.countMinus);
  const values = splitByDirection ? plusValues.map((value, idx) => value + minusValues[idx]) : plusValues;
  const max = Math.max(1, ...values, ...plusValues, ...minusValues);
  const middleY = top + chartHeight / 2;
  const yAxis = splitByDirection
    ? `
    <line x1="${left}" y1="${top}" x2="${left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.22)" />
    <text x="${left - 4}" y="${top + 3}" text-anchor="end" fill="rgba(180,207,214,0.9)" font-size="9">${formatAxisValue(max)}</text>
    <text x="${left - 4}" y="${middleY + 3}" text-anchor="end" fill="rgba(180,207,214,0.9)" font-size="9">0</text>
    <text x="${left - 4}" y="${plotBottom - 1}" text-anchor="end" fill="rgba(180,207,214,0.9)" font-size="9">-${formatAxisValue(max)}</text>
  `
    : `
    <line x1="${left}" y1="${top}" x2="${left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.22)" />
    <text x="${left - 4}" y="${top + 3}" text-anchor="end" fill="rgba(180,207,214,0.9)" font-size="9">${formatAxisValue(max)}</text>
    <text x="${left - 4}" y="${plotBottom - 1}" text-anchor="end" fill="rgba(180,207,214,0.9)" font-size="9">0</text>
  `;
  const grid = splitByDirection
    ? `
    <line x1="${left}" y1="${top}" x2="${width - right}" y2="${top}" stroke="rgba(255,255,255,0.12)" />
    <line x1="${left}" y1="${middleY}" x2="${width - right}" y2="${middleY}" stroke="rgba(255,255,255,0.25)" />
    <line x1="${left}" y1="${plotBottom}" x2="${width - right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.14)" />
  `
    : `
    <line x1="${left}" y1="${top}" x2="${width - right}" y2="${top}" stroke="rgba(255,255,255,0.12)" />
    <line x1="${left}" y1="${top + chartHeight / 2}" x2="${width - right}" y2="${top + chartHeight / 2}" stroke="rgba(255,255,255,0.12)" />
    <line x1="${left}" y1="${plotBottom}" x2="${width - right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.2)" />
  `;

  if (!values.length || values.every((value) => value <= 0)) {
    svg.innerHTML = `${yAxis}${grid}<text x="${(left + (width - right)) / 2}" y="${height / 2 + 4}" text-anchor="middle" fill="rgba(180,207,214,0.9)" font-size="11">keine Daten</text>`;
    return;
  }

  const xStep = chartWidth / values.length;
  const bars = values.map((value, index) => {
      const x = left + index * xStep + 1;
      const w = Math.max(1, xStep - 2);
      if (!splitByDirection) {
        const h = (value / max) * chartHeight;
        const y = plotBottom - h;
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1" fill="rgba(125,244,208,0.75)" />`;
      }

      const plus = plusValues[index] || 0;
      const minus = minusValues[index] || 0;
      const halfHeight = chartHeight / 2;
      const plusH = (plus / max) * halfHeight;
      const minusH = (minus / max) * halfHeight;
      const plusY = middleY - plusH;
      const minusY = middleY;
      const plusBar = plus > 0
        ? `<rect x="${x.toFixed(2)}" y="${plusY.toFixed(2)}" width="${w.toFixed(2)}" height="${plusH.toFixed(2)}" rx="1" fill="rgba(125,244,208,0.85)" />`
        : "";
      const minusBar = minus > 0
        ? `<rect x="${x.toFixed(2)}" y="${minusY.toFixed(2)}" width="${w.toFixed(2)}" height="${minusH.toFixed(2)}" rx="1" fill="rgba(255,125,125,0.85)" />`
        : "";
      return `${plusBar}${minusBar}`;
    })
    .join("");

  const tickIndexes = computeTickIndexes(values.length);
  const ticks = tickIndexes
    .map((index) => {
      const x = left + index * xStep + xStep / 2;
      const bucket = bins[index]?.bucket || 0;
      const label = formatBucketLabel(bucket, bins[0]?.bucket, bins[bins.length - 1]?.bucket);
      return `
        <line x1="${x.toFixed(2)}" y1="${plotBottom}" x2="${x.toFixed(2)}" y2="${(plotBottom + 4).toFixed(2)}" stroke="rgba(255,255,255,0.35)" />
        <text x="${x.toFixed(2)}" y="${(height - 6).toFixed(2)}" text-anchor="middle" fill="rgba(180,207,214,0.9)" font-size="9">${label}</text>
      `;
    })
    .join("");

  svg.innerHTML = `${yAxis}${grid}${bars}${ticks}`;
}

function buildTimeBins(series) {
  const rawPoints = Array.isArray(series) ? series : [];
  if (!rawPoints.length) {
    return [];
  }

  const normalized = rawPoints
    .map((point) => ({
      bucket: Math.floor((Number.isFinite(point?.bucket) ? point.bucket : 0) / GRAPH_BUCKET_MS) * GRAPH_BUCKET_MS,
      countPlus: Number.isFinite(point?.countPlus) ? point.countPlus : (Number.isFinite(point?.count) ? point.count : 0),
      countMinus: Number.isFinite(point?.countMinus) ? point.countMinus : 0
    }))
    .filter((point) => point.bucket > 0)
    .sort((a, b) => a.bucket - b.bucket);

  if (!normalized.length) {
    return [];
  }

  const byBucket = new Map();
  normalized.forEach((point) => {
    const existing = byBucket.get(point.bucket) || { bucket: point.bucket, countPlus: 0, countMinus: 0 };
    existing.countPlus += point.countPlus;
    existing.countMinus += point.countMinus;
    byBucket.set(point.bucket, existing);
  });

  const firstBucket = normalized[0].bucket;
  const lastBucket = normalized[normalized.length - 1].bucket;
  const bins = [];
  for (let bucket = firstBucket; bucket <= lastBucket; bucket += GRAPH_BUCKET_MS) {
    const existing = byBucket.get(bucket);
    bins.push(existing || { bucket, countPlus: 0, countMinus: 0 });
  }
  return bins;
}

function computeTickIndexes(count) {
  if (count <= 1) {
    return [0];
  }
  if (count <= 4) {
    return Array.from({ length: count }, (_, i) => i);
  }
  const indexes = [0, Math.floor((count - 1) / 2), count - 1];
  return Array.from(new Set(indexes)).sort((a, b) => a - b);
}

function formatBucketLabel(bucket, firstBucket, lastBucket) {
  if (!Number.isFinite(bucket) || bucket <= 0) {
    return "";
  }
  const includeDate = Number.isFinite(firstBucket) && Number.isFinite(lastBucket) && (lastBucket - firstBucket >= 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("de-DE", includeDate
    ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" }
  ).format(new Date(bucket));
}

function formatAxisValue(value) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return String(safe);
}

function formatCount(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("de-DE").format(safe);
}

function formatUpdated(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Zuletzt aktualisiert: n/a";
  }
  return `Zuletzt aktualisiert: ${new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp))}`;
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
