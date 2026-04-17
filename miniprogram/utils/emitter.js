function createEmitter() {
  const listeners = new Map();

  function on(event, handler) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(handler);
    return () => off(event, handler);
  }

  function off(event, handler) {
    const set = listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      listeners.delete(event);
    }
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    Array.from(set).forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error('[emitter]', event, error);
      }
    });
  }

  function clear(event) {
    if (event) {
      listeners.delete(event);
      return;
    }
    listeners.clear();
  }

  return { on, off, emit, clear };
}

module.exports = { createEmitter };

