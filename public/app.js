/* AI Job Copilot — 前端交互 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    statusPill: $('status-pill'),
    jobTitle: $('job-title'),
    jdText: $('jd-text'),
    dropzone: $('dropzone'),
    resumeFile: $('resume-file'),
    fileChip: $('file-chip'),
    fileName: $('file-name'),
    fileRemove: $('file-remove'),
    runBtn: $('run-btn'),
    emptyState: $('empty-state'),
    result: $('result'),
    mockFlag: $('mock-flag'),
  };

  var toast = $('toast');
  var toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3600);
  }

  // ---------- 健康检查 ----------
  function checkHealth() {
    fetch('/api/health')
      .then(function (r) { return r.json(); })
      .then(function (h) {
        if (h.mock) {
          setStatus('demo', '演示模式 · 示例数据');
        } else if (h.configured) {
          setStatus('ready', '已连接 Dify 工作流');
        } else {
          setStatus('unconfigured', '未配置 Dify API');
        }
      })
      .catch(function () {
        setStatus('unconfigured', '服务不可用');
      });
  }

  function setStatus(state, label) {
    els.statusPill.dataset.state = state;
    els.statusPill.textContent = label;
  }

  // ---------- 文件选择 ----------
  var currentFile = null;

  els.dropzone.addEventListener('click', function () { els.resumeFile.click(); });
  els.dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.resumeFile.click(); }
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    els.dropzone.addEventListener(ev, function (e) { e.preventDefault(); els.dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    els.dropzone.addEventListener(ev, function (e) { e.preventDefault(); els.dropzone.classList.remove('dragover'); });
  });
  els.dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      setFile(e.dataTransfer.files[0]);
    }
  });
  els.resumeFile.addEventListener('change', function () {
    if (els.resumeFile.files.length) setFile(els.resumeFile.files[0]);
  });
  els.fileRemove.addEventListener('click', function () {
    currentFile = null;
    els.resumeFile.value = '';
    els.fileChip.hidden = true;
    els.dropzone.hidden = false;
    validateForm();
  });

  function setFile(f) {
    currentFile = f;
    els.fileName.textContent = f.name;
    els.fileChip.hidden = false;
    els.dropzone.hidden = true;
    validateForm();
  }

  // ---------- 表单 ----------
  function validateForm() {
    var ok = els.jobTitle.value.trim() && els.jdText.value.trim() && currentFile;
    els.runBtn.disabled = !ok;
    return Boolean(ok);
  }
  els.jobTitle.addEventListener('input', validateForm);
  els.jdText.addEventListener('input', validateForm);

  // ---------- 提交 ----------
  els.runBtn.addEventListener('click', function () {
    if (!validateForm()) return;

    var fd = new FormData();
    fd.append('job_title', els.jobTitle.value.trim());
    fd.append('jd_text', els.jdText.value.trim());
    fd.append('resume', currentFile, currentFile.name);

    els.runBtn.classList.add('loading');
    els.runBtn.disabled = true;
    var hintEl = document.querySelector('.run-hint');
    var hintText = hintEl ? hintEl.textContent : '';
    if (hintEl) hintEl.textContent = '评估中…DeepSeek 分析可能需要 1-3 分钟，请耐心等待';

    fetch('/api/run', { method: 'POST', body: fd })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; });
      })
      .then(function (res) {
        if (!res.body.ok) throw new Error(res.body.error || '评估失败，请稍后重试');
        renderResult(res.body.result);
        if (res.body.mock) {
          els.mockFlag.hidden = false;
        } else {
          els.mockFlag.hidden = true;
        }
        showToast(res.body.mock ? '已展示演示数据' : '评估完成');
      })
      .catch(function (err) {
        showToast(err.message || '网络错误');
      })
      .finally(function () {
        els.runBtn.classList.remove('loading');
        if (hintEl && hintText) hintEl.textContent = hintText;
        validateForm();
      });
  });

  // ---------- 渲染 ----------
  var FIT_LABEL = { strong_fit: '强匹配', potential_fit: '潜力匹配', weak_fit: '弱匹配' };
  var GAP_LABEL = { none: '无缺口', partial_gap: '部分匹配', experience_gap: '经验缺口' };
  var GAP_TEXT = { none: 'none', partial_gap: 'partial_gap', experience_gap: 'experience_gap' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderResult(r) {
    if (!r) return;
    els.emptyState.hidden = true;
    els.result.hidden = false;

    var score = Number(r.overall_score || 0);
    $('r-score').textContent = Math.round(score * 10) / 10;
    $('r-jobtitle').textContent = r.job_title || '';

    var fit = r.fit_level || 'potential_fit';
    var fitEl = $('r-fitlevel');
    fitEl.textContent = FIT_LABEL[fit] || fit;
    fitEl.className = 'fit-pill ' + (fit === 'strong_fit' ? 'strong' : fit === 'weak_fit' ? 'weak' : 'potential');

    var s = r.summary || {};
    $('r-summary').innerHTML =
      '<span class="summary-chip matched">完全匹配 <b>' + esc(s.matched || 0) + '</b></span>' +
      '<span class="summary-chip partial">部分匹配 <b>' + esc(s.partial || 0) + '</b></span>' +
      '<span class="summary-chip gap">经验缺口 <b>' + esc(s.gap || 0) + '</b></span>' +
      '<span class="summary-chip total">共 <b>' + esc(s.total || 0) + '</b> 项能力</span>';

    // 能力匹配明细
    var matches = r.competency_matches || [];
    $('r-matches').innerHTML = matches.map(function (m) {
      var ms = Number(m.match_score || 0);
      var pct = Math.round(ms * 100);
      var fillClass = ms >= 0.75 ? 'high' : ms >= 0.4 ? 'mid' : 'low';
      var ev = (m.matched_evidence || []).join('；');
      return (
        '<div class="match-item">' +
          '<div class="match-top">' +
            '<span class="match-name">' + esc(m.competency) + '</span>' +
            '<span class="match-imp">importance ' + esc(m.importance || '—') + ' · ' + pct + '%</span>' +
          '</div>' +
          '<div class="match-bar"><div class="match-fill ' + fillClass + '" style="width:' + pct + '%"></div></div>' +
          '<div class="match-meta">' +
            '<span class="gap-tag ' + esc(GAP_TEXT[m.gap_type] || 'partial') + '">' + esc(GAP_LABEL[m.gap_type] || m.gap_type || '—') + '</span>' +
          '</div>' +
          (m.reasoning ? '<div class="match-reason">' + esc(m.reasoning) + '</div>' : '') +
          (ev ? '<div class="match-evidence">证据：' + esc(ev) + '</div>' : '') +
        '</div>'
      );
    }).join('') || '<p class="empty-desc">暂无能力匹配数据</p>';

    // 最有力的匹配
    var strongest = r.strongest_matches || [];
    $('r-strongest').innerHTML = strongest.map(function (m) {
      return (
        '<div class="mini-card">' +
          '<div class="mc-name">' + esc(m.competency) + '</div>' +
          (m.evidence ? '<div class="mc-desc">' + esc(m.evidence) + '</div>' : '') +
          (m.reason ? '<div class="mc-reason">' + esc(m.reason) + '</div>' : '') +
        '</div>'
      );
    }).join('') || '<p class="empty-desc">暂无数据</p>';

    // 关键差距
    var gaps = r.key_gaps || [];
    $('r-gaps').innerHTML = gaps.map(function (g) {
      return (
        '<div class="mini-card">' +
          '<div class="mc-name">' + esc(g.competency) + '</div>' +
          (g.gap ? '<div class="mc-desc">' + esc(g.gap) + '</div>' : '') +
          (g.impact ? '<div class="mc-reason">影响：' + esc(g.impact) + '</div>' : '') +
        '</div>'
      );
    }).join('') || '<p class="empty-desc">暂无关键差距</p>';

    // 简历策略
    var strategy = r.resume_strategy || [];
    $('r-strategy').innerHTML = strategy.map(function (s2) {
      return '<li>' + esc(s2) + '</li>';
    }).join('') || '<p class="empty-desc">暂无策略建议</p>';

    // 申请建议
    $('r-advice').textContent = r.application_advice || '—';

    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- 演示入口：?demo=1 自动填入示例并触发评估 ----------
  function autoDemo() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('demo') !== '1') return;
    els.jobTitle.value = '产品经理';
    els.jdText.value = '负责用户研究、数据分析、跨部门协作，撰写产品需求文档，推动产品迭代。';
    validateForm();
    var fd = new FormData();
    fd.append('job_title', els.jobTitle.value.trim());
    fd.append('jd_text', els.jdText.value.trim());
    fd.append('resume', new File([''], 'demo-resume.pdf', { type: 'application/pdf' }), 'demo-resume.pdf');
    els.runBtn.classList.add('loading');
    els.runBtn.disabled = true;
    fetch('/api/run', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || '评估失败');
        renderResult(j.result);
        els.mockFlag.hidden = false;
      })
      .catch(function (err) { showToast(err.message || '网络错误'); })
      .finally(function () {
        els.runBtn.classList.remove('loading');
        validateForm();
      });
  }

  checkHealth();
  autoDemo();
})();
