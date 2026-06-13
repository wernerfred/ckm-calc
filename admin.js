const CALCS = {
  punsch: "Punsch",
  cocktail: "Cocktail",
  wurstel: "Würstel"
};

const params = new URLSearchParams(window.location.search);
const calcId = params.get("calc");
if (!CALCS[calcId]) {
  window.location.replace("./admin.html");
}

const refs = {
  title: document.getElementById("adminTitle"),
  itemList: document.getElementById("itemList"),
  addForm: document.getElementById("addForm"),
  newName: document.getElementById("newName"),
  newPrice: document.getElementById("newPrice"),
  newAutoDeposit: document.getElementById("newAutoDeposit"),
  logoutBtn: document.getElementById("logoutBtn")
};

let catalogs = window.CKM.loadCatalogsLocal();

refs.title.textContent = `Administration - ${CALCS[calcId]}`;
boot();

async function boot() {
  catalogs = await loadCatalogsWithFallback();
  render();
}

refs.addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = refs.newName.value.trim();
  if (!name) {
    return;
  }

  const price = window.CKM.normalizePrice(refs.newPrice.value, 0);
  const item = {
    id: makeId(name),
    name,
    price,
    autoDeposit: refs.newAutoDeposit.checked
  };

  catalogs[calcId].push(item);
  saveAndRender();

  refs.newName.value = "";
  refs.newPrice.value = "";
  refs.newAutoDeposit.checked = false;
});

if (refs.logoutBtn) {
  refs.logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {}
    window.location.href = "./admin-login.html";
  });
}

function render() {
  refs.itemList.innerHTML = "";

  catalogs[calcId].forEach((item) => {
    const card = document.createElement("article");
    card.className = "item";
    card.innerHTML = `
      <div class="row">
        <label>
          <span>Name</span>
          <input type="text" value="${escapeHtml(item.name)}" data-field="name" />
        </label>
        <label>
          <span>Preis (€)</span>
          <input type="number" min="0" step="0.1" inputmode="decimal" value="${item.price.toFixed(2)}" data-field="price" />
        </label>
      </div>
      <label class="toggle">
        <input type="checkbox" data-field="autoDeposit" ${item.autoDeposit ? "checked" : ""} />
        <span>Auto Pfand (2€) bei +</span>
      </label>
      <button type="button" class="remove">Artikel entfernen</button>
    `;

    const nameInput = card.querySelector('input[data-field="name"]');
    const priceInput = card.querySelector('input[data-field="price"]');
    const autoInput = card.querySelector('input[data-field="autoDeposit"]');
    const removeBtn = card.querySelector(".remove");

    nameInput.addEventListener("change", () => {
      const next = nameInput.value.trim();
      if (!next) {
        nameInput.value = item.name;
        return;
      }
      item.name = next;
      saveAndRender();
    });

    priceInput.addEventListener("change", () => {
      item.price = window.CKM.normalizePrice(priceInput.value, item.price);
      saveAndRender();
    });

    autoInput.addEventListener("change", () => {
      item.autoDeposit = autoInput.checked;
      saveAndRender();
    });

    removeBtn.addEventListener("click", () => {
      catalogs[calcId] = catalogs[calcId].filter((entry) => entry.id !== item.id);
      saveAndRender();
    });

    refs.itemList.append(card);
  });
}

function saveAndRender() {
  saveAndRenderAsync().catch(() => {});
}

async function saveAndRenderAsync() {
  try {
    catalogs = await window.CKM.saveCatalogsRemote(catalogs);
  } catch {
    window.CKM.saveCatalogs(catalogs);
    catalogs = window.CKM.loadCatalogsLocal();
  }
  render();
}

async function loadCatalogsWithFallback() {
  try {
    return await window.CKM.loadCatalogs();
  } catch {
    return window.CKM.loadCatalogsLocal();
  }
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeId(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const suffix = String(Date.now()).slice(-6);
  return `${base || "item"}-${suffix}`;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
