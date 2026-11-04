using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class BufferedResultList : ListView {
    public BufferedResultList(){DoubleBuffered=true;}
}
public sealed partial class ExporterForm : Form {
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16777216 };
    readonly string home = AppDomain.CurrentDomain.BaseDirectory;
    readonly string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ImedicalSourceExporter");
    readonly ComboBox profiles = new ComboBox(), version = new ComboBox(), speed = new ComboBox();
    readonly TextBox url = new TextBox(), ns = new TextBox(), user = new TextBox(), password = new TextBox(), destination = new TextBox(), documents = new TextBox(), log = new TextBox();
    readonly CheckBox remember = new CheckBox(), show = new CheckBox(), web = new CheckBox(), trial = new CheckBox(), budget = new CheckBox();
    readonly Label status = new Label();
    readonly Label elapsedLabel = new Label{Text="本次用时：未开始",Dock=DockStyle.Right,Width=190,TextAlign=ContentAlignment.MiddleRight};
    readonly Stopwatch runClock = new Stopwatch();
    readonly Button start = new Button(), resume = new Button(), stop = new Button(), closePool = new Button(), retryMissing = new Button();
    readonly ListView results = new BufferedResultList();
    readonly List<ListViewItem> resultRows = new List<ListViewItem>();
    const int PageSize=200;
    int resultPage;
    readonly Label pageLabel=new Label{AutoSize=true};
    readonly Button previousPage=new Button{Text="上一页",AutoSize=true}, nextPage=new Button{Text="下一页",AutoSize=true};
    readonly Timer timer = new Timer();
    Process worker;
    StreamWriter workerInput;
    Dictionary<string, object> job;
    Dictionary<string, Dictionary<string,string>> saved = new Dictionary<string, Dictionary<string,string>>();
    bool busy, blocked, shuttingDown, displayingJob, reading;
    readonly bool quietValidation;
    string batch;
    string displayedBatch, displayedReceipt;
    const FileShare ReceiptSharing=FileShare.ReadWrite|FileShare.Delete;
    public ExporterForm(string stateDirectory = null, bool startIsolatedWorker = false) {
        if(stateDirectory!=null)data=Path.GetFullPath(stateDirectory);quietValidation=stateDirectory!=null&&!startIsolatedWorker;
        Text = "医院源码导出 · 会话复用版"; Size = new Size(1040,860); MinimumSize = new Size(900,760);
        Font = new Font("Microsoft YaHei",9); StartPosition = FormStartPosition.CenterScreen;
        BuildWindow();
        timer.Interval=500;timer.Tick+=(s,e)=>{RefreshReceipt();UpdateElapsed();};timer.Start();profiles.SelectedIndexChanged+=(s,e)=>Guard(LoadProfile);
        foreach(Control c in new Control[]{url,ns,user,password,speed})c.TextChanged+=(s,e)=>{if(!displayingJob){budget.Checked=false;trialIdentity=null;}UpdateScopeControls();};
        LoadSettings();TryOpenSavedProject();Shown+=(s,e)=>{if(stateDirectory==null||startIsolatedWorker)Guard(()=>{var problem=RuntimeProblem();if(problem!=null){ShowWorkbenchError(problem);return;}StartWorker();});};FormClosing+=(s,e)=>{if(worker!=null&&!worker.HasExited){e.Cancel=true;Guard(RequestClose);}};
        UpdateButtons();
    }
    protected override bool ShowWithoutActivation {get{return quietValidation;}}
    void Add(TableLayoutPanel p,string label,Control c,int col,int row){p.Controls.Add(new Label{Text=label,AutoSize=true,Anchor=AnchorStyles.Left},col,row);c.Dock=DockStyle.Fill;p.Controls.Add(c,col+1,row);}
    void Guard(Action a){try{a();}catch(Exception e){ShowWorkbenchError(e.Message);MessageBox.Show(this,e.Message,"操作未完成",MessageBoxButtons.OK,MessageBoxIcon.Information);}}
    void Append(string text){log.AppendText(DateTime.Now.ToString("HH:mm:ss")+" "+text+Environment.NewLine);}
    void PrepareMissingRetry(){
        if(batch==null||job==null)throw new Exception("请先完成一个导出批次。");
        if(!String.Equals(url.Text.Trim(),Convert.ToString(job["url"]),StringComparison.OrdinalIgnoreCase)||ns.Text.Trim()!=Convert.ToString(job["ns"]))throw new Exception("请先切回原批次的连接和命名空间，再补取 missing。");
        var file=Path.Combine(batch,"export/missing-objects.txt");
        var text=String.Join("\r\n",PendingMissingNames());
        if(String.IsNullOrWhiteSpace(text))throw new Exception("本批没有未确认的缺失对象；已确认不补取的对象不会自动重试。");
        destination.Text=Directory.GetParent(batch).FullName;version.SelectedIndex=0;speed.SelectedIndex=0;
        trial.Checked=false;budget.Checked=false;web.Checked=false;documents.Text=text;
    }
    void LoadSettings(){Directory.CreateDirectory(data);var file=Path.Combine(data,"profiles.dpapi");if(!File.Exists(file))return;try{var text=Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(file),null,DataProtectionScope.CurrentUser));saved=json.Deserialize<Dictionary<string,Dictionary<string,string>>>(text);foreach(var key in saved.Keys)profiles.Items.Add(key);if(profiles.Items.Count>0)profiles.SelectedIndex=0;}catch{Append("保存的配置无法解密，请重新填写；原文件未覆盖。");}}
    void SaveProfile(){if(String.IsNullOrWhiteSpace(profiles.Text))throw new Exception("请填写医院配置名称。");saved[profiles.Text]=new Dictionary<string,string>{{"url",url.Text.Trim()},{"ns",ns.Text.Trim()},{"user",user.Text},{"password",remember.Checked?password.Text:""},{"destination",destination.Text}};var bytes=ProtectedData.Protect(Encoding.UTF8.GetBytes(json.Serialize(saved)),null,DataProtectionScope.CurrentUser);var file=Path.Combine(data,"profiles.dpapi");var temp=file+".tmp";File.WriteAllBytes(temp,bytes);if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);if(!profiles.Items.Contains(profiles.Text))profiles.Items.Add(profiles.Text);Append("连接配置已保存。");}
    void LoadProfile(){Dictionary<string,string> p;if(!saved.TryGetValue(profiles.Text,out p))return;if(project!=null){project.Dispose();project=null;}url.Text=p["url"];ns.Text=p["ns"];user.Text=p["user"];password.Text=p["password"];remember.Checked=password.Text.Length>0;destination.Text=p["destination"];TryOpenSavedProject();}
    void StartWorker(){var info=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"WindowsPowerShell/v1.0/powershell.exe"),"-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(home,"gui-worker.ps1")+"\" -StateDirectory \""+data+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};worker=new Process{StartInfo=info,EnableRaisingEvents=true};worker.OutputDataReceived+=(s,e)=>{if(e.Data!=null&&!IsDisposed)BeginInvoke(new Action(()=>Receive(e.Data)));};worker.ErrorDataReceived+=(s,e)=>{if(e.Data!=null&&!IsDisposed)BeginInvoke(new Action(()=>Append(e.Data)));};worker.Exited+=(s,e)=>{if(!IsDisposed)BeginInvoke(new Action(()=>{busy=false;reading=false;runClock.Stop();UpdateElapsed();UpdateButtons();if(shuttingDown)Close();else Append("后台进程已退出；如有未核对会话，下次启动将阻断导出。");}));};worker.Start();workerInput=new StreamWriter(worker.StandardInput.BaseStream,new UTF8Encoding(false));workerInput.AutoFlush=true;worker.BeginOutputReadLine();worker.BeginErrorReadLine();}
    void Send(object value){if(worker==null||worker.HasExited)throw new Exception("后台进程未运行。");workerInput.WriteLine(json.Serialize(value));workerInput.Flush();}
    void Begin(bool continuing){BeginTask(continuing);}
    void DisplayJob(){
        displayingJob=true;
        try{
            destination.Text=Path.GetDirectoryName(batch);
            var name=Convert.ToString(job["version"]);version.SelectedIndex=0;
            for(int i=1;i<version.Items.Count;i++)if(Convert.ToString(version.Items[i]).Split(' ')[0]==name){version.SelectedIndex=i;break;}
            int index=Array.IndexOf(new[]{1,4,10},Convert.ToInt32(job["sessions"]));if(index>=0)speed.SelectedIndex=index;
            web.Checked=Convert.ToBoolean(job["confirmWeb"]);
            var list=Path.Combine(batch,"files.txt");documents.Text=File.Exists(list)?File.ReadAllText(list,Encoding.UTF8):"";
        }finally{displayingJob=false;}
        inputSource=String.IsNullOrEmpty(TextValue(job,"inputSource"))?"原批次清单":TextValue(job,"inputSource");UpdateInputSummary();UpdateScopeControls();
    }
    void UpdateElapsed(){
        if(!runClock.IsRunning && runClock.ElapsedTicks==0)return;
        var value="本次用时："+FormatElapsed(TimeSpan.FromMilliseconds((IsProjectJob?elapsedBeforeResume:0)+runClock.ElapsedMilliseconds));
        if(elapsedLabel.Text!=value)elapsedLabel.Text=value;
    }
    static string FormatElapsed(TimeSpan duration){return ((int)duration.TotalMinutes).ToString("D2")+"分"+duration.Seconds.ToString("D2")+"秒";}
    string Preview(string output){
        try{var p=json.Deserialize<Dictionary<string,object>>(output);var text="对象数量："+Convert.ToString(p["total"])+"\n";
            if(p.ContainsKey("version"))text+="版本范围："+p["version"]+"（读取医院当前内容）\n";
            if(p.ContainsKey("webRoots"))text+="Web 前缀："+json.Serialize(p["webRoots"])+"\n";
            if(p.ContainsKey("items")){int count=0;foreach(Dictionary<string,object> item in (System.Collections.IEnumerable)p["items"]){if(count++>=8)break;text+=Convert.ToString(item["document"])+"\n";}}
            if(p.ContainsKey("sample"))text+=json.Serialize(p["sample"])+"\n";
            return text+"\n"+(job==null?speed.Text:Convert.ToString(job["sessions"])+" 会话 / "+Convert.ToString(job["interval"])+"ms")+"\n"+(trial.Checked?"本轮仅做小批试验":"本轮导出完整清单");
        }catch{return output.Length>2000?output.Substring(0,2000):output;}
    }
    void RefreshReceipt(){
        if(RefreshProjectReceipt())return;
        if(batch==null)return;
        var file=Path.Combine(batch,"export/baseline-state.json");if(!File.Exists(file))return;
        try{
            string content;
            using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,ReceiptSharing))
            using(var reader=new StreamReader(stream,Encoding.UTF8))content=reader.ReadToEnd();
            if(displayedBatch==batch && displayedReceipt==content)return;
            var state=json.Deserialize<Dictionary<string,object>>(content);
            var items=(System.Collections.IEnumerable)state["items"];
            var confirmed=ConfirmedNames();
            int dirtyFirst=Int32.MaxValue,dirtyLast=-1;
            {
                if(displayedBatch!=batch){results.VirtualListSize=0;resultRows.Clear();resultPage=0;}
                int index=0;
                foreach(Dictionary<string,object> item in items){
                    var name=ImportableName(Convert.ToString(item["document"]));
                    var outcome=RenderOutcome(item,confirmed);
                    var bytes=Convert.ToString(item["bytes"]);
                    if(index>=resultRows.Count){
                        var row=new ListViewItem(name);row.SubItems.Add(outcome);row.SubItems.Add(bytes);row.Tag=item;resultRows.Add(row);
                    }else{
                        var row=resultRows[index];row.Tag=item;
                        bool changed=row.Text!=name||row.SubItems[1].Text!=outcome||row.SubItems[2].Text!=bytes;
                        if(changed && index>=resultPage*PageSize && index<(resultPage+1)*PageSize){dirtyFirst=Math.Min(dirtyFirst,index-resultPage*PageSize);dirtyLast=index-resultPage*PageSize;}
                        if(row.Text!=name)row.Text=name;
                        if(row.SubItems[1].Text!=outcome)row.SubItems[1].Text=outcome;
                        if(row.SubItems[2].Text!=bytes)row.SubItems[2].Text=bytes;
                    }
                    index++;
                }
                while(resultRows.Count>index)resultRows.RemoveAt(resultRows.Count-1);
                RenderPage(false);
            }
            if(resultFilter.SelectedIndex>0)results.Invalidate();
            else if(dirtyLast>=dirtyFirst && dirtyFirst<results.VirtualListSize && results.IsHandleCreated)results.RedrawItems(dirtyFirst,Math.Min(dirtyLast,results.VirtualListSize-1),true);
            displayedBatch=batch;displayedReceipt=content;
            PaintReceiptSummary(state);
        }catch{/* Atomic replacement may coincide with the timer; retry next tick. */}
    }
    void RenderPage(bool changed){
        visibleRows.Clear();foreach(var row in resultRows){var raw=RawStatus(row);int filter=resultFilter.SelectedIndex;bool selected=filter<=0||(filter==1&&raw=="missing")||(filter==2&&(legacyMode?(raw=="failed"||raw=="empty"):raw!="fetched"))||(filter==3&&(raw=="fetched"||project!=null&&project.Find(RawName(row))!=null&&!String.IsNullOrEmpty(project.Find(RawName(row)).sha256)))||(filter==4&&(raw=="pending"||raw=="writing"))||(filter==5&&(raw=="candidate-new"||raw=="candidate-change"||raw=="local-conflict"));if(selected&&MatchWorkbenchRow(row))visibleRows.Add(row);}
        int pages=Math.Max(1,(visibleRows.Count+PageSize-1)/PageSize);resultPage=Math.Max(0,Math.Min(resultPage,pages-1));
        int count=Math.Min(PageSize,Math.Max(0,visibleRows.Count-resultPage*PageSize));
        if(changed)results.VirtualListSize=0;
        if(results.VirtualListSize!=count){results.VirtualListSize=count;changed=true;}
        previousPage.Enabled=resultPage>0;nextPage.Enabled=resultPage+1<pages;
        pageLabel.Text="第 "+(resultPage+1)+" / "+pages+" 页 · "+visibleRows.Count+" / "+resultRows.Count+" 项";if(changed)results.Invalidate();
    }
    int CountFinished(System.Collections.IEnumerable items){int n=0;foreach(Dictionary<string,object> i in items)if(Convert.ToString(i["status"])!="pending"&&Convert.ToString(i["status"])!="writing")n++;return n;}
    [STAThread] public static void Main(string[] args){
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        if(args.Length==2 && args[0]=="--self-test"){
            try { SelfTest(args[1]); Environment.Exit(0); } catch(Exception ex) { File.WriteAllText(Path.Combine(args[1],"failed.txt"),ex.ToString()); Environment.Exit(1); } return;
        }
        Application.Run(args.Length==2&&args[0]=="--state-directory"?new ExporterForm(args[1],true):new ExporterForm());
    }
    static void SelfTest(string directory){
        Directory.CreateDirectory(directory);
        using(var f=new ExporterForm(directory)){
            if(f.speed.SelectedIndex!=0||f.trial.Checked||f.budget.Checked)throw new Exception("default-single-session-must-not-require-a-separate-trial");
            f.profiles.Text="Local test";f.url.Text="http://127.0.0.1:1/api/atelier/";f.ns.Text="TEST";f.user.Text="test";f.password.Text="synthetic-password";f.remember.Checked=true;f.SaveProfile();
            var bytes=File.ReadAllBytes(Path.Combine(directory,"profiles.dpapi"));if(Encoding.UTF8.GetString(bytes).Contains("synthetic-password"))throw new Exception("plaintext-password-written");
            using(var loaded=new ExporterForm(directory)){if(loaded.password.Text!="synthetic-password"||loaded.url.Text!=f.url.Text)throw new Exception("profile-roundtrip-failed");}
            f.remember.Checked=false;f.SaveProfile();using(var loaded=new ExporterForm(directory)){if(loaded.password.Text!="")throw new Exception("password-not-cleared");}
            f.batch=Path.Combine(directory,"receipt");Directory.CreateDirectory(Path.Combine(f.batch,"export"));
            f.job=new Dictionary<string,object>{{"version","v9.2"},{"sessions",4},{"interval",100},{"confirmWeb",false}};
            f.budget.Checked=true;f.DisplayJob();
            if(!f.version.Text.StartsWith("v9.2 ",StringComparison.Ordinal)||f.speed.SelectedIndex!=1||!f.budget.Checked||f.destination.Text!=directory)throw new Exception("resume-controls-disagree-with-job");
            f.speed.SelectedIndex=0;if(f.budget.Checked)throw new Exception("manual-speed-change-kept-budget");
            File.WriteAllText(Path.Combine(f.batch,"export/baseline-state.json"),"{\"items\":[{\"document\":\"Demo.A.cls\",\"status\":\"fetched\",\"bytes\":12}]}");
            f.RefreshReceipt();if(f.resultRows.Count!=1||f.resultRows[0].Text!="Demo.A.cls")throw new Exception("receipt-grid-not-populated");
            var originalRow=f.resultRows[0];
            f.RefreshReceipt();if(!Object.ReferenceEquals(originalRow,f.resultRows[0]))throw new Exception("unchanged-receipt-rebuilt-row");
            var receiptFile=Path.Combine(f.batch,"export/baseline-state.json");
            File.WriteAllText(receiptFile,File.ReadAllText(receiptFile).Replace("fetched","missing"));
            f.RefreshReceipt();if(!Object.ReferenceEquals(originalRow,f.resultRows[0])||RawStatus(originalRow)!="missing")throw new Exception("incremental-refresh-lost-row-state");
            using(var held=new FileStream(receiptFile,FileMode.Open,FileAccess.Read,ReceiptSharing)){
                File.WriteAllText(receiptFile+".next",File.ReadAllText(receiptFile).Replace("missing","fetched"));
                File.Replace(receiptFile+".next",receiptFile,null);
            }
            f.RefreshReceipt();if(RawStatus(originalRow)!="fetched")throw new Exception("receipt-replacement-while-reading-failed");
            var preview=f.Preview("{\"total\":1,\"items\":[{\"document\":\"Demo.A.cls\"}]}");if(!preview.Contains("Demo.A.cls"))throw new Exception("preview-not-populated");
            var many=new List<object>();for(int n=0;n<5352;n++)many.Add(new{document="Demo.C"+n+".cls",status="pending",bytes=0});
            File.WriteAllText(receiptFile,f.json.Serialize(new{items=many}));
            var watch=Stopwatch.StartNew();f.RefreshReceipt();watch.Stop();
            if(f.resultRows.Count!=5352||f.results.VirtualListSize!=PageSize||watch.ElapsedMilliseconds>5000)throw new Exception("large-list-refresh-failed");
            f.resultPage=26;f.RenderPage(true);if(f.results.VirtualListSize!=152||f.resultRows[f.resultPage*PageSize].Text!="Demo.C5200.cls")throw new Exception("last-page-failed");
            f.displayedReceipt=null;
            f.job["url"]=f.url.Text.Trim();f.job["ns"]=f.ns.Text.Trim();
            var missingFile=Path.Combine(f.batch,"export/missing-objects.txt");File.WriteAllText(missingFile,"Demo.Missing.cls\r\n/app/missing.js\r\n",new UTF8Encoding(false));
            File.WriteAllText(receiptFile,"{\"items\":[{\"document\":\"Demo.Missing.cls\",\"status\":\"missing\",\"bytes\":0},{\"document\":\"app/missing.js\",\"status\":\"missing\",\"bytes\":0}]}");f.RefreshReceipt();
            var sourceBatch=f.batch;f.speed.SelectedIndex=2;f.trial.Checked=true;f.PrepareMissingRetry();
            if(f.speed.SelectedIndex!=0||f.version.SelectedIndex!=0||f.trial.Checked||f.budget.Checked||f.batch!=sourceBatch||f.documents.Text!="Demo.Missing.cls\r\n/app/missing.js")throw new Exception("missing-retry-preparation-invalid");
            WorkflowSelfTest(f,directory);
            File.WriteAllText(Path.Combine(directory,"passed.txt"),"DPAPI roundtrip; password removal; receipt grid; incremental refresh preserves rows and selection; concurrent receipt replacement; 5352 backing rows with 200-row pages; preview passed");
        }
    }
}
