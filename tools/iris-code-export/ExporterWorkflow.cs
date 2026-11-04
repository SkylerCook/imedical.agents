using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using System.Xml;

// Windows-only presentation and local task actions; all server reads use the existing exporter.
public sealed partial class ExporterForm {
    readonly Label inputTitle = new Label(), resultTitle = new Label(), summary = new Label(), sessionStatus = new Label(), workflowHint = new Label();
    readonly Button importList = new Button(), continueCurrent = new Button(), diagnosticToggle = new Button(), markMissing = new Button();
    readonly Panel diagnostics = new Panel();
    readonly FlowLayoutPanel confirmations = new FlowLayoutPanel();
    readonly ComboBox resultFilter = new ComboBox();
    readonly ProgressBar progress = new WorkbenchProgress();
    readonly Label problems = new Label();
    readonly List<ListViewItem> visibleRows = new List<ListViewItem>();
    TableLayoutPanel connectionFields;
    TableLayoutPanel windowLayout;
    string inputSource = "手工清单", lastReason, trialIdentity;
    bool closeRequested, closingPool, runningTrial;

    static Label TextLabel() { return new Label { AutoSize = true, Margin = new Padding(3, 5, 3, 5) }; }
    void BuildWindow() { BuildWorkbench(); }

    static void ApplyVisualStyle(Control parent) {
        parent.ForeColor = Color.FromArgb(43, 56, 76);
        var flow = parent as FlowLayoutPanel; if (flow != null && flow.AutoSize) flow.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        foreach (Control c in parent.Controls) {
            var button = c as Button; if (button != null) { button.FlatStyle = FlatStyle.Flat; button.FlatAppearance.BorderColor = Color.FromArgb(210, 220, 233); button.BackColor = Color.White; button.Padding = new Padding(8, 4, 8, 4); button.Margin = new Padding(3, 4, 5, 4); button.Cursor = Cursors.Hand; }
            var text = c as TextBox; if (text != null) { text.BorderStyle = BorderStyle.FixedSingle; text.BackColor = Color.White; }
            var list = c as ListView; if (list != null) { list.BorderStyle = BorderStyle.None; list.GridLines = false; }
            ApplyVisualStyle(c);
        }
    }
    void ArrangeWorkflow() { }

    static object Value(Dictionary<string, object> d, string key) { object v; return d != null && d.TryGetValue(key, out v) ? v : null; }
    static string TextValue(Dictionary<string, object> d, string key) { return Convert.ToString(Value(d, key)); }
    static bool Flag(Dictionary<string, object> d, string key) { return Value(d, key) != null && Convert.ToBoolean(d[key]); }
    static int Number(Dictionary<string, object> d, string key) { return Value(d, key) == null ? 0 : Convert.ToInt32(d[key]); }
    static string ImportableName(string name) { return name.Contains("/") && !name.StartsWith("/", StringComparison.Ordinal) ? "/" + name : name; }
    static string Outcome(string raw) {
        switch (raw) {case "fetched": return "已取得"; case "missing": return "未找到（404）"; case "failed": return "失败"; case "empty": return "空内容"; case "writing": return "正在保存"; case "pending": return "待处理"; default: return raw;}
    }
    string RenderOutcome(Dictionary<string, object> item, HashSet<string> confirmed) {
        return TextValue(item, "status") == "missing" && confirmed.Contains(TextValue(item, "document")) ? "未找到（已确认不补取）" : Outcome(TextValue(item, "status"));
    }
    void UpdateInputSummary() {
        int count = 0; foreach (var line in documents.Lines) if (!String.IsNullOrWhiteSpace(line) && !line.TrimStart().StartsWith("#", StringComparison.Ordinal)) count++;
        inputTitle.Text = version.SelectedIndex > 0 ? "待新建任务 · " + version.Text + " + 补充 " + count + " 项" : "待新建任务 · " + inputSource + " · " + count + " 个对象";
    }
    void UpdateScopeControls() {
        budget.Visible = speed.SelectedIndex > 0; web.Visible = version.SelectedIndex > 0;
        UpdateWorkflowHint(); ArrangeWorkflow();
    }
    void UpdateWorkflowHint() {
        if(projectUI){start.Text="增补源码";return;}
        if (trial == null) return;
        start.Text = trial.Checked ? "按当前清单试读" : "按当前清单新建导出";
        workflowHint.Text = trial.Checked ? "下一步：预览后实际试读，每会话最多请求 1 项；预览本身不验证连接。" : speed.SelectedIndex > 0 && !budget.Checked ? "正式导出还缺：人工核实所选会话预算与资源回落，并勾选上方确认项。" : "下一步：新清单点“新建导出”；旧任务点“恢复已有批次”，使用旧范围与旧档位。";
    }
    void UpdateButtons() {
        bool idle = !busy && !closingPool && !closeRequested;
        foreach (Control c in new Control[] {profiles, url, ns, user, password, destination, version, speed, trial, budget, web, importList}) c.Enabled = idle;
        documents.Enabled = true; documents.ReadOnly = !idle;
        bool ready = idle && !blocked && worker != null && !worker.HasExited;
        start.Enabled = resume.Enabled = ready; continueCurrent.Enabled = ready && batch != null && File.Exists(Path.Combine(batch, "job.json"));
        start.BackColor = ready ? Color.FromArgb(32, 100, 207) : Color.FromArgb(225, 233, 244); start.ForeColor = ready ? Color.White : Color.FromArgb(98, 115, 139);
        retryMissing.Enabled = ready && batch != null && PendingMissingNames().Count > 0;
        markMissing.Enabled = idle && batch != null && job != null;
        stop.Enabled = busy && !closeRequested; closePool.Enabled = idle && worker != null && !worker.HasExited;
        UpdateWorkbench();
    }

    static string ExtractClasses(string file, out int duplicates, out int ignored) {
        duplicates = 0; ignored = 0; var names = new List<string>(); var exact = new HashSet<string>(StringComparer.Ordinal); var folded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var settings = new XmlReaderSettings {DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 64L * 1024 * 1024};
        using (var reader = XmlReader.Create(file, settings)) {
            bool rootSeen = false;
            while (reader.Read()) if (reader.NodeType == XmlNodeType.Element) {
                if (reader.Depth == 0) { if (reader.Name != "Export") throw new InvalidDataException("请选择 IRIS 源码 Export XML；不支持 ProjectItem 范围 XML。"); rootSeen = true; }
                if (reader.Depth != 1) continue;
                if (reader.Name != "Class") { ignored++; continue; }
                string name = reader.GetAttribute("name");
                if (String.IsNullOrWhiteSpace(name) || name.Length > 512 || Regex.IsMatch(name, "[\\s/\\\\:*?\"<>|\\x00-\\x1f]") || name.StartsWith(".", StringComparison.Ordinal) || name.EndsWith(".", StringComparison.Ordinal) || name.Contains("..")) throw new InvalidDataException("源码 XML 包含无效的 Class name。");
                if (!exact.Add(name)) { duplicates++; continue; }
                if (!folded.Add(name)) throw new InvalidDataException("源码 XML 存在仅大小写不同的类名，请先核实。");
                names.Add(name + ".cls");
            }
            if (!rootSeen || names.Count == 0) throw new InvalidDataException("源码 XML 中未找到顶层 Class 对象。");
        }
        return String.Join("\r\n", names) + "\r\n";
    }

    void ValidateBudget(int sessions) {
        if (sessions > 1 && !trial.Checked && !budget.Checked) {
            budget.Visible = true; budget.Focus();
            throw new InvalidOperationException((trialIdentity == CurrentTrialIdentity(sessions) ? "本次已完成小批试读。" : "预览只解析本地清单；如未实际试读，请先勾选“小批试读”。") + "\n正式导出还缺：人工核实 " + sessions + " 会话的预算与资源回落，然后勾选对应确认项。");
        }
    }
    string CurrentTrialIdentity(int sessions) {
        using (var sha = System.Security.Cryptography.SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(json.Serialize(new object[] {url.Text.Trim(), ns.Text.Trim(), user.Text, password.Text, sessions}))));
    }
    void BeginTask(bool continuing) {
        if (String.IsNullOrWhiteSpace(password.Text) || String.IsNullOrWhiteSpace(user.Text)) throw new InvalidOperationException("请填写用户名和密码。");
        Uri uri;
        if (!Uri.TryCreate(url.Text.Trim(), UriKind.Absolute, out uri) || !(uri.Scheme == "http" || uri.Scheme == "https") || !uri.AbsolutePath.TrimEnd('/').EndsWith("/api/atelier", StringComparison.Ordinal) || uri.UserInfo != "" || uri.Query != "" || uri.Fragment != "") throw new InvalidOperationException("请填写有效的 Atelier 根 URL，以 /api/atelier/ 结尾。");
        if (continuing) {
            using (var d = new OpenFileDialog {Filter = "导出批次|job.json", Title = "恢复旧批次：使用该批次原范围和档位"}) { if (d.ShowDialog() != DialogResult.OK) return; LoadBatch(d.FileName); }
        } else {
            int sessions = new[] {1, 4, 10}[speed.SelectedIndex]; ValidateBudget(sessions);
            if (!Path.IsPathRooted(destination.Text)) throw new InvalidOperationException("请选择保存根目录。");
            if (version.SelectedIndex == 0 && String.IsNullOrWhiteSpace(documents.Text)) throw new InvalidOperationException("请粘贴或导入对象清单，或选择版本。");
            batch = Path.Combine(destination.Text, "batch-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            job = new Dictionary<string, object> {{"batch", batch}, {"url", url.Text.Trim()}, {"ns", ns.Text.Trim()}, {"sessions", sessions}, {"interval", new[] {200, 100, 50}[speed.SelectedIndex]}, {"version", version.SelectedIndex == 0 ? "" : version.Text.Split(' ')[0]}, {"scope", version.Text.StartsWith("v9.2 ", StringComparison.Ordinal) ? "all-products" : "doctor"}, {"confirmWeb", web.Checked}};
            job["inputSource"] = inputSource;
            Directory.CreateDirectory(batch); if (!String.IsNullOrWhiteSpace(documents.Text)) File.WriteAllText(Path.Combine(batch, "files.txt"), documents.Text, new UTF8Encoding(false)); SaveJob();
        }
        PreviewJob(continuing);
    }
    void LoadBatch(string file) {
        var selected = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)); string selectedBatch = Path.GetDirectoryName(file);
        if (!String.Equals(Path.GetFullPath(TextValue(selected, "batch")), selectedBatch, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("批次目录已移动，请保留原路径后恢复。");
        if (TextValue(selected, "url") != url.Text.Trim() || TextValue(selected, "ns") != ns.Text.Trim()) throw new InvalidOperationException("连接或 Namespace 与批次不一致，请选择原医院配置。");
        string oldList = Path.Combine(selectedBatch, "files.txt"); string oldText = File.Exists(oldList) ? File.ReadAllText(oldList, Encoding.UTF8) : "";
        if (documents.Text != oldText || TextValue(selected, "version") != (version.SelectedIndex == 0 ? "" : version.Text.Split(' ')[0])) {
            if (MessageBox.Show(this, "恢复批次：" + Path.GetFileName(selectedBatch) + "\n将使用旧批次的清单、" + Number(selected, "sessions") + " 会话 / " + Number(selected, "interval") + "ms。\n当前输入区的新清单不会用于这次续传。是否恢复？", "确认恢复范围", MessageBoxButtons.OKCancel) != DialogResult.OK) throw new OperationCanceledException("已取消恢复，当前输入未更改。");
        }
        if (Number(selected, "sessions") != new[] {1, 4, 10}[speed.SelectedIndex]) budget.Checked = false;
        job = selected; batch = selectedBatch; DisplayJob();
    }
    void PreviewJob(bool continuing) {
        ValidateBudget(Number(job, "sessions")); DisplayJob();
        if (displayedBatch != batch) { results.VirtualListSize = 0; resultRows.Clear(); resultPage = 0; displayedBatch = null; displayedReceipt = null; RenderPage(true); resultTitle.Text = "结果批次 · " + Path.GetFileName(batch) + " · 待实际读取"; summary.Text = "本地预览只解析范围，尚未读取本批源码。"; }
        var stopFile = Path.Combine(batch, "stop.request"); if (File.Exists(stopFile)) File.Delete(stopFile);
        busy = true; UpdateButtons(); status.Text = "本地预览中 · 不连接服务器"; job["resume"] = continuing; Send(new {op = "run", job, plan = true});
    }
    void ContinueCurrent() {
        if (job == null || batch == null) throw new InvalidOperationException("请先选择或完成一个批次。");
        if (TextValue(job, "url") != url.Text.Trim() || TextValue(job, "ns") != ns.Text.Trim()) throw new InvalidOperationException("请切回当前批次的连接后继续。");
        if (MessageBox.Show(this, "继续批次：" + Path.GetFileName(batch) + "\n使用原清单和原 " + Number(job, "sessions") + " 会话档位，处理剩余项；已确认不补取的 missing 会保留。\n上方新编辑的清单不会加入。", "继续当前批次", MessageBoxButtons.OKCancel) != DialogResult.OK) return;
        if (Number(job, "sessions") != new[] {1, 4, 10}[speed.SelectedIndex]) budget.Checked = false;
        trial.Checked = false; DisplayJob(); PreviewJob(Directory.Exists(Path.Combine(batch, "export")));
    }
    void SaveJob() {
        string file = Path.Combine(batch, "job.json"), temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temp, json.Serialize(job), new UTF8Encoding(false)); if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file); } finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    List<ListViewItem> SelectedRows() { var rows = new List<ListViewItem>(); foreach (int i in results.SelectedIndices) if (resultPage * PageSize + i < visibleRows.Count) rows.Add(visibleRows[resultPage * PageSize + i]); return rows; }
    static string RawStatus(ListViewItem row) { return TextValue(row.Tag as Dictionary<string, object>, "status"); }
    static string RawName(ListViewItem row) { return TextValue(row.Tag as Dictionary<string, object>, "document"); }
    string CopyText(IEnumerable<ListViewItem> rows, bool details) {
        var lines = new List<string>(); foreach (var row in rows) lines.Add(ImportableName(RawName(row)) + (details ? "\t" + row.SubItems[1].Text + "\t" + row.SubItems[2].Text : "")); return String.Join("\r\n", lines);
    }
    void CopyRows(bool details, bool allMissing) {
        var rows = allMissing ? resultRows.FindAll(r => RawStatus(r) == "missing") : SelectedRows(); string text = CopyText(rows, details);
        if (text.Length == 0) throw new InvalidOperationException(allMissing ? "当前批次没有未找到的对象。" : "请先选中结果行；可按 Ctrl 多选，Ctrl+A 选当前页。");
        Clipboard.SetText(text); status.Text = "已复制 " + rows.Count + " 个对象" + (allMissing ? "（包含全部分页）" : "") + "，可直接粘贴核实。";
    }
    void ConfigureCopyMenu() {
        var menu = new ContextMenuStrip(); menu.Items.Add("复制所选对象名（Ctrl+C）", null, (s, e) => Guard(() => CopyRows(false, false))); menu.Items.Add("复制所选行详情", null, (s, e) => Guard(() => CopyRows(true, false))); menu.Items.Add("复制全部未找到对象（全部分页）", null, (s, e) => Guard(() => CopyRows(false, true))); menu.Items.Add(new ToolStripSeparator()); menu.Items.Add("所选缺失确认不补取…", null, (s, e) => Guard(() => ConfirmMissing(false))); menu.Items.Add("恢复所选缺失的补取", null, (s, e) => Guard(() => ConfirmMissing(true))); results.ContextMenuStrip = menu;
        results.KeyDown += (s, e) => { if (e.Control && e.KeyCode == Keys.C) { e.SuppressKeyPress = true; Guard(() => CopyRows(false, false)); } else if (e.Control && e.KeyCode == Keys.A) { e.SuppressKeyPress = true; for (int i = 0; i < results.VirtualListSize; i++) results.Items[i].Selected = true; } };
        results.MouseDown += (s, e) => { if (e.Button == MouseButtons.Right) { var hit = results.HitTest(e.Location); if (hit.Item != null && !hit.Item.Selected) { results.SelectedIndices.Clear(); hit.Item.Selected = true; } } };
    }
    HashSet<string> ConfirmedNames() {
        var names = new HashSet<string>(StringComparer.Ordinal); var values = Value(job, "confirmedMissing") as IEnumerable;
        if (values != null) foreach (var name in values) names.Add(Convert.ToString(name)); return names;
    }
    List<string> PendingMissingNames() {
        var names = new List<string>(); var confirmed = ConfirmedNames();
        if (batch != null && displayedBatch == batch) foreach (var row in resultRows) if (RawStatus(row) == "missing" && !confirmed.Contains(RawName(row))) names.Add(ImportableName(RawName(row)));
        return names;
    }
    void ConfirmMissing(bool undo) {
        if(!legacyMode&&project!=null){
            var active=project.FindRun(project.Index.activeRun);
            if(active==null||!IsProjectJob)throw new InvalidOperationException("本次采集已结束；缺失记录保留，稍后可明确补取或检查更新。");
            foreach(var row in SelectedRows())if(RawStatus(row)=="missing"&&!active.documents.Contains(RawName(row)))throw new InvalidOperationException("所选对象不属于当前采集范围。");
        }
        if (busy || closingPool || closeRequested || job == null) throw new InvalidOperationException("请等待批次结束后处理缺失对象。");
        var selected = SelectedRows().FindAll(r => RawStatus(r) == "missing"); if (selected.Count == 0) throw new InvalidOperationException("请先选中需要处理的未找到对象。");
        if (!undo && MessageBox.Show(this, "将登记所选 " + selected.Count + " 个对象由你确认无需补取。\n原始 404 和缺失清单仍保留；这不代表已取得源码，也不自动验证服务器是否存在。\n后续同批续传跳过这些对象。是否登记？", "确认不再补取", MessageBoxButtons.OKCancel) != DialogResult.OK) return;
        var names = ConfirmedNames(); foreach (var row in selected) { if (undo) names.Remove(RawName(row)); else names.Add(RawName(row)); }
        var ordered = new List<string>(names); ordered.Sort(StringComparer.Ordinal); job["confirmedMissing"] = ordered.ToArray(); job["missingConfirmedAt"] = DateTime.UtcNow.ToString("o"); SaveJob(); displayedReceipt = null; RefreshReceipt(); UpdateButtons();
        status.Text = undo ? "已恢复所选缺失对象的补取。" : "已记录不补取；原始 missing 保留，可继续当前批次。";
    }

    void PaintReceiptSummary(Dictionary<string, object> receipt) {
        var counts = new Dictionary<string, int>(); foreach (var key in new[] {"fetched", "missing", "empty", "failed", "pending", "writing"}) counts[key] = 0;
        var items = Value(receipt, "items") as IEnumerable; if (items != null) foreach (Dictionary<string, object> item in items) { string key = TextValue(item, "status"); if (counts.ContainsKey(key)) counts[key]++; }
        summary.Text = "已取得 " + counts["fetched"] + " / " + resultRows.Count + " 个对象" + (counts["pending"] > 0 ? " · 待处理 " + counts["pending"] : "") + (counts["writing"] > 0 ? " · 正在保存 " + counts["writing"] : "");
        progress.Value = resultRows.Count == 0 ? 0 : Math.Min(100, 100 * (resultRows.Count - counts["pending"] - counts["writing"]) / resultRows.Count);
        var issues = new List<string>(); if (counts["missing"] > 0) issues.Add("未找到 " + counts["missing"]); if (counts["failed"] > 0) issues.Add("失败 " + counts["failed"]); if (counts["empty"] > 0) issues.Add("空内容 " + counts["empty"]); if (ConfirmedNames().Count > 0) issues.Add("已确认不补取 " + ConfirmedNames().Count); problems.Text = String.Join(" · ", issues); problems.Visible = issues.Count > 0;
        lastReason = TextValue(receipt, "reason");
        string scope = TextValue(job, "version"); if (String.IsNullOrEmpty(scope)) scope = TextValue(job, "inputSource"); if (String.IsNullOrEmpty(scope)) scope = "自定义清单";
        resultTitle.Text = "当前任务 · " + scope + " · " + resultRows.Count + " 个对象 · " + Number(job, "sessions") + " 会话";
        bool retained = Flag(receipt, "sessionRetained"), verified = Flag(receipt, "logoutVerified");
        sessionStatus.Text = retained ? "连接保持，可继续导出；空闲 120 秒自动断开" : verified ? "连接已断开（退出响应已确认）" : "断开尚未确认，请查看核查指引";
        if (busy && reading) status.Text = "正在读取 · " + (counts["fetched"] + counts["missing"] + counts["empty"] + counts["failed"]) + " / " + resultRows.Count;
        else if (!String.IsNullOrEmpty(lastReason)) status.Text = ExplainReason(lastReason);
        else if (counts["pending"] + counts["writing"] > 0) status.Text = runningTrial ? "小批试读已结束 · 核对资源后可继续当前批次，处理其余对象" : "本批尚有待处理对象 · 可继续当前批次";
        else status.Text = counts["missing"] + counts["empty"] + counts["failed"] > 0 ? "本批读取结束 · 可筛选问题对象，复制名称核实或确认不再补取" : retained ? "全部源码已取得 · 可打开结果目录，或断开连接结束" : verified ? "导出完成 · 全部源码已取得，连接已断开" : "全部源码已取得 · 断开待确认";
        markMissing.Visible = counts["missing"] > 0;
    }
    static string ExplainReason(string reason) {
        switch (reason) {
            case "atelier-http-401": return "认证失败（401）：请核对用户名、密码及接口认证配置。退出状态另见会话栏。";
            case "atelier-http-503": return "服务器返回 503：请先核实服务与容量状态。";
            case "atelier-transport-or-timeout": return "连接失败或超时：请展开诊断详情查看网络、TLS 或超时分类。";
            case "cancelled-by-user": return "读取已安全停止 · 已保存文件保留，可恢复同一批次。";
            case "resume-source-or-scope-mismatch": return "旧批次的清单、目标或运行时不匹配。请使用原工具恢复；新版范围请新建批次。";
            case "onsite-cleanup-evidence-required": return "请填写实际核查方式、结果，并明确确认现场已核实。";
            case "another-exporter-window-is-running": return "已有另一个导出窗口在运行。请先在该窗口结束任务并退出，再重新打开本工具。";
            default: return reason != null && reason.StartsWith("previous-session-unresolved", StringComparison.Ordinal) ? "上次会话待核查：点击“核查与解除阻断”查看步骤。" : "操作未完成：" + reason + "。请查看诊断详情。";
        }
    }
    void Receive(string line) {
        try {
            var envelope = json.Deserialize<Dictionary<string, object>>(line); string kind = TextValue(envelope, "kind"); var d = Value(envelope, "data") as Dictionary<string, object>;
            if (d.ContainsKey("blocked")) blocked = Flag(d, "blocked");
            if(kind=="result"&&IsProjectJob){ReceiveProjectResult(d);return;}
            if (kind == "ready") { status.Text = blocked ? "上次会话待核查 · 在连接设置中打开“核查会话”" : "就绪 · 点增补源码补充范围，或检查更新"; sessionStatus.Text = blocked ? "服务器会话 · 上次状态未核实" : "服务器会话 · 当前无连接"; Append(status.Text);if(IsProjectJob&&!blocked){lastProjectReceipt=null;PaintProjectProgress();} }
            else if (kind == "result") {
                string output = TextValue(d, "output"); Append(output);
                if (Flag(d, "plan")) {
                    if (closeRequested && !shuttingDown) { busy = false; StartClosing(); }
                    else if (Number(d, "exitCode") != 0) { busy = false; status.Text = ExplainReason(output.Trim()); }
                    else if (MessageBox.Show(this, Preview(output) + "\n\n确认范围并开始实际读取？", "本地预览（尚未连接服务器）", MessageBoxButtons.OKCancel) == DialogResult.OK) { reading = true; runningTrial = trial.Checked; runClock.Restart(); UpdateElapsed(); status.Text = runningTrial ? "正在实际小批试读…" : "正在导出…"; Send(new {op = "run", job, user = user.Text, password = password.Text, resume = Flag(job, "resume"), trial = runningTrial, confirmed = budget.Checked}); }
                    else { busy = false; status.Text = "已取消读取 · 未发送本轮服务器请求"; }
                } else {
                    busy = false; reading = false; runClock.Stop(); UpdateElapsed(); displayedReceipt = null; RefreshReceipt();
                    var result = json.Deserialize<Dictionary<string, object>>(output);
                    if (!String.IsNullOrEmpty(TextValue(result, "operationError"))) { lastReason = TextValue(result, "operationError"); status.Text = ExplainReason(lastReason); }
                    var session = Value(result, "session") as Dictionary<string, object>;
                    if (runningTrial && String.IsNullOrEmpty(TextValue(result, "reason")) && Flag(result, "logoutVerified") && Flag(session, "cookieVerified")) trialIdentity = CurrentTrialIdentity(Number(job, "sessions"));
                    continueCurrent.Text = runningTrial ? "继续当前批次（正式导出）" : "继续当前批次";
                    if (closeRequested && !shuttingDown) StartClosing();
                }
            } else if (kind == "closed") {
                closingPool = false; Append("退出响应核实：" + Flag(d, "cleanupVerified") + "；实际 License 回落仍需现场核对。");
                displayedReceipt = null; RefreshReceipt();
                sessionStatus.Text = Flag(d, "cleanupVerified") ? "连接已断开（退出响应已确认）" : "断开尚未确认，请查看核查指引";
                if (closeRequested && !shuttingDown) {
                    if (Flag(d, "cleanupVerified") || MessageBox.Show(this, "退出尚未核实。关闭窗口将保留待核查状态，下次启动仍受保护。\n是否关闭窗口并保留该状态？", "会话退出待核查", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes) { shuttingDown = true; Send(new {op = "quit"}); }
                    else closeRequested = false;
                }
            } else if (kind == "reconciled") { status.Text = "现场核查依据已登记，可重试；原始退出未核实记录保留。"; sessionStatus.Text = "服务器会话 · 已登记人工核查，未改写为自动注销成功"; }
            else if (kind == "error" || kind == "fatal") { busy = false; closingPool = false; reading = false; runClock.Stop(); SaveProjectElapsed(); UpdateElapsed(); lastReason = TextValue(d, "reason"); status.Text = ExplainReason(lastReason); ShowWorkbenchError(status.Text); if (closeRequested && !shuttingDown) StartClosing(); }
            UpdateButtons();
        } catch (Exception ex) { Append("后台消息处理失败：" + ex.Message); }
    }
    void RequestStop() { if (batch != null) File.WriteAllText(Path.Combine(batch, "stop.request"), "stop"); status.Text = "正在安全停止 · 等待在途请求和文件保存完成…"; }
    void RequestClose() { if (shuttingDown) return; closeRequested = true; UpdateButtons(); if (busy) RequestStop(); else StartClosing(); }
    void StartClosing() { closingPool = true; sessionStatus.Text = "正在退出 · 注销服务器会话，请稍候…"; UpdateButtons(); Send(new {op = "close"}); }
    protected override void Dispose(bool disposing) { if (disposing) { timer.Stop(); timer.Dispose(); if(project!=null){project.Dispose();project=null;} connectionFields.Dispose(); } base.Dispose(disposing); }
    void Reconcile() {
        if (busy || closingPool) throw new InvalidOperationException("请等待当前请求和会话收束。");
        using (var dialog = new Form {Text = "核查服务器遗留会话", Size = new Size(680, 480), MinimumSize = new Size(620, 420), StartPosition = FormStartPosition.CenterParent, Font = Font}) {
            var layout = new TableLayoutPanel {Dock = DockStyle.Fill, Padding = new Padding(12), ColumnCount = 1, RowCount = 7}; dialog.Controls.Add(layout);
            var reason = TextLabel(); reason.MaximumSize = new Size(620, 0); reason.Text = (String.IsNullOrEmpty(lastReason) ? "上次会话状态未核实。" : ExplainReason(lastReason)) + "\n1. 在服务器 Web 会话管理中核查本工具本次连接。\n2. 确认相关会话已结束，并核对资源占用回落。\n3. 填写实际核查方式和结果；此操作只登记依据，不清理服务器。";
            layout.Controls.Add(reason); layout.Controls.Add(new Label {Text = "核查方式（如：查看服务器 Web 会话与资源占用）", AutoSize = true}); var method = new TextBox {Dock = DockStyle.Top}; layout.Controls.Add(method);
            layout.Controls.Add(new Label {Text = "实际核查结果（不要填写密码或 Cookie）", AutoSize = true}); var evidence = new TextBox {Multiline = true, Dock = DockStyle.Fill, ScrollBars = ScrollBars.Vertical}; layout.Controls.Add(evidence);
            var confirmed = new CheckBox {Text = "我已完成上述现场核查，填写内容为实际结果", AutoSize = true}; layout.Controls.Add(confirmed);
            var submit = new Button {Text = "登记核查依据并解除阻断", AutoSize = true, Enabled = false}; layout.Controls.Add(submit);
            for (int i = 0; i < 7; i++) layout.RowStyles.Add(new RowStyle(i == 4 ? SizeType.Percent : SizeType.AutoSize, i == 4 ? 100 : 0));
            EventHandler validate = (s, e) => submit.Enabled = confirmed.Checked && method.Text.Trim().Length >= 4 && evidence.Text.Trim().Length >= 6; method.TextChanged += validate; evidence.TextChanged += validate; confirmed.CheckedChanged += validate;
            submit.Click += (s, e) => { Send(new {op = "reconcile", confirm = true, evidence = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " | " + method.Text.Trim() + " | " + evidence.Text.Trim()}); dialog.Close(); }; dialog.ShowDialog(this);
        }
    }

    static void WorkflowSelfTest(ExporterForm f, string directory) {
        if (f.CopyText(f.resultRows, false) != "Demo.Missing.cls\r\n/app/missing.js") throw new Exception("copy-names-must-be-importable-and-preserve-slash");
        f.busy = true; f.UpdateButtons(); if (!f.documents.Enabled || !f.documents.ReadOnly) throw new Exception("running-list-must-remain-selectable-and-readonly"); f.busy = false; f.UpdateButtons(); if (f.documents.ReadOnly) throw new Exception("idle-list-must-allow-paste");
        f.job["confirmedMissing"] = new[] {"Demo.Missing.cls"}; f.SaveJob(); f.displayedReceipt = null; f.RefreshReceipt();
        if (f.resultRows[0].SubItems[1].Text != "未找到（已确认不补取）" || f.PendingMissingNames().Count != 1 || f.CopyText(f.resultRows, false) != "Demo.Missing.cls\r\n/app/missing.js") throw new Exception("missing-ack-must-preserve-copy-and-exclude-only-retries");
        var restored = f.json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(f.batch, "job.json"))); if (Value(restored, "confirmedMissing") == null) throw new Exception("missing-ack-not-persisted");
        f.speed.SelectedIndex = 1; f.trial.Checked = false; f.budget.Checked = false; f.trialIdentity = f.CurrentTrialIdentity(4);
        try { f.ValidateBudget(4); throw new Exception("budget-guard-missing"); } catch (InvalidOperationException e) { if (!e.Message.Contains("本次已完成小批试读") || !e.Message.Contains("还缺")) throw; }
        f.password.Text += "changed"; if (f.trialIdentity != null || f.budget.Checked) throw new Exception("credential-change-must-invalidate-trial-and-budget");
        var xml = Path.Combine(directory, "classes.xml"); int duplicates, ignored;
        File.WriteAllText(xml, "<Export><Class name=\"Demo.First\"><Method name=\"M\"><Implementation><![CDATA[<Class name=\"Not.Real\"/>]]></Implementation></Method></Class><Class name=\"Demo.First\"/><Routine name=\"Example\" type=\"MAC\"/><Class name=\"Demo.Last\"/></Export>", Encoding.UTF8);
        if (ExtractClasses(xml, out duplicates, out ignored) != "Demo.First.cls\r\nDemo.Last.cls\r\n" || duplicates != 1 || ignored != 1) throw new Exception("source-xml-class-extraction-invalid");
        foreach (string invalid in new[] {"<Project><ProjectItem name=\"Demo.A\"/></Project>", "<!DOCTYPE Export [<!ENTITY x SYSTEM 'file:///must-not-read'>]><Export><Class name=\"Demo.A\"/></Export>", "<Export><Class name=\"Demo.A\"/><Class name=\"demo.a\"/></Export>", "<Export><Class name=\"Demo.A\">"}) {
            File.WriteAllText(xml, invalid, Encoding.UTF8); bool rejected = false; try { ExtractClasses(xml, out duplicates, out ignored); } catch { rejected = true; } if (!rejected) throw new Exception("unsafe-or-malformed-source-xml-accepted");
        }
        // Compare actual rendered bounds at small windows and enlarged fonts; no network worker is started.
        foreach (float scale in new[] {1f, 1.25f, 1.5f}) {
            string state = Path.Combine(directory, "layout-" + scale.ToString(System.Globalization.CultureInfo.InvariantCulture));
            using (var view = new ExporterForm(state)) {
                view.ShowInTaskbar = false; view.StartPosition = FormStartPosition.Manual; view.Location = new Point(-20000, -20000);
                view.Font = new Font(view.Font.FontFamily, 9f * scale); view.Size = new Size(1000, 820); view.speed.SelectedIndex = 1; view.version.SelectedIndex = 3;
                view.documents.Text = "Demo.First.cls\r\n/app/example.js"; view.Show(); Application.DoEvents(); view.PerformLayout();
                foreach (Control control in new Control[] {view.start, view.resume, view.continueCurrent, view.closePool, view.checkUpdates, view.results, view.progress}) {
                    if (!control.Visible) throw new Exception("required-action-hidden: " + control.Text);
                    if(control.Width<20||control.Height<5)throw new Exception("required-action-has-no-usable-space: "+control.Text);
                    for(Control child=control;child.Parent!=null&&child!=view.windowLayout;child=child.Parent){
                        var scrolling=child.Parent as ScrollableControl;if(scrolling!=null&&scrolling.AutoScroll)break;
                        if(!child.Parent.ClientRectangle.Contains(child.Bounds))throw new Exception("action-clipped-by-parent: "+control.Text+" / "+child.GetType().Name+" "+child.Bounds+" in "+child.Parent.GetType().Name+" "+child.Parent.ClientRectangle+" @ "+scale);
                    }
                }
                using (var bitmap = new Bitmap(view.Width, view.Height)) { view.DrawToBitmap(bitmap, new Rectangle(Point.Empty, view.Size)); bitmap.Save(Path.Combine(directory, "layout-" + scale.ToString(System.Globalization.CultureInfo.InvariantCulture) + ".png")); }
                using (var bitmap = new Bitmap(view.windowLayout.Width, view.windowLayout.Height)) { view.windowLayout.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size)); bitmap.Save(Path.Combine(directory, "surface-" + scale.ToString(System.Globalization.CultureInfo.InvariantCulture) + ".png")); }
                view.Close();
            }
        }
        int duplicateCount;
        if(Deduplicate("Demo.A.cls\r\nDemo.A.cls\r\nDemo.B.cls",out duplicateCount)!="Demo.A.cls\r\nDemo.B.cls"||duplicateCount!=1)throw new Exception("project-list-deduplication-failed");
    }
}
