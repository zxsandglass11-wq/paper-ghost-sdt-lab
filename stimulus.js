/* 合成纸页：数学场与屏幕渲染分开，避免把生成 d′误写成玩家的 d′。 */
(function (root, factory) {
  const math = typeof module === 'object' && module.exports ? require('./sdt.js') : root.PaperSDT;
  const api = factory(math);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PaperStimulus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SDT) {
  'use strict';

  const WIDTH = 40;
  const HEIGHT = 32;
  const BASE_RGB = [222, 214, 193];
  const NOISE_SD = 28;
  const ORTHOGONAL_NOISE_SCALE = 0.22;
  const OBSERVATION = Object.freeze({ x: 160, y: 98, width: 280, height: 224 });

  function buildTemplate() {
    const shape = new Float64Array(WIDTH * HEIGHT);
    let sum = 0;
    // A fixed crescent at the known center. Subpixel coverage makes its edge less jagged.
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        let coverage = 0;
        for (let sy = 0; sy < 4; sy += 1) {
          for (let sx = 0; sx < 4; sx += 1) {
            const dx = x + (sx + 0.5) / 4 - WIDTH / 2;
            const dy = y + (sy + 0.5) / 4 - HEIGHT / 2;
            if (dx * dx + dy * dy < 11.7 * 11.7
              && (dx - 5.6) * (dx - 5.6) + dy * dy > 10.7 * 10.7) coverage += 1;
          }
        }
        const value = coverage / 16;
        shape[y * WIDTH + x] = value;
        sum += value;
      }
    }
    const mean = sum / shape.length;
    let norm = 0;
    for (let i = 0; i < shape.length; i += 1) {
      shape[i] -= mean;
      norm += shape[i] * shape[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < shape.length; i += 1) shape[i] /= norm;
    return shape;
  }

  const template = buildTemplate();

  /**
   * With unit template t, z ~ N(0,1), and independent ε ~ N(0,I), the raw field is
   * X = (z + signal × d′gen)t + ρ[ε − (ε·t)t], where ρ = 0.22.
   * Thus X·t = z + signal × d′gen, exactly N(0,1) / N(d′gen,1).
   * The orthogonal residue preserves visible paper noise without burying the
   * shape under unnecessary high-dimensional pixel noise. Pixel noise is
   * CORRELATED Gaussian, with covariance ttᵀ + ρ²(I − ttᵀ), not IID.
   * A positive template value darkens the paper. As mean(t)=0, the signal
   * introduces no overall mean-luminance cue in the raw observation region.
   *
   * Display uses 8-bit RGB, clipping, and browser interpolation. Consequently,
   * the exact Gaussian statement describes this RAW FIELD, not monitor pixels
   * or human perception. clipping reports affected cells before rounding.
   */
  function generateField(seed, signal, dPrime) {
    if (typeof signal !== 'boolean' || !Number.isFinite(dPrime) || dPrime < 0 || dPrime > 20) {
      throw new RangeError('刺激需要布尔标签和 0–20 范围内的有限生成分离度。');
    }
    const rng = SDT.createRng(seed);
    const templateEvidence = SDT.normalRandom(rng) + (signal ? dPrime : 0);
    const epsilon = new Float64Array(template.length);
    let epsilonProjection = 0;
    for (let i = 0; i < epsilon.length; i += 1) {
      epsilon[i] = SDT.normalRandom(rng);
      epsilonProjection += epsilon[i] * template[i];
    }
    const values = new Float64Array(template.length);
    let evidence = 0;
    let clippedCells = 0;
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let i = 0; i < values.length; i += 1) {
      const value = templateEvidence * template[i]
        + ORTHOGONAL_NOISE_SCALE * (epsilon[i] - epsilonProjection * template[i]);
      values[i] = value;
      evidence += value * template[i];
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      if (BASE_RGB.some(channel => channel - NOISE_SD * value < 0 || channel - NOISE_SD * value > 255)) {
        clippedCells += 1;
      }
    }
    return { width: WIDTH, height: HEIGHT, values, template: template.slice(), evidence,
      model: { templateNoiseSD: 1, orthogonalNoiseScale: ORTHOGONAL_NOISE_SCALE },
      clipping: { count: clippedCells, fraction: clippedCells / values.length,
        baseRGB: BASE_RGB.slice(), noiseSD: NOISE_SD, minimum, maximum } };
  }

  function paperOutline(ctx) {
    ctx.beginPath();
    ctx.moveTo(51, 25);
    ctx.lineTo(546, 22);
    ctx.lineTo(550, 100);
    ctx.lineTo(546, 174);
    ctx.lineTo(552, 267);
    ctx.lineTo(548, 393);
    ctx.lineTo(423, 390);
    ctx.lineTo(333, 395);
    ctx.lineTo(226, 391);
    ctx.lineTo(52, 395);
    ctx.lineTo(49, 299);
    ctx.lineTo(53, 211);
    ctx.lineTo(48, 124);
    ctx.closePath();
  }

  function drawPaper(ctx, seed) {
    const backdrop = ctx.createLinearGradient(0, 0, 600, 420);
    backdrop.addColorStop(0, '#172f2e');
    backdrop.addColorStop(1, '#294540');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, 600, 420);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.34)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 9;
    paperOutline(ctx);
    ctx.fillStyle = '#ded6bc';
    ctx.fill();
    ctx.restore();
    paperOutline(ctx);
    ctx.save();
    ctx.clip();
    const paper = ctx.createRadialGradient(301, 205, 25, 301, 205, 327);
    paper.addColorStop(0, '#ded6c1');
    paper.addColorStop(0.63, '#e4dbc3');
    paper.addColorStop(1, '#c5b694');
    ctx.fillStyle = paper;
    ctx.fillRect(45, 20, 510, 380);
    const grain = SDT.createRng((seed ^ 0xF18E31A7) >>> 0);
    for (let i = 0; i < 1250; i += 1) {
      const x = 49 + grain() * 503;
      const y = 22 + grain() * 375;
      // Decorative fibres stay outside the observation area.
      if (x > 155 && x < 445 && y > 93 && y < 327) continue;
      ctx.strokeStyle = `rgba(101,79,48,${0.025 + grain() * 0.10})`;
      ctx.lineWidth = 0.35 + grain() * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 1 + grain() * 10, y - 1 + grain() * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(124,102,68,.12)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(86, 23);
    ctx.lineTo(82, 395);
    ctx.moveTo(513, 22);
    ctx.lineTo(518, 393);
    ctx.stroke();
    ctx.fillStyle = 'rgba(94,80,57,.40)';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillText('FOLIO / 01', 109, 58);
    ctx.textAlign = 'right';
    ctx.fillText('TRANSMITTED LIGHT', 494, 366);
    ctx.restore();
  }

  function registrationMarks(ctx) {
    const { x, y, width, height } = OBSERVATION;
    ctx.strokeStyle = 'rgba(95,85,64,.28)';
    ctx.lineWidth = 0.7;
    for (const [px, py, sx, sy] of [[x - 7, y - 7, 1, 1], [x + width + 7, y - 7, -1, 1],
      [x - 7, y + height + 7, 1, -1], [x + width + 7, y + height + 7, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(px, py + sy * 10);
      ctx.lineTo(px, py);
      ctx.lineTo(px + sx * 10, py);
      ctx.stroke();
    }
  }

  function paintField(ctx, field) {
    const work = ctx.canvas.ownerDocument.createElement('canvas');
    work.width = field.width;
    work.height = field.height;
    const small = work.getContext('2d');
    const pixels = small.createImageData(field.width, field.height);
    for (let i = 0; i < field.values.length; i += 1) {
      for (let ch = 0; ch < 3; ch += 1) pixels.data[i * 4 + ch] = BASE_RGB[ch] - NOISE_SD * field.values[i];
      pixels.data[i * 4 + 3] = 255;
    }
    small.putImageData(pixels, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const { x, y, width, height } = OBSERVATION;
    ctx.drawImage(work, x, y, width, height);
  }

  function draw(canvas, options = {}) {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { seed = 260929, signal = true, dPrime = 4, phase = 'preview' } = options;
    ctx.save();
    ctx.setTransform(canvas.width / 600, 0, 0, canvas.height / 420, 0, 0);
    drawPaper(ctx, seed);
    if (phase === 'preview') {
      // The introductory example teaches the target shape; it is not an experimental trial.
      paintField(ctx, { width: WIDTH, height: HEIGHT, values: template.map(value => value * 14) });
    } else if (phase === 'sample') {
      paintField(ctx, generateField(seed, signal, dPrime));
    } else if (phase === 'mask') {
      // Independent mask: neither its appearance nor texture depends on the hidden label.
      paintField(ctx, generateField((seed ^ 0xDE71C7ED) >>> 0, false, 0));
      ctx.fillStyle = 'rgba(227,218,195,.65)';
      ctx.fillRect(OBSERVATION.x, OBSERVATION.y, OBSERVATION.width, OBSERVATION.height);
    } else {
      ctx.strokeStyle = '#7d7764';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(293, 210);
      ctx.lineTo(307, 210);
      ctx.moveTo(300, 203);
      ctx.lineTo(300, 217);
      ctx.stroke();
    }
    registrationMarks(ctx);
    ctx.restore();
  }

  return Object.freeze({ draw, generateField, WIDTH, HEIGHT, OBSERVATION, ORTHOGONAL_NOISE_SCALE });
});
