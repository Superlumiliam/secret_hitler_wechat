"use strict";

const { clone } = require("./utils");

class InMemoryStore {
  constructor(seedData = {}) {
    this.users = clone(seedData.users) || {};
    this.rooms = clone(seedData.rooms) || {};
    this.roomMembers = clone(seedData.roomMembers) || {};
    this.games = clone(seedData.games) || {};
    this.publicSnapshots = clone(seedData.publicSnapshots) || {};
    this.privateSnapshots = clone(seedData.privateSnapshots) || {};
    this.commandRecords = clone(seedData.commandRecords) || {};
    this.events = clone(seedData.events) || {};
  }

  async getUser(openid) {
    return clone(this.users[openid] || null);
  }

  async saveUser(user) {
    this.users[user.openid] = clone(user);
    return clone(user);
  }

  async getRoom(roomId) {
    return clone(this.rooms[roomId] || null);
  }

  async getRoomByCode(roomCode) {
    const room = Object.values(this.rooms).find((item) => item.roomCode === roomCode);
    return clone(room || null);
  }

  async saveRoom(room) {
    this.rooms[room.roomId] = clone(room);
    return clone(room);
  }

  async listRoomMembers(roomId) {
    return clone(
      Object.values(this.roomMembers)
        .filter((member) => member.roomId === roomId)
    );
  }

  async getRoomMember(roomId, memberId) {
    const key = `${roomId}:${memberId}`;
    return clone(this.roomMembers[key] || null);
  }

  async getRoomMemberByOpenId(roomId, openid) {
    const member = Object.values(this.roomMembers).find((item) => item.roomId === roomId && item.openid === openid);
    return clone(member || null);
  }

  async saveRoomMember(member) {
    this.roomMembers[`${member.roomId}:${member.memberId}`] = clone(member);
    return clone(member);
  }

  async saveRoomMembers(members) {
    members.forEach((member) => {
      this.roomMembers[`${member.roomId}:${member.memberId}`] = clone(member);
    });
    return clone(members);
  }

  async getGame(roomId) {
    return clone(this.games[roomId] || null);
  }

  async saveGame(game) {
    this.games[game.roomId] = clone(game);
    return clone(game);
  }

  async getPublicSnapshot(roomId) {
    return clone(this.publicSnapshots[roomId] || null);
  }

  async savePublicSnapshot(snapshot) {
    this.publicSnapshots[snapshot.roomId] = clone(snapshot);
    return clone(snapshot);
  }

  async getPrivateSnapshot(roomId, memberId) {
    return clone(this.privateSnapshots[`${roomId}:${memberId}`] || null);
  }

  async savePrivateSnapshot(snapshot) {
    this.privateSnapshots[`${snapshot.roomId}:${snapshot.memberId}`] = clone(snapshot);
    return clone(snapshot);
  }

  async savePrivateSnapshots(snapshots) {
    snapshots.forEach((snapshot) => {
      this.privateSnapshots[`${snapshot.roomId}:${snapshot.memberId}`] = clone(snapshot);
    });
    return clone(snapshots);
  }

  async getCommandRecord(commandRecordId) {
    return clone(this.commandRecords[commandRecordId] || null);
  }

  async saveCommandRecord(record) {
    this.commandRecords[record.commandRecordId] = clone(record);
    return clone(record);
  }

  async listEvents(roomId) {
    return clone(this.events[roomId] || []);
  }

  async appendEvents(roomId, events) {
    this.events[roomId] = [...(this.events[roomId] || []), ...clone(events)];
    return clone(this.events[roomId]);
  }

  async runTransaction(callback) {
    return callback(this);
  }
}

module.exports = {
  InMemoryStore
};
