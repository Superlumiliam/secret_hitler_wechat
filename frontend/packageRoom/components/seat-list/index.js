Component({
  options: {
    styleIsolation: "apply-shared",
  },
  properties: {
    assets: {
      type: Object,
      value: {},
    },
    seats: {
      type: Array,
      value: [],
    },
  },
  methods: {
    onTapSeat(event) {
      this.triggerEvent("tapseat", event.detail || {});
    },
    onTapAvatar(event) {
      this.triggerEvent("tapavatar", event.detail || {});
    },
    onTapIdentityMark(event) {
      this.triggerEvent("tapidentitymark", event.detail || {});
    },
  },
});
