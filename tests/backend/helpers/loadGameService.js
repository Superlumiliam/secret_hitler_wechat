const Module = require("module");
const path = require("path");

function createMemoryDb(initialData = {}) {
  const collections = {};

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
        const id = data._id || `${name}_${ensureCollection(name).size + 1}`;
        ensureCollection(name).set(id, clone({ ...data, _id: id }));
        return { _id: id };
      },
    };
  }

  function docApi(name, id) {
    return {
      async get() {
        return { data: clone(ensureCollection(name).get(id)) };
      },
      async set({ data }) {
        ensureCollection(name).set(id, clone({ ...data, _id: id }));
        return {};
      },
      async update({ data }) {
        const collection = ensureCollection(name);
        const existing = collection.get(id) || { _id: id };
        collection.set(id, clone({ ...existing, ...data }));
        return {};
      },
    };
  }

  function queryApi(name, query, limitCount = null) {
    return {
      limit(nextLimitCount) {
        return queryApi(name, query, nextLimitCount);
      },
      async get() {
        let rows = Array.from(ensureCollection(name).values()).filter((row) => matchesQuery(row, query));
        if (Number.isInteger(limitCount)) {
          rows = rows.slice(0, limitCount);
        }
        return { data: clone(rows) };
      },
    };
  }

  return {
    command: {
      in(values) {
        return { $in: values };
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
      return await handler({ collection: collectionApi });
    },
    dump() {
      const result = {};
      Object.keys(collections).forEach((name) => {
        result[name] = Object.fromEntries(collections[name]);
      });
      return clone(result);
    },
  };
}

function loadGameService(options = {}) {
  const db = options.db || createMemoryDb();
  const openIdRef = { value: options.openId || "test_openid" };
  const gameServicePath = path.resolve(__dirname, "../../../cloudfunctions/gameService/index.js");
  const originalLoad = Module._load;

  delete require.cache[gameServicePath];
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
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    const service = require(gameServicePath);
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
  loadGameService,
};
