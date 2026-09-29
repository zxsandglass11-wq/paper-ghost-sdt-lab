/* 数学核心不依赖页面；浏览器与 Node 使用同一份计算。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PaperSDT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SQRT_2PI = Math.sqrt(2 * Math.PI);
  const COSTS = Object.freeze({ standard: [1, 1], survey: [4, 1], confirm: [1, 4] });

  function normalPDF(x) {
    return Math.exp(-0.5 * x * x) / SQRT_2PI;
  }

  // Abramowitz–Stegun 7.1.26; absolute CDF error is less than 8e-8.
  function normalCDF(x) {
    if (Number.isNaN(x)) return NaN;
    if (x === Infinity) return 1;
    if (x === -Infinity) return 0;
    if (x === 0) return 0.5;
    const z = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * z);
    const tail = (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t) * Math.exp(-z * z) / 2;
    return x < 0 ? tail : 1 - tail;
  }

  // Peter J. Acklam's rational approximation to Φ⁻¹(p).
  // Boundaries remain infinite mathematically; summarize() applies the count correction first.
  function inverseNormal(p) {
    if (!Number.isFinite(p) || p < 0 || p > 1) return NaN;
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
      138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
      66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const tail = 0.02425;
    if (p < tail || p > 1 - tail) {
      const q = Math.sqrt(-2 * Math.log(p < tail ? p : 1 - p));
      const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
        / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      return p < tail ? x : -x;
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function summarize(trials, mode = 'standard') {
    const counts = { H: 0, M: 0, FA: 0, CR: 0 };
    const times = [];
    for (const trial of Array.isArray(trials) ? trials : []) {
      if (!trial || typeof trial.signal !== 'boolean' || typeof trial.response !== 'boolean') continue;
      const category = trial.signal ? (trial.response ? 'H' : 'M') : (trial.response ? 'FA' : 'CR');
      counts[category] += 1;
      if (Number.isFinite(trial.responseMs) && trial.responseMs >= 0) times.push(trial.responseMs);
    }
    const ns = counts.H + counts.M;
    const nn = counts.FA + counts.CR;
    const n = ns + nn;
    const hitRate = ns ? counts.H / ns : null;
    const falseAlarmRate = nn ? counts.FA / nn : null;
    const correctedHitRate = ns ? (counts.H + 0.5) / (ns + 1) : null;
    const correctedFalseAlarmRate = nn ? (counts.FA + 0.5) / (nn + 1) : null;
    const zh = ns ? inverseNormal(correctedHitRate) : null;
    const zf = nn ? inverseNormal(correctedFalseAlarmRate) : null;
    const costs = COSTS[mode] || COSTS.standard;
    return {
      counts, n, ns, nn, hitRate, falseAlarmRate,
      accuracy: n ? (counts.H + counts.CR) / n : null,
      correctedHitRate, correctedFalseAlarmRate,
      dPrime: ns && nn ? zh - zf : null,
      criterion: ns && nn ? -(zh + zf) / 2 : null,
      meanResponseMs: times.length ? times.reduce((sum, time) => sum + time, 0) / times.length : null,
      cost: counts.M * costs[0] + counts.FA * costs[1]
    };
  }

  // Centered equal-variance model: N(-d/2, 1), N(+d/2, 1), decision boundary c.
  function prediction(dPrime, criterion, prior = 0.5) {
    if (![dPrime, criterion, prior].every(Number.isFinite) || prior < 0 || prior > 1) {
      throw new RangeError('模型参数须为有限数，先验概率须在 0 与 1 之间。');
    }
    const hitRate = normalCDF(dPrime / 2 - criterion);
    const falseAlarmRate = normalCDF(-dPrime / 2 - criterion);
    const H = prior * hitRate;
    const M = prior * (1 - hitRate);
    const FA = (1 - prior) * falseAlarmRate;
    const CR = (1 - prior) * (1 - falseAlarmRate);
    return { hitRate, falseAlarmRate, accuracy: H + CR, H, M, FA, CR };
  }

  // Mulberry32: a saved unsigned 32-bit seed reproduces a sequence, including seed 0.
  function createRng(seed) {
    let state = Number(seed) >>> 0;
    return function random() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Box–Muller transform. 1 - rng() excludes log(0) for this RNG's [0, 1) output.
  function normalRandom(rng = Math.random) {
    return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  }

  function makeTrials(count, prior, seed) {
    if (![20, 40, 80].includes(count) || ![0.25, 0.5, 0.75].includes(prior)) {
      throw new RangeError('试次数可选 20、40、80，先验概率可选 0.25、0.5、0.75。');
    }
    const rng = createRng(seed);
    const signalCount = Math.round(count * prior);
    const trials = Array.from({ length: count }, (_, index) => ({
      signal: index < signalCount,
      seed: Math.floor(rng() * 4294967296) >>> 0
    }));
    for (let i = trials.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [trials[i], trials[j]] = [trials[j], trials[i]];
    }
    return trials;
  }

  return Object.freeze({ normalPDF, normalCDF, inverseNormal, summarize, prediction,
    createRng, normalRandom, makeTrials, COSTS });
});
