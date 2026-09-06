/**
 * AI Job Copilot — Web 前端服务
 *
 * 安全模型：
 *  - Dify API Key 只从服务端环境变量读取（.env），绝不发送到浏览器。
 *  - 前端只与本站后端通信，由后端代理调用 Dify 工作流 API。
 *  - 后端日志与错误响应中均不包含 API Key。
 *
 * 环境变量（见 .env.example）：
 *  - DIFY_BASE_URL   Dify API 地址，例如 https://api.dify.ai/v1（云版）或 http://<host>/v1（自部署）
 *  - DIFY_API_KEY    Dify 应用的 API Key（在 Dify 应用「API 访问」页生成）
 *  - DIFY_MOCK       true 时启用演示模式（返回示例数据，便于无 Key 预览界面）
 *  - PORT            监听端口，默认 8787
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const PORT = Number(process.env.PORT || 8787);
const DIFY_BASE_URL = (process.env.DIFY_BASE_URL || '').replace(/\/+$/, '');
const DIFY_API_KEY = process.env.DIFY_API_KEY || '';
const FILE_VARIABLE = process.env.DIFY_FILE_VARIABLE || 'resume'; // 工作流里文件类型变量的名称
// Dify 文件按 user 隔离：上传文件与运行工作流必须用同一个 user，否则报 Invalid upload file
const USER_ID = process.env.DIFY_USER || 'job-copilot-web';
const MOCK = String(process.env.DIFY_MOCK || '').toLowerCase() === 'true';

// 允许上传的简历文件类型
const ALLOWED_EXT = new Set([
  'pdf', 'doc', 'docx', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
]);

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 内存存储，限制大小
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

function isConfigured() {
  return Boolean(DIFY_BASE_URL && DIFY_API_KEY);
}

/** 带超时的 fetch 封装 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 上传简历文件到 Dify，返回 upload_file_id */
async function uploadToDify(buffer, filename) {
  const fd = new FormData();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  fd.append('file', blob, filename);
  fd.append('user', USER_ID); // 必须与运行工作流时的 user 一致

  const resp = await fetchWithTimeout(`${DIFY_BASE_URL}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DIFY_API_KEY}` },
    body: fd,
  }, 30000);

  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* ignore */ }

  if (!resp.ok) {
    const detail = json && (json.message || json.error) ? (json.message || json.error) : `HTTP ${resp.status}`;
    throw new Error(`简历文件上传失败：${detail}`);
  }
  const fileId = json && (json.id || json.upload_file_id);
  if (!fileId) {
    throw new Error('简历文件上传失败：Dify 未返回文件 ID');
  }
  return fileId;
}

/**
 * 流式运行工作流（SSE），解析到 workflow_finished 事件。
 * Dify 云版对 blocking 模式有约 2 分钟网关超时（长工作流会 504），
 * streaming 模式大幅放宽，DeepSeek 多节点工作流必须用它。
 * 返回 { ok, outputs, error }
 */
async function runStreaming(body) {
  const resp = await fetchWithTimeout(`${DIFY_BASE_URL}/workflows/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, 600000); // 给足 10 分钟

  if (!resp.ok) {
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* ignore */ }
    const msg = json && (json.message || json.error) ? (json.message || json.error) : `HTTP ${resp.status}`;
    return { ok: false, error: msg };
  }

  // 解析 SSE 事件流
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = null;
  let errorMsg = null;
  const seenEvents = [];

  // 解析单个 SSE chunk（event: / data: 行），更新上下文
  function parseChunk(chunk) {
    let event = '';
    let data = '';
    for (const rawLine of chunk.split('\n')) {
      const line = rawLine.replace(/\r$/, ''); // 兼容 CRLF
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    // 兼容：部分实现把事件类型放在 data JSON 的 event 字段里
    if (!event && data) {
      try {
        const obj = JSON.parse(data);
        if (obj && obj.event) event = obj.event;
      } catch (_) { /* ignore */ }
    }
    if (!event) return;
    seenEvents.push(event);
    console.log(`[sse] ${event}${data ? ' · ' + data.slice(0, 120) : ''}`);
    if (event === 'workflow_finished') {
      try { finished = JSON.parse(data); } catch (e) {
        console.error('[sse] workflow_finished 解析失败，原始 data:', data.slice(0, 500));
      }
    } else if (event === 'error') {
      try {
        const e = JSON.parse(data);
        errorMsg = (e.message || e.error || 'streaming error');
      } catch (_) { errorMsg = data; }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    // 关键：done=true 时也必须处理最后一块 value，不能直接 break 丢弃
    if (value) buffer += decoder.decode(value, { stream: !done });

    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      parseChunk(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
    if (done) break;
  }

  // 流结束后 flush 剩余 buffer（最后一个事件可能没有 \n\n 结尾）
  if (buffer.trim()) {
    console.log('[sse] 流结束，flush 剩余 buffer:', buffer.slice(0, 300));
    parseChunk(buffer);
  }

  if (!finished) {
    console.error('[sse] 未收到 workflow_finished，已收到事件:', seenEvents.join(',') || '(无)');
  }
  if (errorMsg) return { ok: false, error: errorMsg };
  if (!finished || !finished.data || finished.data.status !== 'succeeded') {
    const detail = (finished && finished.data && (finished.data.error || finished.message)) || '未收到工作流完成事件';
    return { ok: false, error: detail };
  }

  const outputs = (finished.data && finished.data.outputs) || {};
  if (typeof outputs.result_json === 'string') {
    try { outputs._parsed = JSON.parse(outputs.result_json); } catch (_) { outputs._parsed = null; }
  }
  return { ok: true, outputs };
}

/**
 * 运行 Dify 工作流（streaming 模式），返回解析后的 outputs。
 * 文件传参：
 *  主方案：自定义 File 类型变量在 inputs 内传单个 file 对象（Dify 官方标准）；
 *  备选：顶层 files 数组（映射 sys.files，部分版本/场景可用）。
 */
async function runWorkflow(inputs, fileId) {
  const fileObject = {
    transfer_method: 'local_file',
    upload_file_id: fileId,
    type: 'document',
  };

  // 主方案：inputs 内传单个 file 对象 + streaming
  let r = await runStreaming({
    inputs: {
      ...inputs,
      [FILE_VARIABLE]: fileObject,
    },
    response_mode: 'streaming',
    user: USER_ID, // 与上传文件时的 user 保持一致
  });
  if (r.ok) {
    console.log('[api/run] 文件传参：inputs 内传 file 对象（官方标准）· streaming');
    return r.outputs;
  }

  // 仅校验类拒绝才降级，其他错误（认证失败、超时等）直接抛出
  if (!/must be a file|is required/i.test(r.error)) {
    throw new Error(`工作流运行失败：${r.error}`);
  }

  // 备选：顶层 files + streaming
  console.log('[api/run] inputs 内传对象被拒，降级尝试顶层 files + streaming');
  r = await runStreaming({
    inputs,
    files: [{
      variable: FILE_VARIABLE,
      transfer_method: 'local_file',
      upload_file_id: fileId,
      type: 'document',
    }],
    response_mode: 'streaming',
    user: USER_ID,
  });
  if (r.ok) return r.outputs;
  throw new Error(`工作流运行失败：${r.error}`);
}

/** 演示模式数据（仅用于无 Key 时预览界面，标注为示例） */
function mockResult(jobTitle) {
  return {
    job_title: jobTitle || '产品经理',
    overall_score: 72.5,
    fit_level: 'potential_fit',
    summary: { matched: 3, partial: 4, gap: 3, total: 10 },
    competency_matches: [
      { competency: '用户研究', importance: 5, match_score: 0.75, matched_evidence: ['负责车主活动派对策划，洞察用户需求'], reasoning: '活动策划经历直接涉及用户洞察与需求分析', gap_type: 'partial_gap' },
      { competency: '跨部门协作', importance: 4, match_score: 1, matched_evidence: ['参与摩展发布会全流程，联动多部门'], reasoning: '发布会组织经历完整覆盖跨团队协作', gap_type: 'none' },
      { competency: '数据分析', importance: 4, match_score: 0.25, matched_evidence: ['撰写多平台文案，跟踪内容数据'], reasoning: '仅间接涉及数据，缺少系统性分析证据', gap_type: 'partial_gap' },
      { competency: '原型设计', importance: 3, match_score: 0, matched_evidence: [], reasoning: '简历中无相关证据', gap_type: 'experience_gap' },
    ],
    strongest_matches: [
      { competency: '跨部门协作', evidence: '参与摩展发布会全流程，联动多部门', reason: '完整覆盖岗位核心协作要求' },
      { competency: '用户研究', evidence: '负责车主活动派对策划', reason: '直接体现用户洞察能力' },
      { competency: '内容策划', evidence: '撰写主持稿与直播稿', reason: '与岗位内容表达能力高度契合' },
    ],
    key_gaps: [
      { competency: '原型设计', gap: '无产品原型相关经验', impact: '影响产品方案落地能力评估' },
      { competency: '数据分析', gap: '缺乏系统性数据方法', impact: '弱化数据驱动决策的证明力' },
    ],
    resume_strategy: ['补充用户研究方法论描述，量化活动数据', '增加数据分析相关项目或课程经历', '将主持稿/直播稿经历改写为内容策划能力'],
    application_advice: '整体匹配度良好，建议在简历中强化用户研究与数据能力证据后再投递，胜率会明显提升。',
    _mock: true,
  };
}

// ---------- API ----------

/** 健康检查：不返回任何 Key 信息 */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: isConfigured(),
    mock: MOCK,
  });
});

/** 运行评估 */
app.post('/api/run', upload.single('resume'), async (req, res) => {
  const startedAt = Date.now();
  try {
    const jobTitle = String(req.body.job_title || '').trim();
    const jdText = String(req.body.jd_text || '').trim();
    const file = req.file;

    console.log(`[api/run] 收到请求 job_title="${jobTitle}" 文件=${file ? file.originalname : '(无)'} size=${file ? file.size : 0}B`);

    if (!jobTitle) return res.status(400).json({ ok: false, error: '请填写岗位名称' });
    if (!jdText) return res.status(400).json({ ok: false, error: '请粘贴职位描述 JD' });

    if (MOCK) {
      // 演示模式：不调用 Dify、不校验文件，返回示例数据（便于先看界面效果）
      const mock = mockResult(jobTitle);
      return res.json({ ok: true, mock: true, result: mock });
    }

    if (!file) return res.status(400).json({ ok: false, error: '请上传简历文件' });

    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return res.status(400).json({ ok: false, error: `不支持的文件类型 .${ext}，请上传 PDF / Word / TXT / 图片` });
    }

    if (!isConfigured()) {
      return res.status(503).json({
        ok: false,
        error: '服务端未配置 Dify API（请管理员在 .env 中配置 DIFY_BASE_URL 与 DIFY_API_KEY）',
      });
    }

    // 1. 上传简历到 Dify
    console.log(`[api/run] 上传文件到 Dify: ${DIFY_BASE_URL}/files/upload`);
    const fileId = await uploadToDify(file.buffer, file.originalname);
    console.log(`[api/run] 上传成功 upload_file_id=${fileId}`);

    // 2. 运行工作流
    console.log('[api/run] 运行工作流...');
    const outputs = await runWorkflow({
      job_title: jobTitle,
      jd_text: jdText,
    }, fileId);
    console.log(`[api/run] 工作流完成，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

    const parsed = outputs._parsed;
    const result = parsed || {
      job_title: jobTitle,
      overall_score: Number(outputs.overall_score || 0),
    };

    res.json({ ok: true, mock: false, result });
  } catch (err) {
    // 不向客户端暴露 Key 或内部细节，但记录到服务端日志便于定位
    console.error(`[api/run] 失败（${((Date.now() - startedAt) / 1000).toFixed(1)}s）:`, err.message);
    res.status(500).json({ ok: false, error: err.message || '服务内部错误' });
  }
});

// multer 上传错误（超限等）转为 JSON 响应
app.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ ok: false, error: '文件超过 15MB 大小限制' });
  }
  console.error('[multer] 上传错误:', err.message);
  res.status(400).json({ ok: false, error: `上传失败：${err.message || '未知错误'}` });
});

// SPA 兜底
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Job Copilot Web 已启动: http://localhost:${PORT}`);
  console.log(`模式: ${MOCK ? 'DEMO（演示数据，未调用 Dify）' : (isConfigured() ? 'LIVE（已配置 Dify）' : '未配置 Dify，请填写 .env')}`);
});
