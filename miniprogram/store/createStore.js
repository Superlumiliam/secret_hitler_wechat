function createStore(initialState) {
  let state = typeof initialState === 'function' ? initialState() : { ...initialState };
  const listeners = new Set();

  function notify() {
    listeners.forEach((listener) => listener(state));
  }

  return {
    getState() {
      return state;
    },
    setState(next) {
      state = typeof next === 'function' ? next(state) : { ...next };
      notify();
    },
    patch(partial) {
      const next = typeof partial === 'function' ? partial(state) : partial;
      state = Object.assign({}, state, next);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      state = typeof initialState === 'function' ? initialState() : { ...initialState };
      notify();
    },
  };
}

module.exports = { createStore };

