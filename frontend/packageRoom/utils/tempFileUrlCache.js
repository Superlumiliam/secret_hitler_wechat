const DEFAULT_TTL_MS = 50 * 60 * 1000;

const cacheByFileId = new Map();
const pendingByFileId = new Map();

function uniqueFileIds(fileIds) {
  return Array.from(new Set((fileIds || []).filter((fileId) => typeof fileId === "string" && fileId)));
}

function readCachedUrl(fileId, now) {
  const cached = cacheByFileId.get(fileId);
  return cached && cached.expiresAt > now ? cached.url : "";
}

async function resolveTempFileUrls(fileIds, options = {}) {
  const ids = uniqueFileIds(fileIds);
  const now = Date.now();
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
  const urlByFileId = {};
  const waits = [];
  const misses = [];

  ids.forEach((fileId) => {
    const cachedUrl = readCachedUrl(fileId, now);
    if (cachedUrl) {
      urlByFileId[fileId] = cachedUrl;
      return;
    }
    const pending = pendingByFileId.get(fileId);
    if (pending) {
      waits.push(pending);
      return;
    }
    misses.push(fileId);
  });

  if (misses.length && wx.cloud && wx.cloud.getTempFileURL) {
    const staleUrlByFileId = {};
    misses.forEach((fileId) => {
      const cached = cacheByFileId.get(fileId);
      staleUrlByFileId[fileId] = (cached && cached.url) || "";
    });

    const batchPromise = wx.cloud
      .getTempFileURL({ fileList: misses })
      .then((res) => {
        const resolved = {};
        (res.fileList || []).forEach((file) => {
          if (file.status === 0 && file.tempFileURL) {
            resolved[file.fileID] = file.tempFileURL;
            cacheByFileId.set(file.fileID, {
              url: file.tempFileURL,
              expiresAt: Date.now() + ttlMs,
            });
          }
        });
        misses.forEach((fileId) => {
          if (!resolved[fileId] && staleUrlByFileId[fileId]) {
            resolved[fileId] = staleUrlByFileId[fileId];
          }
        });
        return resolved;
      })
      .catch((err) => {
        const fallback = {};
        misses.forEach((fileId) => {
          if (staleUrlByFileId[fileId]) {
            fallback[fileId] = staleUrlByFileId[fileId];
          }
        });
        if (!Object.keys(fallback).length) {
          throw err;
        }
        return fallback;
      })
      .finally(() => {
        misses.forEach((fileId) => {
          if (pendingByFileId.get(fileId) === batchPromise) {
            pendingByFileId.delete(fileId);
          }
        });
      });

    misses.forEach((fileId) => {
      pendingByFileId.set(fileId, batchPromise);
    });
    waits.push(batchPromise);
  }

  const resolvedGroups = await Promise.all(waits);
  resolvedGroups.forEach((resolved) => {
    Object.assign(urlByFileId, resolved);
  });
  return urlByFileId;
}

function clearTempFileUrlCache() {
  cacheByFileId.clear();
  pendingByFileId.clear();
}

module.exports = {
  DEFAULT_TTL_MS,
  clearTempFileUrlCache,
  resolveTempFileUrls,
};
