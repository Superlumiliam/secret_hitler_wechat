const assert = require("assert");
const { createMemoryDb, loadBootstrapService } = require("../helpers/loadGameService");

(async () => {
  const db = createMemoryDb();
  const { service } = loadBootstrapService({ db, openId: "openid_1" });
  const response = await service.main({
    action: "recoverActiveRoom",
    payload: {},
  });

  assert.strictEqual(response.success, true);
  assert.deepStrictEqual(response.data.user, { sessionReady: true });
  assert.strictEqual(response.data.activeRoom, null);
  console.log("bootstrap recovery tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
