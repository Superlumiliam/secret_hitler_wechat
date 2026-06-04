Component({
  options: {
    styleIsolation: "apply-shared",
  },
  properties: {
    piles: {
      type: Array,
      value: [],
    },
    canPreviewDrawPile: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    onTapPileCard(event) {
      if (event.currentTarget.dataset.key !== "draw" || !this.properties.canPreviewDrawPile) {
        return;
      }
      this.triggerEvent("tapdraw");
    },
  },
});
