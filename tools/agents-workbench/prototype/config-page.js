// Browser-only configuration sample. Secret text is deliberately never collected.
import { connectionFor, libraryLabels } from './mock.js';

export function configurationPage({ state, save, projects, esc, getId, render, currentName }) {
  const views = new Map();
  const view = () => {
    const id = getId();
    if (!views.has(id)) views.set(id, { status: 'ready', preview: false });
    return views.get(id);
  };
  const defaults = project => {
    const { host, port } = connectionFor(project);
    return {
      name: currentName(), mode: project.mode, library: project.activeLibrary,
      host, port, secret: 'keep'
    };
  };
  const read = project => ({ ...defaults(project), ...project.editorDraft });
  const input = (label, key, value, type = 'text') => `
    <div class="field">
      <label for="edit-${key}">${label}</label>
      <input id="edit-${key}" name="${key}" value="${esc(value)}" type="${type}"
        ${type === 'number' ? 'min="1" max="65535" step="1"' : ''} required aria-describedby="edit-error">
    </div>`;
  const button = (label, action, primary = false) =>
    `<button type="button" data-edit="${action}" ${primary ? 'class="primary"' : ''}>${label}</button>`;

  function libraryStatus(project) {
    const name = libraryLabels[project.activeLibrary];
    const clientStatus = project.needsReconnect ? '客户端待重连核验'
      : project.tested ? `客户端模拟已连到${name}` : '客户端尚未核验';
    return `
      <div class="library-status" id="library-status" role="status" tabindex="-1">
        <span>当前开发库 <strong>${name}</strong></span><span>${clientStatus}</span>
        ${project.needsReconnect ? button('模拟重连并核验', 'verify') : ''}
      </div>`;
  }

  function preview(project, draft, scope) {
    const switching = draft.library !== project.activeLibrary;
    const current = connectionFor(project);
    const credential = draft.secret === 'clear' ? '将清除此档案的演示凭据'
      : draft.secret === 'replace' ? '将模拟替换此档案的凭据' : '沿用目标档案的凭据设置';
    return `
      <section class="change-preview" aria-labelledby="edit-preview-title">
        <h3 id="edit-preview-title" tabindex="-1">${switching ? '核对切库影响' : '核对本次修改'}</h3>
        <dl>
          <dt>影响范围</dt><dd>${scope}</dd>
          <dt>开发库</dt><dd>${switching ? libraryLabels[project.activeLibrary] + ' → ' : ''}${libraryLabels[draft.library]}</dd>
          <dt>连接</dt><dd>${switching ? esc(current.host) + ':' + esc(current.port) + ' → ' : ''}${esc(draft.host)}:${esc(draft.port)}</dd>
          ${switching ? '<dt>跟随入口</dt><dd>VS Code ObjectScript、IRIS MCP、框架脚本</dd>' : ''}
          <dt>凭据</dt><dd>${credential}</dd>
        </dl>
        <div class="actions">
          ${button('返回编辑', 'back')}
          ${button(switching ? '模拟应用切换' : '模拟保存并检查', 'apply', true)}
          ${button('模拟保存失败', 'fail')}
          ${switching ? '' : button('模拟部分完成', 'partial')}
        </div>
      </section>`;
  }

  function page() {
    const project = state(getId()), v = view(), draft = read(project);
    const dirty = !!project.editorDraft;
    const scope = projects[getId()].parent ? '当前模块' : '当前工程';
    const statuses = {
      ready: ['配置已读取', '本页使用演示数据。'],
      loading: ['正在读取配置', '正在核对工程信息和连接来源。'],
      empty: ['尚未配置开发连接', '请先创建演示连接。'],
      failed: ['配置未保存', '模拟写入失败。当前开发库仍可使用，草稿已保留。'],
      partial: ['配置已保存，验证未完成', '可继续模拟检查客户端加载。'],
      saved: ['配置已保存', '已读回浏览器中的演示值。']
    };
    const [title, description] = statuses[v.status] || statuses.ready;
    const feedbackAction = v.status === 'loading' ? button('完成模拟读取', 'state-ready')
      : v.status === 'empty' ? button('创建演示连接', 'state-ready', true)
      : v.status === 'partial' && !project.needsReconnect ? button('重新检查演示结果', 'verify', true) : '';
    const intro = `
      <div class="page-heading"><div><h2>工程配置</h2><p>交互预览 · 仅保存浏览器演示数据，不读写真实工程。</p></div></div>
      <details class="state-review">
        <summary>状态验收</summary>
        <div class="actions">${[['ready','正常'],['loading','加载'],['empty','空态'],['failed','失败'],['partial','部分完成']]
          .map(([key, label]) => button(label, 'state-' + key)).join('')}</div>
        <small>切换演示状态。</small>
      </details>
      <div class="feedback ${v.status}" role="status" aria-live="polite">
        <strong>${dirty && v.status === 'ready' ? '有未保存的修改' : title}</strong>
        <p>${description}</p>${feedbackAction}
      </div>`;
    if (['empty', 'loading'].includes(v.status)) {
      return intro + `<section class="config-section" aria-busy="${v.status === 'loading'}">
        ${v.status === 'loading' ? '<div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div>'
          : '<h3>先准备一组开发连接</h3><p>正式接入后优先沿用已有连接。</p>'}
      </section>`;
    }
    return intro + `
      <div class="configuration-layout">
        <form id="polished-config" novalidate>
          <section class="config-section">
            <div class="section-heading"><h3>工程信息</h3><p>展示名称与开发方式</p></div>
            <div class="form-grid">
              ${input('项目显示名称', 'name', draft.name)}
              <div class="field">
                <label for="edit-mode">开发方式</label>
                <select id="edit-mode" name="mode">
                  <option value="connected" ${draft.mode === 'connected' ? 'selected' : ''}>连接开发</option>
                  <option value="offline" ${draft.mode === 'offline' ? 'selected' : ''}>离线开发</option>
                </select>
                <span class="field-origin">切换开发方式会保留开发库档案。</span>
              </div>
            </div>
          </section>
          <section class="config-section">
            <div class="section-heading">
              <h3>IRIS 开发连接</h3>
              <details class="inline-source"><summary>来源与影响范围</summary><p>${scope}</p>
                <p>VS Code ObjectScript、IRIS MCP 和框架脚本跟随当前档案。Web／SFTP 按各自绑定处理。</p>
              </details>
            </div>
            <div class="form-grid library-fields">
              <div class="field">
                <label for="edit-library">开发库档案</label>
                <select id="edit-library" name="library" aria-describedby="library-status edit-error">
                  ${Object.entries(libraryLabels).map(([key, name]) =>
                    `<option value="${key}" ${draft.library === key ? 'selected' : ''}>${name}</option>`).join('')}
                </select>
              </div>
              ${input('连接地址', 'host', draft.host)}
              ${input('Web 端口', 'port', draft.port, 'number')}
            </div>
            ${libraryStatus(project)}
            <div class="credential-row">
              <div>
                <label for="edit-secret">档案凭据</label>
                <p id="library-credential">${connectionFor(project, draft.library).secret ? '已设置（演示）' : '未设置（演示）'}</p>
              </div>
              <select id="edit-secret" name="secret" aria-describedby="secret-help">
                <option value="keep" ${draft.secret === 'keep' ? 'selected' : ''}>保留档案凭据</option>
                <option value="replace" ${draft.secret === 'replace' ? 'selected' : ''}>模拟替换凭据</option>
                <option value="clear" ${draft.secret === 'clear' ? 'selected' : ''}>清除演示凭据</option>
              </select>
            </div>
            <p id="secret-help" class="field-help">凭据选择只影响所选档案。请使用演示数据。</p>
          </section>
          <p id="edit-error" class="field-error" role="alert">${esc(v.error || '')}</p>
          ${v.preview ? preview(project, draft, scope) : ''}
          <div class="save-bar">
            <div id="edit-status" role="status">${dirty ? '未保存 · 草稿仅保存在本浏览器' : '没有待保存的修改'}</div>
            <div class="actions">${button('放弃修改', 'discard')}
              <button class="primary" type="submit" ${dirty ? '' : 'disabled'}>${draft.library === project.activeLibrary ? '预览修改' : '预览切换'}</button>
            </div>
          </div>
        </form>
        <aside class="source-panel"><details><summary>更多配置与共享连接</summary>
          <p>个人共享配置可能影响其他引用工程，须独立核对。</p>
          <div class="actions">
            <button type="button" data-action="scope-open:identity">接管配置</button>
            <button type="button" data-action="scope-open:web">Web / SFTP</button>
            <button type="button" data-action="scope-open:profiles">领域配置</button>
            <button type="button" data-action="scope-open:bos">BOS 配置</button>
            <button type="button" data-action="scope-open:embedding">知识 Key</button>
          </div>
        </details></aside>
      </div>`;
  }

  function capture(form) {
    const project = state(getId()), v = view();
    const draft = Object.fromEntries(new FormData(form));
    const initial = defaults(project);
    const dirty = Object.keys(initial).some(key => String(initial[key]) !== draft[key]);
    if (dirty) project.editorDraft = draft;
    else delete project.editorDraft;
    save();
    v.preview = false;
    v.error = '';
    form.querySelector('.change-preview')?.remove();
    document.getElementById('edit-error').textContent = '';
    const feedback = document.querySelector('.feedback');
    if (feedback && ['ready', 'saved'].includes(v.status)) {
      v.status = 'ready';
      feedback.className = 'feedback ready';
      feedback.querySelector('strong').textContent = dirty ? '有未保存的修改' : '配置已读取';
      feedback.querySelector('p').textContent = '';
    }
    document.getElementById('edit-status').textContent = dirty ? '未保存 · 草稿仅保存在本浏览器' : '没有待保存的修改';
    const submit = form.querySelector('[type=submit]');
    submit.disabled = !dirty;
    submit.textContent = draft.library === project.activeLibrary ? '预览修改' : '预览切换';
  }

  function chooseLibrary(select) {
    const project = state(getId()), previous = read(project);
    const before = connectionFor(project, previous.library);
    if (previous.host !== before.host || String(previous.port) !== String(before.port) || previous.secret !== 'keep') {
      select.value = previous.library;
      view().error = '请先保存或放弃所选档案的连接修改，再选择另一套开发库。';
      document.getElementById('edit-error').textContent = view().error;
      return;
    }
    const target = connectionFor(project, select.value);
    const { elements } = select.form;
    elements.host.value = target.host;
    elements.port.value = target.port;
    elements.secret.value = 'keep';
    for (const field of [elements.host, elements.port]) field.removeAttribute('aria-invalid');
    document.getElementById('library-credential').textContent = target.secret ? '已设置（演示）' : '未设置（演示）';
    capture(select.form);
  }

  document.addEventListener('input', event => {
    const form = event.target.closest('#polished-config');
    if (form && event.target.id !== 'edit-library') capture(form);
  });
  document.addEventListener('change', event => {
    const form = event.target.closest('#polished-config');
    if (!form) return;
    if (event.target.id === 'edit-library') chooseLibrary(event.target);
    else capture(form);
  });
  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.id !== 'polished-config') return;
    event.preventDefault();
    capture(form);
    const project = state(getId()), v = view(), draft = read(project);
    if (!project.editorDraft) return;
    const port = Number(draft.port);
    const invalid = !draft.name.trim() ? 'name' : !draft.host.trim() ? 'host'
      : !Number.isInteger(port) || port < 1 || port > 65535 ? 'port' : null;
    for (const key of ['name', 'host', 'port']) form.elements[key].removeAttribute('aria-invalid');
    if (invalid) {
      v.error = invalid === 'port' ? 'Web 端口请输入 1–65535 的整数。' : '项目名称和连接地址不能为空。';
      render();
      const field = document.getElementById('edit-' + invalid);
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      return;
    }
    v.preview = true;
    render();
    document.getElementById('edit-preview-title').focus();
  });

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-edit]')?.dataset.edit;
    if (!action) return;
    const project = state(getId()), v = view();
    v.error = '';
    if (action.startsWith('state-')) {
      v.status = action.slice(6);
    } else if (action === 'discard') {
      delete project.editorDraft;
      v.status = 'ready';
      save();
    } else if (action === 'fail' && v.preview) {
      v.status = 'failed';
    } else if (action === 'verify') {
      project.tested = true;
      project.needsReconnect = false;
      v.status = 'saved';
      save();
    } else if (['apply', 'partial'].includes(action) && v.preview) {
      const draft = read(project), target = connectionFor(project, draft.library);
      const host = draft.host.trim(), port = Number(draft.port);
      const secret = draft.secret === 'keep' ? target.secret : draft.secret === 'replace';
      if (draft.library !== project.activeLibrary || target.host !== host || target.port !== port || target.secret !== secret) {
        project.tested = false;
        project.needsReconnect = true;
      }
      Object.assign(target, { host, port, secret });
      project.name = draft.name.trim();
      project.mode = draft.mode;
      project.activeLibrary = draft.library;
      delete project.editorDraft;
      save();
      v.status = action === 'partial' ? 'partial' : 'saved';
    }
    v.preview = false;
    render();
    if (action === 'back' || action === 'discard') document.getElementById('edit-library')?.focus();
    if (action === 'apply' || action === 'verify') document.getElementById('library-status')?.focus();
  });
  return page;
}
