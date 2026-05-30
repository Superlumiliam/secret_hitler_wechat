Component({
  options: {
    styleIsolation: "apply-shared",
  },
  properties: {
    assets: {
      type: Object,
      value: {},
    },
    electionTracker: {
      type: Number,
      value: 0,
    },
    slots: {
      type: Array,
      value: [],
    },
  },
});
