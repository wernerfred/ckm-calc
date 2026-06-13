const CATALOGS_STORAGE_KEY = "ckm-catalogs-v1";
const CATALOGS_API_PATH = "/api/catalogs";

const CKM_DEFAULT_CATALOGS = {
  punsch: [
    { id: "punsch", name: "Punsch", price: 4, autoDeposit: true },
    { id: "kinderpunsch", name: "Kinderpunsch", price: 3, autoDeposit: true },
    { id: "schuss", name: "Schuss", price: 1.5, autoDeposit: false },
    { id: "bier", name: "Bier", price: 3, autoDeposit: false },
    { id: "deposit", name: "Pfand", price: 2, autoDeposit: false }
  ],
  cocktail: [
    { id: "kaffe_heisse_schokolade", name: "Kaffe / Heiße Schokolade", price: 2.5, autoDeposit: true },
    { id: "lumumba_apfelpunsch", name: "Lumumba / Apfelpunsch", price: 4, autoDeposit: true },
    { id: "apfelpunsch_alkfr", name: "Apfelpunsch alkfr.", price: 3, autoDeposit: true },
    { id: "glueh_gin_schneezauber", name: "Glüh Gin / Schneezauber", price: 5, autoDeposit: true },
    { id: "schnaps", name: "Schnaps", price: 2, autoDeposit: true },
    { id: "nussschnaps", name: "Nussschnaps", price: 3, autoDeposit: true },
    { id: "deposit", name: "Pfand", price: 2, autoDeposit: false }
  ],
  wurstel: [
    { id: "w2", name: "2 Würstel", price: 3.5, autoDeposit: false },
    { id: "w4", name: "4 Würstel", price: 6, autoDeposit: false },
    { id: "kaltgetraenk", name: "Kaltgetränk", price: 2.5, autoDeposit: false },
    { id: "bier", name: "Bier", price: 3, autoDeposit: false }
  ]
};

function cloneCatalogs(input) {
  return JSON.parse(JSON.stringify(input));
}

function normalizePrice(value, fallback) {
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function sanitizeCatalogItems(items, fallbackItems) {
  const sourceItems = Array.isArray(items) ? items : fallbackItems;
  const safe = sourceItems
    .map((item, index) => {
      const fallback = fallbackItems[index] || fallbackItems[0] || { id: `item-${index}`, name: `Item ${index + 1}`, price: 0 };
      const id = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : fallback.id;
      const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : fallback.name;
      const price = normalizePrice(item?.price, fallback.price || 0);
      return {
        id,
        name,
        price,
        autoDeposit: Boolean(item?.autoDeposit)
      };
    })
    .filter((item) => item.id);

  const fallbackDeposit = fallbackItems.find((item) => item.id === "deposit");
  const nonDeposit = safe.filter((item) => item.id !== "deposit");
  if (!fallbackDeposit) {
    return nonDeposit.length ? nonDeposit : cloneCatalogs(fallbackItems);
  }

  const safeDeposit = safe.find((item) => item.id === "deposit");
  const deposit = {
    id: "deposit",
    name: safeDeposit?.name || fallbackDeposit.name,
    price: normalizePrice(safeDeposit?.price, fallbackDeposit.price),
    autoDeposit: false
  };
  return [...nonDeposit, deposit];
}

function loadCatalogsFromLocalStorage() {
  try {
    const raw = localStorage.getItem(CATALOGS_STORAGE_KEY);
    if (!raw) {
      return cloneCatalogs(CKM_DEFAULT_CATALOGS);
    }

    const parsed = JSON.parse(raw);
    return {
      punsch: sanitizeCatalogItems(parsed?.punsch, CKM_DEFAULT_CATALOGS.punsch),
      cocktail: sanitizeCatalogItems(parsed?.cocktail, CKM_DEFAULT_CATALOGS.cocktail),
      wurstel: sanitizeCatalogItems(parsed?.wurstel, CKM_DEFAULT_CATALOGS.wurstel)
    };
  } catch {
    return cloneCatalogs(CKM_DEFAULT_CATALOGS);
  }
}

function saveCatalogs(catalogs) {
  localStorage.setItem(CATALOGS_STORAGE_KEY, JSON.stringify(catalogs));
}

async function fetchCatalogsFromServer() {
  const response = await fetch(CATALOGS_API_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch catalogs");
  }
  const remote = await response.json();
  const sanitized = {
    punsch: sanitizeCatalogItems(remote?.punsch, CKM_DEFAULT_CATALOGS.punsch),
    cocktail: sanitizeCatalogItems(remote?.cocktail, CKM_DEFAULT_CATALOGS.cocktail),
    wurstel: sanitizeCatalogItems(remote?.wurstel, CKM_DEFAULT_CATALOGS.wurstel)
  };
  saveCatalogs(sanitized);
  return sanitized;
}

async function loadCatalogs() {
  try {
    return await fetchCatalogsFromServer();
  } catch {
    return loadCatalogsFromLocalStorage();
  }
}

function loadCatalogsLocal() {
  return loadCatalogsFromLocalStorage();
}

async function saveCatalogsRemote(catalogs) {
  const payload = {
    punsch: sanitizeCatalogItems(catalogs?.punsch, CKM_DEFAULT_CATALOGS.punsch),
    cocktail: sanitizeCatalogItems(catalogs?.cocktail, CKM_DEFAULT_CATALOGS.cocktail),
    wurstel: sanitizeCatalogItems(catalogs?.wurstel, CKM_DEFAULT_CATALOGS.wurstel)
  };
  const response = await fetch(CATALOGS_API_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Failed to save catalogs");
  }
  const saved = await response.json();
  const sanitized = {
    punsch: sanitizeCatalogItems(saved?.punsch, CKM_DEFAULT_CATALOGS.punsch),
    cocktail: sanitizeCatalogItems(saved?.cocktail, CKM_DEFAULT_CATALOGS.cocktail),
    wurstel: sanitizeCatalogItems(saved?.wurstel, CKM_DEFAULT_CATALOGS.wurstel)
  };
  saveCatalogs(sanitized);
  return sanitized;
}

window.CKM = {
  CATALOGS_STORAGE_KEY,
  defaultCatalogs: CKM_DEFAULT_CATALOGS,
  cloneCatalogs,
  loadCatalogsLocal,
  loadCatalogs,
  saveCatalogs,
  saveCatalogsRemote,
  normalizePrice
};
