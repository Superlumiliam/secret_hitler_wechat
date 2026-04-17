function format(args) {
  return args
    .map((item) => {
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch (error) {
        return String(item);
      }
    })
    .join(' ');
}

const logger = {
  debug(...args) {
    console.log('[secret-hitler]', format(args));
  },
  info(...args) {
    console.info('[secret-hitler]', format(args));
  },
  warn(...args) {
    console.warn('[secret-hitler]', format(args));
  },
  error(...args) {
    console.error('[secret-hitler]', format(args));
  },
};

module.exports = { logger };

