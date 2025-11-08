// High Performance IndexedDB Utility (Optimized, backward-compatible)
// Nama kelas & method dipertahankan agar tidak merusak logika aplikasi.

class JimpitanDB {
  constructor() {
    this.dbName = "JimpitanAppDB";
    this.version = 3;
    this.db = null;
    this.initialized = false;
    this._openPromise = null; // untuk mencegah multiple open calls
  }

  // Init dengan deduplikasi open calls
  async init() {
    if (this.initialized && this.db) return this.db;
    if (this._openPromise) return this._openPromise;

    this._openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = (e) => {
        this._openPromise = null;
        reject(new Error("Failed to open database"));
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.initialized = true;
        this._openPromise = null;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        this.createOptimizedStores(db, event.oldVersion);
      };
    });

    return this._openPromise;
  }

  createOptimizedStores(db /*, oldVersion */) {
    // Hapus store yang tidak sesuai lalu buat ulang (menjaga struktur yang diinginkan)
    const ensureDelete = (name) => {
      if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
    };

    ensureDelete("dailyInputs");
    ensureDelete("settings");
    ensureDelete("cache");

    // dailyInputs store
    const store = db.createObjectStore("dailyInputs", {
      keyPath: "id",
      autoIncrement: true,
    });
    // Indexes untuk query cepat
    store.createIndex("kategori_tanggal", ["kategori", "tanggal"], {
      unique: false,
    });
    store.createIndex("kategori_donatur", ["kategori", "donatur"], {
      unique: false,
    });
    store.createIndex("kategori", "kategori", { unique: false });
    store.createIndex("tanggal", "tanggal", { unique: false });
    store.createIndex("donatur", "donatur", { unique: false });
    store.createIndex("createdAt", "createdAt", { unique: false });

    // settings store
    const settingsStore = db.createObjectStore("settings", {
      keyPath: "key",
    });
    settingsStore.createIndex("key", "key", { unique: true });

    // cache store
    const cacheStore = db.createObjectStore("cache", {
      keyPath: "key",
    });
    cacheStore.createIndex("expires", "expires", { unique: false });
  }

  // Utility internal: menjalankan transaksi dan mengembalikan objectStore
  _txn(storeNames, mode = "readonly") {
    return this.db.transaction(storeNames, mode);
  }

  async ensureInit() {
    if (!this.initialized) await this.init();
  }

  // === DAILY INPUTS METHODS ===

  async saveDailyInput(inputData) {
    await this.ensureInit();
    const txn = this._txn(["dailyInputs"], "readwrite");
    const store = txn.objectStore("dailyInputs");

    const dataWithMeta = {
      ...inputData,
      createdAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const request = store.add(dataWithMeta);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Failed to save data"));
    });
  }

  async getDailyInputs(kategori, tanggal = null) {
    await this.ensureInit();
    const txn = this._txn(["dailyInputs"], "readonly");
    const store = txn.objectStore("dailyInputs");

    // Gunakan index kategori_tanggal jika ada
    let index;
    try {
      index = store.index("kategori_tanggal");
    } catch (e) {
      index = store.index("kategori");
    }

    const range = tanggal
      ? IDBKeyRange.only([kategori, tanggal])
      : IDBKeyRange.bound([kategori, ""], [kategori, "\uffff"]);

    return new Promise((resolve, reject) => {
      const req = index.getAll(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error("Failed to retrieve data"));
    });
  }

  async getDailyInputsFallback(kategori, tanggal = null) {
    await this.ensureInit();
    const txn = this._txn(["dailyInputs"], "readonly");
    const store = txn.objectStore("dailyInputs");
    const index = store.index("kategori");

    return new Promise((resolve, reject) => {
      const req = index.getAll(kategori);
      req.onsuccess = () => {
        let results = req.result;
        if (tanggal)
          results = results.filter((item) => item.tanggal === tanggal);
        resolve(results);
      };
      req.onerror = () =>
        reject(new Error("Failed to retrieve data with fallback"));
    });
  }

  async updateDailyInput(id, updates) {
    await this.ensureInit();
    const txn = this._txn(["dailyInputs"], "readwrite");
    const store = txn.objectStore("dailyInputs");

    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          reject(new Error("Data not found"));
          return;
        }
        const updated = {
          ...existing,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(new Error("Failed to update data"));
      };
      getReq.onerror = () =>
        reject(new Error("Failed to retrieve data for update"));
    });
  }

  async deleteDailyInput(id) {
    await this.ensureInit();
    const txn = this._txn(["dailyInputs"], "readwrite");
    const store = txn.objectStore("dailyInputs");

    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(new Error("Failed to delete data"));
    });
  }

  // Delete by date menggunakan index (batched)
  async deleteDailyInputsByDate(kategori, tanggal) {
    await this.ensureInit();
    const txn = this._txn(["dailyInputs"], "readwrite");
    const store = txn.objectStore("dailyInputs");

    // Jika index tidak ada, fallback ke getAll + filter
    let index;
    try {
      index = store.index("kategori_tanggal");
    } catch (e) {
      index = store.index("kategori");
    }

    const range =
      index.name === "kategori_tanggal"
        ? IDBKeyRange.only([kategori, tanggal])
        : IDBKeyRange.only(kategori);

    return new Promise((resolve, reject) => {
      const getReq = index.getAll(range);
      getReq.onsuccess = () => {
        let items = getReq.result;
        if (index.name !== "kategori_tanggal") {
          items = items.filter((it) => it.tanggal === tanggal);
        }

        if (items.length === 0) {
          resolve({ deletedCount: 0, errorCount: 0 });
          return;
        }

        let deleted = 0;
        let errors = 0;

        items.forEach((item) => {
          const delReq = store.delete(item.id);
          delReq.onsuccess = () => deleted++;
          delReq.onerror = () => errors++;
        });

        txn.oncomplete = () =>
          resolve({ deletedCount: deleted, errorCount: errors });
        txn.onerror = () =>
          reject(new Error("Transaction failed during deletion"));
      };
      getReq.onerror = () =>
        reject(new Error("Failed to retrieve data for deletion"));
    });
  }

  async deleteDailyInputsByDateFallback(kategori, tanggal) {
    // Simpel: reuse deleteDailyInputsByDate (keamanan)
    return this.deleteDailyInputsByDate(kategori, tanggal);
  }

  async batchSaveDailyInputs(inputsArray) {
    if (!Array.isArray(inputsArray) || inputsArray.length === 0) return [];

    await this.ensureInit();
    const txn = this._txn(["dailyInputs"], "readwrite");
    const store = txn.objectStore("dailyInputs");

    const results = new Array(inputsArray.length);
    let errOccurred = false;

    return new Promise((resolve, reject) => {
      inputsArray.forEach((inputData, i) => {
        const dataWithMeta = {
          ...inputData,
          createdAt: new Date().toISOString(),
        };
        const req = store.add(dataWithMeta);
        req.onsuccess = () => {
          results[i] = req.result;
        };
        req.onerror = (e) => {
          errOccurred = true;
          reject(new Error(`Failed to save item at index ${i}`));
        };
      });

      txn.oncomplete = () => {
        if (!errOccurred) resolve(results);
      };
      txn.onerror = () =>
        reject(new Error("Transaction failed during batch save"));
    });
  }

  async getAllDailyInputs() {
    await this.ensureInit();
    const txn = this._txn(["dailyInputs"], "readonly");
    const store = txn.objectStore("dailyInputs");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error("Failed to retrieve all data"));
    });
  }

  // === CACHE METHODS ===

  async setCache(key, value, ttl = 300000) {
    await this.ensureInit();
    const txn = this._txn(["cache"], "readwrite");
    const store = txn.objectStore("cache");
    const cacheItem = {
      key,
      value: JSON.stringify(value),
      expires: Date.now() + ttl,
    };

    return new Promise((resolve, reject) => {
      const req = store.put(cacheItem);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(new Error("Failed to set cache"));
    });
  }

  async getCache(key) {
    await this.ensureInit();
    const txn = this._txn(["cache"], "readonly");
    const store = txn.objectStore("cache");

    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = async () => {
        const result = req.result;
        if (!result) return resolve(null);
        if (result.expires < Date.now()) {
          // hapus expired async & return null
          try {
            await this.clearCache(key);
          } catch (e) {}
          return resolve(null);
        }
        try {
          resolve(JSON.parse(result.value));
        } catch (e) {
          resolve(null);
        }
      };
      req.onerror = () => reject(new Error("Failed to get cache"));
    });
  }

  async clearCache(key) {
    await this.ensureInit();
    const txn = this._txn(["cache"], "readwrite");
    const store = txn.objectStore("cache");
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(new Error("Failed to clear cache"));
    });
  }

  async cleanupExpiredCache() {
    await this.ensureInit();
    const txn = this._txn(["cache"], "readwrite");
    const store = txn.objectStore("cache");
    let index;
    try {
      index = store.index("expires");
    } catch (e) {
      index = null;
    }

    if (!index) {
      // fallback: getAll keys
      return new Promise((resolve, reject) => {
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(0);
        req.onerror = () => reject(new Error("Failed to cleanup cache"));
      });
    }

    const range = IDBKeyRange.upperBound(Date.now());
    return new Promise((resolve, reject) => {
      const req = index.getAllKeys(range);
      req.onsuccess = () => {
        const keys = req.result || [];
        let delCount = 0;
        keys.forEach((k) => {
          store.delete(k).onsuccess = () => delCount++;
        });
        txn.oncomplete = () => resolve(delCount);
      };
      req.onerror = () => reject(new Error("Failed to cleanup cache"));
    });
  }

  // === SETTINGS METHODS ===

  async saveSetting(key, value) {
    await this.ensureInit();
    const txn = this._txn(["settings"], "readwrite");
    const store = txn.objectStore("settings");
    return new Promise((resolve, reject) => {
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(new Error("Failed to save setting"));
    });
  }

  async getSetting(key) {
    await this.ensureInit();
    const txn = this._txn(["settings"], "readonly");
    const store = txn.objectStore("settings");
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(new Error("Failed to get setting"));
    });
  }

  // === UTILITY METHODS ===

  async repairDatabase() {
    try {
      if (this.db) {
        this.db.close();
        this.db = null;
        this.initialized = false;
      }
      await new Promise((resolve, reject) => {
        const delReq = indexedDB.deleteDatabase(this.dbName);
        delReq.onsuccess = () => resolve();
        delReq.onerror = () => reject(new Error("Failed to delete database"));
      });
      await this.init();
      return true;
    } catch (e) {
      return false;
    }
  }

  async checkHealth() {
    try {
      await this.ensureInit();
      const stores = ["dailyInputs", "settings", "cache"];
      const health = {};
      for (const s of stores) {
        try {
          const txn = this._txn([s], "readonly");
          const store = txn.objectStore(s);
          const countReq = store.count();
          health[s] = await new Promise((resolve) => {
            countReq.onsuccess = () =>
              resolve({ exists: true, count: countReq.result });
            countReq.onerror = () => resolve({ exists: false });
          });
        } catch (e) {
          health[s] = { exists: false };
        }
      }
      return health;
    } catch (e) {
      return { overall: "unhealthy" };
    }
  }
}

// Buat instance global yang digunakan oleh script.js
const jimpitanDB = new JimpitanDB();
