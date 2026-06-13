const CALC_ID = document.body.dataset.calcId || "default";
const STORAGE_KEY = `ckm-kasse-state-v1-${CALC_ID}`;
const FALLBACK_ITEMS = [
  { id: "punsch", name: "Punsch", price: 4, autoDeposit: true },
  { id: "kinderpunsch", name: "Kinderpunsch", price: 3, autoDeposit: true },
  { id: "schuss", name: "Schuss", price: 1.5, autoDeposit: false },
  { id: "bier", name: "Bier", price: 3, autoDeposit: false },
  { id: "deposit", name: "Pfand", price: 2, autoDeposit: false }
];
const CALC_FALLBACK_ITEMS = getCalcFallbackItems();
let ITEMS = CALC_FALLBACK_ITEMS;
let DEPOSIT_ITEM = null;
let HAS_DEPOSIT = false;
let DEPOSIT_PRICE = 0;
let AUTO_DEPOSIT_ITEM_IDS = new Set();
let NON_DEPOSIT_ITEMS = [];
let initialState = null;
let state = null;

const totalEl = document.getElementById("total");
const hintsEl = document.getElementById("changeHints");
const rowsEl = document.getElementById("rows");
const resetEl = document.getElementById("reset");
const ITEM_TITLE_MAX_PX = 31;
const ITEM_TITLE_MIN_PX = 10;
let fitTitlesRafId = 0;

registerServiceWorker();
boot();

async function boot() {
  const catalogs = await loadCatalogsWithFallback();
  const selectedItems = catalogs[CALC_ID] || CALC_FALLBACK_ITEMS;
  configureCatalog(selectedItems);
  state = loadState();

  renderRows();
  render();
  scheduleFitItemTitleSize();

  resetEl.addEventListener("click", () => {
    state = cloneInitialState();
    persist();
    render();
  });

  window.addEventListener("resize", scheduleFitItemTitleSize);
}

function configureCatalog(items) {
  const sourceItems = Array.isArray(items) && items.length ? items : CALC_FALLBACK_ITEMS;
  const nonDeposit = sourceItems.filter((item) => item.id !== "deposit");
  const deposit = sourceItems.find((item) => item.id === "deposit") || CALC_FALLBACK_ITEMS.find((item) => item.id === "deposit");
  ITEMS = deposit ? [...nonDeposit, deposit] : nonDeposit;
  DEPOSIT_ITEM = ITEMS.find((item) => item.id === "deposit") || null;
  HAS_DEPOSIT = Boolean(DEPOSIT_ITEM);
  DEPOSIT_PRICE = DEPOSIT_ITEM ? DEPOSIT_ITEM.price : 0;
  AUTO_DEPOSIT_ITEM_IDS = new Set(ITEMS.filter((item) => item.autoDeposit).map((item) => item.id));
  NON_DEPOSIT_ITEMS = ITEMS.filter((item) => item.id !== "deposit");
  initialState = {
    counts: Object.fromEntries(NON_DEPOSIT_ITEMS.map((item) => [item.id, 0])),
    deposit: {
      autoFromDrinks: 0,
      manualAdded: 0,
      manualRemoved: 0
    }
  };
}

function getCalcFallbackItems() {
  const fromCatalogs = window.CKM?.defaultCatalogs?.[CALC_ID];
  if (Array.isArray(fromCatalogs) && fromCatalogs.length) {
    return JSON.parse(JSON.stringify(fromCatalogs));
  }
  return FALLBACK_ITEMS;
}

async function loadCatalogsWithFallback() {
  if (!window.CKM) {
    return {};
  }
  try {
    return await window.CKM.loadCatalogs();
  } catch {
    return window.CKM.loadCatalogsLocal();
  }
}

function renderRows() {
  rowsEl.innerHTML = "";
  rowsEl.style.gridTemplateRows = `repeat(${ITEMS.length}, minmax(0, 1fr))`;

  ITEMS.forEach((item) => {
    const row = document.createElement("article");
    row.className = "row";

    const itemMeta =
      item.id === "deposit"
        ? `${formatMoney(item.price)} €`
        : `${formatMoney(item.price)} €${item.autoDeposit ? ` + ${formatMoney(DEPOSIT_PRICE)} €` : ""}`;

    const isDepositItem = item.id === "deposit";
    const minusIndicator =
      isDepositItem
        ? `<span class="btn-symbol minus-symbol">-</span>
           <span class="btn-count btn-count-minus" data-count-minus="${item.id}">${minusCountLabel(item.id)}</span>`
        : "-";

    row.innerHTML = `
      <div class="item">
        <h2>${escapeHtml(item.name)}</h2>
        <p class="meta" data-meta="${item.id}">${escapeHtml(itemMeta)}</p>
      </div>
      <div class="actions">
        <button type="button" class="action plus with-indicator" data-action="plus" data-id="${item.id}">
          <span class="btn-symbol">+</span>
          <span class="btn-count" data-count="${item.id}">${plusCountLabel(item.id)}</span>
        </button>
        <button type="button" class="action minus ${isDepositItem ? "with-indicator" : ""}" data-action="minus" data-id="${item.id}">${minusIndicator}</button>
      </div>
    `;

    rowsEl.appendChild(row);
  });

  scheduleFitItemTitleSize();

  rowsEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const id = button.dataset.id;
    const action = button.dataset.action;
    applyAction(id, action);
    persist();
    render();
  });
}

function scheduleFitItemTitleSize() {
  if (fitTitlesRafId) {
    cancelAnimationFrame(fitTitlesRafId);
  }
  fitTitlesRafId = requestAnimationFrame(() => {
    fitTitlesRafId = 0;
    fitItemTitleSize();
  });
}

function fitItemTitleSize() {
  const titleEls = Array.from(rowsEl.querySelectorAll(".item h2"));
  if (!titleEls.length) {
    return;
  }

  titleEls.forEach((el) => {
    el.style.fontSize = "";
  });

  const cssMaxForViewport = Number.parseFloat(getComputedStyle(titleEls[0]).fontSize) || ITEM_TITLE_MAX_PX;
  const maxPx = Math.min(ITEM_TITLE_MAX_PX, cssMaxForViewport);

  let low = ITEM_TITLE_MIN_PX;
  let high = maxPx;
  let best = ITEM_TITLE_MIN_PX;

  const fitsAt = (px) => {
    titleEls.forEach((el) => {
      el.style.fontSize = `${px}px`;
    });
    return titleEls.every((el) => el.scrollWidth <= el.clientWidth + 1);
  };

  if (!fitsAt(low)) {
    return;
  }

  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    if (fitsAt(mid)) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  titleEls.forEach((el) => {
    el.style.fontSize = `${best.toFixed(2)}px`;
  });
}

function applyAction(id, action) {
  if (id === "deposit" && HAS_DEPOSIT) {
    if (action === "plus") {
      state.deposit.manualAdded += 1;
    } else {
      state.deposit.manualRemoved += 1;
    }
    return;
  }

  const current = state.counts[id] || 0;
  if (action === "plus") {
    state.counts[id] = current + 1;
    if (HAS_DEPOSIT && AUTO_DEPOSIT_ITEM_IDS.has(id)) {
      state.deposit.autoFromDrinks += 1;
    }
    return;
  }

  if (current <= 0) {
    return;
  }

  state.counts[id] = current - 1;
  if (HAS_DEPOSIT && AUTO_DEPOSIT_ITEM_IDS.has(id) && state.deposit.autoFromDrinks > 0) {
    state.deposit.autoFromDrinks -= 1;
  }
}

function render() {
  const total = calculateTotal();
  totalEl.textContent = `${formatMoney(total)} €`;
  renderHints(total);

  ITEMS.forEach((item) => {
    const countEl = rowsEl.querySelector(`[data-count="${item.id}"]`);
    if (countEl) {
      countEl.textContent = plusCountLabel(item.id);
    }

    if (item.id === "deposit" && HAS_DEPOSIT) {
      const minusCountEl = rowsEl.querySelector('[data-count-minus="deposit"]');
      if (minusCountEl) {
        minusCountEl.textContent = minusCountLabel("deposit");
      }
    }
  });
}

function calculateTotal() {
  const itemsTotal = NON_DEPOSIT_ITEMS.reduce((sum, item) => {
    const count = state.counts[item.id] || 0;
    return sum + count * item.price;
  }, 0);

  if (!HAS_DEPOSIT) {
    return round2(itemsTotal);
  }

  const depositNetCount = state.deposit.autoFromDrinks + state.deposit.manualAdded - state.deposit.manualRemoved;
  return round2(itemsTotal + depositNetCount * DEPOSIT_PRICE);
}

function renderHints(total) {
  hintsEl.innerHTML = "";

  let base = Math.ceil(total / 10) * 10;
  if (base < 10) {
    base = 10;
  }

  for (let i = 0; i < 3; i += 1) {
    const target = base + i * 10;
    const give = round2(target - total);
    const line = document.createElement("div");
    line.innerHTML = `auf ${target.toFixed(0)}: <strong>${formatMoney(give)} €</strong>`;
    hintsEl.appendChild(line);
  }
}

function plusCountLabel(id) {
  if (id === "deposit" && HAS_DEPOSIT) {
    return String(state.deposit.autoFromDrinks + state.deposit.manualAdded);
  }
  return String(state.counts[id] || 0);
}

function minusCountLabel(id) {
  if (id === "deposit" && HAS_DEPOSIT) {
    return String(state.deposit.manualRemoved);
  }
  return "";
}

function formatMoney(value) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(round2(value));
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cloneInitialState() {
  return JSON.parse(JSON.stringify(initialState));
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneInitialState();
    }

    const parsed = JSON.parse(raw);
    const counts = Object.fromEntries(
      NON_DEPOSIT_ITEMS.map((item) => [item.id, nonNegativeInt(parsed?.counts?.[item.id])])
    );

    return {
      counts,
      deposit: {
        autoFromDrinks: HAS_DEPOSIT ? nonNegativeInt(parsed?.deposit?.autoFromDrinks) : 0,
        manualAdded: HAS_DEPOSIT ? nonNegativeInt(parsed?.deposit?.manualAdded) : 0,
        manualRemoved: HAS_DEPOSIT ? nonNegativeInt(parsed?.deposit?.manualRemoved) : 0
      }
    };
  } catch {
    return cloneInitialState();
  }
}

function nonNegativeInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
