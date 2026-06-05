const assert = require("assert");
const { createMemoryDb, loadGameService, loadRoomService } = require("./helpers/loadGameService");

async function assertDeterministicCommandRecords(loadService, scopeKey, requesterOpenId) {
  const legacyResponse = { success: true, data: { source: "legacy" } };
  const db = createMemoryDb({
    command_records: {
      legacy_random_id: {
        _id: "legacy_random_id",
        scopeKey,
        commandId: "legacy_command",
        requesterOpenId,
        payloadHash: "legacy_hash",
        response: legacyResponse,
      },
    },
  });
  const { service } = loadService({ db, openId: requesterOpenId });
  const hooks = service.__testHooks;
  assert.strictEqual(hooks.isDocumentNotFoundError({ errCode: -502005 }), true);
  assert.strictEqual(hooks.isDocumentNotFoundError({ code: "DATABASE_DOCUMENT_NOT_EXIST" }), true);
  assert.strictEqual(hooks.isDocumentNotFoundError({ errMsg: "document does not exist" }), true);

  const freshCommandId = `cmd_new_${hooks.COMMAND_RECORD_DIRECT_ID_ENABLED_AT + 1}_fresh`;
  assert.strictEqual(hooks.getCommandTimestamp(freshCommandId), hooks.COMMAND_RECORD_DIRECT_ID_ENABLED_AT + 1);
  assert.strictEqual(hooks.shouldQueryLegacyCommandRecord(freshCommandId), false);
  const statsBeforeFreshMiss = db.stats();
  assert.strictEqual(await hooks.getCommandRecord(scopeKey, freshCommandId), null);
  assert.strictEqual(
    db.stats().queryGets.command_records || 0,
    statsBeforeFreshMiss.queryGets.command_records || 0,
    "new command direct miss should not execute legacy where query",
  );

  const directResponse = { success: true, data: { source: "direct" } };
  await hooks.saveCommandRecord(scopeKey, "direct_command", "direct_hash", directResponse, requesterOpenId);
  const stableId = hooks.getCommandRecordId(scopeKey, "direct_command");
  assert.match(stableId, /^cmd_[a-f0-9]{64}$/, "stable command record id should be document-safe");
  assert.strictEqual(db.dump().command_records[stableId].commandId, "direct_command");
  assert.strictEqual(db.stats().adds.command_records || 0, 0, "new command records should not use random add ids");

  const statsBeforeDirectRead = db.stats();
  const directRecord = await hooks.getCommandRecord(scopeKey, "direct_command");
  const statsAfterDirectRead = db.stats();
  assert.deepStrictEqual(directRecord.response, directResponse);
  assert.strictEqual(
    statsAfterDirectRead.queryGets.command_records || 0,
    statsBeforeDirectRead.queryGets.command_records || 0,
    "direct record hit should avoid where query",
  );

  const legacyRecord = await hooks.getCommandRecord(scopeKey, "legacy_command");
  assert.deepStrictEqual(legacyRecord.response, legacyResponse, "legacy random-id record should remain readable");
  assert.strictEqual(
    db.stats().queryGets.command_records,
    (statsAfterDirectRead.queryGets.command_records || 0) + 1,
    "missing direct record should fall back to one legacy query",
  );

  const oldTimestampCommandId = `cmd_old_${hooks.COMMAND_RECORD_DIRECT_ID_ENABLED_AT}_legacy`;
  assert.strictEqual(hooks.shouldQueryLegacyCommandRecord(oldTimestampCommandId), true);
  assert.strictEqual(hooks.shouldQueryLegacyCommandRecord("unparseable_command"), true);
  assert.strictEqual(
    hooks.shouldQueryLegacyCommandRecord(`not_cmd_${hooks.COMMAND_RECORD_DIRECT_ID_ENABLED_AT + 1}_future`),
    true,
  );
  const oldTimestampResponse = { success: true, data: { source: "old-timestamp-legacy" } };
  await db.collection("command_records").doc("legacy_old_timestamp_random_id").set({
    data: {
      scopeKey,
      commandId: oldTimestampCommandId,
      requesterOpenId,
      payloadHash: "old_timestamp_hash",
      response: oldTimestampResponse,
    },
  });
  const oldTimestampRecord = await hooks.getCommandRecord(scopeKey, oldTimestampCommandId);
  assert.deepStrictEqual(
    oldTimestampRecord.response,
    oldTimestampResponse,
    "command at or before module enable time should still read legacy random-id record",
  );
}

(async () => {
  await assertDeterministicCommandRecords(loadRoomService, "user:host_openid", "host_openid");
  await assertDeterministicCommandRecords(loadGameService, "room:room_1", "host_openid");
  console.log("command record performance tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
