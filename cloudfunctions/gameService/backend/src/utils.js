"use strict";

const crypto = require("node:crypto");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hashPayload(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function createRequestId() {
  return generateId("req");
}

function normalizeDisplayName(value) {
  return String(value || "").trim();
}

function nowIso(nowProvider) {
  return (nowProvider ? nowProvider() : new Date()).toISOString();
}

function generateRoomCode(randomProvider) {
  const digits = [];
  for (let index = 0; index < 6; index += 1) {
    digits.push(String(randomProvider.randomInt(10)));
  }
  return digits.join("");
}

function sortMembersBySeat(members) {
  return [...members].sort((left, right) => left.seatIndex - right.seatIndex || left.memberId.localeCompare(right.memberId));
}

function unique(items) {
  return [...new Set(items)];
}

module.exports = {
  clone,
  createRequestId,
  generateId,
  generateRoomCode,
  hashPayload,
  normalizeDisplayName,
  nowIso,
  sortMembersBySeat,
  stableStringify,
  unique
};
