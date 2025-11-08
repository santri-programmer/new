// ======= PRODUCTION MODE CHECK =======
const IS_PRODUCTION =
  !window.location.hostname.includes("localhost") &&
  !window.location.hostname.includes("127.0.0.1");

// Simple logger yang non-blocking di dev
const logger = {
  log: (...a) => !IS_PRODUCTION && console.log(...a),
  error: (...a) => console.error(...a),
  warn: (...a) => console.warn(...a),
  info: (...a) => !IS_PRODUCTION && console.info(...a),
  time: (l) => !IS_PRODUCTION && console.time(l),
  timeEnd: (l) => !IS_PRODUCTION && console.timeEnd(l),
};

// ======= DATA & CACHE STRUCTURES =======
const kategoriDonatur = {
  kategori1: [
    "Mas Ani",
    "Pak Kholis",
    "Pak Hasyim",
    "Amat",
    "Mbak Is",
    "Dani",
    "Pak Napi",
    "Pak Ipin",
    "Mas Agus BZ",
    "Pak Fat",
    "Pak Ropi",
    "Mas Umam",
    "Pak Kisman",
    "Pak Yanto",
    "Pak Pardi",
    "Pak Salam",
    "Pak Piyan",
    "Pak Slamet",
    "Pak Ibin",
    "Idek",
    "Pak Ngari",
    "Pak Tukhin",
    "Pak Rofiq",
    "Pak Syafak",
    "Pak Jubaidi",
    "Mbak Kholis",
    "Pak Kholiq",
    "Pak Rokhan",
    "Mas Agus",
    "Mas Izin",
    "Pak Abror",
    "Mas Gustaf",
  ],
  kategori2: ["Pak A", "Pak B", "Pak C"],
  kategori3: ["Pak A", "Pak B", "Pak C"],
};

const kategoriLabel = {
  kategori1: "RT Tengah",
  kategori2: "RT Kulon",
  kategori3: "RT Kidul",
};

// State in-memory super cepat
let dataDonasi = [];
let dataCache = {
  kategori1: new Map(),
  kategori2: new Map(),
  kategori3: new Map(),
  timestamp: new Map(),
};
let donaturTerinput = {
  kategori1: new Set(),
  kategori2: new Set(),
  kategori3: new Set(),
};

// DOM cache
const cachedElements = {};
let db = null;

// ======= INIT =======
document.addEventListener("DOMContentLoaded", async () => {
  logger.time("AppInitialization");

  try {
    db = jimpitanDB;
    await db.init();

    // ⚡ Preload semua kategori ke RAM agar switching instan
    await preloadAllKategori();

    // Tampilkan kategori default (RT Tengah)
    await Promise.all([
      initializeCachedElements(),
      loadDataHariIni("kategori1"),
      muatDropdown("kategori1"),
    ]);

    setupEventListeners();
  } catch (err) {
    logger.error("❌ DB init failed:", err);
    showNotification("Gagal menginisialisasi penyimpanan offline", false);
  }

  requestAnimationFrame(() => {
    document.querySelectorAll(".critical-hidden").forEach((el) => {
      el.classList.remove("critical-hidden");
      el.classList.add("critical-show");
    });
  });

  logger.timeEnd("AppInitialization");
});

// ======= DOM CACHING =======
function initializeCachedElements() {
  const map = {
    tanggalHariIni: "tanggalHariIni",
    notifikasi: "notifikasi",
    kategoriDonatur: "kategoriDonatur",
    donatur: "donatur",
    pemasukan: "pemasukan",
    btnTambah: "btnTambah",
    btnExport: "btnExport",
    btnHapus: "btnHapus",
    tabelDonasi: "tabelDonasi",
    totalDonasi: "totalDonasi",
    dataCount: "dataCount",
    btnRefresh: "btnRefresh",
  };
  Object.keys(map).forEach((k) => {
    cachedElements[k] = document.getElementById(map[k]);
  });

  if (cachedElements.tanggalHariIni) {
    const tanggalHariIni = new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    cachedElements.tanggalHariIni.textContent = tanggalHariIni;
  }
}

// ======= PRELOAD SEMUA DATA =======
async function preloadAllKategori() {
  try {
    const kategoriList = Object.keys(kategoriDonatur);
    const today = new Date().toLocaleDateString("id-ID");

    await Promise.all(
      kategoriList.map(async (kategori) => {
        const saved = await db.getDailyInputs(kategori, today).catch(() => []);
        dataCache[kategori] = new Map(saved.map((it) => [it.donatur, it]));
        donaturTerinput[kategori] = new Set(saved.map((it) => it.donatur));
        dataCache.timestamp.set(kategori, Date.now());
      })
    );

    logger.log("✅ Semua kategori telah di-preload ke memori");
  } catch (err) {
    logger.error("⚠️ Gagal preload semua kategori:", err);
  }
}

// ======= EVENT LISTENERS =======
function setupEventListeners() {
  document.addEventListener("click", (e) => {
    const target = e.target.closest && e.target.closest(".quick-amount");
    if (target) {
      const amount = target.getAttribute("data-amount") || "0";
      if (cachedElements.pemasukan) {
        cachedElements.pemasukan.value = amount;
        cachedElements.pemasukan.focus();
      }
    }
  });

  if (cachedElements.btnTambah)
    cachedElements.btnTambah.addEventListener("click", tambahData);
  if (cachedElements.btnExport)
    cachedElements.btnExport.addEventListener("click", exportData);
  if (cachedElements.btnHapus)
    cachedElements.btnHapus.addEventListener("click", hapusDataHariIni);

  if (cachedElements.kategoriDonatur) {
    cachedElements.kategoriDonatur.addEventListener(
      "change",
      debounce(async function () {
        const kategori = this.value;
        // Tidak ada loading lagi di sini!
        await loadDataHariIni(kategori);
        await muatDropdown(kategori);
      }, 100)
    );
  }

  if (cachedElements.pemasukan) {
    cachedElements.pemasukan.addEventListener(
      "input",
      debounce(function (e) {
        const v = e.target.value.replace(/\D/g, "");
        if (v.length > 8) e.target.value = v.slice(0, 8);
        else e.target.value = v;
      }, 120)
    );
  }

  if (cachedElements.btnRefresh) {
    cachedElements.btnRefresh.addEventListener("click", () => {
      window.location.reload();
    });
  }
}

// ======= LOAD & RENDER DATA =======
async function loadDataHariIni(kategori) {
  const today = new Date().toLocaleDateString("id-ID");

  // ⚡ Langsung tampil dari RAM tanpa tunggu DB
  const cachedMap = dataCache[kategori];
  if (cachedMap && cachedMap.size > 0) {
    dataDonasi = Array.from(cachedMap.values()).filter(
      (it) => it.tanggal === today
    );
    donaturTerinput[kategori] = new Set(dataDonasi.map((it) => it.donatur));
    renderTabelTerurut(kategori);
    updateTotalDisplay();
    updateDataCount();

    // Sinkron background (tidak mengganggu UI)
    db.getDailyInputs(kategori, today)
      .then((savedData) => {
        dataCache[kategori] = new Map(savedData.map((it) => [it.donatur, it]));
        dataCache.timestamp.set(kategori, Date.now());
      })
      .catch(() => {});
    return;
  }

  // fallback jika cache kosong
  try {
    const savedData = await db.getDailyInputs(kategori, today);
    dataCache[kategori] = new Map(savedData.map((it) => [it.donatur, it]));
    donaturTerinput[kategori] = new Set(savedData.map((it) => it.donatur));
    dataDonasi = savedData;
    renderTabelTerurut(kategori);
    updateTotalDisplay();
    updateDataCount();
  } catch (error) {
    logger.error("❌ loadDataHariIni error:", error);
    dataDonasi = [];
    donaturTerinput[kategori] = new Set();
    renderTabelTerurut(kategori);
    updateTotalDisplay();
    updateDataCount();
  }
}

// ======= CORE ACTIONS =======
async function tambahData() {
  const donatur = cachedElements.donatur?.value;
  const nominal = cachedElements.pemasukan?.value;
  const kategori = cachedElements.kategoriDonatur?.value || "kategori1";

  if (!donatur || nominal === "") {
    showNotification("Nama dan nominal tidak boleh kosong", false);
    return;
  }

  const tanggal = new Date().toLocaleDateString("id-ID");

  try {
    const existing = dataCache[kategori].get(donatur);
    if (existing) {
      await db.updateDailyInput(existing.id, { nominal, tanggal });
      existing.nominal = nominal;
      showNotification(`✏️ Data ${donatur} diperbarui`, true);
    } else {
      const newData = { donatur, nominal, tanggal, kategori };
      const newId = await db.saveDailyInput(newData);
      newData.id = newId;
      dataCache[kategori].set(donatur, newData);
      donaturTerinput[kategori].add(donatur);
      showNotification(`✅ Data ${donatur} berhasil disimpan`, true);
    }

    dataDonasi = Array.from(dataCache[kategori].values());
    renderTabelTerurut(kategori);
    updateTotalDisplay();
    updateDataCount();
    await muatDropdown(kategori);

    cachedElements.pemasukan.value = "";
    cachedElements.pemasukan.focus();
  } catch (e) {
    logger.error("❌ tambahData error:", e);
    showNotification("Gagal menyimpan data", false);
  }
}

async function exportData() {
  const kategori = cachedElements.kategoriDonatur?.value || "kategori1";
  if (!dataDonasi.length) {
    showNotification("Tidak ada data untuk diexport", false);
    return;
  }
  const sortedData = getSortedDataDonasi(kategori);
  const csv = generateCSVContent(sortedData, kategori);
  downloadCSV(csv, kategori);
  showNotification(
    `✅ Data berhasil diexport untuk ${kategoriLabel[kategori]}`,
    true
  );
}

async function hapusDataHariIni() {
  const kategori = cachedElements.kategoriDonatur?.value || "kategori1";
  const today = new Date().toLocaleDateString("id-ID");
  if (!confirm(`Hapus semua data hari ini untuk ${kategoriLabel[kategori]}?`))
    return;

  try {
    await db.deleteDailyInputsByDate(kategori, today);
    dataCache[kategori].clear();
    donaturTerinput[kategori].clear();
    dataDonasi = [];
    renderTabelTerurut(kategori);
    updateTotalDisplay();
    updateDataCount();
    await muatDropdown(kategori);
    showNotification("🗑️ Data hari ini berhasil dihapus", true);
  } catch (e) {
    logger.error("❌ hapusDataHariIni error:", e);
    showNotification("Gagal menghapus data", false);
  }
}

// ======= HELPERS =======
function debounce(fn, wait = 150) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function showNotification(message, isSuccess = true) {
  const notif = cachedElements.notifikasi;
  if (!notif) return;
  notif.textContent = message;
  notif.className = `mb-4 md:mb-6 text-center p-3 md:p-4 rounded-xl transition-all duration-300 ${
    isSuccess ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
  }`;
  setTimeout(() => {
    notif.textContent = "";
    notif.className =
      "mb-4 md:mb-6 text-center p-3 md:p-4 rounded-xl transition-all duration-300";
  }, 2500);
}

async function muatDropdown(kategori = "kategori1") {
  const select = cachedElements.donatur;
  const names = kategoriDonatur[kategori] || [];
  const belum = names.filter((n) => !donaturTerinput[kategori]?.has(n));

  select.innerHTML = "";
  const frag = document.createDocumentFragment();

  if (belum.length === 0) {
    const opt = new Option("🎉 Semua donatur sudah diinput", "");
    opt.disabled = true;
    frag.appendChild(opt);
    cachedElements.btnTambah.disabled = true;
    cachedElements.pemasukan.disabled = true;
  } else {
    for (const n of belum) frag.appendChild(new Option(n, n));
    cachedElements.btnTambah.disabled = false;
    cachedElements.pemasukan.disabled = false;
  }

  select.appendChild(frag);
}

function getSortedDataDonasi(kategori) {
  const map = new Map(dataDonasi.map((it) => [it.donatur, it]));
  const ordered = [];
  (kategoriDonatur[kategori] || []).forEach((n) => {
    if (map.has(n)) ordered.push(map.get(n));
  });
  return ordered;
}

function renderTabelTerurut(kategori) {
  const tbody = cachedElements.tabelDonasi.querySelector("tbody");
  const sorted = getSortedDataDonasi(kategori);

  tbody.innerHTML = "";
  if (!sorted.length) {
    const r = document.createElement("tr");
    r.innerHTML = `<td colspan="3" class="py-6 text-center text-gray-500"><i class="fas fa-inbox text-3xl mb-2"></i><div>Tidak ada data</div></td>`;
    tbody.appendChild(r);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="py-3 px-4">${item.donatur}</td>
      <td class="py-3 px-4 text-right font-mono">${
        parseInt(item.nominal) === 0
          ? "<span class='text-gray-400 italic'>Tidak Mengisi</span>"
          : "Rp " + Number(item.nominal).toLocaleString("id-ID")
      }</td>
      <td class="py-3 px-4 text-center">
        <button class="bg-amber-500 text-white p-2 rounded-lg mx-1" onclick="editRow(this,'${kategori}','${
      item.donatur
    }',${item.id})"><i class="fas fa-edit"></i></button>
        <button class="bg-red-500 text-white p-2 rounded-lg mx-1" onclick="hapusRow('${kategori}','${
      item.donatur
    }',${item.id})"><i class="fas fa-trash"></i></button>
      </td>`;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

function updateTotalDisplay() {
  const total = dataDonasi.reduce((s, it) => s + Number(it.nominal), 0);
  cachedElements.totalDonasi.textContent =
    "Rp " + total.toLocaleString("id-ID");
}

function updateDataCount() {
  cachedElements.dataCount.textContent = `${dataDonasi.length} data`;
}

function generateCSVContent(sortedData, kategori) {
  let csv = "Nama,Nominal,Tanggal,Kategori\n";
  sortedData.forEach((item) => {
    const nominal =
      item.nominal === "0"
        ? "Tidak Mengisi"
        : `Rp ${Number(item.nominal).toLocaleString("id-ID")}`;
    csv += `"${item.donatur}","${nominal}","${item.tanggal}","${kategoriLabel[kategori]}"\n`;
  });
  const total = sortedData.reduce((s, it) => s + Number(it.nominal), 0);
  csv += `\n"Total","Rp ${total.toLocaleString("id-ID")}","",""`;
  return csv;
}

function downloadCSV(csvContent, kategori) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date().toLocaleDateString("id-ID").replace(/\//g, "-");
  link.href = url;
  link.download = `data-jimpitan-${kategoriLabel[kategori]}-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function editRow(btn, kategori, donatur, id) {
  const tr = btn.closest("tr");
  const nominalCell = tr.children[1];
  const aksiCell = tr.children[2];
  const current = nominalCell.textContent.replace(/[Rp\s.]/g, "") || "0";
  nominalCell.innerHTML = `<input type="number" id="editInput" value="${current}" class="border p-1 w-24 text-right">`;
  aksiCell.innerHTML = `
    <button class="bg-emerald-500 text-white p-2 rounded-lg mx-1" onclick="simpanEdit('${kategori}','${donatur}',${id})"><i class="fas fa-check"></i></button>
    <button class="bg-gray-500 text-white p-2 rounded-lg mx-1" onclick="loadDataHariIni('${kategori}')"><i class="fas fa-times"></i></button>`;
  document.getElementById("editInput").focus();
}

async function simpanEdit(kategori, donatur, id) {
  const nominalBaru = document.getElementById("editInput").value;
  const tanggal = new Date().toLocaleDateString("id-ID");
  await db.updateDailyInput(id, { nominal: nominalBaru, tanggal });
  const cached = dataCache[kategori].get(donatur);
  if (cached) cached.nominal = nominalBaru;
  dataDonasi = Array.from(dataCache[kategori].values());
  renderTabelTerurut(kategori);
  updateTotalDisplay();
  showNotification(`✅ Data ${donatur} diperbarui`, true);
}

async function hapusRow(kategori, donatur, id) {
  if (!confirm(`Hapus data ${donatur}?`)) return;
  await db.deleteDailyInput(id);
  dataCache[kategori].delete(donatur);
  dataDonasi = Array.from(dataCache[kategori].values());
  renderTabelTerurut(kategori);
  updateTotalDisplay();
  updateDataCount();
  await muatDropdown(kategori);
  showNotification(`🗑️ Data ${donatur} dihapus`, true);
}
