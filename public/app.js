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
    tabs: document.querySelectorAll('.tab'),
    viewEvaluate: $('view-evaluate'),
    viewJobs: $('view-jobs'),
    jobsLoading: $('jobs-loading'),
    jobsError: $('jobs-error'),
    jobsEmpty: $('jobs-empty'),
    jobsContent: $('jobs-content'),
    jobsMeta: $('jobs-meta'),
    jobsGroups: $('jobs-groups'),
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

  // ---------- Tab 切换 ----------
  els.tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      els.tabs.forEach(function (t) {
        var active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      var view = tab.dataset.view;
      els.viewEvaluate.hidden = view !== 'evaluate';
      els.viewJobs.hidden = view !== 'jobs';
      if (view === 'jobs' && !jobsLoaded) loadJobs();
    });
  });

  // ---------- 岗位推荐（飞书岗位库） ----------
  var jobsLoaded = false;
  var FIT_LEVEL_CLASS = {
    '最高匹配度': 'lv-strong',
    '高胜算': 'lv-high',
    '较高胜算': 'lv-mid',
    '中等偏上': 'lv-mid2',
    '护城河岗位': 'lv-niche',
  };
  var TIER_LABEL = { '第一梯队': 'first', '第二梯队': 'second', '第三梯队': 'third' };

  function loadJobs() {
    jobsLoaded = true;
    els.jobsLoading.hidden = false;
    els.jobsError.hidden = true;
    els.jobsEmpty.hidden = true;
    els.jobsContent.hidden = true;

    fetch('/api/jobs')
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; });
      })
      .then(function (res) {
        els.jobsLoading.hidden = true;
        if (!res.body.ok) throw new Error(res.body.error || '读取岗位失败');
        var jobs = res.body.jobs || [];
        if (!jobs.length) { els.jobsEmpty.hidden = false; return; }
        renderJobs(res.body);
      })
      .catch(function (err) {
        els.jobsLoading.hidden = true;
        els.jobsError.hidden = false;
        els.jobsError.textContent = err.message || '读取岗位失败，请稍后重试';
      });
  }

  function renderJobs(data) {
    var jobs = data.jobs || [];
    els.jobsContent.hidden = false;

    // 策略 + 竞争力（取最新日期第一条记录上的策略/竞争力）
    var first = jobs[0] || {};
    if (first.strategy || first.competitiveness) {
      var metaHtml = '';
      if (first.strategy) metaHtml += '<p class="jobs-strategy"><span class="meta-key">今日策略</span>' + esc(first.strategy) + '</p>';
      if (first.competitiveness) metaHtml += '<p class="jobs-competitiveness"><span class="meta-key">竞争力</span>' + esc(first.competitiveness) + '</p>';
      els.jobsMeta.innerHTML = metaHtml;
      els.jobsMeta.hidden = false;
    } else {
      els.jobsMeta.hidden = true;
    }

    // 按日期分组（后端已按日期倒序、梯队排序）
    var byDate = {};
    jobs.forEach(function (j) {
      var d = j.date || '未标注日期';
      (byDate[d] = byDate[d] || []).push(j);
    });

    var html = '';
    Object.keys(byDate).forEach(function (date) {
      var list = byDate[date];
      html += '<section class="job-day">';
      html += '<h3 class="day-title"><span class="day-dot" aria-hidden="true"></span>' + esc(date) + ' · ' + list.length + ' 个岗位</h3>';
      html += '<div class="job-grid">';
      list.forEach(function (j) { html += jobCard(j); });
      html += '</div></section>';
    });
    els.jobsGroups.innerHTML = html;
  }

  function jobCard(j) {
    var levelClass = FIT_LEVEL_CLASS[j.winLevel] || '';
    var tierClass = TIER_LABEL[j.priority] || '';
    var link = j.link ? '<a class="job-link" href="' + esc(j.link) + '" target="_blank" rel="noopener noreferrer">查看职位 ›</a>' : '';
    return (
      '<article class="job-card">' +
        '<div class="jc-top">' +
          '<span class="jc-company">' + esc(j.company) + '</span>' +
          (j.priority ? '<span class="tier-tag ' + tierClass + '">' + esc(j.priority) + '</span>' : '') +
        '</div>' +
        '<h4 class="jc-position">' + esc(j.position) + '</h4>' +
        '<div class="jc-meta">' +
          (j.location ? '<span class="jc-chip">' + esc(j.location) + '</span>' : '') +
          (j.meta ? '<span class="jc-chip">' + esc(j.meta) + '</span>' : '') +
          (j.resumeType ? '<span class="jc-chip">' + esc(j.resumeType) + '</span>' : '') +
        '</div>' +
        '<div class="jc-tags">' +
          (j.winLevel ? '<span class="level-tag ' + levelClass + '">' + esc(j.winLevel) + '</span>' : '') +
          (j.group ? '<span class="jc-group">' + esc(j.group) + '</span>' : '') +
        '</div>' +
        (j.winReason ? '<p class="jc-reason">' + esc(j.winReason) + '</p>' : '') +
        (j.description ? '<p class="jc-desc">' + esc(j.description) + '</p>' : '') +
        (j.linkNote ? '<p class="jc-note">' + esc(j.linkNote) + '</p>' : '') +
        '<div class="jc-foot">' + link + '</div>' +
      '</article>'
    );
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
