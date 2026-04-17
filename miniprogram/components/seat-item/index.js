Component({
  properties: {
    player: {
      type: Object,
      value: null,
    },
    selectable: {
      type: Boolean,
      value: false,
    },
    selected: {
      type: Boolean,
      value: false,
    },
    canMoveUp: {
      type: Boolean,
      value: false,
    },
    canMoveDown: {
      type: Boolean,
      value: false,
    },
    danger: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    onSelect() {
      if (!this.data.selectable || !this.data.player) return;
      this.triggerEvent('select', this.data.player);
    },
    onMoveUp() {
      if (!this.data.player) return;
      this.triggerEvent('moveup', this.data.player);
    },
    onMoveDown() {
      if (!this.data.player) return;
      this.triggerEvent('movedown', this.data.player);
    },
  },
});
