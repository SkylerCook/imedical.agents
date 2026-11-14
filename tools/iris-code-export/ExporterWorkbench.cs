using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

// Uses the existing .NET Framework/WinForms runtime; no browser or additional UI runtime.
public sealed partial class ExporterForm {
    ProjectBaseline project;
    BaselineRun projectRun;
    readonly TextBox searchNames = new SearchBox();
    readonly TextBox projectVersionInput = new TextBox();
    readonly ComboBox fileKind = new ComboBox();
    readonly Label projectHeading = new Label(), projectOverview = new Label(), projectPath = new Label(), errorBanner = new Label();
    readonly Button checkUpdates = new Button(), acceptUpdates = new Button(), keepCurrent = new Button(), openProject = new Button(), freezeProject = new Button(), historyProject = new Button();
    readonly FlowLayoutPanel workbenchActions = new FlowLayoutPanel();
    readonly List<Button> workbenchInputs = new List<Button>();
    readonly Panel projectBody = new Panel();
    int projectRemainingCount;
    Form diagnosticWindow;
    Button importShared;
    readonly TextBox connectionHost = new TextBox(), connectionPort = new TextBox();
    readonly ComboBox connectionScheme = new ComboBox();
    string connectionPath = "/api/atelier/";
    void ReadConnectionAddress() {
        Uri address;
        if(!Uri.TryCreate(url.Text, UriKind.Absolute, out address)) return;
        connectionHost.Text = address.Host;
        connectionPort.Text = address.Port.ToString();
        connectionScheme.SelectedItem = address.Scheme;
        connectionPath = address.AbsolutePath;
    }
    string BuildConnectionAddress() {
        string host = connectionHost.Text.Trim();
        if(host.Contains("://")) return ExporterConnection.Normalize(host);
        int port;
        if(!Int32.TryParse(connectionPort.Text, out port) || port < 1 || port > 65535) throw new IOException("请填写 1–65535 之间的 Web 端口。");
        if(String.IsNullOrWhiteSpace(host) || host.IndexOfAny(new[]{'/', '\\', '?', '#', '@', ' '}) >= 0) throw new IOException("请填写服务器主机名或 IP。");
        return ExporterConnection.Normalize(new UriBuilder(connectionScheme.Text, host, port, connectionPath).Uri.AbsoluteUri);
    }

    bool projectUI = true, legacyMode, projectImporting;
    long elapsedBeforeResume, lastElapsedSaved;
    string lastProjectReceipt;
    static readonly Color WorkBlue = Color.FromArgb(40, 100, 220), WorkMuted = Color.FromArgb(100, 116, 139);
    Button ActionButton(string text, Action action, bool primary) {
        var b = new Button {Text = text, AutoSize = true, MinimumSize = new Size(88, 34), FlatStyle = FlatStyle.Flat, BackColor = primary ? WorkBlue : Color.White, ForeColor = primary ? Color.White : Color.FromArgb(23, 43, 71), Padding = new Padding(8, 3, 8, 3), Margin = new Padding(4), Cursor = Cursors.Hand};
        b.FlatAppearance.BorderColor = primary ? WorkBlue : Color.FromArgb(220, 229, 240);
        b.Click += (s, e) => Guard(action); return b;
    }
    static Panel Card() {return new WorkbenchCard {Dock = DockStyle.Fill, Padding = new Padding(16), Margin = new Padding(0, 0, 0, 14)};}
    static Label Note(string text) {return new Label {Text = text, AutoSize = true, ForeColor = WorkMuted, Margin = new Padding(3, 7, 3, 7)};}
    void BuildWorkbench() {
        AutoScaleMode = AutoScaleMode.Font; Text = "项目源码基线"; BackColor = Color.FromArgb(245, 247, 251);
        Size = new Size(1200, 880); MinimumSize = new Size(980, 700);
        windowLayout = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, BackColor = BackColor, Padding = new Padding(18)};
        windowLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        windowLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); windowLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); windowLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); Controls.Add(windowLayout);
        var top = new TableLayoutPanel {Dock = DockStyle.Top, AutoSize = true, ColumnCount = 3, BackColor = Color.White, Padding = new Padding(12), Margin = new Padding(0, 0, 0, 16)};
        top.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); top.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        top.Controls.Add(new Label {Text = "▣  项目源码基线", Font = new Font(Font, FontStyle.Bold), AutoSize = true, Margin = new Padding(4, 10, 25, 4)}, 0, 0);
        profiles.Width = 300; profiles.Anchor = AnchorStyles.Right; profiles.Margin = new Padding(3, 7, 12, 3); top.Controls.Add(profiles, 1, 0);
        top.Controls.Add(ActionButton("连接设置", ShowConnectionSettings, false), 2, 0); windowLayout.Controls.Add(top, 0, 0);
        var lead = new TableLayoutPanel {AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,Dock=DockStyle.Top,ColumnCount=2,Margin=new Padding(0,0,0,14)};
        lead.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));lead.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,250));
        var title = new FlowLayoutPanel {AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false};
        projectHeading.Text = "这家医院的源码，都在这里"; projectHeading.AutoSize = true; projectHeading.Font = new Font(Font.FontFamily, 17, FontStyle.Bold); title.Controls.Add(projectHeading); title.Controls.Add(Note("往同一目录增补源码，随时检查服务器变化。")); lead.Controls.Add(title, 0, 0);
        var mainActions = new FlowLayoutPanel {AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,Dock=DockStyle.Fill,WrapContents=true};
        checkUpdates.Text = "检查更新"; start.Text = "增补源码";
        foreach (var button in new[] {checkUpdates, start}) {button.AutoSize = true; button.MinimumSize = new Size(106, 40); mainActions.Controls.Add(button);}
        start.Click += (s, e) => Guard(() => ShowAddDialog(false)); checkUpdates.Click += (s, e) => Guard(() => BeginProject("check")); lead.Controls.Add(mainActions, 1, 0); windowLayout.Controls.Add(lead, 0, 1);
        var body = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1};
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 232)); body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); windowLayout.Controls.Add(body, 0, 2);
        var side = new FlowLayoutPanel {Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(0, 0, 14, 0)};
        var add = new FlowLayoutPanel {BackColor = Color.White, Width = 212, Height = 218, FlowDirection = FlowDirection.TopDown, Padding = new Padding(12), WrapContents = false, Margin = new Padding(0, 0, 0, 14)};
        add.Controls.Add(new Label {Text = "拖入清单，直接增补", AutoSize = true, Font = new Font(Font, FontStyle.Bold), Margin = new Padding(4, 12, 4, 8)});
        add.Controls.Add(Note("TXT / 源码 XML · 自动去重"));
        importList.Text = "选择 TXT / XML"; importList.AutoSize = true; importList.Width = 182; importList.Click += (s, e) => Guard(() => ShowAddDialog(true)); add.Controls.Add(importList);
        var paste = ActionButton("粘贴对象名", () => ShowAddDialog(false), false); paste.Width = 182; workbenchInputs.Add(paste); add.Controls.Add(paste);
        var byVersion = ActionButton("按版本补充", () => {version.SelectedIndex = Math.Max(1, version.SelectedIndex); ShowAddDialog(false);}, false); byVersion.Width = 182; workbenchInputs.Add(byVersion); add.Controls.Add(byVersion); side.Controls.Add(add);
        var browse = new FlowLayoutPanel {BackColor = Color.White, Width = 212, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(12), Margin = new Padding(0, 0, 0, 14)};
        browse.Controls.Add(new Label {Text = "浏览基线", AutoSize = true, Font = new Font(Font, FontStyle.Bold), Margin = new Padding(4, 8, 4, 10)});
        foreach (var label in new[] {"全部范围", "当前文件", "需处理", "本次变化"}) {
            string selected = label; var button = ActionButton(label, () => {resultFilter.SelectedIndex = selected == "全部范围" ? 0 : selected == "当前文件" ? 3 : selected == "需处理" ? 2 : 5;}, false); button.Width = 182; browse.Controls.Add(button);
        }
        resume.Text = "打开项目目录…"; resume.AutoSize = true; resume.Width = 182; resume.Click += (s, e) => Guard(ChooseProject); browse.Controls.Add(resume);
        importShared=ActionButton("导入共享基线…",ImportSharedProject,false);importShared.Width=182;browse.Controls.Add(importShared);
        historyProject.Text = "更新记录"; historyProject.AutoSize = true; historyProject.Click += (s, e) => Guard(ShowProjectHistory); browse.Controls.Add(historyProject); side.Controls.Add(browse);
        var sideNote = Note("同一来源、同一目录持续增补。\r\n检查时间与内容更新时间分别记录。"); sideNote.MaximumSize = new Size(210, 0); side.Controls.Add(sideNote);
        body.Controls.Add(side, 0, 0);
        var wheelRouter = new WorkbenchWheelRouter(body);
        Application.AddMessageFilter(wheelRouter);
        Disposed += (s, e) => Application.RemoveMessageFilter(wheelRouter);
        projectBody.Dock = DockStyle.Fill; projectBody.AutoScroll = true; body.Controls.Add(projectBody, 1, 0);
        var main = new TableLayoutPanel {Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, RowCount = 5};
        main.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        foreach (var size in new[] {SizeType.AutoSize, SizeType.Absolute, SizeType.Absolute, SizeType.Absolute, SizeType.Absolute}) main.RowStyles.Add(new RowStyle(size, size == SizeType.Absolute ? 100 : 0));
        main.RowStyles[1].Height=138;main.RowStyles[2].Height = 190; main.RowStyles[3].Height = 48; main.RowStyles[4].Height = 260;
        projectBody.Controls.Add(main);
        errorBanner.AutoSize = true; errorBanner.BackColor = Color.FromArgb(255, 240, 241); errorBanner.ForeColor = Color.FromArgb(168, 39, 50); errorBanner.Padding = new Padding(14); errorBanner.Visible = false; errorBanner.Margin = new Padding(0, 0, 0, 12); main.Controls.Add(errorBanner, 0, 0);
        var overview = Card();var overviewLayout=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=2,RowCount=2,Margin=Padding.Empty};
        overviewLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));overviewLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,244));
        overviewLayout.RowStyles.Add(new RowStyle(SizeType.Percent,100));overviewLayout.RowStyles.Add(new RowStyle(SizeType.Absolute,22));
        projectOverview.AutoSize=false;projectOverview.AutoEllipsis=true;projectOverview.Font=new Font(Font.FontFamily,10,FontStyle.Bold);projectOverview.Dock=DockStyle.Fill;projectOverview.Margin=Padding.Empty;overviewLayout.Controls.Add(projectOverview,0,0);
        projectPath.AutoSize=false;projectPath.AutoEllipsis=true;projectPath.Dock=DockStyle.Fill;projectPath.ForeColor=WorkMuted;projectPath.Margin=Padding.Empty;overviewLayout.Controls.Add(projectPath,0,1);overviewLayout.SetColumnSpan(projectPath,2);
        var overviewButtons = new FlowLayoutPanel {Dock=DockStyle.Fill,WrapContents=false,Margin=Padding.Empty};
        openProject.Text = "打开目录"; freezeProject.Text = "保存版本基线"; foreach (var b in new[] {openProject, freezeProject}) {b.AutoSize = true; overviewButtons.Controls.Add(b);}
        openProject.Click += (s, e) => Guard(() => {EnsureProject(); Process.Start("explorer.exe", "\"" + project.Root + "\"");});
        freezeProject.Click += (s, e) => Guard(FreezeProject); overviewLayout.Controls.Add(overviewButtons,1,0);overview.Controls.Add(overviewLayout);main.Controls.Add(overview,0,1);
        var activity = Card(); var activityLayout = new TableLayoutPanel {Dock = DockStyle.Fill, RowCount = 5, ColumnCount = 2};
        activityLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); activityLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        activityLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));activityLayout.RowStyles.Add(new RowStyle(SizeType.Absolute,15));activityLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));activityLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        activityLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        summary.AutoSize = true; summary.Text = "尚未采集 · 已保存的结果和用时会保留"; activityLayout.Controls.Add(summary, 0, 0);
        elapsedLabel.AutoSize = true; elapsedLabel.Dock = DockStyle.None; elapsedLabel.Font = new Font(Font.FontFamily,10,FontStyle.Bold); activityLayout.Controls.Add(elapsedLabel, 1, 0);
        progress.Dock = DockStyle.Fill; progress.Height = 8; activityLayout.Controls.Add(progress, 0, 1); activityLayout.SetColumnSpan(progress, 2);
        status.AutoSize = true; status.Text = "请选择连接和项目目录"; activityLayout.Controls.Add(status, 0, 2);
        workbenchActions.AutoSize = true; workbenchActions.Dock = DockStyle.Fill; workbenchActions.WrapContents = true;
        continueCurrent.Text = "继续上次采集"; stop.Text = "暂停"; closePool.Text = "断开连接"; diagnosticToggle.Text = "诊断详情"; retryMissing.Text = "补取未取得项";
        sessionStatus.AutoSize = true; sessionStatus.ForeColor = WorkMuted; sessionStatus.Text = "连接尚未使用"; activityLayout.Controls.Add(sessionStatus, 0, 3); activityLayout.SetColumnSpan(sessionStatus, 2);
        foreach (var b in new[] {continueCurrent, stop, closePool, retryMissing, diagnosticToggle}) {b.AutoSize = true; workbenchActions.Controls.Add(b);} activityLayout.Controls.Add(workbenchActions, 0, 4); activityLayout.SetColumnSpan(workbenchActions, 2);
        continueCurrent.Click += (s, e) => Guard(() => {if (legacyMode) ContinueCurrent(); else ContinueProject();}); stop.Click += (s, e) => Guard(RequestStop);
        closePool.Click += (s, e) => Guard(() => {closingPool = true; UpdateButtons(); Send(new {op = "close"});}); retryMissing.Click += (s, e) => Guard(() => {if (legacyMode) {PrepareMissingRetry(); Begin(false);} else BeginProject("retry");});
        diagnosticToggle.Click += (s, e) => ShowDiagnostics();
        activity.Controls.Add(activityLayout); main.Controls.Add(activity, 0, 2);
        var filters = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 4}; filters.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 114)); filters.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112)); filters.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); filters.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        resultFilter.DropDownStyle = fileKind.DropDownStyle = ComboBoxStyle.DropDownList;
        resultFilter.Items.AddRange(new object[] {"全部范围", "未找到", "需处理", "当前文件", "等待采集", "本次变化"});
        fileKind.Items.AddRange(new object[] {"全部类型", "类定义", "例程 / 头文件", "Web 文件"}); resultFilter.SelectedIndex = fileKind.SelectedIndex = 0;
        searchNames.Dock = DockStyle.Fill; searchNames.AccessibleName = "查找对象名称"; searchNames.Margin = new Padding(6, 3, 6, 3);
        filters.Controls.Add(resultFilter, 0, 0); filters.Controls.Add(fileKind, 1, 0); filters.Controls.Add(searchNames, 2, 0); filters.Controls.Add(ActionButton("复制所选", () => CopyRows(false, false), false), 3, 0);
        resultFilter.SelectedIndexChanged += (s, e) => {resultPage = 0; RenderPage(true);}; fileKind.SelectedIndexChanged += (s, e) => {resultPage = 0; RenderPage(true);}; searchNames.TextChanged += (s, e) => {resultPage = 0; RenderPage(true);}; main.Controls.Add(filters, 0, 3);
        var listCard = Card(); listCard.Padding = new Padding(7);
        results.VirtualMode = true; results.RetrieveVirtualItem += (s, e) => e.Item = visibleRows[resultPage * PageSize + e.ItemIndex]; results.View = View.Details; results.FullRowSelect = true; results.HideSelection = false; results.MultiSelect = true; results.Dock = DockStyle.Fill;
        results.Columns.Add("完整对象名（选中 Ctrl+C）", 325); results.Columns.Add("状态", 135); results.Columns.Add("字节", 72); results.Columns.Add("最近检查", 122); results.Columns.Add("内容更新", 122); ConfigureCopyMenu();
        results.DoubleClick += (s, e) => Guard(ShowProjectDiff);
        results.SelectedIndexChanged += (s, e) => UpdateWorkbench();
        var pages = new FlowLayoutPanel {AutoSize = true, Dock = DockStyle.Bottom}; pages.Controls.Add(pageLabel); pages.Controls.Add(previousPage); pages.Controls.Add(nextPage);
        previousPage.Click += (s, e) => {resultPage--; RenderPage(true);}; nextPage.Click += (s, e) => {resultPage++; RenderPage(true);};
        acceptUpdates.Text = "接纳可更新项"; keepCurrent.Text = "保留当前版本";
        foreach (var b in new[] {acceptUpdates, keepCurrent}) {b.AutoSize = true; pages.Controls.Add(b);}
        acceptUpdates.Click += (s, e) => Guard(() => {EnsureProject(); int count = project.AcceptChanges(); status.Text = "已更新 " + count + " 项；旧版与采集记录已保留。"; RenderProject();});
        keepCurrent.Click += (s, e) => Guard(() => {EnsureProject(); project.KeepCurrentCandidates(); status.Text = "已保留当前版本；服务器候选仍可从更新记录查看。"; RenderProject();});
        listCard.Controls.Add(results); listCard.Controls.Add(pages); main.Controls.Add(listCard, 0, 4);
        diagnostics.Dock = DockStyle.Fill; diagnostics.Visible = false; log.Multiline = true; log.ReadOnly = true; log.ScrollBars = ScrollBars.Both; log.WordWrap = false; log.Dock = DockStyle.Fill; diagnostics.Controls.Add(log);
        Disposed += (s, e) => {if (diagnosticWindow != null) diagnosticWindow.Dispose(); else diagnostics.Dispose();};
        main.SizeChanged += (s, e) => {errorBanner.MaximumSize = new Size(Math.Max(200, main.Width - 5), 0);};
        projectBody.SizeChanged += (s, e) => {main.Width = Math.Max(500, projectBody.ClientSize.Width - SystemInformation.VerticalScrollBarWidth); main.RowStyles[4].Height = Math.Max(260, projectBody.ClientSize.Height - 407);};
        connectionFields = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 9, Padding = new Padding(16)};
        connectionFields.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); connectionFields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var addressFields = new FlowLayoutPanel {AutoSize=true, Dock=DockStyle.Fill, WrapContents=true};
        connectionHost.Width=250; connectionPort.Width=70;
        connectionScheme.DropDownStyle=ComboBoxStyle.DropDownList;connectionScheme.Items.AddRange(new object[]{"http","https"});connectionScheme.SelectedIndex=0;connectionScheme.Width=80;
        addressFields.Controls.Add(connectionHost);addressFields.Controls.Add(connectionScheme);addressFields.Controls.Add(Note("Web 端口"));addressFields.Controls.Add(connectionPort);
        Add(connectionFields, "主机 / IP", addressFields, 0, 0);
        connectionHost.Leave += (s,e) => {if(connectionHost.Text.Contains("://")) Guard(()=>{url.Text=ExporterConnection.Normalize(connectionHost.Text);ReadConnectionAddress();});};
        var advancedAddress = new FlowLayoutPanel {AutoSize=true,Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown};
        var showAddress = new CheckBox {Text="高级设置 · 完整 Atelier 地址",AutoSize=true};url.Width=520;url.Visible=false;
        showAddress.CheckedChanged += (s,e)=>{if(showAddress.Checked)Guard(()=>{url.Text=BuildConnectionAddress();});url.Visible=showAddress.Checked;};
        url.Leave += (s,e)=>Guard(()=>{url.Text=ExporterConnection.Normalize(url.Text);ReadConnectionAddress();});
        advancedAddress.Controls.Add(showAddress);advancedAddress.Controls.Add(url);connectionFields.Controls.Add(advancedAddress,1,8);
         Add(connectionFields, "命名空间", ns, 0, 1); Add(connectionFields, "用户名", user, 0, 2); Add(connectionFields, "密码", password, 0, 3); Add(connectionFields, "源码保存目录", destination, 0, 4);
        password.UseSystemPasswordChar = true; remember.Text = "本机加密记住密码"; remember.AutoSize = true; connectionFields.Controls.Add(remember, 1, 5);
        Add(connectionFields, "高级 · 并发采集", speed, 0, 6); speed.DropDownStyle = ComboBoxStyle.DropDownList; speed.Items.AddRange(new object[] {"默认 · 1 会话 / 200ms", "并发 · 4 会话 / 100ms", "并发 · 10 会话 / 50ms"}); speed.SelectedIndex = 0;
        trial.Text = "多会话先做小批验证"; trial.AutoSize = true; budget.Text = "已核实资源，允许当前并发档位（同一连接与账号自动复用）"; budget.AutoSize = true; var advanced = new FlowLayoutPanel {AutoSize = true, Dock = DockStyle.Top}; advanced.Controls.Add(budget); connectionFields.Controls.Add(advanced, 1, 7);
        web.Text = "已核对版本 Web 路径"; web.AutoSize = true; version.DropDownStyle = ComboBoxStyle.DropDownList; version.Items.AddRange(new object[] {"自定义清单", "v8.3 医生站（重建）", "v8.4 医生站", "v8.5 医生站", "v9.0 医生站", "v9.0.2 医生站", "v9.1 医生站", "v9.2 全产品"}); version.SelectedIndex = 0;
        documents.Multiline = true; documents.ScrollBars = ScrollBars.Both; documents.WordWrap = false;
        version.SelectedIndexChanged += (s, e) => UpdateInputSummary(); documents.TextChanged += (s, e) => UpdateInputSummary();
        AllowDrop = true; DragEnter += (s, e) => {if (!busy && e.Data.GetDataPresent(DataFormats.FileDrop)) e.Effect = DragDropEffects.Copy;};
        DragDrop += (s, e) => Guard(() => {var files = (string[])e.Data.GetData(DataFormats.FileDrop); if (files.Length != 1) throw new IOException("请一次导入一个 TXT 或源码 XML。"); LoadProjectList(files[0]); ShowAddDialog(false);});
        ApplyVisualStyle(windowLayout); start.BackColor = WorkBlue; start.ForeColor = Color.White; start.FlatAppearance.BorderSize = 0;
        UpdateWorkbench(); RenderPage(false);
    }
    void ShowDiagnostics() {
        if (diagnosticWindow == null || diagnosticWindow.IsDisposed) {
            var area = Screen.FromControl(this).WorkingArea;
            diagnosticWindow = new Form {Text = "诊断详情", AutoScaleMode = AutoScaleMode.Font, Size = new Size(Math.Min(1080, area.Width - 40), Math.Min(680, area.Height - 40)), MinimumSize = new Size(560, 360), StartPosition = FormStartPosition.Manual, Font = Font, ShowInTaskbar = false};
            diagnosticWindow.Location = new Point(Math.Max(area.Left, Math.Min(Left + (Width - diagnosticWindow.Width) / 2, area.Right - diagnosticWindow.Width)), Math.Max(area.Top, Math.Min(Top + (Height - diagnosticWindow.Height) / 2, area.Bottom - diagnosticWindow.Height)));
            var footer = new FlowLayoutPanel {Dock = DockStyle.Bottom, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8)};
            var close = ActionButton("关闭", () => diagnosticWindow.Close(), false);
            footer.Controls.Add(close); diagnosticWindow.Controls.Add(diagnostics); diagnosticWindow.Controls.Add(footer); diagnosticWindow.CancelButton = close;
            diagnosticWindow.FormClosing += (s, e) => {if (e.CloseReason == CloseReason.UserClosing) {e.Cancel = true; diagnosticWindow.Hide(); diagnostics.Visible = false;}};
        }
        diagnostics.Visible = true;
        if (!diagnosticWindow.Visible) diagnosticWindow.Show(this);
        if (diagnosticWindow.WindowState == FormWindowState.Minimized) diagnosticWindow.WindowState = FormWindowState.Normal;
        diagnosticWindow.Activate();
    }
    void ShowConnectionSettings() {
        if (busy) throw new InvalidOperationException("请先暂停当前采集。");
        ReadConnectionAddress();
        using (var dialog = new Form {Text = "项目连接设置", Size = new Size(900, 650), MinimumSize = new Size(800, 600), StartPosition = FormStartPosition.CenterParent, Font = Font}) {
            var footer = new FlowLayoutPanel {Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(10)};
            var nameLine=new FlowLayoutPanel {Dock=DockStyle.Top,AutoSize=true,Padding=new Padding(16,10,16,0)};
            nameLine.Controls.Add(Note("项目 / 环境名称"));var projectName=new TextBox {Text=profiles.Text,Width=420};nameLine.Controls.Add(projectName);
            footer.Controls.Add(ActionButton("选择源码保存目录…", () => {using (var picker = new FolderBrowserDialog {Description = "选择已有项目基线，或新的空目录"}) if (picker.ShowDialog(dialog) == DialogResult.OK) destination.Text = picker.SelectedPath;}, false));
            footer.Controls.Add(ActionButton("从已有项目读取连接…", () => {
                using(var picker = new FolderBrowserDialog {Description="选择已配置连接的项目文件夹"}) if(picker.ShowDialog(dialog)==DialogResult.OK) {
                    var imported=ExporterConnection.ReadProject(picker.SelectedPath);
                    url.Text=imported["url"];ns.Text=imported["namespace"];projectName.Text=imported["name"];
                    user.Clear();password.Clear();remember.Checked=false;ReadConnectionAddress();
                }
            }, false));
            footer.Controls.Add(ActionButton("保存设置", () => {url.Text=BuildConnectionAddress();ReadConnectionAddress();if(String.IsNullOrWhiteSpace(ns.Text))throw new IOException("请填写命名空间。");profiles.Text=projectName.Text.Trim();SaveProfile(); if (project != null) {project.Dispose(); project = null;} TryOpenSavedProject(); dialog.Close();}, true));
            footer.Controls.Add(ActionButton("核查会话", Reconcile, false));
            footer.Controls.Add(ActionButton("恢复旧批次…", () => {legacyMode = true; Begin(true); dialog.Close();}, false));
            footer.Controls.Add(ActionButton("使用说明",()=>Process.Start("notepad.exe","\""+Path.Combine(home,"GUI.md")+"\""),false));
            connectionFields.Visible = true; dialog.Controls.Add(connectionFields); dialog.Controls.Add(nameLine); dialog.Controls.Add(footer);
            try {dialog.ShowDialog(this);} finally {dialog.Controls.Remove(connectionFields);}
        }
    }
    void ChooseProject() {
        if (busy) throw new InvalidOperationException("请先暂停当前采集。");
        using (var dialog = new FolderBrowserDialog {Description = "一个项目使用一个目录；选择已有项目基线，或新的空目录"}) if (dialog.ShowDialog(this) == DialogResult.OK) {
            if (project != null) {project.Dispose(); project = null;} destination.Text = dialog.SelectedPath; EnsureProject(); RenderProject();
        }
    }
    void EnsureProject() {
        if (project != null && !String.Equals(project.Root, destination.Text.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) {project.Dispose(); project = null;}
        if (project == null) {
            if (!Path.IsPathRooted(destination.Text)) throw new InvalidOperationException("请在连接设置中选择项目基线目录。");
            projectRun=null;job=null;batch=null;lastProjectReceipt=null;runClock.Reset();elapsedBeforeResume=0;
            project = new ProjectBaseline(destination.Text, profiles.Text.Length == 0 ? "项目基线" : profiles.Text, null);
            projectVersionInput.Text=project.Index.projectVersion??"";
            legacyMode = false; var active = project.FindRun(project.Index.activeRun);
            if(active==null&&project.Index.runs.Count>0)active=project.Index.runs[project.Index.runs.Count-1];
            if(active!=null){
                projectRun=active;batch=project.RunDirectory(active.id);
                string savedJob=Path.Combine(batch,"job.json");
                if(File.Exists(savedJob)){
                    var loaded=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(savedJob,Encoding.UTF8));
                    if(String.Equals(TextValue(loaded,"batch"),batch,StringComparison.OrdinalIgnoreCase))job=loaded;
                }
                elapsedBeforeResume=active.elapsedMs;runClock.Reset();elapsedLabel.Text="本次用时："+FormatElapsed(TimeSpan.FromMilliseconds(active.elapsedMs));
                PaintProjectProgress();if(!String.IsNullOrEmpty(project.Index.activeRun))status.Text="上次采集尚未完成，可在同目录继续。";
            }
        }
    }
    void TryOpenSavedProject() {
        if (!String.IsNullOrEmpty(destination.Text) && File.Exists(Path.Combine(destination.Text, ".export/project.json"))) {
            try {EnsureProject(); RenderProject();} catch (Exception ex) {ShowWorkbenchError(ex.Message);}
        } else {projectOverview.Text=Path.IsPathRooted(destination.Text)?"还没有源码 · 点增补源码开始建立基线":"先在连接设置选择项目和保存目录";projectPath.Text=destination.Text;UpdateWorkbench();}
    }
    void ShowAddDialog(bool pickFile) {
        if (busy) throw new InvalidOperationException("当前任务正在采集，请先暂停。");
        using (var dialog = new Form {Text = "增补到当前基线", Size = new Size(820, 600), MinimumSize = new Size(700, 550), StartPosition = FormStartPosition.CenterParent, Font = Font, BackColor = BackColor}) {
            var layout = new TableLayoutPanel {Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5, Padding = new Padding(18)};
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            var line = new FlowLayoutPanel {AutoSize = true, Dock = DockStyle.Top}; version.Width = 235; line.Controls.Add(version);
            line.Controls.Add(ActionButton("选择 TXT / XML", () => {using (var file = new OpenFileDialog {Filter = "对象清单或源码 XML|*.txt;*.xml"}) if (file.ShowDialog(dialog) == DialogResult.OK) LoadProjectList(file.FileName);}, false));
            line.Controls.Add(Note("项目版本"));projectVersionInput.Width=130;projectVersionInput.AccessibleName="项目版本（填写，独立于清单版本）";line.Controls.Add(projectVersionInput);line.Controls.Add(web); layout.Controls.Add(line, 0, 0);
            inputTitle.AutoSize = true; layout.Controls.Add(inputTitle, 0, 1);
            documents.Dock = DockStyle.Fill; documents.MinimumSize = new Size(0, 220); layout.Controls.Add(documents, 0, 2);
            var hint = Note("每行一个完整对象名，自动合并重复项；已取得文件跳过。\r\n继续写入当前项目目录，连接检查包含在本次采集中。"); layout.Controls.Add(hint, 0, 3);
            var buttons = new FlowLayoutPanel {Dock = DockStyle.Top, AutoSize = true};
            var sample = new CheckBox {Name="sampleOnly", Text="仅试采前", AutoSize=true, Checked=false};
            var count = new NumericUpDown {Minimum=1, Maximum=100, Value=10, Width=65};
            buttons.Controls.Add(sample); buttons.Controls.Add(count); buttons.Controls.Add(Note("项"));
            buttons.Controls.Add(ActionButton("取消", () => dialog.Close(), false));
            var submit = ActionButton(sample.Checked ? "开始试采" : "增补到当前基线", () => {BeginProjectSample("append", sample.Checked ? (int)count.Value : 0); dialog.Close();}, true);
            count.Enabled=sample.Checked; sample.CheckedChanged += (s,e) => {count.Enabled=sample.Checked;submit.Text=sample.Checked ? "开始试采" : "增补到当前基线";};
            buttons.Controls.Add(submit); layout.Controls.Add(buttons, 0, 4); dialog.Controls.Add(layout);
            // These controls edit the existing connection settings; they are not a second configuration.
            var concurrency = new FlowLayoutPanel {Name="concurrencySettings", AutoSize=true, Dock=DockStyle.Top, WrapContents=true, Visible=false};
            var advancedLink = new LinkLabel {Text="高级采集设置 · 当前 " + speed.Text, AutoSize=true, Margin=new Padding(3,6,3,3)};
            var advancedHost = new FlowLayoutPanel {AutoSize=true, Dock=DockStyle.Top, FlowDirection=FlowDirection.TopDown, WrapContents=false};
            layout.Controls.Remove(hint); advancedHost.Controls.Add(hint); advancedHost.Controls.Add(advancedLink); advancedHost.Controls.Add(concurrency); layout.Controls.Add(advancedHost,0,3);
            var choice = new ComboBox {DropDownStyle=ComboBoxStyle.DropDownList, Width=230}; choice.Items.AddRange(new object[]{speed.Items[0],speed.Items[1],speed.Items[2]}); choice.SelectedIndex=speed.SelectedIndex;
            var approval = new CheckBox {Text=budget.Text, AutoSize=true, Checked=budget.Checked, Visible=choice.SelectedIndex>0};
            concurrency.Controls.Add(choice); concurrency.Controls.Add(approval);
            Action fitAdvanced = () => {int width = Math.Max(250,dialog.ClientSize.Width-56); advancedHost.MaximumSize = concurrency.MaximumSize = hint.MaximumSize = advancedLink.MaximumSize = approval.MaximumSize = new Size(width,0);};
            dialog.ClientSizeChanged += (s,e)=>fitAdvanced(); fitAdvanced();
            choice.SelectedIndexChanged += (s,e)=>{speed.SelectedIndex=choice.SelectedIndex;approval.Checked=budget.Checked;approval.Visible=choice.SelectedIndex>0;advancedLink.Text="高级采集设置 · 当前 "+speed.Text;};
            approval.CheckedChanged += (s,e)=>{if(budget.Checked!=approval.Checked)budget.Checked=approval.Checked;};
            advancedLink.LinkClicked += (s,e)=>{concurrency.Visible=!concurrency.Visible;};
            if (pickFile) dialog.Shown += (s, e) => Guard(() => {using (var file = new OpenFileDialog {Filter = "对象清单或源码 XML|*.txt;*.xml"}) if (file.ShowDialog(dialog) == DialogResult.OK) LoadProjectList(file.FileName);});
            try {dialog.ShowDialog(this);} finally {layout.Controls.Remove(documents); line.Controls.Remove(version); line.Controls.Remove(projectVersionInput); line.Controls.Remove(web); layout.Controls.Remove(inputTitle);}
        }
    }
    void LoadProjectList(string file) {
        if(projectImporting)throw new IOException("正在读取清单，请稍候。");
        string extension=Path.GetExtension(file).ToLowerInvariant();
        if(extension!=".xml"&&extension!=".txt")throw new IOException("请选择 UTF-8 TXT 或源码 Export XML。");
        var clock=Stopwatch.StartNew();projectImporting=true;inputTitle.Text="正在读取清单 · 0%";UpdateButtons();
        var reader=new BackgroundWorker {WorkerReportsProgress=true};
        reader.DoWork+=(s,e)=>{
            if(new FileInfo(file).Length>64L*1024*1024)throw new IOException("清单超过 64MB，请按范围拆分后逐次增补。");
            byte[] content;
            using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read))
            using(var bytes=new MemoryStream()){
                var buffer=new byte[65536];int n;long count=0;
                while((n=stream.Read(buffer,0,buffer.Length))>0){bytes.Write(buffer,0,n);count+=n;reader.ReportProgress(stream.Length==0?100:(int)(count*100/stream.Length));}
                content=bytes.ToArray();
            }
            int duplicates=0,ignored=0,extra=0;string text=extension==".xml"?ExtractClasses(file,out duplicates,out ignored):new UTF8Encoding(false,true).GetString(content);
            text=Deduplicate(text,out extra);e.Result=new object[]{text,duplicates+extra,ignored};
        };
        reader.ProgressChanged+=(s,e)=>{if(!IsDisposed)inputTitle.Text="正在读取清单 · "+e.ProgressPercentage+"% · 用时 "+clock.Elapsed.TotalSeconds.ToString("0.0")+" 秒";};
        reader.RunWorkerCompleted+=(s,e)=>{
            projectImporting=false;reader.Dispose();if(IsDisposed)return;
            if(e.Error!=null){ShowWorkbenchError(e.Error.Message);inputTitle.Text="清单读取失败，原输入保留";}
            else {var value=(object[])e.Result;inputSource=Path.GetFileName(file);version.SelectedIndex=0;documents.Text=(string)value[0];inputTitle.Text=inputSource+" · 已读取 100% · 去重 "+value[1]+" · 忽略其它 XML 对象 "+value[2]+" · 用时 "+clock.Elapsed.TotalSeconds.ToString("0.00")+" 秒";}
            UpdateButtons();
            if(closeRequested){if(worker!=null&&!worker.HasExited)StartClosing();else Close();}
        };
        reader.RunWorkerAsync();
    }
    static string Deduplicate(string text, out int duplicates) {
        duplicates = 0; var exact = new HashSet<string>(StringComparer.Ordinal); var folded = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var values = new List<string>();
        foreach (var line in text.Split('\n')) {
            string name = line.Trim().TrimStart('\uFEFF'); if (name.Length == 0 || name.StartsWith("#")) continue;
            if (!exact.Add(name)) {duplicates++; continue;}
            if (!folded.Add(name)) throw new IOException("清单包含仅大小写不同的对象，请核实：" + name);
            values.Add(name);
        }
        return String.Join("\r\n", values);
    }
    void ValidateConnection() {
        Uri uri;
        if (String.IsNullOrWhiteSpace(user.Text) || String.IsNullOrWhiteSpace(password.Text)) throw new IOException("请在连接设置中填写用户名和密码。");
        if (!Uri.TryCreate(url.Text.Trim(), UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || !uri.AbsolutePath.TrimEnd('/').EndsWith("/api/atelier", StringComparison.Ordinal) || uri.UserInfo != "" || uri.Query != "" || uri.Fragment != "") throw new IOException("请填写有效的 Atelier 根 URL，以 /api/atelier/ 结尾。");
    }
    void BeginProject(string mode) {BeginProjectRun(mode, 0, mode == "retry" ? ProjectRetryNames() : null);}
    void BeginProjectSample(string mode, int sampleLimit) {BeginProjectRun(mode, sampleLimit, null);}
    void BeginProjectRun(string mode, int sampleLimit, List<string> selectedNames) {
        if(projectImporting)throw new IOException("清单仍在读取或解析，请等待完成后增补。");
        string requestedVersion=projectVersionInput.Text.Trim();
        ValidateConnection(); EnsureProject();project.BindOrigin(ProjectBaseline.Origin(url.Text,ns.Text));project.Save(); legacyMode = false;
        if(requestedVersion.Length>0)projectVersionInput.Text=requestedVersion;
        int sessions = new[] {1, 4, 10}[speed.SelectedIndex]; if(sampleLimit == 0) ValidateBudget(sessions);
        string list = documents.Text;
        if (selectedNames != null) list = String.Join("\r\n", selectedNames);
        else if (mode != "append") {
            var names = new List<string>(); foreach (var entry in project.Index.items) if (mode == "check" || String.IsNullOrEmpty(entry.sha256)) names.Add(ImportableName(entry.document));
            list = String.Join("\r\n", names);
        }
        int duplicateCount; list = Deduplicate(list, out duplicateCount);
        if (mode != "append" && String.IsNullOrWhiteSpace(list) || mode == "append" && version.SelectedIndex == 0 && String.IsNullOrWhiteSpace(list)) throw new IOException("没有需要采集的对象。请先粘贴或导入清单。");
        var previousRun = project.FindRun(project.Index.activeRun);
        if(previousRun != null && previousRun.documents.Count == 0 && previousRun.state != "running") project.EndRun(previousRun);
        projectRun = project.NewRun(mode); batch = project.RunDirectory(projectRun.id);
        projectRun.projectVersion=projectVersionInput.Text.Trim();if(projectRun.projectVersion.Length>0)project.Index.projectVersion=projectRun.projectVersion;
        projectRun.catalogVersion=mode=="append"&&version.SelectedIndex>0?version.Text.Split(' ')[0]:"";
        project.Save();
        job = new Dictionary<string, object> {{"batch", batch}, {"url", url.Text.Trim()}, {"ns", ns.Text.Trim()}, {"sessions", sessions}, {"interval", new[] {200, 100, 50}[speed.SelectedIndex]}, {"version", mode == "append" && version.SelectedIndex > 0 ? version.Text.Split(' ')[0] : ""}, {"scope", version.Text.StartsWith("v9.2 ") ? "all-products" : "doctor"}, {"confirmWeb", web.Checked}, {"inputSource", inputSource}, {"projectRun", projectRun.id}};
        if (!String.IsNullOrWhiteSpace(list)) File.WriteAllText(Path.Combine(batch, "files.txt"), list, new UTF8Encoding(false));
        job["sampleLimit"] = sampleLimit;
        SaveJob(); busy = true;runClock.Reset();elapsedBeforeResume=0;elapsedLabel.Text="本次用时：00分00秒";progress.Value=0;errorBanner.Visible = false; lastProjectReceipt = null; status.Text = "正在解析范围 · 不连接服务器"; summary.Text = mode == "check" ? "检查更新 · 准备中" : "增补源码 · 准备中"; UpdateButtons(); Send(new {op = "run", job, plan = true});
    }
    bool IsProjectJob {get {return !legacyMode && project != null && projectRun != null && job != null && TextValue(job, "projectRun") == projectRun.id;}}
    void ReceiveProjectResult(Dictionary<string, object> envelope) {
        string output = TextValue(envelope, "output"); Append(output);
        try {
            if (Flag(envelope, "plan")) {
                if (Number(envelope, "exitCode") != 0) throw new IOException(output.Trim());
                var plan = json.Deserialize<Dictionary<string, object>>(output);
                if(!plan.ContainsKey("items") || !(plan["items"] is IEnumerable)) throw new IOException("范围解析结果缺少对象清单，请使用完整解压的新版工具重试。");
                var items = new List<object>();
                var fullNames = new List<string>();
                int limit = Number(job, "sampleLimit");
                foreach(Dictionary<string, object> item in (IEnumerable)plan["items"]) {
                    fullNames.Add(ImportableName(Convert.ToString(item["document"])));
                    if(limit <= 0 || items.Count < limit) items.Add(item);
                }
                if(limit > 0) ProjectBaseline.Atomic(Path.Combine(batch, "sample-full-scope.txt"), new UTF8Encoding(false).GetBytes(String.Join("\r\n", fullNames)));
                var queue = project.Plan(projectRun, items, inputSource);
                if(projectRun.catalogVersion!=null&&projectRun.catalogVersion.Length>0&&!project.Index.catalogVersions.Contains(projectRun.catalogVersion)){project.Index.catalogVersions.Add(projectRun.catalogVersion);project.Save();}
                projectRemainingCount = queue.Count;
                RenderProject();
                if (queue.Count == 0) {busy = false; status.Text = projectRun.protectedCount > 0 ? "已保护 " + projectRun.protectedCount + " 项候选或本地变动，其余已取得；本次无需读取。" : "已有文件均已取得，本次没有新增请求；检查更新可核实服务器变化。"; RenderProject(); return;}
                var names = new List<string>(); foreach (var name in queue) names.Add(ImportableName(name));
                File.WriteAllText(Path.Combine(batch, "files.txt"), String.Join("\r\n", names), new UTF8Encoding(false)); job["version"] = ""; SaveJob(); StartProjectReading(false);
            } else {
                busy = reading = false; runClock.Stop(); SaveProjectElapsed(); lastProjectReceipt = null;
                var result = json.Deserialize<Dictionary<string, object>>(output); lastReason = TextValue(result, "operationError"); if (String.IsNullOrEmpty(lastReason)) lastReason = TextValue(result, "reason");
                var segmentSession=Value(result,"session") as Dictionary<string,object>;
                projectRun.segments++;projectRun.requestCount+=Number(segmentSession,"requestCount");projectRun.authenticationCount+=Number(segmentSession,"authenticationCount");
                ProjectBaseline.Atomic(Path.Combine(batch,"segments/"+projectRun.segments.ToString("D4")+".json"),Encoding.UTF8.GetBytes(output));
                project.Save();
                string receiptFile = Path.Combine(batch, "export/baseline-state.json");
                if (File.Exists(receiptFile)) {project.Ingest(projectRun, json.Deserialize<Dictionary<string, object>>(File.ReadAllText(receiptFile, Encoding.UTF8))); PaintProjectProgress();}
                else {projectRun.state = "paused"; projectRun.reason = lastReason; project.Save();}
                var session=Value(result,"session") as Dictionary<string,object>;
                if(runningTrial&&String.IsNullOrEmpty(lastReason)&&Flag(result,"logoutVerified")&&Flag(session,"cookieVerified"))trialIdentity=CurrentTrialIdentity(Number(job,"sessions"));
                if((!Flag(job,"firstVerified")&&Number(job,"sessions")==1 || runningTrial)&&String.IsNullOrEmpty(lastReason)&&Flag(session,"cookieVerified")&&File.Exists(receiptFile)){
                    job["firstVerified"]=true;SaveJob();RenderProject();
                    if(!String.IsNullOrEmpty(project.Index.activeRun)&&!closeRequested&&!blocked){StartProjectReading(true);return;}
                }
                if (!String.IsNullOrEmpty(lastReason) && lastReason != "cancelled-by-user") ShowWorkbenchError(ExplainReason(lastReason));
                else status.Text += projectRun.state=="paused"?" · 已暂停，可继续":projectRun.mode=="check"?(projectRun.changed==0?" · 内容未变化":" · 变化待接纳"):" · 已保存到当前基线";
                if (projectRun.protectedCount > 0) status.Text += " · 已保护 " + projectRun.protectedCount + " 项候选或本地变动";
                sessionStatus.Text = Flag(result, "sessionRetained") ? "连接复用中，空闲后自动断开" : Flag(result, "logoutVerified") ? "连接已断开，退出响应已核实" : "退出状态待核实";
                RenderProject(); if (closeRequested && !shuttingDown) StartClosing();
            }
        } catch (Exception ex) {
            busy = reading = false; runClock.Stop();
            if (projectRun != null) {projectRun.reason = ex.Message; if(projectRun.documents.Count == 0) project.EndRun(projectRun); else {projectRun.state = "paused"; project.Save();}}
            summary.Text = "采集未完成"; status.Text = projectRun != null && projectRun.documents.Count == 0 ? "尚未读取服务器；请修正后重新增补。" : "已保存进度，可继续上次采集。";
            ShowWorkbenchError(ex.Message); if (closeRequested && !shuttingDown) StartClosing();
        } finally {UpdateButtons();}
    }
    void StartProjectReading(bool resuming) {
        ValidateConnection(); reading = busy = true;
        elapsedBeforeResume = projectRun.elapsedMs; runClock.Restart(); lastElapsedSaved = 0;
        projectRun.state = "running"; project.Save(); job["resume"] = resuming; SaveJob();
        string cancel = Path.Combine(batch, "stop.request"); if (File.Exists(cancel)) File.Delete(cancel);
        runningTrial = false;
        summary.Text = projectRun.mode == "check" ? "检查更新 · 正在读取并对比" : (projectRun.mode == "retry" ? "补取源码" : "增补源码") + " · 正在读取、保存和核对";status.Text = "正在读取 · 0 / " + projectRun.documents.Count;
        lastProjectReceipt=null;RenderProject();PaintProjectProgress();
        Send(new {op = "run", job, user = user.Text, password = password.Text, resume = resuming, trial = false, sampleLimit = Number(job,"sampleLimit"), confirmed = IsBudgetApproved(Number(job,"sessions")), maxFiles = Number(job,"sessions")==1&&!Flag(job,"firstVerified")?1:0}); UpdateButtons();
    }
    void ResumeProjectRun() {
        EnsureProject();
        projectRun = project.FindRun(project.Index.activeRun);
        if (projectRun == null) throw new IOException("没有未完成采集。补充范围请点“增补源码”，重新核实服务器请点“检查更新”。");
        if(projectRun.mode=="import"){ResumeSharedImport();return;}
        ValidateConnection();project.BindOrigin(ProjectBaseline.Origin(url.Text,ns.Text));project.Save();
        batch = project.RunDirectory(projectRun.id); string file = Path.Combine(batch, "job.json");
        if (!File.Exists(file)) throw new IOException("上次任务尚未完成范围解析，请从更新记录结束该次采集后重新增补。");
        job = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8));
        if(!String.Equals(TextValue(job,"batch"),batch,StringComparison.OrdinalIgnoreCase))throw new IOException("项目目录已移动，不能用新路径续传原采集。请保留原路径和原工具，或结束该记录后重新检查更新。");
        if (TextValue(job, "url") != url.Text.Trim() || TextValue(job, "ns") != ns.Text.Trim()) throw new IOException("请切回该项目的原始连接再继续。");
        if(Number(job, "sampleLimit") == 0) ValidateBudget(Number(job, "sessions")); legacyMode = false;
        if (projectRun.documents.Count == 0) {busy = true; Send(new {op = "run", job, plan = true});} else StartProjectReading(File.Exists(Path.Combine(batch, "export/baseline-state.json")));
    }
    static bool NeedsAttention(string outcome) {
        return outcome == "missing" || outcome == "failed" || outcome == "empty" || outcome == "local-conflict" || outcome == "candidate-new" || outcome == "candidate-change" || outcome == "not-accepted";
    }
    List<string> ProjectRetryNames() {
        var names = new List<string>(); if (project == null) return names;
        var selected = SelectedRows();
        if (selected.Count > 0) {
            foreach (var row in selected) {var entry = project.Find(RawName(row)); if (entry != null && RetryableEntry(entry)) names.Add(ImportableName(entry.document));}
        } else foreach (var entry in project.Index.items) if (RetryableEntry(entry)) names.Add(ImportableName(entry.document));
        return names;
    }
    static bool RetryableEntry(BaselineEntry entry) {
        return String.IsNullOrEmpty(entry.candidateRun) && (entry.outcome == "missing" || entry.outcome == "failed" || entry.outcome == "empty" || String.IsNullOrEmpty(entry.sha256) && (entry.outcome == "pending" || entry.outcome == "writing" || entry.outcome == "not-accepted"));
    }
    string SampleScopeFile() {return batch == null ? "" : Path.Combine(batch, "sample-full-scope.txt");}
    int SampleRemainingCount() {
        if (project == null || projectRun == null || projectRun.state != "complete" || !File.Exists(SampleScopeFile())) return 0;
        int count = 0; foreach (var name in File.ReadAllLines(SampleScopeFile(), Encoding.UTF8)) {var entry = project.Find(name.TrimStart('/')); if (entry == null) entry = project.Find(name); if (entry == null || RetryableEntry(entry)) count++;} return count;
    }
    void ContinueProject() {
        if (project != null && !String.IsNullOrEmpty(project.Index.activeRun)) {ResumeProjectRun(); return;}
        if (SampleRemainingCount() == 0) throw new IOException("没有待继续的采集，可增补源码或补取未取得项。");
        documents.Text = File.ReadAllText(SampleScopeFile(), Encoding.UTF8); version.SelectedIndex = 0; BeginProject("append");
    }
    void SaveProjectElapsed() {
        if (!IsProjectJob) return;
        projectRun.elapsedMs = elapsedBeforeResume + runClock.ElapsedMilliseconds; project.Save();
    }
    bool RefreshProjectReceipt() {
        if (!IsProjectJob) return false;
        if (reading && runClock.ElapsedMilliseconds - lastElapsedSaved >= 5000) {SaveProjectElapsed(); lastElapsedSaved = runClock.ElapsedMilliseconds;}
        PaintProjectProgress(); return true;
    }
    void PaintProjectProgress() {
        if (!IsProjectJob) return;
        string receiptFile = Path.Combine(batch, "export/baseline-state.json"); if (!File.Exists(receiptFile)) return;
        try {
            string text; using (var stream = new FileStream(receiptFile, FileMode.Open, FileAccess.Read, ReceiptSharing)) using (var reader = new StreamReader(stream, Encoding.UTF8)) text = reader.ReadToEnd();
            if (text == lastProjectReceipt) return;
            var receipt = json.Deserialize<Dictionary<string, object>>(text); int total = 0, success = 0, missing = 0, failed = 0, pending = 0, skippedMissing = 0; var confirmedMissing = ConfirmedNames();
            foreach (Dictionary<string, object> item in (IEnumerable)receipt["items"]) {total++; string value = TextValue(item, "status"); if (value == "fetched") success++; else if (value == "missing") {missing++; if(confirmedMissing.Contains(TextValue(item,"document")))skippedMissing++;} else if (value == "pending" || value == "writing") pending++; else failed++;}
            summary.Text = (projectRun.mode == "check" ? "检查更新" : Number(job,"sampleLimit") > 0 ? "试采" : projectRun.mode == "retry" ? "补取源码" : "增补源码") + (reading ? " · 进行中" : projectRun.state == "paused" ? " · 已暂停" : " · 已结束");
            status.Text = "本轮已处理 " + (total - pending) + " / " + total + "   已取得 " + success + "   未找到 " + missing + "   失败 " + failed;
            projectRemainingCount = total - success - skippedMissing;
            progress.Value = total == 0 ? 0 : (total - pending) * 100 / total; lastProjectReceipt = text;
            RenderProject();
        } catch (IOException) {/* Atomic receipt replacement: retain visible progress and read on the next timer tick. */}
    }
    void RenderProject() {
        if (project == null) {UpdateWorkbench(); return;}
        // During collection the receipt is newer than the published project index. Display it
        // without ingesting/publishing candidates or hashing all source files on every timer tick.
        var live = new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);
        if (IsProjectJob && project.Index.activeRun == projectRun.id && lastProjectReceipt != null) {
            var receipt = json.Deserialize<Dictionary<string, object>>(lastProjectReceipt);
            foreach (Dictionary<string, object> item in (IEnumerable)receipt["items"]) live[TextValue(item, "document")] = item;
        }
        int index = 0, dirtyFirst = Int32.MaxValue, dirtyLast = -1;
        int files = 0, issues = 0, changes = 0, waiting = 0, staged = 0;
        foreach (var entry in project.Index.items) {
            Dictionary<string, object> current;
            bool collecting = live.TryGetValue(entry.document, out current);
            string outcome = collecting ? TextValue(current, "status") : entry.outcome;
            string bytes = collecting ? TextValue(current, "bytes") : entry.bytes.ToString();
            string checkedAt = collecting && outcome != "pending" && outcome != "writing" ? TextValue(current, "observedAt") : entry.checkedAt;
            if (!String.IsNullOrEmpty(entry.sha256)) files++; if (NeedsAttention(outcome)) issues++; if (!String.IsNullOrEmpty(entry.candidateRun)) changes++;
            if (outcome == "pending" || outcome == "writing") waiting++; if (collecting && outcome == "fetched") staged++;
            var item = new Dictionary<string, object> {{"document", entry.document}, {"status", outcome}, {"bytes", bytes}, {"currentFile", !String.IsNullOrEmpty(entry.sha256)}};
            bool shared=entry.source!=null&&entry.source.StartsWith("shared:",StringComparison.Ordinal)&&String.IsNullOrEmpty(entry.checkedAt);
            string label = collecting && outcome == "fetched" ? "已取得 · 待核对" : shared?(String.IsNullOrEmpty(entry.sha256)?"共享基线未取得":"共享基线 · 尚未检查服务器"):ProjectOutcome(outcome);
            var columns = new[] {ImportableName(entry.document), label, bytes, DisplayDate(checkedAt), String.IsNullOrEmpty(entry.contentAt)?"尚未取得":DisplayDate(entry.contentAt)};
            ListViewItem row;
            if (index >= resultRows.Count) {row = new ListViewItem(columns); resultRows.Add(row);}
            else {
                row = resultRows[index];
                if (row.SubItems.Count != columns.Length) {row = new ListViewItem(columns); resultRows[index] = row; dirtyFirst = 0; dirtyLast = PageSize - 1;}
                for (int column = 0; column < columns.Length; column++) if (row.SubItems[column].Text != columns[column]) {
                    row.SubItems[column].Text = columns[column];
                    if (index >= resultPage * PageSize && index < (resultPage + 1) * PageSize) {dirtyFirst = Math.Min(dirtyFirst, index - resultPage * PageSize); dirtyLast = index - resultPage * PageSize;}
                }
            }
            row.Tag = item; index++;
        }
        while (resultRows.Count > index) resultRows.RemoveAt(resultRows.Count - 1);
        projectHeading.Text = project.Index.name + (String.IsNullOrEmpty(project.Index.projectVersion)?"":" / "+project.Index.projectVersion) + "的源码基线";
        projectOverview.Text = "当前基线 " + files + " 项 / 登记 " + project.Index.items.Count + "\r\n已取得待核对 " + staged + " / 等待采集 " + waiting + " / 需处理 " + issues + "\r\n最近全范围检查：" + DisplayDate(project.Index.lastFullCheck);
        projectPath.Text = project.Root; acceptUpdates.Text = "接纳可更新项"; acceptUpdates.Visible = keepCurrent.Visible = changes > 0;
        RenderPage(false);
        if (resultFilter.SelectedIndex > 0 || searchNames.Text.Length > 0 || fileKind.SelectedIndex > 0) results.Invalidate();
        else if (dirtyLast >= dirtyFirst && dirtyFirst < results.VirtualListSize && results.IsHandleCreated) results.RedrawItems(dirtyFirst, Math.Min(dirtyLast, results.VirtualListSize - 1), true);
        UpdateWorkbench();
    }
    static string DisplayDate(string text) {DateTime value; return DateTime.TryParse(text, out value) ? value.ToLocalTime().ToString("MM-dd HH:mm:ss") : "尚未检查";}
    static string ProjectOutcome(string outcome) {
        switch (outcome) {case "candidate-new": return "新增 · 待接纳"; case "candidate-change": return "服务器变化 · 待接纳"; case "local-conflict": return "本地变动 · 已保护"; case "kept-local": return "已保留当前版本"; case "not-accepted": return "未接纳"; default: return Outcome(outcome);}
    }
    void ShowWorkbenchError(string reason) {errorBanner.Text = reason + "\r\n已保存的文件和进度会保留；技术信息可点“诊断详情”查看。"; errorBanner.Visible = true; Append(reason); UpdateWorkbench();}
    void UpdateWorkbench() {
        if (!projectUI) return;
        bool idle = !busy && !closingPool && !closeRequested && !projectImporting, ready = idle && !blocked && worker != null && !worker.HasExited;
        if (!legacyMode) {start.Text = "增补源码"; continueCurrent.Text = "继续采集"; resume.Text = "打开项目目录…";}
        bool hasActiveRun = project != null && !String.IsNullOrEmpty(project.Index.activeRun);
        start.Enabled=ready && !hasActiveRun;
        checkUpdates.Enabled = ready && !hasActiveRun && project != null && project.Index.items.Count > 0; resume.Enabled = idle;
        importList.Enabled = ready && !hasActiveRun;
        foreach (var input in workbenchInputs) input.Enabled = ready && !hasActiveRun;
        freezeProject.Enabled = idle && project != null; historyProject.Enabled = idle && project != null;
        if(importShared!=null)importShared.Enabled=idle;
        int safeChanges=0;bool conflicts=false;
        if(project!=null)foreach(var entry in project.Index.items){if(entry.outcome=="local-conflict")conflicts=true;else if(!String.IsNullOrEmpty(entry.candidateRun))safeChanges++;}
        acceptUpdates.Text="接纳可更新的 "+safeChanges+" 项";acceptUpdates.Enabled=idle&&safeChanges>0;keepCurrent.Enabled=idle&&project!=null;
        if(conflicts&&!busy&&status.Text.Contains("内容未变化"))status.Text=status.Text.Replace("内容未变化","本地变动已保护");
        if (!legacyMode) {
            bool active = project != null && !String.IsNullOrEmpty(project.Index.activeRun);
            int remainder = active ? projectRemainingCount : SampleRemainingCount();
            continueCurrent.Text = active&&projectRun!=null&&projectRun.mode=="import"?"继续导入共享基线":(active && projectRun != null && !String.IsNullOrEmpty(projectRun.reason) && projectRun.reason != "cancelled-by-user" ? "重试剩余 " : active ? "继续采集 " : "继续剩余 ") + remainder + " 项";
            continueCurrent.Enabled = (ready || idle&&active&&projectRun!=null&&projectRun.mode=="import") && (active || remainder > 0);
            int retry = ProjectRetryNames().Count;
            retryMissing.Text = (SelectedRows().Count > 0 ? "补取所选 " : "补取未取得 ") + retry + " 项";
            retryMissing.Enabled = ready && !active && retry > 0;
            continueCurrent.BackColor = continueCurrent.Enabled ? WorkBlue : Color.White; continueCurrent.ForeColor = continueCurrent.Enabled ? Color.White : ForeColor;
            if (closingPool) sessionStatus.Text = "正在断开连接，已保存的文件会保留…";
        }
        if (blocked) {errorBanner.Text = "服务器会话状态尚未核实。请在连接设置中打开“核查会话”，登记实际核查结果后再继续。"; errorBanner.Visible = true;}
    }
    bool MatchWorkbenchRow(ListViewItem row) {
        if (!projectUI) return true;
        if (searchNames.Text.Trim().Length > 0 && row.Text.IndexOf(searchNames.Text.Trim(), StringComparison.OrdinalIgnoreCase) < 0) return false;
        if (fileKind.SelectedIndex == 1 && !row.Text.EndsWith(".cls", StringComparison.OrdinalIgnoreCase)) return false;
        if (fileKind.SelectedIndex == 2 && !(row.Text.EndsWith(".mac", StringComparison.OrdinalIgnoreCase) || row.Text.EndsWith(".inc", StringComparison.OrdinalIgnoreCase) || row.Text.EndsWith(".int", StringComparison.OrdinalIgnoreCase))) return false;
        if (fileKind.SelectedIndex == 3 && !row.Text.Contains("/")) return false;
        return true;
    }
    void ShowProjectDiff() {
        if(project==null||SelectedRows().Count!=1)return;
        var entry=project.Find(RawName(SelectedRows()[0]));if(entry==null)return;
        using(var dialog=new Form {Text=ImportableName(entry.document)+" · 本地与服务器候选",Size=new Size(1080,660),MinimumSize=new Size(800,500),StartPosition=FormStartPosition.CenterParent,Font=Font}){
            var panes=new SplitContainer {Dock=DockStyle.Fill,Orientation=Orientation.Vertical,SplitterDistance=520};
            var local=new TextBox {Multiline=true,ReadOnly=true,WordWrap=false,ScrollBars=ScrollBars.Both,Dock=DockStyle.Fill,Font=new Font("Consolas",10)};
            var remote=new TextBox {Multiline=true,ReadOnly=true,WordWrap=false,ScrollBars=ScrollBars.Both,Dock=DockStyle.Fill,Font=local.Font};
            string path=ProjectBaseline.Within(project.Root,"src/"+entry.path);
            local.Text=ReadPreview(path,"当前基线尚未取得该对象。");
            remote.Text=String.IsNullOrEmpty(entry.candidateRun)?"本次没有可查看的服务器候选。":ReadPreview(ProjectBaseline.Within(project.RunDirectory(entry.candidateRun),"export/src/"+entry.path),"候选文件不存在，请保留目录核查。");
            panes.Panel1.Controls.Add(local);panes.Panel2.Controls.Add(remote);
            panes.Panel1.Controls.Add(new Label {Text="本地当前文件（只读，可复制）",Dock=DockStyle.Top,Height=30});
            panes.Panel2.Controls.Add(new Label {Text="服务器候选（只读，可复制）",Dock=DockStyle.Top,Height=30});
            dialog.Controls.Add(panes);dialog.ShowDialog(this);
        }
    }
    static string ReadPreview(string path,string absent){
        if(!File.Exists(path))return absent;
        if(new FileInfo(path).Length>2*1024*1024)return"文件超过 2MB，请从项目目录或更新记录打开完整内容。";
        return File.ReadAllText(path,Encoding.UTF8);
    }
    void RunLocalProjectWork(string title, Func<BackgroundWorker,object> work, Action<object> completed, Action<Exception> failed = null) {
        projectImporting=true;UpdateButtons();status.Text=title;
        var task=new BackgroundWorker {WorkerReportsProgress=true};
        task.DoWork+=(s,e)=>{e.Result=work(task);};
        task.ProgressChanged+=(s,e)=>{if(IsDisposed)return;Action update=()=>{if(!IsDisposed&&projectImporting)status.Text=title+" · "+e.ProgressPercentage+"%";};if(InvokeRequired)BeginInvoke(update);else update();};
        Action<RunWorkerCompletedEventArgs> finish=e=>{
            try {
                if(IsDisposed){var abandoned=e.Error==null?e.Result as IDisposable:null;if(abandoned!=null)abandoned.Dispose();return;}
                if(e.Error!=null){ShowWorkbenchError(e.Error.Message);if(failed!=null)failed(e.Error);}else completed(e.Result);
            }catch(Exception ex){if(!IsDisposed)ShowWorkbenchError(ex.Message);}
            finally{projectImporting=false;task.Dispose();}
            if(!IsDisposed){UpdateButtons();if(closeRequested){if(worker!=null&&!worker.HasExited)StartClosing();else Close();}}
        };
        task.RunWorkerCompleted+=(s,e)=>{if(!IsDisposed&&InvokeRequired)BeginInvoke(new Action(()=>finish(e)));else finish(e);};task.RunWorkerAsync();
    }
    void ImportSharedProject() {
        if(busy||projectImporting)throw new IOException("请先等待当前操作收束。");
        string source,target;
        using(var picker=new FolderBrowserDialog {Description="选择共享基线目录（包含 交付清单.json 和 src）"}){if(picker.ShowDialog(this)!=DialogResult.OK)return;source=picker.SelectedPath;}
        ProjectBaseline.SharedManifest(source);
        using(var picker=new FolderBrowserDialog {Description="选择新的空工作目录；保留共享原件不变"}){if(picker.ShowDialog(this)!=DialogResult.OK)return;target=picker.SelectedPath;}
        BeginSharedImport(source,target);
    }
    void BeginSharedImport(string source,string target) {
        if(project!=null){project.Dispose();project=null;}
        int percent=-1;
        RunLocalProjectWork("正在校验并导入共享基线",task=>ProjectBaseline.ImportShared(source,target,(count,total)=>{int value=count*100/Math.Max(1,total);if(value!=percent){percent=value;task.ReportProgress(value);}}),result=>{
            AttachSharedProject((ProjectBaseline)result,target);
            status.Text="共享基线已导入，可离线使用源码；配置自己的连接后可增补或检查更新。";sessionStatus.Text="未连接服务器；共享源码尚未与当前服务器核对";
        },error=>{
            if(File.Exists(Path.Combine(target,".export/project.json"))){var pending=new ProjectBaseline(target,"共享基线",null);var active=pending.FindRun(pending.Index.activeRun);if(active!=null&&active.mode=="import"){AttachSharedProject(pending,target);status.Text="导入尚未完成，已保存进度；可点“继续导入共享基线”。";}else pending.Dispose();}
        });
    }
    void AttachSharedProject(ProjectBaseline imported,string target) {
            project=imported;projectRun=project.Index.runs[project.Index.runs.Count-1];batch=project.RunDirectory(projectRun.id);job=null;lastProjectReceipt=null;runClock.Reset();elapsedBeforeResume=0;
            displayingJob=true;
            try {
                string name=project.Index.name+" / "+(project.Index.projectVersion??"共享基线");string unique=name;bool existing=false;
                foreach(var profile in saved)if(String.Equals(profile.Value["destination"],target,StringComparison.OrdinalIgnoreCase)){unique=profile.Key;existing=true;break;}
                int count=2;if(!existing)while(saved.ContainsKey(unique))unique=name+" ("+(count++)+")";
                profiles.Text=unique;destination.Text=target;
                version.SelectedIndex=0;documents.Clear();inputSource="共享基线导入";
                if(existing){var profile=saved[unique];url.Text=profile["url"];ns.Text=profile["ns"];user.Text=profile["user"];password.Text=profile["password"];remember.Checked=password.Text.Length>0;}
                else {url.Clear();ns.Clear();user.Clear();password.Clear();remember.Checked=false;}
                speed.SelectedIndex=0;projectVersionInput.Text=project.Index.projectVersion??"";
            }finally{displayingJob=false;}
            RestoreBudget();SaveProfile();RenderProject();
    }
    void ResumeSharedImport() {
        string file=Path.Combine(project.RunDirectory(projectRun.id),"import-source.json");
        if(!File.Exists(file))throw new IOException("导入尚未保存来源，请重新选择共享基线并导入到此工作目录。");
        var source=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));BeginSharedImport(TextValue(source,"sourceRoot"),project.Root);
    }
    void FreezeProject() {
        EnsureProject();
        using(var dialog=new Form {Text="保存项目版本基线",Size=new Size(760,500),MinimumSize=new Size(650,440),StartPosition=FormStartPosition.CenterParent,Font=Font}) {
            var layout=new FlowLayoutPanel {Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=true,Padding=new Padding(18)};dialog.Controls.Add(layout);
            var nameField=new TextBox {Text=project.Index.name,Width=450,Name="baselineShortName"};layout.Controls.Add(Note("项目简称（用于列表和目录）"));layout.Controls.Add(nameField);
            var versionField=new TextBox {Text=projectVersionInput.Text,Width=450,Name="baselineProjectVersion"};layout.Controls.Add(Note("项目版本（填写，独立于采集清单版本）"));layout.Controls.Add(versionField);
            var details=new FlowLayoutPanel {AutoSize=true,FlowDirection=FlowDirection.TopDown,WrapContents=false,Visible=false};
            var fullName=new TextBox {Text=String.IsNullOrEmpty(project.Index.fullName)?project.Index.name:project.Index.fullName,Width=540};var owner=new TextBox {Text=project.Index.owner??"",Width=540};var product=new TextBox {Text=project.Index.product??"",Width=540};
            details.Controls.Add(Note("完整名称（可选）"));details.Controls.Add(fullName);details.Controls.Add(Note("归属 / 交付中心（可选）"));details.Controls.Add(owner);details.Controls.Add(Note("产品（可选）"));details.Controls.Add(product);
            var showDetails=new CheckBox {Name="baselineDetails",Text="补充说明 · 完整名称、归属、产品",AutoSize=true};showDetails.CheckedChanged+=(s,e)=>{details.Visible=showDetails.Checked;};layout.Controls.Add(showDetails);layout.Controls.Add(details);
            var path=new Label {AutoSize=true,MaximumSize=new Size(680,0)};string parent="";
            Action preview=()=>{try {path.Text=parent.Length==0?"选择保存位置后，自动建立：项目简称 / 项目版本":ProjectBaseline.VersionDirectory(parent,nameField.Text.Trim(),versionField.Text.Trim());}catch(IOException ex){path.Text=ex.Message;}};
            nameField.TextChanged+=(s,e)=>preview();versionField.TextChanged+=(s,e)=>preview();layout.Controls.Add(ActionButton("选择基线保存位置…",()=>{using(var picker=new FolderBrowserDialog {Description="选择基线库父目录，将自动建立 项目 / 版本"})if(picker.ShowDialog(dialog)==DialogResult.OK){parent=picker.SelectedPath;preview();}},false));layout.Controls.Add(path);preview();
            layout.Controls.Add(Note("同事可导入后继续维护；缺失项如实保留，不共享连接凭据。"));
            var footer=new FlowLayoutPanel {Dock=DockStyle.Bottom,AutoSize=true,FlowDirection=FlowDirection.RightToLeft,Padding=new Padding(10)};dialog.Controls.Add(footer);
            var save=ActionButton("保存版本基线",()=>{
                ProjectBaseline.VersionDirectory(parent,nameField.Text.Trim(),versionField.Text.Trim());dialog.Close();SaveVersionProject(parent,nameField.Text.Trim(),versionField.Text.Trim(),fullName.Text.Trim(),owner.Text.Trim(),product.Text.Trim());
            },true);save.Name="saveVersionBaseline";footer.Controls.Add(save);var cancel=ActionButton("取消",()=>dialog.Close(),false);footer.Controls.Add(cancel);dialog.CancelButton=cancel;
            Action fit=()=>{int width=Math.Max(200,layout.ClientSize.Width-54);nameField.Width=versionField.Width=Math.Min(450,width);fullName.Width=owner.Width=product.Width=Math.Min(540,width);details.MaximumSize=new Size(width,0);foreach(Control control in layout.Controls)if(control is Label||control is CheckBox)control.MaximumSize=new Size(width,0);};dialog.SizeChanged+=(s,e)=>fit();fit();dialog.ShowDialog(this);
        }
    }
    void SaveVersionProject(string parent,string shortName,string projectVersion,string fullName,string owner,string product) {
        string target=ProjectBaseline.VersionDirectory(parent,shortName,projectVersion);projectVersionInput.Text=projectVersion;project.Index.name=shortName;project.Index.fullName=fullName;project.Index.owner=owner;project.Index.product=product;project.Index.projectVersion=projectVersion;project.Save();SaveProfile();
        int percent=-1;RunLocalProjectWork("正在保存并核验项目版本基线",task=>{project.Freeze(target,(count,total)=>{int value=count*100/Math.Max(1,total);if(value!=percent){percent=value;task.ReportProgress(value);}});return target;},result=>{RenderProject();status.Text="版本基线已保存："+result;if(!quietValidation)Process.Start("explorer.exe","\""+result+"\"");});
    }
    void ShowProjectHistory() {
        EnsureProject();
        using (var dialog = new Form {Text = "更新记录", Size = new Size(860, 520), StartPosition = FormStartPosition.CenterParent, Font = Font}) {
            var list = new ListBox {Dock = DockStyle.Fill, HorizontalScrollbar = true};
            for (int i = project.Index.runs.Count - 1; i >= 0; i--) {var r = project.Index.runs[i]; list.Items.Add(DisplayDate(r.startedAt) + "  " + (r.mode == "check" ? "检查更新" : "增补 / 补取") + "  " + r.documents.Count + " 项  变化 "+r.changed+" / 已接纳 "+r.accepted+" / 未找到 "+r.missing+" / 失败 "+r.failed+"  "+RunLabel(r.state) + "  " + FormatElapsed(TimeSpan.FromMilliseconds(r.elapsedMs)));}
            var footer = new FlowLayoutPanel {AutoSize = true, Dock = DockStyle.Bottom};
            footer.Controls.Add(ActionButton("查看本次保存内容", () => {if (list.SelectedIndex < 0) return; var r = project.Index.runs[project.Index.runs.Count - 1 - list.SelectedIndex]; Process.Start("explorer.exe", "\"" + project.RunDirectory(r.id) + "\"");}, false));
            footer.Controls.Add(ActionButton("结束未完成采集", () => {var r = project.FindRun(project.Index.activeRun); if (r != null && MessageBox.Show(dialog, "结束本次采集，已保存文件和记录均保留。之后可重新增补或检查更新。", "结束采集", MessageBoxButtons.OKCancel) == DialogResult.OK) {project.EndRun(r); dialog.Close(); RenderProject();}}, false));
            dialog.Controls.Add(list); dialog.Controls.Add(footer); dialog.ShowDialog(this);
        }
    }
    static string RuntimeProblem() {
        try {
            using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\PowerShell\3\PowerShellEngine")) {
                var version = key == null ? null : Convert.ToString(key.GetValue("PowerShellVersion")); Version value;
                if (!Version.TryParse(version, out value) || value < new Version(5, 1)) return "现有采集引擎需要 Windows PowerShell 5.1。该电脑的环境尚不满足，工具不会安装或升级系统组件。请在已有运行环境的项目电脑使用。";
            }
        } catch {return "无法确认 Windows PowerShell 运行环境，请检查电脑权限；未连接服务器。";}
        return null;
    }
    static string RunLabel(string value){switch(value){case"planning":return"正在解析范围";case"ready":case"running":return"采集中";case"paused":return"已暂停";default:return"已结束";}}
}
// Route wheel input by pointer location, preserving native inner scrolling until its edge.
public sealed class WorkbenchWheelRouter : IMessageFilter {
    readonly Control root;
    int remainder;
    ScrollableControl previous;
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    struct ScrollInfo {public uint size, mask; public int min, max; public uint page; public int pos, track;}
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool GetScrollInfo(IntPtr hwnd, int bar, ref ScrollInfo info);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wparam, IntPtr lparam);
    public WorkbenchWheelRouter(Control root) {this.root = root;}
    public bool PreFilterMessage(ref Message message) {
        if(message.Msg != 0x020A || root.IsDisposed || !root.Visible || !root.ContainsFocus && Form.ActiveForm != root.FindForm()) return false;
        Point point = Control.MousePosition;
        if(!root.RectangleToScreen(root.ClientRectangle).Contains(point)) return false;
        Control target = root;
        while(true) {
            Control child = target.GetChildAtPoint(target.PointToClient(point));
            if(child == null) break;
            target = child;
        }
        var combo = target as ComboBox;
        if(combo != null && combo.DroppedDown) return false;
        int delta = unchecked((short)((message.WParam.ToInt64() >> 16) & 65535));
        if(delta == 0) return false;
        for(Control current = target; current != null && current != root; current = current.Parent) {
            var panel = current as ScrollableControl;
            if(panel != null && panel.AutoScroll && panel.VerticalScroll.Visible) {
                int position = -panel.AutoScrollPosition.Y;
                int maximum = Math.Max(0, panel.VerticalScroll.Maximum - panel.VerticalScroll.LargeChange + 1);
                if(delta > 0 ? position > 0 : position < maximum) {
                    if(previous != panel) {remainder = 0; previous = panel;}
                    remainder += delta;
                    int steps = remainder / 120; remainder %= 120;
                    int lines = SystemInformation.MouseWheelScrollLines;
                    int distance = lines < 0 ? panel.ClientSize.Height : lines * Math.Max(1, panel.VerticalScroll.SmallChange);
                    panel.AutoScrollPosition = new Point(-panel.AutoScrollPosition.X, Math.Max(0, Math.Min(maximum, position - steps * distance)));
                    return true;
                }
            } else if(current is ListView || current is TextBoxBase) {
                var info = new ScrollInfo {size = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(ScrollInfo)), mask = 7};
                if(GetScrollInfo(current.Handle, 1, ref info) && (delta > 0 ? info.pos > info.min : info.pos < info.max - Math.Max(0, (int)info.page - 1))) {
                    SendMessage(current.Handle, message.Msg, message.WParam, message.LParam);
                    return true;
                }
            }
        }
        return false;
    }
}
public sealed class SearchBox:TextBox {
    [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
    static extern IntPtr SendMessage(IntPtr handle,int message,IntPtr parameter,string text);
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);SendMessage(Handle,0x1501,new IntPtr(1),"查找名称或路径…");}
}
public sealed class WorkbenchCard:Panel {
    public WorkbenchCard(){SetStyle(ControlStyles.SupportsTransparentBackColor|ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);BackColor=Color.Transparent;}
    protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);if(Width<14||Height<14)return;
        using(var path=new System.Drawing.Drawing2D.GraphicsPath()){
            int d=12,w=Width-1,h=Height-1;
            path.AddArc(0,0,d,d,180,90);path.AddArc(w-d,0,d,d,270,90);path.AddArc(w-d,h-d,d,d,0,90);path.AddArc(0,h-d,d,d,90,90);path.CloseFigure();
            e.Graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using(var fill=new SolidBrush(Color.White))e.Graphics.FillPath(fill,path);
            using(var border=new Pen(Color.FromArgb(228,234,242)))e.Graphics.DrawPath(border,path);
        }
    }
}
public sealed class WorkbenchProgress:ProgressBar {
    public WorkbenchProgress(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);}
    protected override void OnPaint(PaintEventArgs e){
        using(var background=new SolidBrush(Color.FromArgb(229,235,245)))e.Graphics.FillRectangle(background,ClientRectangle);
        int width=Maximum<=Minimum?0:(int)((long)(Value-Minimum)*Width/(Maximum-Minimum));
        using(var fill=new SolidBrush(Color.FromArgb(40,100,220)))e.Graphics.FillRectangle(fill,0,0,width,Height);
    }
}

public static class ExporterConnection {
    public static string Normalize(string text) {
        Uri address;
        if(!Uri.TryCreate(text.Trim(),UriKind.Absolute,out address) || (address.Scheme!="http" && address.Scheme!="https") || address.UserInfo!="" || address.Query!="" || address.Fragment!="") throw new IOException("请填写有效的 HTTP/HTTPS 地址，账号密码请填写在对应输入框。");
        var builder=new UriBuilder(address);
        string path=address.AbsolutePath.TrimEnd('/');
        if(!path.EndsWith("/api/atelier",StringComparison.Ordinal))path+="/api/atelier";
        builder.Path=path+"/";return builder.Uri.AbsoluteUri;
    }
    static Dictionary<string,object> Map(object value) {return value as Dictionary<string,object> ?? new Dictionary<string,object>();}
    static object Get(Dictionary<string,object> value,string key) {object result;return value.TryGetValue(key,out result)?result:null;}
    static Dictionary<string,object> Read(string file) {
        if(!File.Exists(file))return new Dictionary<string,object>();
        string text=File.ReadAllText(file,Encoding.UTF8);
        // Preserve quoted strings while removing JSONC comments and trailing commas.
        text=System.Text.RegularExpressions.Regex.Replace(text,@"""(?:\\.|[^""\\])*""|//[^\r\n]*|/\*[\s\S]*?\*/",m=>m.Value.StartsWith("\"")?m.Value:"");
        text=System.Text.RegularExpressions.Regex.Replace(text,@"""(?:\\.|[^""\\])*""|,\s*(?=[}\]])",m=>m.Value.StartsWith("\"")?m.Value:"");
        return new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string,object>>(text);
    }
    public static Dictionary<string,string> ReadProject(string root) {
        var settings=Read(Path.Combine(root,".vscode/settings.json"));
        var conn=Map(Get(settings,"objectscript.conn"));string name=Convert.ToString(Get(conn,"server"));
        var server=Map(Get(Map(Get(settings,"intersystems.servers")),name));var web=Map(Get(server,"webServer"));
        var mcp=conn.Count == 0 ? Read(Path.Combine(root,".mcp.json")) : new Dictionary<string,object>();var env=Map(Get(Map(Get(Map(Get(mcp,"mcpServers")),"iris-agentic-dev")),"env"));
        string host=Convert.ToString(Get(web,"host")??Get(conn,"host")??Get(env,"IRIS_HOST"));
        string port=Convert.ToString(Get(web,"port")??Get(conn,"port")??Get(env,"IRIS_WEB_PORT"));
        string ns=Convert.ToString(Get(conn,"ns")??Get(env,"IRIS_NAMESPACE"));
        string scheme=Convert.ToString(Get(web,"scheme")??Get(env,"IRIS_SCHEME")??(Object.Equals(Get(conn,"https"),true)?"https":"http"));
        int number;if(String.IsNullOrWhiteSpace(host)||!Int32.TryParse(port,out number)||number<1||number>65535||String.IsNullOrWhiteSpace(ns))throw new IOException("项目中未找到完整连接，请填写主机、Web 端口和命名空间。");
        string prefix=Convert.ToString(Get(server,"pathPrefix")??Get(web,"pathPrefix"));
        return new Dictionary<string,string>{{"url",Normalize(new UriBuilder(scheme,host,number,prefix).Uri.AbsoluteUri)},{"namespace",ns},{"name",String.IsNullOrWhiteSpace(name)?new DirectoryInfo(root).Name:name}};
    }
}
