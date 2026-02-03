// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const nowISO = () => new Date().toISOString().slice(0, 19).replace("T", " ");

function loadRecords() {
  try { return JSON.parse(localStorage.getItem("furo_locator_records") || "[]"); }
  catch { return []; }
}
function saveRecords(records) {
  localStorage.setItem("furo_locator_records", JSON.stringify(records));
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsv(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------- Map ----------
let map = L.map("map").setView([-25.965, 32.589], 13); // Maputo default-ish
let tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
});
tileLayer.addTo(map);

let marker = null;
let lastFix = null;

function setStatus(msg, ok=false) {
  $("status").textContent = msg;
  $("status").className = ok ? "ok" : "muted";
}

function setAccuracyWarn(acc) {
  const w = $("accuracyWarn");
  if (acc && acc > 30) {
    w.style.display = "block";
    w.textContent = `Precisão fraca (~${Math.round(acc)}m). Tenta em local aberto e captura novamente.`;
  } else {
    w.style.display = "none";
    w.textContent = "";
  }
}

function setMarker(lat, lng) {
  if (!marker) {
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      lastFix = lastFix || {};
      lastFix.latitude = p.lat;
      lastFix.longitude = p.lng;
      lastFix.method = "map_adjust";
      setStatus(`Pin ajustado: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`, true);
      $("btnSave").disabled = false;
      $("btnClearPin").disabled = false;
    });
  } else {
    marker.setLatLng([lat, lng]);
  }
  map.setView([lat, lng], 17);
  $("btnSave").disabled = false;
  $("btnClearPin").disabled = false;
}

function clearMarker() {
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
  lastFix = null;
  $("btnSave").disabled = true;
  $("btnClearPin").disabled = true;
  setAccuracyWarn(null);
  setStatus("Pin limpo.");
}

// ---------- UI actions ----------
$("btnCapture").addEventListener("click", () => {
  const code = $("clientCode").value.trim();
  if (!code) {
    setStatus("Informe o código do cliente antes de capturar.", false);
    return;
  }
  if (!navigator.geolocation) {
    setStatus("Geolocalização não suportada neste dispositivo.", false);
    return;
  }

  setStatus("A obter GPS…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;

      lastFix = {
        client_code: code,
        latitude,
        longitude,
        accuracy_m: accuracy ?? null,
        captured_at: nowISO(),
        captured_by: $("capturedBy").value.trim() || null,
        method: "gps",
        notes: $("notes").value.trim() || null,
        source: "pwa_export",
      };

      setMarker(latitude, longitude);
      setAccuracyWarn(accuracy ?? null);
      setStatus(`GPS OK: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`, true);
    },
    (err) => {
      setStatus(`Erro ao obter GPS: ${err.message}`, false);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

$("btnSave").addEventListener("click", () => {
  if (!lastFix) return;

  const code = $("clientCode").value.trim();
  if (!code) {
    setStatus("Código do cliente vazio.", false);
    return;
  }

  // sincroniza o código (caso o user tenha editado após captura)
  lastFix.client_code = code;

  // se o marker foi ajustado, usar coords do marker
  if (marker) {
    const p = marker.getLatLng();
    lastFix.latitude = p.lat;
    lastFix.longitude = p.lng;
  }

  const records = loadRecords();
  records.unshift(lastFix);
  saveRecords(records);
  renderList();

  setStatus("Guardado offline.", true);
});

$("btnClearPin").addEventListener("click", clearMarker);

$("btnExportJson").addEventListener("click", () => {
  const records = loadRecords();
  const payload = {
    app: "furo-locator-pwa",
    version: "1.0",
    exported_at: nowISO(),
    records,
  };
  downloadText(`localizacoes_${nowISO().replace(/[: ]/g,"-")}.json`, JSON.stringify(payload, null, 2));
  setStatus("JSON exportado.", true);
});

$("btnExportCsv").addEventListener("click", () => {
  const records = loadRecords();
  const header = ["client_code","latitude","longitude","accuracy_m","captured_at","notes"].join(",");
  const lines = records.map(r => ([
    escapeCsv(r.client_code),
    escapeCsv(r.latitude),
    escapeCsv(r.longitude),
    escapeCsv(r.accuracy_m ?? ""),
    escapeCsv(r.captured_at ?? ""),
    escapeCsv(r.notes ?? "")
  ].join(",")));
  const csv = [header, ...lines].join("\n");
  downloadText(`localizacoes_${nowISO().replace(/[: ]/g,"-")}.csv`, csv);
  setStatus("CSV exportado.", true);
});

$("btnClearAll").addEventListener("click", () => {
  if (!confirm("Apagar todas as capturas deste telemóvel?")) return;
  saveRecords([]);
  renderList();
  setStatus("Capturas apagadas.", true);
});

// ---------- List ----------
function renderList() {
  const list = $("list");
  const records = loadRecords();
  list.innerHTML = "";

  if (!records.length) {
    list.innerHTML = `<div class="muted">Sem capturas ainda.</div>`;
    return;
  }

  for (const r of records.slice(0, 50)) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <b>${r.client_code}</b>
      <div>${(r.captured_at || "")} • ${r.method || "gps"} • ±${r.accuracy_m ? Math.round(r.accuracy_m) : "-"}m</div>
      <div>${Number(r.latitude).toFixed(6)}, ${Number(r.longitude).toFixed(6)}</div>
      <div class="muted">${r.notes ? r.notes : ""}</div>
    `;
    list.appendChild(div);
  }
}
renderList();

// ---------- Service Worker ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
