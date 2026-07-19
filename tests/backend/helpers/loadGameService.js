const Module = require("module");
const path = require("path");

function createMemoryDb(initialData = {}) {
  const collections = {};
  const stats = {
    docGets: {},
    docSets: {},
    docUpdates: {},
    adds: {},
    queryGets: {},
    queryUpdates: {},
    transactions: 0,
  };

  function incrementStat(group, name) {
    group[name] = (group[name] || 0) + 1;
  }

  function ensureCollection(name) {
    if (!collections[name]) {
      collections[name] = new Map();
    }
    return collections[name];
  }

  Object.keys(initialData).forEach((name) => {
    const collection = ensureCollection(name);
    Object.keys(initialData[name]).forEach((id) => {
      collection.set(id, clone(initialData[name][id]));
    });
  });

  function collectionApi(name) {
    return {
      doc(id) {
        return docApi(name, id);
      },
      where(query) {
        return queryApi(name, query);
      },
      async add({ data }) {
        incrementStat(stats.adds, name);
        const id = data._id || `${name}_${ensureCollection(name).size + 1}`;
        ensureCollection(name).set(id, clone({ ...data, _id: id }));
        return { _id: id };
      },
    };
  }

  function docApi(name, id) {
    return {
      async get() {
        incrementStat(stats.docGets, name);
        return { data: clone(ensureCollection(name).get(id)) };
      },
      async set({ data }) {
        incrementStat(stats.docSets, name);
        ensureCollection(name).set(id, clone({ ...data, _id: id }));
        return {};
      },
      async update({ data }) {
        incrementStat(stats.docUpdates, name);
        const collection = ensureCollection(name);
        const existing = collection.get(id) || { _id: id };
        collection.set(id, clone({ ...existing, ...data }));
        return {};
      },
    };
  }

  function queryApi(name, query, limitCount = null, order = null) {
    return {
      limit(nextLimitCount) {
        return queryApi(name, query, nextLimitCount, order);
      },
      orderBy(field, direction = "asc") {
        return queryApi(name, query, limitCount, { field, direction });
      },
      async get() {
        incrementStat(stats.queryGets, name);
        let rows = Array.from(ensureCollection(name).values()).filter((row) => matchesQuery(row, query));
        if (order) {
          rows = rows.slice().sort((a, b) => {
            if (a[order.field] === b[order.field]) {
              return 0;
            }
            const result = a[order.field] > b[order.field] ? 1 : -1;
            return order.direction === "desc" ? -result : result;
          });
        }
        if (Number.isInteger(limitCount)) {
          rows = rows.slice(0, limitCount);
        }
        return { data: clone(rows) };
      },
      async update({ data }) {
        incrementStat(stats.queryUpdates, name);
        let updated = 0;
        const collection = ensureCollection(name);
        for (const [id, row] of collection.entries()) {
          if (!matchesQuery(row, query)) {
            continue;
          }
          collection.set(id, clone({ ...row, ...data }));
          incrementStat(stats.docUpdates, name);
          updated += 1;
        }
        return { stats: { updated } };
      },
    };
  }

  return {
    command: {
      in(values) {
        return { $in: values };
      },
      lte(value) {
        return { $lte: value };
      },
      inc(value) {
        return { $inc: value };
      },
      set(value) {
        return value;
      },
    },
    collection: collectionApi,
    async runTransaction(handler) {
      stats.transactions += 1;
      return await handler({ collection: collectionApi });
    },
    dump() {
      const result = {};
      Object.keys(collections).forEach((name) => {
        result[name] = Object.fromEntries(collections[name]);
      });
      return clone(result);
    },
    stats() {
      return clone(stats);
    },
  };
}

function loadGameService(options = {}) {
  return loadCloudFunction("gameService", options);
}

function loadRoomService(options = {}) {
  return loadCloudFunction("roomService", options);
}

function loadBootstrapService(options = {}) {
  return loadCloudFunction("bootstrapService", options);
}

function loadCloudFunction(functionName, options = {}) {
  const db = options.db || createMemoryDb();
  const openIdRef = { value: options.openId || "test_openid" };
  const servicePath = path.resolve(__dirname, `../../../cloudfunctions/${functionName}/index.js`);
  const originalLoad = Module._load;

  delete require.cache[servicePath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "wx-server-sdk") {
      return {
        DYNAMIC_CURRENT_ENV: "test-env",
        init() {},
        getWXContext() {
          return {
            OPENID: openIdRef.value,
          };
        },
        database() {
          return db;
        },
        async deleteFile() {
          return {
            fileList: [],
          };
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    const service = require(servicePath);
    return {
      service,
      db,
      setOpenId(openId) {
        openIdRef.value = openId;
      },
    };
  } finally {
    Module._load = originalLoad;
  }
}

function matchesQuery(row, query) {
  return Object.keys(query || {}).every((key) => {
    const expected = query[key];
    if (expected && typeof expected === "object" && Array.isArray(expected.$in)) {
      return expected.$in.includes(row[key]);
    }
    if (expected && typeof expected === "object" && Object.prototype.hasOwnProperty.call(expected, "$lte")) {
      const expectedValue = expected.$lte instanceof Date ? expected.$lte.getTime() : expected.$lte;
      const rowValue = expected.$lte instanceof Date ? new Date(row[key]).getTime() : row[key];
      return rowValue <= expectedValue;
    }
    return row[key] === expected;
  });
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  createMemoryDb,
  loadBootstrapService,
  loadGameService,
  loadRoomService,
};
