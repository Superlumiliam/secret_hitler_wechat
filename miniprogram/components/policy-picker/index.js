Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    cards: {
      type: Array,
      value: [],
    },
    mode: {
      type: String,
      value: 'discard_one',
    },
    canRequestVeto: {
      type: Boolean,
      value: false,
    },
    submitting: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '政策选择',
    },
  },
  data: {
    selectedIndex: -1,
  },
  observers: {
    visible(value) {
      if (!value) {
        this.setData({ selectedIndex: -1 });
      }
    },
  },
  methods: {
    selectCard(e) {
      const index = Number(e.currentTarget.dataset.index);
      this.setData({ selectedIndex: index });
      this.triggerEvent('select', { index, card: this.data.cards[index] });
    },
    confirmPick() {
      if (this.data.selectedIndex < 0) return;
      this.triggerEvent('confirmpick', {
        index: this.data.selectedIndex,
        card: this.data.cards[this.data.selectedIndex],
      });
    },
    requestVeto() {
      this.triggerEvent('requestveto', {});
    },
    cancel() {
      this.setData({ selectedIndex: -1 });
      this.triggerEvent('cancel');
    },
  },
});
