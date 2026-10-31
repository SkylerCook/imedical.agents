using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class ExporterForm : Form {
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16777216 };
    readonly string home = AppDomain.CurrentDomain.BaseDirectory;
    readonly string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ImedicalSourceExporter");
    readonly ComboBox profiles = new ComboBox(), version = new ComboBox(), speed = new ComboBox();
    readonly TextBox url = new TextBox(), ns = new TextBox(), user = new TextBox(), password = new TextBox(), destination = new TextBox(), documents = new TextBox(), log = new TextBox();
    readonly CheckBox remember = new CheckBox(), show = new CheckBox(), web = new CheckBox(), trial = new CheckBox(), budget = new CheckBox();
    readonly Label status = new Label();
    readonly Button start = new Button(), resume = new Button(), stop = new Button(), closePool = new Button();
    readonly ListView results = new ListView();
    readonly Timer timer = new Timer();
    Process worker;
    Dictionary<string, object> job;
    Dictionary<string, Dictionary<string,string>> saved = new Dictionary<string, Dictionary<string,string>>();
    bool busy, blocked, shuttingDown;
    string batch;
    public ExporterForm(string stateDirectory = null) {
        if(stateDirectory!=null)data=Path.GetFullPath(stateDirectory);
        Text = "医院源码导出 · 会话复用版"; Size = new Size(1040,860); MinimumSize = new Size(900,760);
        Font = new Font("Microsoft YaHei UI",9); StartPosition = FormStartPosition.CenterScreen;
        var layout = new TableLayoutPanel { Dock=DockStyle.Fill, ColumnCount=1, RowCount=7, Padding=new Padding(16) };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,172)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,76));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent,40));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,74));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent,35));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,28));layout.RowStyles.Add(new RowStyle(SizeType.Percent,25));Controls.Add(layout);
        var conn = new TableLayoutPanel { Dock=DockStyle.Fill,ColumnCount=4,RowCount=5 };
        for(int i=0;i<5;i++)conn.RowStyles.Add(new RowStyle(SizeType.Absolute,32));
        conn.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,90));conn.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,60));conn.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,90));conn.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,40));
        Add(conn,"医院配置",profiles,0,0);Add(conn,"Namespace",ns,2,0); Add(conn,"Atelier URL",url,0,1);Add(conn,"用户名",user,2,1);
        Add(conn,"密码",password,0,2);password.UseSystemPasswordChar=true;
        var secretOptions=new FlowLayoutPanel{Dock=DockStyle.Fill};remember.Text="记住密码（本机加密）";remember.AutoSize=true;show.Text="显示";show.AutoSize=true;secretOptions.Controls.Add(remember);secretOptions.Controls.Add(show);conn.Controls.Add(secretOptions,1,3);show.CheckedChanged+=(s,e)=>password.UseSystemPasswordChar=!show.Checked;
        var save=new Button{Text="保存连接配置",AutoSize=true};conn.Controls.Add(save,3,2);save.Click+=(s,e)=>Guard(SaveProfile);
        var note=new Label{Text="仅当前 Windows 用户可解密；配置不进入导出包。URL 请填写到 /api/atelier/。",AutoSize=true};conn.Controls.Add(note,0,4);conn.SetColumnSpan(note,4);layout.Controls.Add(conn);
        var options=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=4,RowCount=2};options.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,90));options.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,60));options.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,90));options.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,40));
        Add(options,"保存根目录",destination,0,0);var browse=new Button{Text="浏览…",Dock=DockStyle.Fill};options.Controls.Add(browse,2,0);browse.Click+=(s,e)=>{using(var d=new FolderBrowserDialog())if(d.ShowDialog()==DialogResult.OK)destination.Text=d.SelectedPath;};
        Add(options,"导出范围",version,0,1);version.DropDownStyle=ComboBoxStyle.DropDownList;version.Items.AddRange(new object[]{"粘贴的对象清单","v8.4 医生站","v8.5 医生站","v9.0 医生站","v9.1 医生站","v9.2 全产品"});version.SelectedIndex=0;
        Add(options,"速度",speed,2,1);speed.DropDownStyle=ComboBoxStyle.DropDownList;speed.Items.AddRange(new object[]{"安全 · 1 会话 / 200ms","均衡 · 4 会话 / 100ms","快速 · 10 会话 / 50ms"});speed.SelectedIndex=0;layout.Controls.Add(options);
        var input=new TableLayoutPanel{Dock=DockStyle.Fill,RowCount=2,ColumnCount=1};input.RowStyles.Add(new RowStyle(SizeType.Absolute,30));input.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        var inputTools=new FlowLayoutPanel{Dock=DockStyle.Fill};inputTools.Controls.Add(new Label{Text="每行一个完整对象名；版本模式下作为医院补充清单",AutoSize=true});var import=new Button{Text="导入 TXT",AutoSize=true};inputTools.Controls.Add(import);import.Click+=(s,e)=>Guard(()=>{using(var d=new OpenFileDialog{Filter="UTF-8 清单|*.txt"})if(d.ShowDialog()==DialogResult.OK)documents.Text=File.ReadAllText(d.FileName,Encoding.UTF8);});input.Controls.Add(inputTools);documents.Multiline=true;documents.ScrollBars=ScrollBars.Both;documents.Dock=DockStyle.Fill;input.Controls.Add(documents);layout.Controls.Add(input);
        var actions=new FlowLayoutPanel{Dock=DockStyle.Fill,WrapContents=true};trial.Text="先做小批试验（每会话 1 个对象）";trial.AutoSize=true;trial.Checked=true;web.Text="已核对版本 Web 路径";web.AutoSize=true;budget.Text="当前目标已验证所选会话预算与资源回落";budget.AutoSize=true;actions.Controls.Add(trial);actions.Controls.Add(web);actions.Controls.Add(budget);actions.SetFlowBreak(budget,true);
        start.Text="预览并开始";resume.Text="继续已有批次";stop.Text="安全停止";closePool.Text="断开并核对退出";foreach(var b in new[]{start,resume,stop,closePool}){b.AutoSize=true;actions.Controls.Add(b);}var recover=new Button{Text="处理会话阻断",AutoSize=true};actions.Controls.Add(recover);recover.Click+=(s,e)=>Guard(Reconcile);var open=new Button{Text="打开结果",AutoSize=true};actions.Controls.Add(open);open.Click+=(s,e)=>Guard(()=>{if(batch!=null)Process.Start("explorer.exe",batch);});layout.Controls.Add(actions);
        results.View=View.Details;results.FullRowSelect=true;results.Dock=DockStyle.Fill;results.Columns.Add("对象",610);results.Columns.Add("结果",110);results.Columns.Add("字节",90);layout.Controls.Add(results);
        status.Text="启动本地会话管理器…";status.Dock=DockStyle.Fill;layout.Controls.Add(status);log.Multiline=true;log.ReadOnly=true;log.ScrollBars=ScrollBars.Vertical;log.Dock=DockStyle.Fill;layout.Controls.Add(log);
        start.Click+=(s,e)=>Guard(()=>Begin(false));resume.Click+=(s,e)=>Guard(()=>Begin(true));stop.Click+=(s,e)=>Guard(()=>{if(batch!=null){File.WriteAllText(Path.Combine(batch,"stop.request"),"stop");status.Text="等待在途请求收束，请勿强制关闭…";}});closePool.Click+=(s,e)=>Send(new{op="close"});
        timer.Interval=500;timer.Tick+=(s,e)=>RefreshReceipt();timer.Start();profiles.SelectedIndexChanged+=(s,e)=>Guard(LoadProfile);
        foreach(Control c in new Control[]{url,ns,user,password,speed})c.TextChanged+=(s,e)=>budget.Checked=false;
        LoadSettings();Shown+=(s,e)=>Guard(StartWorker);FormClosing+=(s,e)=>{if(worker!=null&&!worker.HasExited){e.Cancel=true;if(busy){if(batch!=null)File.WriteAllText(Path.Combine(batch,"stop.request"),"stop");MessageBox.Show("正在安全停止。请求收束后请再次关闭窗口。");}else if(!shuttingDown){shuttingDown=true;Send(new{op="quit"});}}};
        UpdateButtons();
    }
    void Add(TableLayoutPanel p,string label,Control c,int col,int row){p.Controls.Add(new Label{Text=label,AutoSize=true,Anchor=AnchorStyles.Left},col,row);c.Dock=DockStyle.Fill;p.Controls.Add(c,col+1,row);}
    void Guard(Action a){try{a();}catch(Exception e){MessageBox.Show(this,e.Message,"操作未完成",MessageBoxButtons.OK,MessageBoxIcon.Information);}}
    void Append(string text){log.AppendText(DateTime.Now.ToString("HH:mm:ss")+" "+text+Environment.NewLine);}
    void UpdateButtons(){foreach(Control c in new Control[]{profiles,url,ns,user,password,destination,documents,version,speed,trial,budget,web})c.Enabled=!busy;start.Enabled=resume.Enabled=!busy&&!blocked&&worker!=null&&!worker.HasExited;stop.Enabled=busy;closePool.Enabled=!busy&&worker!=null&&!worker.HasExited;}
    void LoadSettings(){Directory.CreateDirectory(data);var file=Path.Combine(data,"profiles.dpapi");if(!File.Exists(file))return;try{var text=Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(file),null,DataProtectionScope.CurrentUser));saved=json.Deserialize<Dictionary<string,Dictionary<string,string>>>(text);foreach(var key in saved.Keys)profiles.Items.Add(key);if(profiles.Items.Count>0)profiles.SelectedIndex=0;}catch{Append("保存的配置无法解密，请重新填写；原文件未覆盖。");}}
    void SaveProfile(){if(String.IsNullOrWhiteSpace(profiles.Text))throw new Exception("请填写医院配置名称。");saved[profiles.Text]=new Dictionary<string,string>{{"url",url.Text.Trim()},{"ns",ns.Text.Trim()},{"user",user.Text},{"password",remember.Checked?password.Text:""},{"destination",destination.Text}};var bytes=ProtectedData.Protect(Encoding.UTF8.GetBytes(json.Serialize(saved)),null,DataProtectionScope.CurrentUser);var file=Path.Combine(data,"profiles.dpapi");var temp=file+".tmp";File.WriteAllBytes(temp,bytes);if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);if(!profiles.Items.Contains(profiles.Text))profiles.Items.Add(profiles.Text);Append("连接配置已保存。");}
    void LoadProfile(){Dictionary<string,string> p;if(!saved.TryGetValue(profiles.Text,out p))return;url.Text=p["url"];ns.Text=p["ns"];user.Text=p["user"];password.Text=p["password"];remember.Checked=password.Text.Length>0;destination.Text=p["destination"];}
    void StartWorker(){var info=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"WindowsPowerShell/v1.0/powershell.exe"),"-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(home,"gui-worker.ps1")+"\" -StateDirectory \""+data+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};worker=new Process{StartInfo=info,EnableRaisingEvents=true};worker.OutputDataReceived+=(s,e)=>{if(e.Data!=null&&!IsDisposed)BeginInvoke(new Action(()=>Receive(e.Data)));};worker.ErrorDataReceived+=(s,e)=>{if(e.Data!=null&&!IsDisposed)BeginInvoke(new Action(()=>Append(e.Data)));};worker.Exited+=(s,e)=>{if(!IsDisposed)BeginInvoke(new Action(()=>{busy=false;UpdateButtons();if(shuttingDown)Close();else Append("后台进程已退出；如有未核对会话，下次启动将阻断导出。");}));};worker.Start();worker.BeginOutputReadLine();worker.BeginErrorReadLine();}
    void Send(object value){if(worker==null||worker.HasExited)throw new Exception("后台进程未运行。");worker.StandardInput.WriteLine(json.Serialize(value));worker.StandardInput.Flush();}
    void Begin(bool continuing){if(String.IsNullOrWhiteSpace(password.Text)||String.IsNullOrWhiteSpace(user.Text))throw new Exception("请填写用户名和密码。");Uri uri;if(!Uri.TryCreate(url.Text.Trim(),UriKind.Absolute,out uri)||!(uri.Scheme=="http"||uri.Scheme=="https")||!uri.AbsolutePath.TrimEnd('/').EndsWith("/api/atelier")||uri.UserInfo!=""||uri.Query!=""||uri.Fragment!="")throw new Exception("请填写有效的 Atelier 根 URL，以 /api/atelier/ 结尾。");
        if(continuing){using(var d=new OpenFileDialog{Filter="导出批次|job.json",Title="选择要继续的批次 job.json"}){if(d.ShowDialog()!=DialogResult.OK)return;job=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(d.FileName,Encoding.UTF8));batch=Path.GetDirectoryName(d.FileName);if(!String.Equals(Path.GetFullPath(Convert.ToString(job["batch"])),batch,StringComparison.OrdinalIgnoreCase))throw new Exception("批次目录已移动，请保留原路径后恢复。");if(Convert.ToString(job["url"])!=url.Text.Trim()||Convert.ToString(job["ns"])!=ns.Text.Trim())throw new Exception("连接或 Namespace 与批次不一致，请选择原医院配置。");}}
        else{if(!Path.IsPathRooted(destination.Text))throw new Exception("请选择保存根目录。");if(version.SelectedIndex==0&&String.IsNullOrWhiteSpace(documents.Text))throw new Exception("请粘贴导出对象或选择版本。");batch=Path.Combine(destination.Text,"batch-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,6));Directory.CreateDirectory(batch);job=new Dictionary<string,object>{{"batch",batch},{"url",url.Text.Trim()},{"ns",ns.Text.Trim()},{"sessions",new[]{1,4,10}[speed.SelectedIndex]},{"interval",new[]{200,100,50}[speed.SelectedIndex]},{"version",version.SelectedIndex==0?"":version.Text.Split(' ')[0]},{"scope",version.SelectedIndex==5?"all-products":"doctor"},{"confirmWeb",web.Checked}};if(!String.IsNullOrWhiteSpace(documents.Text))File.WriteAllText(Path.Combine(batch,"files.txt"),documents.Text,new UTF8Encoding(false));File.WriteAllText(Path.Combine(batch,"job.json"),json.Serialize(job),new UTF8Encoding(false));}
        if(Convert.ToInt32(job["sessions"])>1&&!trial.Checked&&!budget.Checked)throw new Exception("多会话请先做小批试验，并核对现场会话预算与资源回落。");var stopFile=Path.Combine(batch,"stop.request");if(File.Exists(stopFile))File.Delete(stopFile);busy=true;UpdateButtons();status.Text="正在本地预览清单…";job["resume"]=continuing;Send(new{op="run",job,plan=true});
    }
    void Receive(string line){try{var e=json.Deserialize<Dictionary<string,object>>(line);var kind=Convert.ToString(e["kind"]);var d=(Dictionary<string,object>)e["data"];if(d.ContainsKey("blocked"))blocked=Convert.ToBoolean(d["blocked"]);
        if(kind=="ready"){status.Text=blocked?"上次会话未核对，导出已阻断":"就绪 · 同一后台复用会话 · 空闲 120 秒后注销";Append(status.Text);}
        else if(kind=="result"){var output=Convert.ToString(d["output"]);if(Convert.ToBoolean(d["plan"])){if(Convert.ToInt32(d["exitCode"])!=0){busy=false;Append(output);}else if(MessageBox.Show(this,Preview(output)+"\n\n确认以上范围并开始读取？","导出预览",MessageBoxButtons.OKCancel)==DialogResult.OK){status.Text="正在导出；重复批次复用原会话…";Send(new{op="run",job,user=user.Text,password=password.Text,resume=Convert.ToBoolean(job["resume"]),trial=trial.Checked,confirmed=budget.Checked});}else{busy=false;}}
            else{busy=false;Append(output);status.Text=Convert.ToBoolean(d["retained"])?"本批读取结束 · 会话保留供复用；点击断开或空闲后统一核对退出":"本批读取结束，请核对结果与退出记录";RefreshReceipt();}}
        else if(kind=="closed"){Append("会话退出核对："+Convert.ToString(d["cleanupVerified"])+"；实际 License 回落仍需现场核对。");status.Text=blocked?"退出或请求异常，已阻断新增连接":"自有会话已收束";RefreshReceipt();}
        else if(kind=="reconciled"){status.Text="核实依据已记录，可以重新开始";Append(status.Text);}
        else if(kind=="error"||kind=="fatal"){busy=false;Append(Convert.ToString(d["reason"]));status.Text="操作已停止，详情见日志";}
        UpdateButtons();}catch(Exception ex){Append("后台消息解析失败："+ex.Message);}}
    string Preview(string output){
        try{var p=json.Deserialize<Dictionary<string,object>>(output);var text="对象数量："+Convert.ToString(p["total"])+"\n";
            if(p.ContainsKey("version"))text+="版本范围："+p["version"]+"（读取医院当前内容）\n";
            if(p.ContainsKey("webRoots"))text+="Web 前缀："+json.Serialize(p["webRoots"])+"\n";
            if(p.ContainsKey("items")){int count=0;foreach(Dictionary<string,object> item in (System.Collections.IEnumerable)p["items"]){if(count++>=8)break;text+=Convert.ToString(item["document"])+"\n";}}
            if(p.ContainsKey("sample"))text+=json.Serialize(p["sample"])+"\n";
            return text+"\n"+(job==null?speed.Text:Convert.ToString(job["sessions"])+" 会话 / "+Convert.ToString(job["interval"])+"ms")+"\n"+(trial.Checked?"本轮仅做小批试验":"本轮导出完整清单");
        }catch{return output.Length>2000?output.Substring(0,2000):output;}
    }
    void Reconcile(){
        if(busy)throw new Exception("请等待当前请求收束。");
        using(var dialog=new Form{Text="核实服务器遗留会话",Size=new Size(600,280),StartPosition=FormStartPosition.CenterParent}){
            var label=new Label{Text="先在服务器核实本工具遗留会话已结束、资源占用已处理，再填写核实依据。\n不能用重启或点击继续代替现场核实；此操作不会替你清理服务器。",Dock=DockStyle.Top,Height=55};
            var evidence=new TextBox{Multiline=true,Dock=DockStyle.Fill};var confirm=new Button{Text="已核实，登记依据并解除阻断",Dock=DockStyle.Bottom,Height=36};
            dialog.Controls.Add(evidence);dialog.Controls.Add(label);dialog.Controls.Add(confirm);confirm.Click+=(s,e)=>{if(evidence.Text.Trim().Length<10){MessageBox.Show("请填写实际核实方式、结果和时间。");return;}Send(new{op="reconcile",confirm=true,evidence=evidence.Text.Trim()});dialog.Close();};dialog.ShowDialog(this);
        }
    }
    void RefreshReceipt(){if(batch==null)return;var file=Path.Combine(batch,"export/baseline-state.json");if(!File.Exists(file))return;try{var state=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));var items=(System.Collections.IEnumerable)state["items"];results.BeginUpdate();results.Items.Clear();foreach(Dictionary<string,object> item in items){var row=new ListViewItem(Convert.ToString(item["document"]));row.SubItems.Add(Convert.ToString(item["status"]));row.SubItems.Add(Convert.ToString(item["bytes"]));results.Items.Add(row);}results.EndUpdate();if(busy)status.Text="正在读取 · 已处理 "+CountFinished(items)+" / "+results.Items.Count+" · "+Convert.ToString(job["sessions"])+" 个会话（上限）";}catch{/* Atomic replacement may coincide with the timer; retry next tick. */}}
    int CountFinished(System.Collections.IEnumerable items){int n=0;foreach(Dictionary<string,object> i in items)if(Convert.ToString(i["status"])!="pending"&&Convert.ToString(i["status"])!="writing")n++;return n;}
    [STAThread] public static void Main(string[] args){
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        if(args.Length==2 && args[0]=="--self-test"){
            try { SelfTest(args[1]); Environment.Exit(0); } catch(Exception ex) { File.WriteAllText(Path.Combine(args[1],"failed.txt"),ex.ToString()); Environment.Exit(1); } return;
        }
        Application.Run(new ExporterForm());
    }
    static void SelfTest(string directory){
        Directory.CreateDirectory(directory);
        using(var f=new ExporterForm(directory)){
            f.profiles.Text="Local test";f.url.Text="http://127.0.0.1:1/api/atelier/";f.ns.Text="TEST";f.user.Text="test";f.password.Text="synthetic-password";f.remember.Checked=true;f.SaveProfile();
            var bytes=File.ReadAllBytes(Path.Combine(directory,"profiles.dpapi"));if(Encoding.UTF8.GetString(bytes).Contains("synthetic-password"))throw new Exception("plaintext-password-written");
            using(var loaded=new ExporterForm(directory)){if(loaded.password.Text!="synthetic-password"||loaded.url.Text!=f.url.Text)throw new Exception("profile-roundtrip-failed");}
            f.remember.Checked=false;f.SaveProfile();using(var loaded=new ExporterForm(directory)){if(loaded.password.Text!="")throw new Exception("password-not-cleared");}
            f.batch=Path.Combine(directory,"receipt");Directory.CreateDirectory(Path.Combine(f.batch,"export"));
            File.WriteAllText(Path.Combine(f.batch,"export/baseline-state.json"),"{\"items\":[{\"document\":\"Demo.A.cls\",\"status\":\"fetched\",\"bytes\":12}]}");
            f.RefreshReceipt();if(f.results.Items.Count!=1||f.results.Items[0].Text!="Demo.A.cls")throw new Exception("receipt-grid-not-populated");
            var preview=f.Preview("{\"total\":1,\"items\":[{\"document\":\"Demo.A.cls\"}]}");if(!preview.Contains("Demo.A.cls"))throw new Exception("preview-not-populated");
            File.WriteAllText(Path.Combine(directory,"passed.txt"),"DPAPI roundtrip; password removal; receipt grid; preview passed");
        }
    }
}
