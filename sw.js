// High Performance Service Worker
const STATIC_CACHE = "jimpitan-static-v3";
const DYNAMIC_CACHE = "jimpitan-dynamic-v2";
const API_CACHE = "jimpitan-api-v1";

// Critical assets untuk immediate caching
const criticalAssets = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./db.js",
  "./manifest.json",
];

// CDN assets untuk performance
const cdnAssets = [
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
];

// Install event - Cache critical assets immediately
self.addEventListener("install", (event) => {
  console.log("🚀 Service Worker installing (Optimized)...");

  event.waitUntil(
    (async () => {
      try {
        const staticCache = await caches.open(STATIC_CACHE);
        console.log("✅ Caching critical assets...");
        await staticCache.addAll(criticalAssets);

        const dynamicCache = await caches.open(DYNAMIC_CACHE);
        console.log("✅ Caching CDN assets...");

        for (const url of cdnAssets) {
          try {
            await dynamicCache.add(url);
          } catch (err) {
            console.warn("⚠️ Failed to cache CDN asset:", url, err.message);
            // continue silently — don't break installation
          }
        }

        console.log("✅ All assets cached successfully");
        await self.skipWaiting();
      } catch (error) {
        console.error("❌ Cache installation failed:", error);
      }
    })()
  );
});

// Activate event - Cleanup old caches
self.addEventListener("activate", (event) => {
  console.log("🔄 Service Worker activating (Optimized)...");

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete old caches
            if (![STATIC_CACHE, DYNAMIC_CACHE, API_CACHE].includes(cacheName)) {
              console.log("🗑️ Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log("✅ Service Worker activated and ready");
        return self.clients.claim();
      })
  );
});

// Fetch event - Optimized caching strategy
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Skip external resources except our CDNs
  const isOurDomain = self.location.origin === url.origin;
  const isFontAwesome = url.hostname.includes("cdnjs.cloudflare.com");
  const isTailwind = url.hostname.includes("cdn.tailwindcss.com");

  if (!isOurDomain && !isFontAwesome && !isTailwind) return;

  // Apply different strategies based on resource type
  if (isOurDomain) {
    // Local assets - Cache First strategy
    event.respondWith(cacheFirstStrategy(event.request));
  } else {
    // CDN assets - Stale While Revalidate strategy
    event.respondWith(staleWhileRevalidateStrategy(event.request));
  }
});

// Cache First Strategy untuk local assets
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    // Return cached version dan update cache di background
    updateCacheInBackground(request);
    return cachedResponse;
  }

  try {
    // Fetch from network
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache the new response
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Fallback untuk HTML requests
    if (request.destination === "document") {
      return caches.match("./index.html");
    }

    throw error;
  }
}

// Stale While Revalidate Strategy untuk CDN assets
async function staleWhileRevalidateStrategy(request) {
  const cachedResponse = await caches.match(request);

  // Return cached version immediately
  if (cachedResponse) {
    updateCacheInBackground(request);
    return cachedResponse;
  }

  // Fetch from network
  const networkResponse = await fetch(request);

  if (networkResponse.ok) {
    // Cache the new response
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, networkResponse.clone());
  }

  return networkResponse;
}

// Background cache update
async function updateCacheInBackground(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(
        self.location.origin === new URL(request.url).origin
          ? STATIC_CACHE
          : DYNAMIC_CACHE
      );
      cache.put(request, response);
    }
  } catch (error) {
    // Silent fail - kita sudah punya cached version
  }
}

// Background sync untuk offline operations
self.addEventListener("sync", (event) => {
  if (event.tag === "background-sync") {
    console.log("🔄 Background sync triggered");
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Clean up expired cache entries
  try {
    const cache = await caches.open(DYNAMIC_CACHE);
    const requests = await cache.keys();

    const cleanupPromises = requests.map(async (request) => {
      const response = await cache.match(request);
      if (!response) return;

      // Check cache headers atau custom logic untuk expiration
      const dateHeader = response.headers.get("date");
      if (dateHeader) {
        const cacheTime = new Date(dateHeader).getTime();
        const cacheAge = Date.now() - cacheTime;

        // Hapus cache yang lebih dari 1 hari
        if (cacheAge > 24 * 60 * 60 * 1000) {
          await cache.delete(request);
        }
      }
    });

    await Promise.all(cleanupPromises);
  } catch (error) {
    console.log("Cache cleanup failed:", error);
  }
}

// Periodic cache cleanup (setiap 6 jam)
setInterval(() => {
  doBackgroundSync().catch(() => {});
}, 6 * 60 * 60 * 1000);

// Message handler untuk communication dengan client
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data && event.data.type === "GET_CACHE_STATS") {
    event.ports[0].postMessage({
      type: "CACHE_STATS",
      stats: getCacheStats(),
    });
  }
});

// Cache statistics
async function getCacheStats() {
  const staticCache = await caches.open(STATIC_CACHE);
  const dynamicCache = await caches.open(DYNAMIC_CACHE);

  const staticRequests = await staticCache.keys();
  const dynamicRequests = await dynamicCache.keys();

  return {
    staticCacheSize: staticRequests.length,
    dynamicCacheSize: dynamicRequests.length,
    totalSize: staticRequests.length + dynamicRequests.length,
  };
}
