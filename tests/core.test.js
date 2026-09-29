'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SDT = require('../sdt.js');
const Stimulus = require('../stimulus.js');

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected} ± ${tolerance}`);
}
function answers(H, M, FA, CR) {
  return [[H, true, true], [M, true, false], [FA, false, true], [CR, false, false]]
    .flatMap(([count, signal, response]) => Array.from({ length: count }, () => ({ signal, response, responseMs: 500 })));
}

test('normal CDF, density, and inverse match known reference values', () => {
  near(SDT.normalCDF(0), 0.5);
  near(SDT.normalPDF(0), 0.3989422804014327);
  near(SDT.normalCDF(1.96), 0.9750021048517795);
  near(SDT.normalCDF(-1), 0.15865525393145707);
  near(SDT.inverseNormal(0.975), 1.959963984540054);
  near(SDT.inverseNormal(0.001), -3.090232306167813);
  for (const p of [0.00001, 0.001, 0.01, 0.1, 0.5, 0.75, 0.975, 0.99999]) {
    near(SDT.normalCDF(SDT.inverseNormal(p)), p);
  }
  assert.equal(SDT.normalCDF(-Infinity), 0);
  assert.equal(SDT.normalCDF(Infinity), 1);
  assert.equal(SDT.inverseNormal(0), -Infinity);
  assert.equal(SDT.inverseNormal(1), Infinity);
  assert.ok(Number.isNaN(SDT.inverseNormal(-0.1)));
});

test('known counts use raw rates for reporting and corrected rates for d′ / c', () => {
  const result = SDT.summarize(answers(15, 5, 4, 16));
  assert.deepEqual(result.counts, { H: 15, M: 5, FA: 4, CR: 16 });
  assert.equal(result.n, 40);
  assert.equal(result.ns, 20);
  assert.equal(result.nn, 20);
  near(result.hitRate, 0.75);
  near(result.falseAlarmRate, 0.2);
  near(result.accuracy, 0.775);
  near(result.correctedHitRate, 15.5 / 21);
  near(result.correctedFalseAlarmRate, 4.5 / 21);
  // Independently checked with Python statistics.NormalDist.inv_cdf.
  near(result.dPrime, 1.4291227687057515);
  near(result.criterion, 0.07707722339049872);
  assert.equal(result.cost, 9);
  assert.equal(SDT.summarize(answers(15, 5, 4, 16), 'survey').cost, 24);
  assert.equal(SDT.summarize(answers(15, 5, 4, 16), 'confirm').cost, 21);
});

test('perfect, all-yes, all-no and inverted results stay finite; negative d′ is preserved', () => {
  const perfect = SDT.summarize(answers(10, 0, 0, 10));
  near(perfect.correctedHitRate, 10.5 / 11);
  near(perfect.correctedFalseAlarmRate, 0.5 / 11);
  assert.ok(Number.isFinite(perfect.dPrime));
  near(perfect.criterion, 0);
  for (const counts of [[10, 0, 10, 0], [0, 10, 0, 10]]) {
    const result = SDT.summarize(answers(...counts));
    near(result.dPrime, 0);
    assert.ok(Number.isFinite(result.criterion));
  }
  const inverted = SDT.summarize(answers(0, 10, 10, 0));
  near(inverted.dPrime, -perfect.dPrime);
  assert.ok(inverted.dPrime < 0);
});

test('missing classes remain null; malformed responses never become yes or no', () => {
  const empty = SDT.summarize([]);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.dPrime, null);
  assert.equal(empty.criterion, null);
  const oneClass = SDT.summarize([{ signal: true, response: false, responseMs: 700 }]);
  assert.equal(oneClass.hitRate, 0);
  assert.equal(oneClass.falseAlarmRate, null);
  assert.equal(oneClass.correctedFalseAlarmRate, null);
  assert.equal(oneClass.dPrime, null);
  const mixed = SDT.summarize([...answers(1, 1, 1, 1), null,
    { signal: true, response: null }, { signal: 'false', response: true },
    { signal: false, response: false, responseMs: Infinity }]);
  assert.equal(mixed.n, 5);
  assert.equal(mixed.meanResponseMs, 500);
});

test('prediction links c and ROC while prior changes only weighted outcomes', () => {
  const centered = SDT.prediction(2, 0, 0.5);
  near(centered.hitRate, 0.841344746);
  near(centered.falseAlarmRate, 0.158655254);
  const cautious = SDT.prediction(2, 1, 0.5);
  assert.ok(cautious.hitRate < centered.hitRate);
  assert.ok(cautious.falseAlarmRate < centered.falseAlarmRate);
  const differentPrior = SDT.prediction(2, 1, 0.25);
  near(differentPrior.hitRate, cautious.hitRate);
  near(differentPrior.falseAlarmRate, cautious.falseAlarmRate);
  near(differentPrior.H + differentPrior.M + differentPrior.FA + differentPrior.CR, 1);
  near(SDT.prediction(0, -1).hitRate, SDT.prediction(0, -1).falseAlarmRate);
});

test('trial plans preserve exact quotas and deterministic unsigned seeds', () => {
  for (const count of [20, 40, 80]) {
    for (const prior of [0.25, 0.5, 0.75]) {
      const trials = SDT.makeTrials(count, prior, 0);
      assert.equal(trials.length, count);
      assert.equal(trials.filter(trial => trial.signal).length, count * prior);
      assert.deepEqual(trials, SDT.makeTrials(count, prior, 0));
      assert.notDeepEqual(trials, SDT.makeTrials(count, prior, 1));
      assert.ok(trials.every(trial => Number.isInteger(trial.seed) && trial.seed >= 0 && trial.seed <= 0xFFFFFFFF));
    }
  }
  assert.throws(() => SDT.makeTrials(6, 0.5, 1), RangeError);
});

test('crescent is zero-mean unit norm and generated signal has no DC cue', () => {
  const no = Stimulus.generateField(15, false, 4);
  const yes = Stimulus.generateField(15, true, 4);
  near(no.template.reduce((sum, value) => sum + value, 0), 0, 1e-12);
  near(no.template.reduce((sum, value) => sum + value * value, 0), 1, 1e-12);
  near(yes.evidence - no.evidence, 4, 1e-12);
  near(yes.values.reduce((sum, value, i) => sum + value - no.values[i], 0), 0, 1e-10);
  assert.deepEqual(yes.values, Stimulus.generateField(15, true, 4).values);
  assert.equal(yes.clipping.fraction, yes.clipping.count / yes.values.length);
});

test('Monte Carlo projection obeys the declared Gaussian mean / variance model', () => {
  const count = 2500;
  const means = [0, 0];
  const squares = [0, 0];
  for (let i = 0; i < count; i += 1) {
    for (let s = 0; s < 2; s += 1) {
      const field = Stimulus.generateField((i * 65537 + s * 31847) >>> 0, Boolean(s), 4);
      means[s] += field.evidence;
      squares[s] += field.evidence * field.evidence;
    }
  }
  for (let s = 0; s < 2; s += 1) {
    means[s] /= count;
    const variance = squares[s] / count - means[s] * means[s];
    near(means[s], s * 4, 0.07);
    near(variance, 1, 0.1);
  }
  near(means[1] - means[0], 4, 0.10);
});

test('orthogonal paper noise has reduced variance without altering decision evidence', () => {
  const count = 300;
  let residualEnergy = 0;
  let clipped = 0;
  for (let seed = 0; seed < count; seed += 1) {
    const field = Stimulus.generateField(seed * 7919, true, 6);
    let residualProjection = 0;
    for (let i = 0; i < field.values.length; i += 1) {
      const residue = field.values[i] - field.evidence * field.template[i];
      residualEnergy += residue * residue;
      residualProjection += residue * field.template[i];
    }
    near(residualProjection, 0, 1e-11);
    clipped += field.clipping.fraction;
    assert.equal(field.model.orthogonalNoiseScale, 0.22);
  }
  near(residualEnergy / (count * (Stimulus.WIDTH * Stimulus.HEIGHT - 1)), 0.22 ** 2, 0.001);
  assert.ok(clipped / count < 0.001, 'Display clipping should affect fewer than 0.1% of sample cells.');
});
