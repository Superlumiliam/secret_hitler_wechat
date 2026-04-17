function debounce(fn, wait) {
  let timer = null;
  return function debounced(...args) {
    const context = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(context, args);
    }, wait);
  };
}

module.exports = { debounce };

