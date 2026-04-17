Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    masked: {
      type: Boolean,
      value: true,
    },
    title: {
      type: String,
      value: '私密信息',
    },
    content: {
      type: Object,
      value: null,
    },
    hint: {
      type: String,
      value: '',
    },
    ctaText: {
      type: String,
      value: '我已查看',
    },
  },
  methods: {
    reveal() {
      this.triggerEvent('reveal', {});
    },
    close() {
      this.triggerEvent('close', {});
    },
  },
});
