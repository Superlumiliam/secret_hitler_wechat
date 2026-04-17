const { shallowEqual } = require('../utils/shallowEqual');

function createStoreBinding(page, store, selector) {
  if (!page || !store) {
    return () => {};
  }

  const apply = (state) => {
    const next = selector ? selector(state) : state;
    if (!next) return;
    if (!page.__boundStoreData) {
      page.__boundStoreData = {};
    }
    if (shallowEqual(page.__boundStoreData, next)) {
      return;
    }
    page.__boundStoreData = Object.assign({}, next);
    if (typeof page.setData === 'function') {
      page.setData(next);
    }
  };

  apply(store.getState());
  const unsubscribe = store.subscribe(apply);
  return unsubscribe;
}

module.exports = {
  createStoreBinding,
};

