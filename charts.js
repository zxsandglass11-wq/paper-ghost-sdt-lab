/* Responsive SVG charts. Public API: PaperCharts.distribution/roc/outcomes/comparison. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    teal: 'var(--teal, #376b63)', blue: 'var(--blue, #49698c)', copper: 'var(--copper, #97663b)',
    ink: 'var(--ink, #202726)', muted: 'var(--muted, #61706a)', line: 'var(--line, #c8c9bd)', paper: 'var(--paper, #f7f3e8)'
  };
  let unique = 0;
  function math() { return root.PaperSDT; }
  function el(name, attributes, parent, text) {
    const node = document.createElementNS(NS, name);
    Object.keys(attributes || {}).forEach(function (key) { node.setAttribute(key, String(attributes[key])); });
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function label(svg, x, y, text, extra) {
    return el('text', Object.assign({ x: x, y: y, fill: C.ink, 'font-size': 13, 'font-family': 'inherit' }, extra), svg, text);
  }
  function line(svg, x1, y1, x2, y2, extra) {
    return el('line', Object.assign({ x1: x1, y1: y1, x2: x2, y2: y2, stroke: C.line, 'stroke-width': 1 }, extra), svg);
  }
  function frame(container, width, height, title, desc) {
    container.replaceChildren();
    const id = 'paper-chart-' + (++unique);
    const svg = el('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-labelledby': id + '-title ' + id + '-desc',
      width: '100%', style: 'display:block;overflow:visible' }, container);
    el('title', { id: id + '-title' }, svg, title);
    el('desc', { id: id + '-desc' }, svg, desc);
    return svg;
  }
  function pct(value) { return (100 * value).toFixed(1) + '%'; }
  function fixed(value) { return Number.isFinite(value) ? value.toFixed(2) : '—'; }
  function widthOf(container, max) { return Math.max(300, Math.min(max, container.clientWidth || max)); }
  function path(points) { return points.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' '); }
  function sample(start, end, n, fn) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push(fn(start + (end - start) * i / n));
    return out;
  }
  function bounded(value, min, max, fallback) { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function params(options) {
    return { d: bounded(options.dPrime, 0, 6, 2), c: bounded(options.criterion, -3, 3, 0), p: bounded(options.prior, 0, 1, 0.5) };
  }
  function accessibleTable(container, caption, headers, rows) {
    const table = document.createElement('table');
    table.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    const cap = document.createElement('caption'); cap.textContent = caption; table.appendChild(cap);
    const head = document.createElement('thead'), tr = document.createElement('tr');
    headers.forEach(function (value) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = value; tr.appendChild(th); });
    head.appendChild(tr); table.appendChild(head);
    const body = document.createElement('tbody');
    rows.forEach(function (row) { const rowNode = document.createElement('tr'); row.forEach(function (value) { const td = document.createElement('td'); td.textContent = value; rowNode.appendChild(td); }); body.appendChild(rowNode); });
    table.appendChild(body); container.appendChild(table);
  }

  /** Equal-variance Gaussian model: N(-d′/2,1), N(+d′/2,1), cutoff c. */
  function distribution(container, options) {
    const p = params(options), s = math().prediction(p.d, p.c, p.p);
    const width = widthOf(container, 680), compact = width < 500;
    const left = compact ? 24 : 54, right = width - 24;
    const svg = frame(container, width, compact ? 434 : 384, '理论证据分布与判断线',
      '两条曲线分行显示，横轴和密度尺度相同。无水印均值为负 d′/2，有水印均值为正 d′/2，标准差均为1。' +
      '判断线右侧回答有水印。命中率 ' + pct(s.hitRate) + '，虚报率 ' + pct(s.falseAlarmRate) + '。先验不改变这两个类别条件比例。');
    const lo = -6.5, hi = 6.5, x = function (v) { return left + (v - lo) / (hi - lo) * (right - left); };
    const y = function (base, v, mean) { return base - math().normalPDF(v - mean) * 218; };
    const defs = el('defs', {}, svg), hatchId = 'paper-hatch-' + unique;
    const pattern = el('pattern', { id: hatchId, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' }, defs);
    el('rect', { width: 6, height: 6, fill: C.copper, opacity: 0.12 }, pattern);
    line(pattern, 0, 0, 0, 6, { stroke: C.copper, opacity: 0.7, 'stroke-width': 1.5 });
    function area(base, mean, from, to, fill, opacity) {
      const points = [[x(from), base]].concat(sample(from, to, 130, function (v) { return [x(v), y(base, v, mean)]; }), [[x(to), base]]);
      el('path', { d: path(points) + ' Z', fill: fill, opacity: opacity || 1 }, svg);
    }
    label(svg, left, 25, '无水印 · 噪声分布', { 'font-weight': 600, fill: C.blue });
    label(svg, right, 25, '均值 −d′/2', { 'text-anchor': 'end', fill: C.muted, 'font-size': 12 });
    area(132, -p.d / 2, lo, p.c, C.blue, 0.22);
    area(132, -p.d / 2, p.c, hi, 'url(#' + hatchId + ')');
    line(svg, x(lo), 132, x(hi), 132);
    el('path', { d: path(sample(lo, hi, 260, function (v) { return [x(v), y(132, v, -p.d / 2)]; })), fill: 'none', stroke: C.blue, 'stroke-width': 2.5, 'stroke-dasharray': '7 3' }, svg);
    label(svg, left, 170, compact ? '有水印 · 信号 + 噪声' : '有水印 · 信号 + 噪声分布', { 'font-weight': 600, fill: C.teal });
    label(svg, right, compact ? 186 : 170, '均值 +d′/2', { 'text-anchor': 'end', fill: C.muted, 'font-size': 12 });
    area(277, p.d / 2, lo, p.c, 'url(#' + hatchId + ')');
    area(277, p.d / 2, p.c, hi, C.teal, 0.24);
    line(svg, x(lo), 277, x(hi), 277);
    el('path', { d: path(sample(lo, hi, 260, function (v) { return [x(v), y(277, v, p.d / 2)]; })), fill: 'none', stroke: C.teal, 'stroke-width': 2.5 }, svg);
    [132, 277].forEach(function (base) {
      line(svg, x(p.c), base - 102, x(p.c), base, { stroke: C.ink, 'stroke-width': 1.7 });
    });
    label(svg, x(p.c) + 7, 49, 'c = ' + fixed(p.c), { 'font-size': 12, 'font-weight': 600 });
    for (let tick = -6; tick <= 6; tick += 2) {
      line(svg, x(tick), 277, x(tick), 282);
      label(svg, x(tick), 298, String(tick), { 'text-anchor': 'middle', 'font-size': 12, fill: C.muted });
    }
    label(svg, right, 322, '证据强度 →', { 'text-anchor': 'end', 'font-size': 12, fill: C.muted });
    label(svg, left, compact ? 346 : 322, '线左：回答无　／　线右：回答有', { 'font-size': 12, fill: C.muted });
    const legendStart = compact ? 371 : 348, secondColumn = compact ? left : width / 2 + 10;
    label(svg, left, legendStart, 'CR 正确拒绝  ' + pct(1 - s.falseAlarmRate), { fill: C.blue, 'font-size': 13 });
    label(svg, secondColumn, compact ? legendStart + 20 : legendStart, 'FA 虚报  ' + pct(s.falseAlarmRate) + '  ▨', { fill: C.ink, 'font-size': 13 });
    label(svg, left, compact ? legendStart + 40 : legendStart + 25, 'M 漏报  ' + pct(1 - s.hitRate) + '  ▨', { fill: C.ink, 'font-size': 13 });
    label(svg, secondColumn, compact ? legendStart + 60 : legendStart + 25, 'H 命中  ' + pct(s.hitRate), { fill: C.teal, 'font-size': 13 });
    return svg;
  }

  /** Theory is a solid curve/circle; observed sessions are independent diamonds. */
  function roc(container, options) {
    const p = params(options), s = math().prediction(p.d, p.c, 0.5);
    const points = (options.points || []).filter(function (point) {
      return Number.isFinite(point.hitRate) && Number.isFinite(point.falseAlarmRate) && point.hitRate >= 0 && point.hitRate <= 1 && point.falseAlarmRate >= 0 && point.falseAlarmRate <= 1;
    }).slice(0, 3);
    const width = widthOf(container, 440), left = 54, right = width - 38, top = 30, bottom = top + right - left;
    const legendTop = bottom + 49;
    const svg = frame(container, width, legendTop + 22 + points.length * 25, '理论 ROC 与观测点',
      '横轴虚报率，纵轴命中率，均为0到1。实线是理论模型，圆点随 c 移动；菱形是玩家原始比例，不是整条实测曲线。' +
      points.map(function (point) { return point.label + '：命中率 ' + pct(point.hitRate) + '，虚报率 ' + pct(point.falseAlarmRate) + '。'; }).join(''));
    const x = function (v) { return left + v * (right - left); }, y = function (v) { return bottom - v * (bottom - top); };
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      line(svg, x(v), top, x(v), bottom, { opacity: v === 0 ? 1 : 0.45 });
      line(svg, left, y(v), right, y(v), { opacity: v === 0 ? 1 : 0.45 });
      label(svg, x(v), bottom + 20, v.toFixed(v === 0 || v === 1 ? 0 : 2), { 'text-anchor': 'middle', 'font-size': 11, fill: C.muted });
      label(svg, left - 10, y(v) + 4, v.toFixed(v === 0 || v === 1 ? 0 : 2), { 'text-anchor': 'end', 'font-size': 11, fill: C.muted });
    });
    line(svg, left, bottom, right, top, { stroke: C.muted, 'stroke-dasharray': '4 5', opacity: 0.6 });
    const curve = [[x(0), y(0)]].concat(sample(9, -9, 300, function (c) {
      return [x(math().normalCDF(-p.d / 2 - c)), y(math().normalCDF(p.d / 2 - c))];
    }), [[x(1), y(1)]]);
    el('path', { d: path(curve), stroke: C.teal, 'stroke-width': 2.5, fill: 'none' }, svg);
    const model = el('circle', { cx: x(s.falseAlarmRate), cy: y(s.hitRate), r: 6, fill: C.teal, stroke: C.paper, 'stroke-width': 2 }, svg);
    el('title', {}, model, '模型预测：虚报 ' + pct(s.falseAlarmRate) + '，命中 ' + pct(s.hitRate));
    label(svg, left, 16, '命中率', { 'font-size': 12, fill: C.muted });
    label(svg, right + 8, bottom + 38, '虚报率', { 'text-anchor': 'end', 'font-size': 12, fill: C.muted });
    line(svg, 24, legendTop, 48, legendTop, { stroke: C.teal, 'stroke-width': 2.5 });
    el('circle', { cx: 36, cy: legendTop, r: 4, fill: C.teal }, svg);
    label(svg, 60, legendTop + 5, '理论 · d′ = ' + fixed(p.d) + '，c = ' + fixed(p.c), { 'font-size': 12 });
    points.forEach(function (point, i) {
      const px = x(point.falseAlarmRate), py = y(point.hitRate), r = 7;
      const marker = el('path', { d: 'M' + px + ',' + (py - r) + ' l' + r + ',' + r + ' l-' + r + ',' + r + ' l-' + r + ',-' + r + ' Z', fill: C.paper, stroke: C.copper, 'stroke-width': 2 }, svg);
      el('title', {}, marker, point.label + '：虚报 ' + pct(point.falseAlarmRate) + '，命中 ' + pct(point.hitRate));
      if (points.length > 1) label(svg, px + 10, py - 7, String(i + 1), { fill: C.copper, 'font-size': 11 });
      label(svg, 36, legendTop + 30 + i * 25, '◇', { fill: C.copper, 'font-size': 18, 'text-anchor': 'middle' });
      label(svg, 60, legendTop + 30 + i * 25, (points.length > 1 ? (i + 1) + ' · ' : '') + String(point.label || '本局') + ' · 实际作答', { 'font-size': 12 });
    });
    accessibleTable(container, 'ROC 数据', ['来源', '虚报率', '命中率'], [['模型预测', pct(s.falseAlarmRate), pct(s.hitRate)]].concat(points.map(function (point) { return [point.label, pct(point.falseAlarmRate), pct(point.hitRate)]; })));
    return svg;
  }

  /** Expected weighted outcomes, scaled to 100 observations; not player records. */
  function outcomes(container, options) {
    const p = params(options), s = math().prediction(p.d, p.c, p.p);
    const values = [p.p * s.hitRate, p.p * (1 - s.hitRate), (1 - p.p) * s.falseAlarmRate, (1 - p.p) * (1 - s.falseAlarmRate)];
    const names = ['H 命中', 'M 漏报', 'FA 虚报', 'CR 正确拒绝'], colors = [C.teal, C.copper, C.copper, C.blue];
    const width = widthOf(container, 560), compact = width < 440, barLeft = compact ? 86 : 111, barWidth = width - barLeft - 82;
    const svg = frame(container, width, compact ? 270 : 249, '先验加权的四类结果',
      '每100次的理论期望，可能出现小数。' + names.map(function (name, i) { return name + (values[i] * 100).toFixed(1) + '次。'; }).join('') + '准确率 ' + pct(s.accuracy) + '。');
    label(svg, 0, 20, '每 100 次的理论期望', { 'font-size': 14, 'font-weight': 600 });
    label(svg, width - 8, 20, 'P(S) = ' + pct(p.p), { 'text-anchor': 'end', 'font-size': 12, fill: C.muted });
    values.forEach(function (value, i) {
      const yy = 47 + i * 37;
      label(svg, 0, yy + 16, names[i], { 'font-size': 13 });
      el('rect', { x: barLeft, y: yy, width: barWidth, height: 22, rx: 3, fill: C.line, opacity: 0.25 }, svg);
      el('rect', { x: barLeft, y: yy, width: value * barWidth, height: 22, rx: 3, fill: colors[i], opacity: i === 1 ? 0.55 : 0.85 }, svg);
      label(svg, width - 12, yy + 16, (value * 100).toFixed(1) + ' 次', { 'text-anchor': 'end', 'font-size': 13 });
    });
    label(svg, 0, 222, '预期准确率 ' + pct(s.accuracy), { 'font-size': 14, 'font-weight': 600, fill: C.teal });
    label(svg, 0, 246, compact ? '改变先验会改变四类数量。' : '改变先验会改变四类数量；固定 d′、c 时，命中率和虚报率不变。', { 'font-size': 12, fill: C.muted });
    if (compact) label(svg, 0, 266, '固定 d′、c 时，命中率和虚报率不变。', { 'font-size': 12, fill: C.muted });
    return svg;
  }

  /** Two or three selected sessions; each metric keeps one shared scale. */
  function comparison(container, sessions) {
    const data = (sessions || []).slice(0, 3).map(function (session, i) {
      return { label: (i + 1) + ' · ' + ({ standard: '标准', survey: '普查', confirm: '确认' }[session.config.mode] || '记录'),
        stats: math().summarize(session.trials, session.config.mode) };
    });
    const width = widthOf(container, 680), columns = width < 590 ? 1 : 2, panelWidth = width / columns;
    const svg = frame(container, width, columns === 1 ? 1230 : 615, '所选各局同尺度比较', '每个指标单独使用相同坐标范围，各局不作排名。负 d′ 与负 c 保留；c 越大，判断越谨慎。');
    if (!data.length) { label(svg, 20, 40, '选两局记录，再看它们的差别。'); return svg; }
    const metrics = [
      { key: 'dPrime', title: 'd′ 估计', min: -4, max: 4 },
      { key: 'criterion', title: 'c 估计', min: -3, max: 3 },
      { key: 'hitRate', title: '原始命中率', min: 0, max: 1, percent: true },
      { key: 'falseAlarmRate', title: '原始虚报率', min: 0, max: 1, percent: true },
      { key: 'accuracy', title: '准确率', min: 0, max: 1, percent: true },
      { key: 'cost', title: '代价点数', min: 0, max: 10 }
    ];
    const shapes = ['circle', 'diamond', 'square'];
    metrics.forEach(function (metric, index) {
      const ox = (index % columns) * panelWidth, oy = Math.floor(index / columns) * 205;
      const numbers = data.map(function (row) { return row.stats[metric.key]; }).filter(Number.isFinite);
      let min = metric.min, max = metric.max;
      if (!metric.percent) { min = Math.min(min, Math.floor(Math.min.apply(null, numbers))); max = Math.max(max, Math.ceil(Math.max.apply(null, numbers))); }
      if (metric.key === 'cost') max = Math.max(10, Math.ceil(max / 10) * 10);
      const x = function (v) { return ox + 73 + (v - min) / (max - min) * (panelWidth - 157); };
      label(svg, ox + 1, oy + 20, metric.title, { 'font-weight': 600, 'font-size': 14 });
      const yAxis = oy + 156;
      [min, (min + max) / 2, max].forEach(function (tick) {
        line(svg, x(tick), oy + 34, x(tick), yAxis, { opacity: 0.55 });
        label(svg, x(tick), yAxis + 20, metric.percent ? Math.round(tick * 100) + '%' : String(Number(tick.toFixed(1))), { 'text-anchor': 'middle', fill: C.muted, 'font-size': 11 });
      });
      line(svg, x(0), oy + 34, x(0), yAxis, { stroke: C.muted, opacity: 0.7, 'stroke-dasharray': '3 3' });
      data.forEach(function (row, i) {
        const value = row.stats[metric.key], yy = oy + 53 + i * 40, color = [C.teal, C.copper, C.blue][i];
        label(svg, ox + 1, yy + 4, row.label, { 'font-size': 12 });
        if (Number.isFinite(value)) {
          line(svg, x(0), yy, x(value), yy, { stroke: color, 'stroke-width': 2, opacity: 0.6 });
          if (shapes[i] === 'circle') el('circle', { cx: x(value), cy: yy, r: 5, fill: color }, svg);
          if (shapes[i] === 'diamond') el('path', { d: 'M' + x(value) + ',' + (yy - 6) + ' l6,6 l-6,6 l-6,-6 Z', fill: color }, svg);
          if (shapes[i] === 'square') el('rect', { x: x(value) - 5, y: yy - 5, width: 10, height: 10, fill: color }, svg);
        }
        label(svg, ox + panelWidth - 17, yy + 4, metric.percent ? pct(value) : fixed(value), { 'text-anchor': 'end', 'font-size': 12 });
      });
    });
    accessibleTable(container, '多局指标数据', ['局', 'd′估计', 'c估计', '命中率', '虚报率', '准确率', '代价'], data.map(function (row) {
      return [row.label, fixed(row.stats.dPrime), fixed(row.stats.criterion), pct(row.stats.hitRate), pct(row.stats.falseAlarmRate), pct(row.stats.accuracy), row.stats.cost];
    }));
    return svg;
  }

  root.PaperCharts = { distribution: distribution, roc: roc, outcomes: outcomes, comparison: comparison };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PaperCharts;
})(typeof globalThis !== 'undefined' ? globalThis : window);
