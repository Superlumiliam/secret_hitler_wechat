"use strict";

class RandomProvider {
  shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.randomInt(index + 1);
      const current = result[index];
      result[index] = result[swapIndex];
      result[swapIndex] = current;
    }
    return result;
  }

  randomInt(maxExclusive) {
    return Math.floor(Math.random() * maxExclusive);
  }
}

class FixedRandomProvider extends RandomProvider {
  constructor(seed = 1) {
    super();
    this.seed = seed >>> 0;
  }

  randomInt(maxExclusive) {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed % maxExclusive;
  }
}

module.exports = {
  FixedRandomProvider,
  RandomProvider
};
