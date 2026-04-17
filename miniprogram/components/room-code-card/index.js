Component({
  properties: {
    roomCode: {
      type: String,
      value: '',
    },
    statusText: {
      type: String,
      value: '',
    },
    subtitle: {
      type: String,
      value: '',
    },
    copyText: {
      type: String,
      value: '复制房号',
    },
  },
  methods: {
    onCopy() {
      this.triggerEvent('copy', {
        roomCode: this.data.roomCode,
      });
    },
  },
});
