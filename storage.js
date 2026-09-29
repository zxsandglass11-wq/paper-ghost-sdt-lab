/* Local records and portable exports. Browser: PaperStore; Node: require('./storage'). */
(function (root) {
  'use strict';

  const KEY = 'paper-ghost.sessions.v1';
  const MAX_SESSIONS = 30;
  const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
  let memory = [];
  const modes = { standard: '日常观察', survey: '线索普查', confirm: '证据确认' };

  function fail(message) { throw new Error(message); }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function uint(value) { return Number.isInteger(value) && value >= 0 && value <= 0xffffffff; }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function shortText(value, label) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) {
      fail(label + '格式不正确。');
    }
    return value;
  }

  // Copy allowed fields only. In particular, imported scores never enter the app.
  function normalizeSession(input, index) {
    const label = '第 ' + (index + 1) + ' 局：';
    if (!object(input)) fail(label + '记录格式不正确。');
    const id = shortText(input.id, label + '编号');
    if (typeof input.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.createdAt)) {
      fail(label + '日期须为 UTC ISO 格式。');
    }
    const date = new Date(input.createdAt);
    if (!Number.isFinite(date.getTime())) fail(label + '日期无效。');
    // Reject impossible calendar dates, which Date would otherwise roll forward.
    if (date.toISOString().slice(0, 19) !== input.createdAt.slice(0, 19)) fail(label + '日期无效。');
    const c = input.config;
    if (!object(c) || ![20, 40, 80].includes(c.count) || ![0.25, 0.5, 0.75].includes(c.prior) ||
        ![2, 4, 6].includes(c.dPrime) || !Object.hasOwn(modes, c.mode) || c.exposureMs !== 1000) {
      fail(label + '实验参数不在支持的范围内。');
    }
    if (input.practice !== false) fail(label + '只能导入已完成的正式局。');
    if (!uint(input.seed)) fail(label + '随机种子无效。');
    if (!Array.isArray(input.trials) || input.trials.length !== c.count) fail(label + '试次数与设置不一致。');
    let signalCount = 0;
    const trials = input.trials.map(function (t, i) {
      if (!object(t) || typeof t.signal !== 'boolean' || typeof t.response !== 'boolean' ||
          !finite(t.responseMs) || t.responseMs < 0 || t.responseMs > Number.MAX_SAFE_INTEGER || !uint(t.seed)) {
        fail(label + '第 ' + (i + 1) + ' 次作答格式不正确。');
      }
      signalCount += Number(t.signal);
      return { signal: t.signal, response: t.response, responseMs: t.responseMs, seed: t.seed };
    });
    if (signalCount !== c.count * c.prior) fail(label + '有水印样本数量与先验设置不一致。');
    const result = {
      id: id, createdAt: date.toISOString(),
      config: { count: c.count, prior: c.prior, dPrime: c.dPrime, mode: c.mode, exposureMs: c.exposureMs },
      trials: trials, seed: input.seed, practice: false
    };
    if (input.challengeId !== undefined) result.challengeId = shortText(input.challengeId, label + '挑战编号');
    if (input.device !== undefined) {
      const d = input.device;
      if (!object(d) || !finite(d.width) || !finite(d.height) || !finite(d.dpr) ||
          d.width <= 0 || d.height <= 0 || d.dpr <= 0 || d.width > 100000 || d.height > 100000 || d.dpr > 100) {
        fail(label + '设备记录无效。');
      }
      result.device = { width: d.width, height: d.height, dpr: d.dpr };
    }
    return result;
  }

  function normalizeAll(input) {
    if (!Array.isArray(input)) fail('记录应当是一个数组。');
    if (input.length > MAX_SESSIONS) fail('一次最多导入 ' + MAX_SESSIONS + ' 局。');
    const ids = new Set();
    return input.map(function (session, index) {
      const item = normalizeSession(session, index);
      if (ids.has(item.id)) fail('文件中有重复的局编号。');
      ids.add(item.id);
      return item;
    });
  }

  /** Validate a JSON export or a plain session array. Throws a readable error. */
  function parseImport(text) {
    if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) fail('文件为空或超过 3 MB。');
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch (_) { fail('无法读取 JSON，请选择从本页导出的记录文件。'); }
    if (Array.isArray(parsed)) return normalizeAll(parsed);
    if (!object(parsed) || parsed.format !== 'paper-ghost' || parsed.version !== 1) fail('不是支持的纸上幽灵记录文件。');
    return normalizeAll(parsed.sessions);
  }

  /** Create a versioned JSON export; derived statistics are deliberately omitted. */
  function serialize(sessions) {
    return JSON.stringify({ format: 'paper-ghost', version: 1, sessions: normalizeAll(sessions) }, null, 2);
  }

  /** Read validated completed sessions. Disabled/corrupt storage is non-fatal. */
  function load() {
    try {
      const store = root.localStorage;
      if (!store) throw new Error('unavailable');
      const text = store.getItem(KEY);
      if (text === null) {
        // Some browsers expose getItem but prohibit writing, particularly at file://.
        const probe = KEY + '.probe';
        store.setItem(probe, '1');
        store.removeItem(probe);
        return { sessions: memory.slice(), persistent: true };
      }
      memory = parseImport(text);
      return { sessions: memory.slice(), persistent: true };
    } catch (_) {
      return { sessions: memory.slice(), persistent: false, error: '本地记录暂时无法读取。新记录会留在本次打开的页面里，请用导出保存。' };
    }
  }

  /** Keep the first 30 sessions (callers supply newest first). Always retain memory. */
  function save(sessions) {
    let normalized;
    try {
      if (!Array.isArray(sessions)) fail('记录应当是一个数组。');
      normalized = normalizeAll(sessions.slice(0, MAX_SESSIONS));
    } catch (error) { return { persistent: false, error: error.message }; }
    memory = normalized;
    try {
      if (!root.localStorage) throw new Error('unavailable');
      root.localStorage.setItem(KEY, serialize(memory));
      return { persistent: true };
    } catch (_) {
      return { persistent: false, error: '浏览器未能保存记录。记录仍在当前页面，请在关闭前导出。' };
    }
  }

  function cell(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    // Text identifiers must not become formulas when the CSV is opened in a sheet.
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  /** UTF-8 BOM CSV, one row per trial plus freshly recomputed session statistics. */
  function csv(sessions) {
    const data = normalizeAll(sessions);
    const math = root.PaperSDT || (typeof require === 'function' ? require('./sdt.js') : null);
    if (!math) fail('统计模块尚未载入。');
    const headers = ['局编号', '完成时间UTC', '工作要求', '试次数', '先验P(S)', '生成d′', '呈现时长ms',
      '挑战编号', '局随机种子', '屏幕宽', '屏幕高', '像素倍率', '试次', '真实有水印', '回答有水印',
      '四类结果', '作答用时ms', '试次随机种子', '命中H', '漏报M', '虚报FA', '正确拒绝CR',
      '原始命中率', '原始虚报率', '准确率', '修正命中率', '修正虚报率', '估计d′', '估计c', '平均作答用时ms', '代价点数'];
    const rows = [headers];
    data.forEach(function (session) {
      const c = session.config;
      const d = session.device || {};
      const s = math.summarize(session.trials, c.mode);
      session.trials.forEach(function (t, i) {
        const outcome = t.signal ? (t.response ? 'H 命中' : 'M 漏报') : (t.response ? 'FA 虚报' : 'CR 正确拒绝');
        rows.push([session.id, session.createdAt, modes[c.mode], c.count, c.prior, c.dPrime, c.exposureMs,
          session.challengeId || '', session.seed, d.width, d.height, d.dpr, i + 1, Number(t.signal), Number(t.response),
          outcome, t.responseMs, t.seed, s.counts.H, s.counts.M, s.counts.FA, s.counts.CR,
          s.hitRate, s.falseAlarmRate, s.accuracy, s.correctedHitRate, s.correctedFalseAlarmRate,
          s.dPrime, s.criterion, s.meanResponseMs, s.cost]);
      });
    });
    return '\uFEFF' + rows.map(function (row) { return row.map(cell).join(','); }).join('\r\n') + '\r\n';
  }

  const api = { MAX_SESSIONS: MAX_SESSIONS, load: load, save: save, parseImport: parseImport, serialize: serialize, csv: csv };
  root.PaperStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
