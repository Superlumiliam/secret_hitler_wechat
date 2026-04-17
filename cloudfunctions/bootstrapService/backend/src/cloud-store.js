"use strict";

const { clone } = require("./utils");

const COLLECTIONS = {
  users: "user_profiles",
  rooms: "rooms",
  roomMembers: "room_members",
  games: "game_core",
  publicSnapshots: "room_public_snapshots",
  privateSnapshots: "player_private_snapshots",
  commandRecords: "command_records",
  events: "game_events"
};

class CloudDbStore {
  constructor(db, transaction = null) {
    this.db = db;
    this.transaction = transaction;
  }

  collection(name) {
    if (this.transaction) {
      return this.transaction.collection(name);
    }
    return this.db.collection(name);
  }

  async queryOne(collectionName, query) {
    const result = await this.collection(collectionName).where(query).limit(1).get();
    return clone(result.data[0] || null);
  }

  async queryMany(collectionName, query) {
    const result = await this.collection(collectionName).where(query).get();
    return clone(result.data || []);
  }

  async setDoc(collectionName, docId, data) {
    await this.collection(collectionName).doc(docId).set({
      data
    });
    return clone(data);
  }

  async getUser(openid) {
    return this.queryOne(COLLECTIONS.users, { _id: openid });
  }

  async saveUser(user) {
    return this.setDoc(COLLECTIONS.users, user.openid, {
      ...user,
      _id: user.openid
    });
  }

  async getRoom(roomId) {
    return this.queryOne(COLLECTIONS.rooms, { _id: roomId });
  }

  async getRoomByCode(roomCode) {
    return this.queryOne(COLLECTIONS.rooms, { roomCode });
  }

  async saveRoom(room) {
    return this.setDoc(COLLECTIONS.rooms, room.roomId, {
      ...room,
      _id: room.roomId
    });
  }

  async listRoomMembers(roomId) {
    return this.queryMany(COLLECTIONS.roomMembers, { roomId });
  }

  async getRoomMember(roomId, memberId) {
    return this.queryOne(COLLECTIONS.roomMembers, {
      roomId,
      memberId
    });
  }

  async getRoomMemberByOpenId(roomId, openid) {
    return this.queryOne(COLLECTIONS.roomMembers, {
      roomId,
      openid
    });
  }

  async saveRoomMember(member) {
    return this.setDoc(COLLECTIONS.roomMembers, `${member.roomId}:${member.memberId}`, {
      ...member,
      _id: `${member.roomId}:${member.memberId}`
    });
  }

  async saveRoomMembers(members) {
    for (const member of members) {
      await this.saveRoomMember(member);
    }
    return clone(members);
  }

  async getGame(roomId) {
    return this.queryOne(COLLECTIONS.games, { _id: roomId });
  }

  async saveGame(game) {
    return this.setDoc(COLLECTIONS.games, game.roomId, {
      ...game,
      _id: game.roomId
    });
  }

  async getPublicSnapshot(roomId) {
    return this.queryOne(COLLECTIONS.publicSnapshots, { _id: roomId });
  }

  async savePublicSnapshot(snapshot) {
    return this.setDoc(COLLECTIONS.publicSnapshots, snapshot.roomId, {
      ...snapshot,
      _id: snapshot.roomId
    });
  }

  async getPrivateSnapshot(roomId, memberId) {
    return this.queryOne(COLLECTIONS.privateSnapshots, {
      _id: `${roomId}:${memberId}`
    });
  }

  async savePrivateSnapshot(snapshot) {
    return this.setDoc(COLLECTIONS.privateSnapshots, `${snapshot.roomId}:${snapshot.memberId}`, {
      ...snapshot,
      _id: `${snapshot.roomId}:${snapshot.memberId}`
    });
  }

  async savePrivateSnapshots(snapshots) {
    for (const snapshot of snapshots) {
      await this.savePrivateSnapshot(snapshot);
    }
    return clone(snapshots);
  }

  async getCommandRecord(commandRecordId) {
    return this.queryOne(COLLECTIONS.commandRecords, { _id: commandRecordId });
  }

  async saveCommandRecord(record) {
    return this.setDoc(COLLECTIONS.commandRecords, record.commandRecordId, {
      ...record,
      _id: record.commandRecordId
    });
  }

  async listEvents(roomId) {
    return this.queryMany(COLLECTIONS.events, { roomId });
  }

  async appendEvents(roomId, events) {
    for (const event of events) {
      await this.setDoc(COLLECTIONS.events, event.eventId, {
        ...event,
        _id: event.eventId,
        roomId
      });
    }
    return this.listEvents(roomId);
  }

  async runTransaction(callback) {
    return this.db.runTransaction(async (transaction) => {
      const transactionalStore = new CloudDbStore(this.db, transaction);
      return callback(transactionalStore);
    }, 3);
  }
}

module.exports = {
  CloudDbStore,
  COLLECTIONS
};
