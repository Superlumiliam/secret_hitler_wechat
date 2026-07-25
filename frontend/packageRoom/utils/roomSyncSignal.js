const ROOM_SYNC_SIGNAL_COLLECTION = "room_sync_signals";
const WATCH_RETRY_INTERVALS_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];

function createRoomSyncSignalWatcher(options = {}) {
  let watcher = null;
  let retryTimer = null;
  let stopped = true;
  let healthy = false;
  let watcherGeneration = 0;
  let retryAttempt = 0;

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function closeWatcher() {
    watcherGeneration += 1;
    if (watcher && typeof watcher.close === "function") {
      watcher.close();
    }
    watcher = null;
  }

  function scheduleRetry() {
    clearRetryTimer();
    if (stopped) {
      return;
    }
    const retryIndex = Math.min(retryAttempt, WATCH_RETRY_INTERVALS_MS.length - 1);
    const retryIntervalMs = WATCH_RETRY_INTERVALS_MS[retryIndex];
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      openWatcher();
    }, retryIntervalMs);
  }

  function markUnavailable(err) {
    closeWatcher();
    const wasHealthy = healthy;
    healthy = false;
    if (typeof options.onUnavailable === "function") {
      options.onUnavailable(err, wasHealthy);
    }
    scheduleRetry();
  }

  function openWatcher() {
    if (stopped || watcher) {
      return;
    }
    if (!options.roomId || !wx.cloud || typeof wx.cloud.database !== "function") {
      markUnavailable(new Error("当前环境不支持房间实时同步"));
      return;
    }

    try {
      const db = wx.cloud.database();
      const generation = watcherGeneration + 1;
      watcherGeneration = generation;
      const nextWatcher = db
        .collection(ROOM_SYNC_SIGNAL_COLLECTION)
        .where({
          roomId: options.roomId,
        })
        .watch({
          onChange(snapshot) {
            if (stopped || generation !== watcherGeneration) {
              return;
            }
            const signals = (snapshot && snapshot.docs) || [];
            const signal = signals.find((item) => item && item.roomId === options.roomId);
            if (!signal) {
              markUnavailable(new Error("房间实时同步信号尚未就绪"));
              return;
            }

            clearRetryTimer();
            retryAttempt = 0;
            if (!healthy) {
              healthy = true;
              if (typeof options.onHealthy === "function") {
                options.onHealthy(signal);
              }
            }
            if (typeof options.onSignal === "function") {
              options.onSignal(signal);
            }
          },
          onError(err) {
            if (!stopped && generation === watcherGeneration) {
              markUnavailable(err);
            }
          },
        });
      if (!stopped && generation === watcherGeneration) {
        watcher = nextWatcher;
      } else if (nextWatcher && typeof nextWatcher.close === "function") {
        nextWatcher.close();
      }
    } catch (err) {
      markUnavailable(err);
    }
  }

  return {
    start() {
      stopped = false;
      openWatcher();
    },
    stop() {
      stopped = true;
      healthy = false;
      retryAttempt = 0;
      clearRetryTimer();
      closeWatcher();
    },
    isHealthy() {
      return healthy;
    },
  };
}

module.exports = {
  ROOM_SYNC_SIGNAL_COLLECTION,
  WATCH_RETRY_INTERVALS_MS,
  createRoomSyncSignalWatcher,
};
