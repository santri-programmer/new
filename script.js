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

// State in-memory yang cepat
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

// DB reference (global instance dari db.js)
let db = null;

// ======= INIT =======
document.addEventListener("DOMContentLoaded", async () => {
  logger.time("AppInitialization");

  try {
    db = jimpitanDB;
    await db.init();
    logger.log("✅ Database initialized");
    await preloadCache("kategori1");
  } catch (err) {
    logger.error("❌ DB init failed:", err);
    showNotification("Gagal menginisialisasi penyimpanan offline", false);
  }

  // inisialisasi DOM cache & operasi awal secara paralel
  await Promise.all([
    initializeCachedElements(),
    loadDataHariIni("kategori1"),
    muatDropdown("kategori1"),
  ]);

  setupEventListeners();

  // Tampilkan elemen critical secara efisien
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
    dataStatus: "dataStatus",
    dataInfo: "dataInfo",
    dataCount: "dataCount",
    btnRefresh: "btnRefresh",
  };
  Object.keys(map).forEach((k) => {
    cachedElements[k] = document.getElementById(map[k]);
  });

  // Set tanggal
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

// ======= EVENT LISTENERS =======
function setupEventListeners() {
  // Delegation quick amount
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

  // Buttons
  if (cachedElements.btnTambah)
    cachedElements.btnTambah.addEventListener("click", tambahData);
  if (cachedElements.btnExport)
    cachedElements.btnExport.addEventListener("click", exportData);
  if (cachedElements.btnHapus)
    cachedElements.btnHapus.addEventListener("click", hapusDataHariIni);

  // kategori change (debounced minimal)
  if (cachedElements.kategoriDonatur) {
    cachedElements.kategoriDonatur.addEventListener(
      "change",
      debounce(async function () {
        const kategori = this.value;
        showNotification("🔄 Memuat data...", true);
        try {
          await loadDataHariIni(kategori);
          await muatDropdown(kategori);
          logger.log("✅ Kategori switched:", kategori);
        } catch (e) {
          logger.error("❌ Switch kategori error:", e);
          showNotification("Gagal memuat data kategori", false);
        } finally {
          // clear notif jika masih memuat
          setTimeout(() => {
            const notif = cachedElements.notifikasi;
            if (notif && notif.textContent.includes("Memuat data")) {
              notif.textContent = "";
              notif.className =
                "mb-4 md:mb-6 text-center p-3 md:p-4 rounded-xl transition-all duration-300";
            }
          }, 400);
        }
      }, 150)
    );
  }

  // pemasukan input sanitize
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

  // auto focus ringan
  setTimeout(() => {
    if (cachedElements.pemasukan) cachedElements.pemasukan.focus();
  }, 120);

  // refresh (soft) via reload
  if (cachedElements.btnRefresh) {
    cachedElements.btnRefresh.addEventListener("click", () => {
      logger.log("🔄 Refresh triggered");
      window.location.reload();
    });
  }
}

// ======= CACHE PRELOAD =======
async function preloadCache(kategori) {
  try {
    if (!db || typeof db.getCache !== "function") return;
    const today = new Date().toLocaleDateString("id-ID");
    const key = `${kategori}_${today}`;
    const cached = await db.getCache(key);
    if (cached && Array.isArray(cached)) {
      dataCache[kategori] = new Map(cached.map((item) => [item.donatur, item]));
      dataCache.timestamp.set(kategori, Date.now());
    }
  } catch (e) {
    logger.warn("⚠️ Cache preload failed:", e && e.message);
  }
}

// ======= LOAD & RENDER DATA =======
async function loadDataHariIni(kategori) {
  const today = new Date().toLocaleDateString("id-ID");
  const cacheKey = `${kategori}_${today}`;

  // fast path: in-memory cache fresh <30s
  const ts = dataCache.timestamp.get(kategori);
  if (ts && Date.now() - ts < 30000) {
    const cachedArray = Array.from(dataCache[kategori].values()).filter(
      (it) => it.tanggal === today
    );
    dataDonasi = cachedArray.map((it) => ({
      donatur: it.donatur,
      nominal: it.nominal,
      tanggal: it.tanggal,
      kategori: it.kategori,
      id: it.id,
    }));
    donaturTerinput[kategori] = new Set(dataDonasi.map((it) => it.donatur));
    renderTabelTerurut(kategori);
    updateTotalDisplay();
    updateDataCount();
    return;
  }

  try {
    const savedData = await db.getDailyInputs(kategori, today);

    // set in-memory cache & timestamp
    dataCache[kategori] = new Map(
      (savedData || []).map((item) => [item.donatur, item])
    );
    dataCache.timestamp.set(kategori, Date.now());

    // persist cache best-effort
    if (typeof db.setCache === "function") {
      db.setCache(cacheKey, savedData, 300000).catch(() => {});
    }

    dataDonasi = (savedData || []).map((item) => ({
      donatur: item.donatur,
      nominal: item.nominal,
      tanggal: item.tanggal,
      kategori: item.kategori,
      id: item.id,
    }));

    donaturTerinput[kategori] = new Set(dataDonasi.map((it) => it.donatur));

    renderTabelTerurut(kategori);
    updateTotalDisplay();
    updateDataCount();
  } catch (error) {
    logger.error("❌ loadDataHariIni error:", error);
    // fallback
    try {
      const fd = await db.getDailyInputsFallback(kategori, today);
      dataDonasi = (fd || []).map((item) => ({
        donatur: item.donatur,
        nominal: item.nominal,
        tanggal: item.tanggal,
        kategori: item.kategori,
        id: item.id,
      }));
      donaturTerinput[kategori] = new Set(dataDonasi.map((it) => it.donatur));
      renderTabelTerurut(kategori);
      updateTotalDisplay();
      updateDataCount();
    } catch (e) {
      logger.error("❌ fallback load failed:", e);
      dataDonasi = [];
      donaturTerinput[kategori] = new Set();
      renderTabelTerurut(kategori);
      updateTotalDisplay();
      updateDataCount();
    }
  }
}

// ======= CORE ACTIONS =======
async function tambahData() {
  const donatur = cachedElements.donatur?.value;
  const nominal = cachedElements.pemasukan?.value;
  const kategori = cachedElements.kategoriDonatur?.value || "kategori1";

  if (!donatur || donatur === "" || nominal === "") {
    showNotification("Nama dan nominal tidak boleh kosong", false);
    return;
  }

  const tanggal = new Date().toLocaleDateString("id-ID");

  try {
    const existingInCache = dataCache[kategori].get(donatur);
    const existingIndex = dataDonasi.findIndex(
      (item) => item.donatur === donatur
    );

    if (existingIndex !== -1 || existingInCache) {
      // Update existing record
      const itemId = existingInCache?.id || dataDonasi[existingIndex].id;
      if (existingIndex !== -1) {
        dataDonasi[existingIndex].nominal = nominal;
        dataDonasi[existingIndex].tanggal = tanggal;
      }
      if (existingInCache) {
        dataCache[kategori].set(donatur, {
          ...existingInCache,
          nominal,
          tanggal,
        });
      }
      if (itemId) await db.updateDailyInput(itemId, { nominal, tanggal });
      showNotification(`✏️ Data ${donatur} diperbarui`, true);
    } else {
      const newData = { donatur, nominal, tanggal, kategori };
      const newId = await db.saveDailyInput(newData);
      newData.id = newId;
      dataDonasi.push(newData);
      donaturTerinput[kategori].add(donatur);
      dataCache[kategori].set(donatur, newData);

      if (parseInt(nominal) === 0) {
        showNotification(`✅ Data ${donatur} disimpan (tidak mengisi)`, true);
      } else {
        showNotification(`✅ Data ${donatur} berhasil disimpan`, true);
      }
    }

    // batch UI update
    requestAnimationFrame(() => {
      renderTabelTerurut(kategori);
      updateTotalDisplay();
      updateDataCount();
    });

    await muatDropdown(kategori);

    if (cachedElements.pemasukan) cachedElements.pemasukan.value = "";
    setTimeout(() => {
      if (cachedElements.pemasukan) cachedElements.pemasukan.focus();
    }, 50);
  } catch (e) {
    logger.error("❌ tambahData error:", e);
    showNotification("Gagal menyimpan data", false);
  }
}

async function exportData() {
  const kategori = cachedElements.kategoriDonatur?.value || "kategori1";
  if (!dataDonasi || dataDonasi.length === 0) {
    showNotification("Tidak ada data untuk diexport", false);
    return;
  }

  try {
    const sortedData = getSortedDataDonasi(kategori);
    const csvContent = generateCSVContent(sortedData, kategori);
    downloadCSV(csvContent, kategori);
    showNotification(
      `✅ Data berhasil diexport untuk ${kategoriLabel[kategori]}`,
      true
    );
  } catch (e) {
    logger.error("❌ exportData error:", e);
    showNotification("Gagal mengexport data", false);
  }
}

async function hapusDataHariIni() {
  const kategori = cachedElements.kategoriDonatur?.value || "kategori1";
  const today = new Date().toLocaleDateString("id-ID");

  if (!dataDonasi || dataDonasi.length === 0) {
    showNotification("Tidak ada data untuk dihapus", false);
    return;
  }

  if (
    !confirm(
      `Apakah Anda yakin ingin menghapus semua data hari ini untuk ${kategoriLabel[kategori]}?`
    )
  )
    return;

  try {
    let result;
    if (typeof db.deleteDailyInputsByDate === "function") {
      result = await db.deleteDailyInputsByDate(kategori, today);
    } else {
      result = await db.deleteDailyInputsByDateFallback(kategori, today);
    }

    dataCache[kategori].clear();
    dataCache.timestamp.delete(kategori);
    dataDonasi = [];
    donaturTerinput[kategori] = new Set();

    requestAnimationFrame(() => {
      const tbody = cachedElements.tabelDonasi.querySelector("tbody");
      tbody.innerHTML = "";
      updateTotalDisplay();
      updateDataCount();
    });

    await muatDropdown(kategori);
    showNotification("🗑️ Data hari ini berhasil dihapus", true);
  } catch (error) {
    logger.error("❌ delete all error:", error);
    // try fallback individual deletes
    try {
      await deleteDataIndividually(kategori, today);
      dataCache[kategori].clear();
      dataCache.timestamp.delete(kategori);
      dataDonasi = [];
      donaturTerinput[kategori] = new Set();
      requestAnimationFrame(() => {
        const tbody = cachedElements.tabelDonasi.querySelector("tbody");
        tbody.innerHTML = "";
        updateTotalDisplay();
        updateDataCount();
      });
      await muatDropdown(kategori);
      showNotification("🗑️ Data hari ini berhasil dihapus", true);
    } catch (e) {
      logger.error("❌ All delete methods failed:", e);
      showNotification("Gagal menghapus data", false);
    }
  }
}

async function deleteDataIndividually(kategori, tanggal) {
  const savedData = await db.getDailyInputs(kategori, tanggal);
  let successCount = 0,
    errorCount = 0;
  for (const item of savedData) {
    try {
      await db.deleteDailyInput(item.id);
      successCount++;
    } catch (e) {
      errorCount++;
      logger.error("❌ Failed delete item:", item.id, e);
    }
  }
  logger.log(`✅ Deleted ${successCount} items, ${errorCount} errors`);
  if (errorCount > 0) throw new Error(`Failed to delete ${errorCount} items`);
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
  requestAnimationFrame(() => {
    const notif = cachedElements.notifikasi;
    if (!notif) return;
    notif.textContent = message;
    notif.className =
      "mb-4 md:mb-6 text-center p-3 md:p-4 rounded-xl transition-all duration-300 show";

    if (isSuccess) {
      notif.classList.add("bg-green-50", "border-green-200", "text-green-700");
    } else {
      notif.classList.add("bg-red-50", "border-red-200", "text-red-700");
    }

    setTimeout(() => {
      notif.classList.remove("show");
      setTimeout(() => {
        notif.textContent = "";
        notif.className =
          "mb-4 md:mb-6 text-center p-3 md:p-4 rounded-xl transition-all duration-300";
      }, 300);
    }, 3000);
  });
}

async function muatDropdown(kategori = "kategori1") {
  const select = cachedElements.donatur;
  const names = kategoriDonatur[kategori] || [];
  // Donatur belum diinput
  const belum = names.filter((n) => !donaturTerinput[kategori]?.has(n));

  // Kosongkan dengan cara paling cepat
  if (select) {
    // gunakan fragment untuk performa
    select.innerHTML = "";
    const frag = document.createDocumentFragment();

    if (belum.length === 0) {
      const opt = new Option("🎉 Semua donatur sudah diinput", "");
      opt.disabled = true;
      frag.appendChild(opt);
      cachedElements.btnTambah.disabled = true;
      if (cachedElements.btnTambah.querySelector("#btnText"))
        cachedElements.btnTambah.querySelector("#btnText").textContent =
          "Selesai";
      cachedElements.pemasukan.disabled = true;
    } else {
      // tambahkan first selected langsung
      const first = belum[0];
      frag.appendChild(new Option(first, first));
      for (let i = 1; i < belum.length; i++)
        frag.appendChild(new Option(belum[i], belum[i]));
      cachedElements.btnTambah.disabled = false;
      if (cachedElements.btnTambah.querySelector("#btnText"))
        cachedElements.btnTambah.querySelector("#btnText").textContent =
          "Tambah";
      cachedElements.pemasukan.disabled = false;
    }

    select.appendChild(frag);

    // trigger ringan, tapi tunda sedikit
    setTimeout(() => {
      select.dispatchEvent(new Event("change"));
    }, 8);
  }
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

  // clear fast
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  if (sorted.length === 0) {
    const r = document.createElement("tr");
    const c = document.createElement("td");
    c.colSpan = 3;
    c.className = "py-8 text-center text-gray-500";
    c.innerHTML =
      '<i class="fas fa-inbox text-4xl mb-2 block"></i><span>Tidak ada data untuk ditampilkan</span>';
    r.appendChild(c);
    tbody.appendChild(r);
    return;
  }

  const frag = document.createDocumentFragment();

  for (const item of sorted) {
    const row = document.createElement("tr");
    row.className = "hover:bg-gray-50 transition-colors";

    // donatur
    const dCell = document.createElement("td");
    dCell.className = "py-3 md:py-4 px-4 md:px-6";
    dCell.textContent = item.donatur;
    row.appendChild(dCell);

    // nominal
    const nCell = document.createElement("td");
    nCell.className = "py-3 md:py-4 px-4 md:px-6 text-right font-mono";
    if (parseInt(item.nominal) === 0) {
      nCell.textContent = "Tidak Mengisi";
      nCell.classList.add("text-gray-400", "italic");
    } else {
      nCell.textContent = "Rp " + Number(item.nominal).toLocaleString("id-ID");
    }
    row.appendChild(nCell);

    // aksi
    const aCell = document.createElement("td");
    aCell.className = "py-3 md:py-4 px-4 md:px-6 text-center";

    const editBtn = document.createElement("button");
    editBtn.innerHTML = '<i class="fas fa-edit"></i>';
    editBtn.className =
      "bg-amber-500 hover:bg-amber-600 text-white p-2 rounded-lg transition duration-200 mx-1";
    editBtn.onclick = () => editRow(row, kategori, item.donatur, item.id);
    aCell.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.className =
      "bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg transition duration-200 mx-1";
    delBtn.onclick = () => hapusRow(kategori, item.donatur, item.id);
    aCell.appendChild(delBtn);

    row.appendChild(aCell);

    frag.appendChild(row);
  }

  tbody.appendChild(frag);
}

function updateTotalDisplay() {
  let total = 0;
  for (let i = 0; i < dataDonasi.length; i++)
    total += Number(dataDonasi[i].nominal);
  if (cachedElements.totalDonasi)
    cachedElements.totalDonasi.textContent =
      "Rp " + total.toLocaleString("id-ID");
}

function updateDataCount() {
  if (cachedElements.dataCount)
    cachedElements.dataCount.textContent = `${dataDonasi.length} data`;
}

function generateCSVContent(sortedData, kategori) {
  let csv = "Nama,Nominal,Tanggal,Kategori\n";
  for (let i = 0; i < sortedData.length; i++) {
    const item = sortedData[i];
    const nominal =
      item.nominal === "0"
        ? "Tidak Mengisi"
        : `Rp ${Number(item.nominal).toLocaleString("id-ID")}`;
    csv += `"${item.donatur}","${nominal}","${item.tanggal}","${kategoriLabel[kategori]}"\n`;
  }
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

function editRow(row, kategori, donaturLama, itemId) {
  const nominalCell = row.cells[1];
  const aksiCell = row.cells[2];
  const currentNominalText = nominalCell.textContent.replace(/[Rp\s.]/g, "");
  const currentNominal =
    currentNominalText === "TidakMengisi" ? "0" : currentNominalText || "0";

  nominalCell.innerHTML = `<input type="number" id="editInput" value="${currentNominal}" min="0" class="w-24 md:w-32 px-3 py-2 border border-gray-300 rounded text-right font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500">`;

  aksiCell.innerHTML = "";

  const saveBtn = document.createElement("button");
  saveBtn.innerHTML = '<i class="fas fa-check"></i>';
  saveBtn.className =
    "bg-emerald-500 hover:bg-emerald-600 text-white p-2 rounded-lg transition duration-200 mx-1";
  saveBtn.onclick = () =>
    simpanEdit(
      kategori,
      donaturLama,
      document.getElementById("editInput").value,
      itemId
    );
  aksiCell.appendChild(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
  cancelBtn.className =
    "bg-gray-500 hover:bg-gray-600 text-white p-2 rounded-lg transition duration-200 mx-1";
  cancelBtn.onclick = () => loadDataHariIni(kategori);
  aksiCell.appendChild(cancelBtn);

  requestAnimationFrame(() => {
    const editInput = document.getElementById("editInput");
    if (editInput) {
      editInput.focus();
      editInput.select();
    }
  });
}

async function simpanEdit(kategori, donaturLama, nominalBaru, itemId) {
  try {
    const tanggal = new Date().toLocaleDateString("id-ID");
    if (itemId)
      await db.updateDailyInput(itemId, { nominal: nominalBaru, tanggal });

    const cachedItem = dataCache[kategori].get(donaturLama);
    if (cachedItem)
      dataCache[kategori].set(donaturLama, {
        ...cachedItem,
        nominal: nominalBaru,
        tanggal,
      });

    const idx = dataDonasi.findIndex((it) => it.id === itemId);
    if (idx !== -1) {
      dataDonasi[idx].nominal = nominalBaru;
      dataDonasi[idx].tanggal = tanggal;
    }

    requestAnimationFrame(() => {
      renderTabelTerurut(kategori);
      updateTotalDisplay();
    });

    await muatDropdown(kategori);
    showNotification(`✅ Data ${donaturLama} berhasil diperbarui`, true);
  } catch (e) {
    logger.error("❌ simpanEdit error:", e);
    showNotification("Gagal memperbarui data", false);
  }
}

async function hapusRow(kategori, donatur, itemId) {
  if (!confirm(`Hapus data ${donatur}?`)) return;
  try {
    if (itemId) await db.deleteDailyInput(itemId);
    dataCache[kategori].delete(donatur);
    dataDonasi = dataDonasi.filter((it) => it.id !== itemId);
    donaturTerinput[kategori].delete(donatur);
    requestAnimationFrame(() => {
      renderTabelTerurut(kategori);
      updateTotalDisplay();
      updateDataCount();
    });
    await muatDropdown(kategori);
    showNotification(`🗑️ Data ${donatur} berhasil dihapus`, true);
  } catch (e) {
    logger.error("❌ hapusRow error:", e);
    showNotification("Gagal menghapus data", false);
  }
}
