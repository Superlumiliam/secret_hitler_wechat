const DEFAULT_TTL_MS = 50 * 60 * 1000;
const MAX_FILE_IDS_PER_REQUEST = 50;

const cacheByFileId = new Map();
const pendingByFileId = new Map();

function uniqueFileIds(fileIds) {
  return Array.from(new Set((fileIds || []).filter((fileId) => typeof fileId === "string" && fileId)));
}

function readCachedUrl(fileId, now) {
  const cached = cacheByFileId.get(fileId);
  return cached && cached.expiresAt > now ? cached.url : "";
}

function createBatchRequest(fileIds, ttlMs) {
  const staleUrlByFileId = {};
  fileIds.forEach((fileId) => {
    const cached = cacheByFileId.get(fileId);
    staleUrlByFileId[fileId] = (cached && cached.url) || "";
  });

  let request;
  try {
    request = wx.cloud.getTempFileURL({ fileList: fileIds });
  } catch (err) {
    request = Promise.reject(err);
  }

  const batchPromise = Promise.resolve(request)
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
      fileIds.forEach((fileId) => {
        if (!resolved[fileId] && staleUrlByFileId[fileId]) {
          resolved[fileId] = staleUrlByFileId[fileId];
        }
      });
      return resolved;
    })
    .catch((err) => {
      const fallback = {};
      fileIds.forEach((fileId) => {
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
      fileIds.forEach((fileId) => {
        if (pendingByFileId.get(fileId) === batchPromise) {
          pendingByFileId.delete(fileId);
        }
      });
    });

  fileIds.forEach((fileId) => {
    pendingByFileId.set(fileId, batchPromise);
  });
  return batchPromise;
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

  if (misses.length && typeof wx !== "undefined" && wx.cloud && wx.cloud.getTempFileURL) {
    for (let start = 0; start < misses.length; start += MAX_FILE_IDS_PER_REQUEST) {
      const batchFileIds = misses.slice(start, start + MAX_FILE_IDS_PER_REQUEST);
      waits.push(createBatchRequest(batchFileIds, ttlMs));
    }
  }

  const settledGroups = await Promise.allSettled(waits);
  let firstRejectedReason = null;
  let hasFulfilledGroup = false;
  settledGroups.forEach((group) => {
    if (group.status === "fulfilled") {
      hasFulfilledGroup = true;
      Object.assign(urlByFileId, group.value);
      return;
    }
    if (!firstRejectedReason) {
      firstRejectedReason = group.reason;
    }
  });
  if (firstRejectedReason && !hasFulfilledGroup && !Object.keys(urlByFileId).length) {
    throw firstRejectedReason;
  }
  return urlByFileId;
}

function clearTempFileUrlCache() {
  cacheByFileId.clear();
  pendingByFileId.clear();
}

module.exports = {
  DEFAULT_TTL_MS,
  MAX_FILE_IDS_PER_REQUEST,
  clearTempFileUrlCache,
  resolveTempFileUrls,
};
