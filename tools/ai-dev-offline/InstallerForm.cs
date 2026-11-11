using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AiDevOffline {
    sealed class InstallLog : IDisposable {
        readonly StreamWriter writer;
        readonly object sync=new object();
        public string FilePath { get; private set; }

        InstallLog(string filePath) {
            FilePath=filePath;
            writer=new StreamWriter(new FileStream(filePath,FileMode.CreateNew,FileAccess.Write,FileShare.Read),new UTF8Encoding(true));
            writer.AutoFlush=true;
        }
        internal static InstallLog Create(params string[] directories) {
            var failures=new List<string>();
            foreach(string directory in directories) {
                try {
                    Directory.CreateDirectory(directory);
                    string name="install-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N")+".log";
                    InstallLog result=new InstallLog(Path.Combine(directory,name));
                    foreach(string failure in failures) result.Write("日志目录不可用，已改用备用目录。"+failure);
                    return result;
                } catch(IOException error) {failures.Add(directory+" "+error.Message);}
                  catch(UnauthorizedAccessException error) {failures.Add(directory+" "+error.Message);}
            }
            throw new IOException(String.Join(Environment.NewLine,failures.ToArray()));
        }
        public void Write(string message) {
            lock(sync) {writer.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff")+" "+message);}
        }
        public void Dispose() {lock(sync) {writer.Dispose();}}
    }
    sealed class Component { public string id {get;set;} public string version {get;set;} public string command {get;set;} }
    sealed class PackageManifest { public Component[] components {get;set;} }
    sealed class ToolRow {
        public string Id;
        public ComboBox Mode;
        public TextBox Path;
    }

    sealed class InstallerForm : Form {
        readonly Color ink = Color.FromArgb(30, 41, 59);
        readonly Color blue = Color.FromArgb(37, 99, 235);
        readonly List<ToolRow> rows = new List<ToolRow>();
        readonly TextBox root = new TextBox();
        readonly ComboBox scope = new ComboBox();
        readonly TextBox log = new TextBox();
        readonly Button start = new Button();
        readonly Button restore = new Button();
        readonly Button exportLog = new Button();
        readonly Button project = new Button();
        readonly Label status = new Label();
        readonly ProgressBar progress = new ProgressBar();
        readonly Panel settings = new Panel();
        Component[] components;
        bool running;
        bool confirming;
        string requestFile;
        InstallLog runLog;
        string logFile;

        [STAThread]
        static void Main(string[] args) {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (InstallerForm form = new InstallerForm()) {
                if (args.Length == 2 && args[0] == "--screenshot") {
                    form.Show(); Application.DoEvents();
                    using (Bitmap bitmap = new Bitmap(form.Width, form.Height)) {
                        form.DrawToBitmap(bitmap, form.ClientRectangle);
                        bitmap.Save(args[1]);
                    }
                    return;
                }
                Application.Run(form);
            }
        }

        Label TextLabel(string text, int size, bool bold) {
            return new Label { Text = text, AutoSize = true, ForeColor = ink,
                Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular) };
        }
        Button ButtonAt(string text, int x, int y, int width) {
            Button button = new Button { Text = text, Location = new Point(x,y), Size = new Size(width,34),
                FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = ink, Cursor = Cursors.Hand };
            button.FlatAppearance.BorderColor = Color.FromArgb(203,213,225);
            return button;
        }
        public InstallerForm() {
            components = new JavaScriptSerializer().Deserialize<PackageManifest>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"manifest.json"))).components;
            Text = "开发工具 · 离线安装助手";
            Font = new Font("Microsoft YaHei UI", 9);
            BackColor = Color.FromArgb(245,247,251);
            ClientSize = new Size(980,760);
            MinimumSize = new Size(1000,800);
            AutoScaleMode = AutoScaleMode.Dpi;
            StartPosition = FormStartPosition.CenterScreen;
            Label title = TextLabel("准备好你的开发环境",22,true);
            title.Location = new Point(30,24); Controls.Add(title);
            Label subtitle = TextLabel("按需选择工具，自动安装并配置环境变量。",10,false);
            subtitle.Location = new Point(32,70); Controls.Add(subtitle);
            settings.SetBounds(24,108,932,470);
            settings.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(settings);
            Label location = TextLabel("安装目录",10,true); location.Location=new Point(8,8);settings.Controls.Add(location);
            root.SetBounds(100,5,466,30);
            root.Text = Directory.Exists("D:\\") ? "D:\\Programs" : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","AiDev");
            settings.Controls.Add(root);
            Button browse = ButtonAt("浏览…",578,3,80);settings.Controls.Add(browse);
            browse.Click += delegate { using(FolderBrowserDialog dialog = new FolderBrowserDialog()) {
                dialog.Description="选择工具安装根目录";
                if(dialog.ShowDialog(this)==DialogResult.OK) root.Text=dialog.SelectedPath;
            }};
            scope.SetBounds(680,5,240,30);scope.DropDownStyle=ComboBoxStyle.DropDownList;
            scope.Items.AddRange(new object[]{"当前用户的环境变量","所有用户（需要管理员权限）"});scope.SelectedIndex=0;settings.Controls.Add(scope);
            string[][] tools = {
                new[]{"vscode","VS Code","代码编辑器","Code.exe"},
                new[]{"git","Git","版本管理工具","git.exe"},
                new[]{"powershell","PowerShell","命令行与自动化运行环境","pwsh.exe"},
                new[]{"node","Node.js","JavaScript 运行环境，含 npm","node.exe"},
                new[]{"python","Python","Python 运行环境，含 pip","python.exe"},
                new[]{"java8","Java 8","Java 开发与运行环境，含 JDK","java.exe"}
            };
            for(int index=0; index<tools.Length; index++) AddTool(tools[index],48+index*68);
            Label note=TextLabel("已有工具请选择对应的可执行文件。安装位置已有其它内容时会提示更换目录。",9,false);
            note.Location=new Point(32,584);Controls.Add(note);
            status.SetBounds(32,616,700,25);status.Text="选择工具后开始";status.ForeColor=ink;Controls.Add(status);
            progress.SetBounds(32,646,916,5);progress.Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Top;Controls.Add(progress);
            log.SetBounds(32,664,916,34);log.Multiline=true;log.ReadOnly=true;log.ScrollBars=ScrollBars.Vertical;
            log.BackColor=Color.White;log.BorderStyle=BorderStyle.FixedSingle;log.Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Top|AnchorStyles.Bottom;Controls.Add(log);
            restore=ButtonAt("恢复环境变量…",32,712,155);restore.Anchor=AnchorStyles.Bottom|AnchorStyles.Left;
            restore.Click+=Restore;Controls.Add(restore);
            exportLog.Text="导出日志…";exportLog.SetBounds(200,712,120,34);
            exportLog.Anchor=AnchorStyles.Bottom|AnchorStyles.Left;exportLog.Enabled=false;
            exportLog.Click+=ExportLog;Controls.Add(exportLog);
            project.Text="项目配置…";project.SetBounds(334,712,130,34);
            project.Anchor=AnchorStyles.Bottom|AnchorStyles.Left;
            project.Click+=delegate {
                if(running || confirming)return;
                var selected=new Dictionary<string,string>();
                foreach(ToolRow row in rows)if(row.Mode.SelectedIndex==2 && File.Exists(row.Path.Text))selected[row.Id]=row.Path.Text;
                using(ProjectConfigurationForm dialog=new ProjectConfigurationForm(root.Text,components,selected,Execute)) dialog.ShowDialog(this);
            };
            Controls.Add(project);
            start=ButtonAt("开始安装与配置",738,710,210);start.Height=38;start.Anchor=AnchorStyles.Bottom|AnchorStyles.Right;
            start.BackColor=blue;start.ForeColor=Color.White;start.FlatAppearance.BorderSize=0;start.Click+=Start;Controls.Add(start);
            FormClosing+=delegate(object sender,FormClosingEventArgs e){
                if(running){e.Cancel=true;MessageBox.Show(this,"正在处理工具，请等待当前任务完成后关闭。","任务进行中");}
            };
            FormClosed+=delegate {if(runLog!=null) runLog.Dispose();};
        }
        void AddTool(string[] tool,int y) {
            Panel card=new Panel { BackColor=Color.White, Location=new Point(8,y), Size=new Size(912,62) };
            Component component=Array.Find(components,delegate(Component c){return c.id==tool[0];});
            Label name=TextLabel(tool[1]+"  "+component.version,11,true);name.Location=new Point(14,10);card.Controls.Add(name);
            Label description=TextLabel(tool[2],9,false);description.Location=new Point(14,35);card.Controls.Add(description);
            ComboBox mode=new ComboBox { DropDownStyle=ComboBoxStyle.DropDownList, Location=new Point(290,21), Width=170 };
            mode.Items.AddRange(new object[]{"跳过","安装并配置","已有工具，仅配置","仅安装，保留环境"});mode.SelectedIndex=0;card.Controls.Add(mode);
            TextBox path=new TextBox { Location=new Point(478,22), Width=326, Enabled=false };card.Controls.Add(path);
            Button choose=ButtonAt("选择…",816,18,80);choose.Enabled=false;card.Controls.Add(choose);
            mode.SelectedIndexChanged+=delegate {path.Enabled=choose.Enabled=mode.SelectedIndex==2;};
            choose.Click+=delegate { using(OpenFileDialog dialog=new OpenFileDialog()) {
                dialog.Title="选择 "+tool[3];dialog.Filter=tool[3]+"|"+tool[3];
                if(dialog.ShowDialog(this)==DialogResult.OK)path.Text=dialog.FileName;
            }};
            rows.Add(new ToolRow{Id=tool[0],Mode=mode,Path=path});settings.Controls.Add(card);
        }
        void Start(object sender,EventArgs e) {
            if(running || confirming)return;
            List<object> items=new List<object>();
            foreach(ToolRow row in rows) {
                if(row.Mode.SelectedIndex==0)continue;
                if(row.Mode.SelectedIndex==2 && !File.Exists(row.Path.Text)) {
                    MessageBox.Show(this,"请为已有工具选择正确的可执行文件。","需要选择文件");return;
                }
                items.Add(new {id=row.Id,mode=row.Mode.SelectedIndex==1?"install":row.Mode.SelectedIndex==3?"installOnly":"existing",path=row.Path.Text});
            }
            if(items.Count==0){MessageBox.Show(this,"请先选择至少一个工具的操作。","选择工具");return;}
            string target;
            try {target=Path.GetFullPath(root.Text);}catch {MessageBox.Show(this,"请选择有效的安装目录。");return;}
            string summary="将处理 "+items.Count+" 项工具。需要配置的命令目录将加入"+scope.Text+"的 PATH。\n\n安装根目录\n"+target+"\n\n选择 Java 安装并配置时会设置 JAVA_HOME。仅安装选项保留环境变量。已有同名命令的优先级将进行检查，配置失败时恢复本项变量。";
            foreach(ToolRow row in rows) {
                if(row.Mode.SelectedIndex==0)continue;
                Component component=Array.Find(components,delegate(Component c){return c.id==row.Id;});
                string current="当前 PATH 未找到";
                foreach(string folder in (Environment.GetEnvironmentVariable("PATH")??"").Split(';')) {
                    try {
                        string candidate=Path.Combine(Environment.ExpandEnvironmentVariables(folder.Trim().Trim('"')),row.Id=="vscode"?"code.cmd":Path.GetFileName(component.command));
                        if(File.Exists(candidate)){current=candidate;break;}
                    }catch(ArgumentException){}
                }
                string[] ids={"vscode","git","powershell","node","python","java8"};
                string[] folders={"VSCode","Git","PowerShell","Node","Python","Java"};
                string planned=row.Mode.SelectedIndex==2?row.Path.Text:Path.Combine(target,folders[Array.IndexOf(ids,row.Id)],component.version,component.command.Replace('/',Path.DirectorySeparatorChar));
                summary+="\n\n"+row.Id+" · "+row.Mode.Text+"\n当前命令  "+current+"\n所选程序  "+planned;
                if(row.Id=="java8" && row.Mode.SelectedIndex!=3)summary+="\n当前 JAVA_HOME  "+(Environment.GetEnvironmentVariable("JAVA_HOME",scope.SelectedIndex==0?EnvironmentVariableTarget.User:EnvironmentVariableTarget.Machine)??"未设置");
            }
            confirming=true;
            bool accepted;
            try { accepted=ConfirmPlan(summary); }
            finally { confirming=false; }
            if(!accepted)return;
            Execute(new {action="apply",root=target,scope=scope.SelectedIndex==0?"User":"Machine",items=items});
        }
        bool ConfirmPlan(string summary) {
            using(Form dialog=new Form()) {
                dialog.Text="确认安装与配置";dialog.Font=Font;dialog.StartPosition=FormStartPosition.CenterParent;
                dialog.ClientSize=new Size(760,520);dialog.MinimizeBox=false;dialog.MaximizeBox=false;
                TextBox text=new TextBox {Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Text=summary.Replace("\r\n","\n").Replace("\n",Environment.NewLine),Dock=DockStyle.Fill,BackColor=Color.White};
                Panel footer=new Panel {Height=52,Dock=DockStyle.Bottom};
                Button accept=ButtonAt("确认执行",620,8,120);accept.DialogResult=DialogResult.OK;
                Button cancel=ButtonAt("返回修改",484,8,120);cancel.DialogResult=DialogResult.Cancel;
                footer.Controls.Add(accept);footer.Controls.Add(cancel);dialog.Controls.Add(text);dialog.Controls.Add(footer);
                dialog.Shown+=delegate {text.Select(0,0);cancel.Focus();};
                dialog.AcceptButton=accept;dialog.CancelButton=cancel;
                return dialog.ShowDialog(this)==DialogResult.OK;
            }
        }
        void Restore(object sender,EventArgs e) {
            using(OpenFileDialog dialog=new OpenFileDialog()) {
                dialog.Title="选择安装目录 .ai-dev-environment 中的回执（多次修改从最近一次开始恢复）";
                dialog.Filter="环境变量回执|*.json";
                string directory=Path.Combine(root.Text,".ai-dev-environment");if(Directory.Exists(directory))dialog.InitialDirectory=directory;
                if(dialog.ShowDialog(this)!=DialogResult.OK)return;
                try {
                    Dictionary<string,object> receipt=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(dialog.FileName));
                    if(MessageBox.Show(this,"恢复这次 PATH 和 JAVA_HOME 修改？后续修改冲突会停止恢复。","恢复环境变量",MessageBoxButtons.OKCancel)!=DialogResult.OK)return;
                    Execute(new {action="rollback",scope=(string)receipt["scope"],receipt=dialog.FileName});
                }catch(Exception error){MessageBox.Show(this,error.Message,"回执无法读取");}
            }
        }
        void BeginLog(object request) {
            if(runLog!=null) {runLog.Dispose();runLog=null;}
            logFile=null;exportLog.Enabled=false;
            try {
                runLog=InstallLog.Create(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"logs"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AiDevOffline","Logs"));
                logFile=runLog.FilePath;exportLog.Enabled=true;
                Record("安装助手 r4 · CLR "+Environment.Version+" · 64 位进程="+Environment.Is64BitProcess);
                Record("日志文件："+logFile);
                Dictionary<string,object> projectRequest=request as Dictionary<string,object>;
                if(projectRequest!=null && projectRequest.ContainsKey("action") && ((string)projectRequest["action"]).StartsWith("project"))
                    Record("项目配置操作："+projectRequest["action"]+"；连接参数与凭据已从日志省略。");
                else Record("本次选择："+new JavaScriptSerializer().Serialize(request));
            } catch(Exception error) {Record("日志文件创建失败："+error.Message);}
        }
        void Record(string text) {
            log.AppendText(text+Environment.NewLine);
            if(runLog==null) return;
            try {runLog.Write(text);}
            catch(Exception error) {log.AppendText("日志文件写入失败："+error.Message+Environment.NewLine);}
        }
        void ExportLog(object sender,EventArgs e) {
            using(SaveFileDialog dialog=new SaveFileDialog()) {
                dialog.Title="导出本次安装日志";
                dialog.Filter="安装日志|*.log";
                dialog.FileName=Path.GetFileName(logFile);
                dialog.InitialDirectory=Path.GetDirectoryName(logFile);
                if(dialog.ShowDialog(this)!=DialogResult.OK) return;
                try {
                    if(!String.Equals(Path.GetFullPath(dialog.FileName),logFile,StringComparison.OrdinalIgnoreCase))
                        File.Copy(logFile,dialog.FileName,true);
                    MessageBox.Show(this,"日志已保存到"+Environment.NewLine+dialog.FileName,"日志已导出");
                } catch(Exception error) {MessageBox.Show(this,error.Message,"日志导出失败");}
            }
        }
        void Append(string text) {
            if(String.IsNullOrEmpty(text)||IsDisposed)return;
            BeginInvoke((Action)delegate {Record(text);});
        }
        internal static ProcessStartInfo CreateWorkerStartInfo(string packageDirectory, string requestPath) {
            return new ProcessStartInfo {
                FileName=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"),
                Arguments="-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File \""+Path.Combine(packageDirectory,"gui-worker.ps1")+"\" -RequestFile \""+requestPath+"\"",
                UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,
                StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8
            };
        }
        internal static string DescribeStartupFailure(Exception error, string stage, string executable) {
            string message="失败步骤："+stage+Environment.NewLine+error.Message;
            System.ComponentModel.Win32Exception nativeError=error as System.ComponentModel.Win32Exception;
            if(nativeError!=null) message+=Environment.NewLine+"Windows 错误码："+nativeError.NativeErrorCode;
            if(!String.IsNullOrEmpty(executable)) message+=Environment.NewLine+"后台程序："+executable;
            return message;
        }
        void Execute(object request) {Execute(request,null);}
        void Execute(object request,Action<bool,string> completed) {
            string stage="创建临时目录";
            Process process=null;
            bool started=false;
            bool outputReady=false;
            string resultJson=null;
            StringBuilder projectOutput=new StringBuilder();
            log.Clear();
            BeginLog(request);
            try {
                string temp=Path.Combine(Directory.Exists("D:\\tmp")?"D:\\tmp":Path.GetTempPath(),"Codex","ai-dev-gui-"+Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(temp);requestFile=Path.Combine(temp,"request.json");
                stage="写入安装请求";
                File.WriteAllText(requestFile,new JavaScriptSerializer().Serialize(request),new UTF8Encoding(false));
                process=new Process();
                process.StartInfo=CreateWorkerStartInfo(AppDomain.CurrentDomain.BaseDirectory,requestFile);
                process.OutputDataReceived+=delegate(object s,DataReceivedEventArgs e){
                    if(e.Data!=null && e.Data.StartsWith("PROJECT_RESULT:")) resultJson=e.Data.Substring(15);
                    else {if(completed!=null && e.Data!=null)lock(projectOutput){projectOutput.AppendLine(e.Data);} Append(e.Data);}
                };
                process.ErrorDataReceived+=delegate(object s,DataReceivedEventArgs e){Append(e.Data);};
                running=true;settings.Enabled=start.Enabled=restore.Enabled=project.Enabled=false;status.Text="正在处理，请稍候…";
                progress.Style=ProgressBarStyle.Marquee;
                stage="启动 PowerShell";
                Record(stage+" · "+process.StartInfo.FileName+" · RemoteSigned");
                process.Start();
                started=true;
                Record("后台进程已启动，PID="+process.Id);
                stage="连接后台日志";
                process.BeginOutputReadLine();process.BeginErrorReadLine();
                outputReady=true;
            } catch(Exception error) {
                string details=DescribeStartupFailure(error,stage,process==null?null:process.StartInfo.FileName);
                Record(details);
                if(started) {
                    status.Text="日志连接失败 · 等待后台任务结束";
                } else {
                    running=false;settings.Enabled=start.Enabled=restore.Enabled=project.Enabled=true;
                    progress.Style=ProgressBarStyle.Blocks;progress.Value=0;
                    status.Text="启动失败 · 查看错误详情";
                    if(process!=null) process.Dispose();
                    CleanupRequest();
                }
                MessageBox.Show(this,details,started?"日志连接失败":"无法启动");
                if(!started && completed!=null)completed(false,null);
            } finally {
                if(started) System.Threading.ThreadPool.QueueUserWorkItem(delegate {
                    int code=-1;
                    string waitError=null;
                    try {process.WaitForExit();code=process.ExitCode;}
                    catch(Exception error) {waitError=error.Message;}
                    finally {process.Dispose();}
                    BeginInvoke((Action)delegate {
                        running=false;settings.Enabled=start.Enabled=restore.Enabled=project.Enabled=true;
                        bool success=code==0 && outputReady && waitError==null;
                        progress.Style=ProgressBarStyle.Blocks;progress.Value=success?100:0;
                        status.Text=success?(completed==null?"处理完成 · 请重新打开终端":"项目配置操作完成"):"任务未确认完成 · 查看日志后再处理";
                        Record("后台退出码："+code);
                        if(waitError!=null) Record("等待后台任务失败："+waitError);
                        Record(status.Text);
                        CleanupRequest();
                        if(completed!=null)completed(success,success?resultJson:projectOutput.ToString());
                    });
                });
            }
        }
        void CleanupRequest() {
            if(requestFile==null)return;
            try {File.Delete(requestFile);Directory.Delete(Path.GetDirectoryName(requestFile));requestFile=null;}
            catch(Exception error){Record("临时文件清理失败 "+requestFile+" "+error.Message);}
        }
    }
}
