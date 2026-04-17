Component({
  properties: {
    players: {
      type: Array,
      value: [],
    },
    title: {
      type: String,
      value: '座位',
    },
    subtitle: {
      type: String,
      value: '',
    },
    selectable: {
      type: Boolean,
      value: false,
    },
    selectedId: {
      type: String,
      value: '',
    },
    canReorder: {
      type: Boolean,
      value: false,
    },
    dangerIds: {
      type: Array,
      value: [],
    },
    emptyText: {
      type: String,
      value: '暂无座位信息',
    },
  },
  data: {
    renderPlayers: [],
  },
  observers: {
    players(players) {
      this.rebuild(players, this.data.dangerIds);
    },
    dangerIds(dangerIds) {
      this.rebuild(this.data.players, dangerIds);
    },
  },
  methods: {
    rebuild(players, dangerIds) {
      const dangerMap = {};
      (dangerIds || []).forEach((id) => {
        dangerMap[id] = true;
      });
      const renderPlayers = (players || []).map((player) =>
        Object.assign({}, player, { isDanger: !!dangerMap[player.memberId] })
      );
      this.setData({ renderPlayers });
    },
    onSelect(e) {
      this.triggerEvent('select', e.detail);
    },
    onMoveUp(e) {
      this.triggerEvent('moveup', e.detail);
    },
    onMoveDown(e) {
      this.triggerEvent('movedown', e.detail);
    },
  },
});
