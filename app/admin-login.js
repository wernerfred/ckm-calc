const form = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const messageEl = document.getElementById("message");
const apiPath = createApiPathResolver();

checkStatus();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  messageEl.textContent = "";

  try {
    const response = await fetch(apiPath("/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      const payload = await safeJson(response);
      messageEl.textContent = payload?.error === "admin password not configured"
        ? "Admin Passwort ist im Container nicht gesetzt."
        : "Passwort ist nicht korrekt.";
      return;
    }

    window.location.href = "./admin.html";
  } catch {
    messageEl.textContent = "Anmeldung fehlgeschlagen. Netzwerk prüfen.";
  }
});

async function checkStatus() {
  try {
    const response = await fetch(apiPath("/api/admin/status"), { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const status = await response.json();
    if (!status.configured) {
      messageEl.textContent = "Admin Passwort ist im Container nicht gesetzt.";
      return;
    }
    if (status.authenticated) {
      window.location.href = "./admin.html";
    }
  } catch {
    // ignore
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createApiPathResolver() {
  if (window.location.protocol !== "file:") {
    return (path) => path;
  }
  const configuredOrigin = localStorage.getItem("ckm_api_origin");
  const fallbackOrigin = "http://localhost:8080";
  const origin = (configuredOrigin || fallbackOrigin).replace(/\/+$/, "");
  return (path) => `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
