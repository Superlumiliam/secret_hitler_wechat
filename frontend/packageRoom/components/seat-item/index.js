Component({
  options: {
    styleIsolation: "apply-shared",
  },
  properties: {
    assets: {
      type: Object,
      value: {},
    },
    seat: {
      type: Object,
      value: {},
    },
  },
  methods: {
    onTapSeat() {
      this.triggerEvent("tapseat", {
        memberId: this.data.seat.memberId || "",
      });
    },
    onTapAvatar() {
      this.triggerEvent("tapavatar", {
        memberId: this.data.seat.memberId || "",
        isSelf: Boolean(this.data.seat.isSelf),
      });
    },
    onTapIdentityMark() {
      this.triggerEvent("tapidentitymark", {
        memberId: this.data.seat.memberId || "",
        canChange: Boolean(this.data.seat.canChangeIdentityMark),
      });
    },
  },
});
