Component({
  options: {
    styleIsolation: "apply-shared",
  },
  properties: {
    assets: {
      type: Object,
      value: {},
    },
    activePowerTipSlot: {
      type: Number,
      value: 0,
    },
    count: {
      type: Number,
      value: 0,
    },
    faction: {
      type: String,
      value: "liberal",
    },
    showProgress: {
      type: Boolean,
      value: true,
    },
    slots: {
      type: Array,
      value: [],
    },
    total: {
      type: Number,
      value: 0,
    },
  },
  methods: {
    onTogglePowerTip(event) {
      this.triggerEvent("togglepowertip", {
        slot: Number(event.currentTarget.dataset.slot) || 0,
      });
    },
  },
});
