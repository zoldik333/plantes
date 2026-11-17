const $ = (id) => document.getElementById(id);
const KEY_STORAGE = "plantes-poc-key";

function getKey() {
  try { return localStorage.getItem(KEY_STORAGE) ?? ""; } catch { return ""; }
}
function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("err", isError);
}
async function api(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), "x-access-key": getKey() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ? `${body.error}${body.details ? `\n${JSON.stringify(body.details)}` : ""}` : `HTTP ${res.status}`);
  return body;
}

// --- Installation ---------------------------------------------------------
const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (!standalone) $("install-hint").classList.remove("hidden");

let swReg;
if ("serviceWorker" in navigator) {
  swReg = await navigator.serviceWorker.register("/sw.js");
}

// --- Clé d'accès ----------------------------------------------------------
$("key").value = getKey();
$("save-key").onclick = async () => {
  try { localStorage.setItem(KEY_STORAGE, $("key").value.trim()); } catch {}
  try {
    await api("/api/push/public-key");
    setStatus($("key-status"), "✓ Clé valide");
  } catch (e) {
    setStatus($("key-status"), `✗ ${e.message}`, true);
  }
};

// --- Push -----------------------------------------------------------------
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

$("enable-push").onclick = async () => {
  const st = $("push-status");
  try {
    if (!swReg || !("PushManager" in window)) {
      throw new Error("Push non disponible ici. Sur iPhone : ouvre l'app depuis l'écran d'accueil (iOS 16.4+).");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error(`Permission refusée (${permission}). Réglages → Notifications → Plantes.`);
    const { publicKey } = await api("/api/push/public-key");
    const sub =
      (await swReg.pushManager.getSubscription()) ??
      (await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
    const { total } = await api("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub),
    });
    setStatus(st, `✓ Notifications activées (${total} appareil·s abonné·s)`);
  } catch (e) {
    setStatus(st, `✗ ${e.message}`, true);
  }
};

$("test-push").onclick = async () => {
  const st = $("push-status");
  try {
    await api("/api/push/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delaySeconds: 10 }) });
    setStatus(st, "⏳ Notif envoyée dans 10 s — verrouille ton iPhone pour la voir arriver.");
  } catch (e) {
    setStatus(st, `✗ ${e.message}`, true);
  }
};

// --- Fiche d'entretien ----------------------------------------------------
/** Réduit la photo à 1600 px max côté le plus long, en JPEG (évite les photos de 5 Mo et le HEIC). */
async function resizePhoto(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Impossible de lire la photo"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

$("photo").onchange = () => {
  const f = $("photo").files[0];
  if (!f) return;
  const p = $("preview");
  p.src = URL.createObjectURL(f);
  p.style.display = "block";
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const LIGHT_LABELS = {
  ombre: "Peu de lumière",
  "mi-ombre": "Lumière douce",
  "lumiere-indirecte-vive": "Très lumineux, sans soleil direct",
  "soleil-direct": "Plein soleil",
};

function renderSheet(s, durationMs) {
  const x = s.extras;
  $("sheet").innerHTML = `
    <h2>${esc(s.commonName)} <span style="font-weight:400;color:#6b6b6b"><i>${esc(s.scientificName)}</i></span></h2>
    ${s.nameMatchesPhoto ? "" : `<p class="status err">⚠️ La photo ne semble pas correspondre : ${esc(s.identificationNote)}</p>`}
    <span class="pill">Difficulté : ${esc(s.difficulty)}</span>
    ${s.observedCondition ? `<p>${esc(s.observedCondition)}</p>` : ""}
    <dl>
      <dt>💧 Arrosage</dt><dd>Tous les <b>${s.watering.intervalDaysSummer} jours</b> l'été, <b>${s.watering.intervalDaysWinter} jours</b> l'hiver.<br>${esc(s.watering.method)}<br><small>${esc(s.watering.signs)}</small></dd>
      <dt>☀️ Lumière : ${esc(LIGHT_LABELS[s.light.need] ?? s.light.need)}</dt><dd>${esc(s.light.details)}</dd>
      <dt>💨 Humidité</dt><dd>${esc(x.humidity)}</dd>
      <dt>🌡️ Température</dt><dd>${esc(x.temperature)}</dd>
      <dt>🧪 Engrais</dt><dd>${esc(x.fertilizer)}</dd>
      <dt>🔁 Rempotage</dt><dd>${esc(x.repotting)}</dd>
      <dt>🪴 Terre</dt><dd>${esc(x.substrate)}</dd>
      <dt>💡 À retenir</dt><dd><ul>${s.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></dd>
    </dl>
    <p class="sub">Générée en ${(durationMs / 1000).toFixed(1)} s</p>`;
  $("sheet").classList.remove("hidden");
}

$("generate").onclick = async () => {
  const st = $("sheet-status");
  const btn = $("generate");
  const name = $("name").value.trim();
  const file = $("photo").files[0];
  if (!name) return setStatus(st, "✗ Il faut au moins un nom.", true);
  btn.disabled = true;
  $("sheet").classList.add("hidden");
  const t0 = Date.now();
  const timer = setInterval(() => setStatus(st, `⏳ Claude prépare la fiche… ${Math.round((Date.now() - t0) / 1000)} s`), 1000);
  try {
    const form = new FormData();
    form.append("name", name);
    if (file) form.append("photo", await resizePhoto(file), "photo.jpg");
    const { sheet, durationMs } = await api("/api/care-sheet", { method: "POST", body: form });
    setStatus(st, "✓ Fiche générée");
    renderSheet(sheet, durationMs);
  } catch (e) {
    setStatus(st, `✗ ${e.message}`, true);
  } finally {
    clearInterval(timer);
    btn.disabled = false;
  }
};
