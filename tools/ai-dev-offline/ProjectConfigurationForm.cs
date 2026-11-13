using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AiDevOffline {
    static class ToolLocations {
        static readonly string[] fields={"projectRoot","codeExe","pwshExe","gitExe","nodeExe","mcpExe","materialsPath"};
        internal static string PreferenceFile() {
            string local=Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if(String.IsNullOrEmpty(local))local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(local,"AiDevOffline","last-project.json");
        }
        internal static Dictionary<string,string> Read(string file) {
            var result=new Dictionary<string,string>();
            try {
                var values=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
                if(values==null)return result;
                foreach(string key in fields)if(values.ContainsKey(key) && values[key] is string)result[key]=(string)values[key];
            } catch(IOException) {} catch(UnauthorizedAccessException) {} catch(ArgumentException) {} catch(InvalidOperationException) {}
            return result;
        }
        internal static void Save(string file,Dictionary<string,object> request) {
            var values=Read(file);
            foreach(string key in fields)if(request.ContainsKey(key) && request[key] is string)values[key]=(string)request[key];
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            string temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
            try {
                File.WriteAllText(temp,new JavaScriptSerializer().Serialize(values),new UTF8Encoding(false));
                if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);
            } finally {if(File.Exists(temp))File.Delete(temp);}
        }
        internal static string FirstFile(params string[] candidates) {
            foreach(string file in candidates)if(!String.IsNullOrWhiteSpace(file) && File.Exists(file))return Path.GetFullPath(file);
            return "";
        }
        internal static string FromPath(string name) {
            string paths=Environment.GetEnvironmentVariable("PATH")+";"+Environment.GetEnvironmentVariable("PATH",EnvironmentVariableTarget.User)+";"+Environment.GetEnvironmentVariable("PATH",EnvironmentVariableTarget.Machine);
            foreach(string folder in paths.Split(';')) {
                try {string file=Path.Combine(Environment.ExpandEnvironmentVariables(folder.Trim().Trim('"')),name);if(File.Exists(file))return Path.GetFullPath(file);}catch(ArgumentException){}
            }
            return "";
        }
        internal static string RegisteredCode() {
            foreach(RegistryKey hive in new[]{Registry.CurrentUser,Registry.LocalMachine}) {
                try {using(RegistryKey key=hive.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\Code.exe")) {
                    string file=key==null?null:key.GetValue(null) as string;
                    if(file!=null && File.Exists(file.Trim('"')))return file.Trim('"');
                }} catch(System.Security.SecurityException) {} catch(UnauthorizedAccessException) {}
            }
            return "";
        }
    }
    sealed class ProjectConfigurationForm : Form {
        readonly Action<object,Action<bool,string>> execute;
        readonly JavaScriptSerializer json=new JavaScriptSerializer();
        readonly TextBox projectRoot=new TextBox(),codeExe=new TextBox(),pwshExe=new TextBox(),gitExe=new TextBox(),nodeExe=new TextBox(),mcpExe=new TextBox();
        readonly TextBox alias=new TextBox(),host=new TextBox(),port=new TextBox(),ns=new TextBox(),description=new TextBox(),username=new TextBox(),password=new TextBox();
        readonly ComboBox scheme=new ComboBox(),userMode=new ComboBox();
        readonly CheckBox mcp=new CheckBox(),common=new CheckBox(),terminal=new CheckBox(),credentials=new CheckBox(),tls=new CheckBox();
        readonly TextBox preview=new TextBox();
        readonly Label status=new Label();
        readonly Panel inputs=new Panel();
        readonly Button planButton=new Button(),applyButton=new Button(),restoreButton=new Button(),loadButton=new Button();
        readonly Timer autoLoad=new Timer();
        Dictionary<string,object> plannedRequest;
        string receiptFile;
        bool busy,hasSavedCredentials;
        string loadedProject;

        public ProjectConfigurationForm(string toolsRoot,Component[] components,Dictionary<string,string> selected,Action<object,Action<bool,string>> run) {
            execute=run;
            Text="项目配置 · IRIS / Caché";Font=new Font("Microsoft YaHei UI",9);
            BackColor=Color.FromArgb(245,247,251);StartPosition=FormStartPosition.CenterParent;
            ClientSize=new Size(960,790);MinimumSize=new Size(980,830);AutoScaleMode=AutoScaleMode.Dpi;
            Label title=new Label {Text="配置一次，打开项目即可使用",AutoSize=true,Font=new Font(Font.FontFamily,18,FontStyle.Bold),Location=new Point(26,20)};
            Controls.Add(title);
            Label subtitle=new Label {Text="连接保存到所选项目，通用偏好保存到 VS Code 用户设置。",AutoSize=true,Location=new Point(28,62)};Controls.Add(subtitle);
            inputs.SetBounds(24,94,912,478);inputs.Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right;Controls.Add(inputs);
            Field("项目文件夹",projectRoot,0,0,620);Choose(projectRoot,758,0,true,null);
            loadButton.Text="读取已有";loadButton.SetBounds(818,0,90,29);inputs.Controls.Add(loadButton);loadButton.Click+=LoadExisting;
            Field("VS Code",codeExe,0,42,620);Choose(codeExe,758,42,false,"Code.exe");
            LabelAt("用户设置",0,84);userMode.SetBounds(128,82,220,28);userMode.DropDownStyle=ComboBoxStyle.DropDownList;
            userMode.Items.AddRange(new object[]{"便携版（Code.exe 旁的 data）","普通安装（当前 Windows 用户）"});userMode.SelectedIndex=0;inputs.Controls.Add(userMode);
            common.Text="应用常用编码与 ObjectScript 格式";common.Checked=true;common.SetBounds(380,82,350,28);inputs.Controls.Add(common);
            LabelAt("服务器名称",0,126);alias.SetBounds(128,124,220,26);alias.Text="project";inputs.Controls.Add(alias);
            LabelAt("命名空间",380,126);ns.SetBounds(508,124,240,26);inputs.Controls.Add(ns);
            LabelAt("主机 / IP",0,168);host.SetBounds(128,166,220,26);inputs.Controls.Add(host);
            scheme.SetBounds(380,166,90,28);scheme.DropDownStyle=ComboBoxStyle.DropDownList;scheme.Items.AddRange(new object[]{"http","https"});scheme.SelectedIndex=0;inputs.Controls.Add(scheme);
            LabelAt("Web 端口",490,168);port.SetBounds(618,166,130,26);inputs.Controls.Add(port);
            Field("连接说明",description,0,208,620);
            credentials.Text="更新本机 MCP 账号密码（保存到项目私有配置）";credentials.SetBounds(0,248,500,26);inputs.Controls.Add(credentials);
            tls.Text="MCP 校验 HTTPS 证书";tls.SetBounds(580,248,320,26);inputs.Controls.Add(tls);
            LabelAt("账号",0,284);username.SetBounds(128,282,220,26);inputs.Controls.Add(username);
            LabelAt("密码",380,284);password.SetBounds(508,282,240,26);password.UseSystemPasswordChar=true;inputs.Controls.Add(password);
            credentials.CheckedChanged+=delegate {username.Enabled=password.Enabled=credentials.Checked;InvalidatePlan();};username.Enabled=password.Enabled=false;
            mcp.Text="同时配置项目 MCP 和 TOML";mcp.Checked=false;mcp.SetBounds(0,318,310,26);inputs.Controls.Add(mcp);
            Field("MCP 程序",mcpExe,0,352,620);Choose(mcpExe,758,352,false,"iris-agentic-dev.exe");
            terminal.Text="默认终端 PowerShell 7";terminal.SetBounds(0,390,240,26);inputs.Controls.Add(terminal);
            pwshExe.SetBounds(250,388,498,26);inputs.Controls.Add(pwshExe);Choose(pwshExe,758,388,false,"pwsh.exe");
            LabelAt("Git / Node",0,432);gitExe.SetBounds(128,430,270,26);inputs.Controls.Add(gitExe);Choose(gitExe,408,430,false,"git.exe");
            nodeExe.SetBounds(490,430,258,26);inputs.Controls.Add(nodeExe);Choose(nodeExe,758,430,false,"node.exe");
            preview.SetBounds(28,578,904,118);preview.Multiline=true;preview.ReadOnly=true;preview.ScrollBars=ScrollBars.Vertical;preview.BackColor=Color.White;
            preview.Anchor=AnchorStyles.Top|AnchorStyles.Bottom|AnchorStyles.Left|AnchorStyles.Right;Controls.Add(preview);
            preview.Text="选择项目后可读取已有连接。MCP 程序可后安装，当前可先保存配置。\r\nVS Code 首次连接时在扩展提示框中登录，可保存到系统凭据管理器。\r\n需要已安装 ObjectScript、Server Manager 和 Language Server 扩展。";
            status.SetBounds(28,702,900,25);status.Anchor=AnchorStyles.Bottom|AnchorStyles.Left;status.Text="预览会列出本次修改的文件和配置项。";Controls.Add(status);
            restoreButton.Text="恢复配置…";restoreButton.SetBounds(28,742,130,34);restoreButton.Anchor=AnchorStyles.Bottom|AnchorStyles.Left;restoreButton.Click+=Restore;Controls.Add(restoreButton);
            planButton.Text="预览配置";planButton.SetBounds(638,738,130,38);planButton.Anchor=AnchorStyles.Bottom|AnchorStyles.Right;planButton.Click+=Plan;Controls.Add(planButton);
            applyButton.Text="应用配置";applyButton.SetBounds(788,738,144,38);applyButton.Anchor=AnchorStyles.Bottom|AnchorStyles.Right;applyButton.BackColor=Color.FromArgb(37,99,235);applyButton.ForeColor=Color.White;
            applyButton.Enabled=false;applyButton.Click+=Apply;Controls.Add(applyButton);
            string codeVersion=Version(components,"vscode"),pwshVersion=Version(components,"powershell");
            var previous=ToolLocations.Read(ToolLocations.PreferenceFile());
            string codeCommand=ToolLocations.FromPath("code.cmd");
            string codeFromCommand=String.IsNullOrEmpty(codeCommand)?"":Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(codeCommand)),"Code.exe");
            codeExe.Text=ToolLocations.FirstFile(Get(selected,"vscode"),Path.Combine(toolsRoot,"VSCode",codeVersion,"Code.exe"),Get(previous,"codeExe"),ToolLocations.FromPath("Code.exe"),codeFromCommand,
                ToolLocations.RegisteredCode(),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","Microsoft VS Code","Code.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Microsoft VS Code","Code.exe"));
            pwshExe.Text=ToolLocations.FirstFile(Get(selected,"powershell"),Path.Combine(toolsRoot,"PowerShell",pwshVersion,"pwsh.exe"),Get(previous,"pwshExe"),ToolLocations.FromPath("pwsh.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"PowerShell","7","pwsh.exe"));
            gitExe.Text=ToolLocations.FirstFile(Get(selected,"git"),Path.Combine(toolsRoot,"Git",Version(components,"git"),"cmd","git.exe"),Get(previous,"gitExe"),ToolLocations.FromPath("git.exe"));
            string nodeVersion=Version(components,"node");
            nodeExe.Text=ToolLocations.FirstFile(Get(selected,"node"),Path.Combine(toolsRoot,"Node",nodeVersion,"node-v"+nodeVersion+"-win-x64","node.exe"),Get(previous,"nodeExe"),ToolLocations.FromPath("node.exe"));
            userMode.SelectedIndex=File.Exists(codeExe.Text) && Directory.Exists(Path.Combine(Path.GetDirectoryName(codeExe.Text),"data"))?0:1;
            terminal.Checked=File.Exists(pwshExe.Text);
            foreach(Control control in inputs.Controls) {
                TextBox text=control as TextBox;if(text!=null)text.TextChanged+=delegate {InvalidatePlan();};
                CheckBox check=control as CheckBox;if(check!=null)check.CheckedChanged+=delegate {InvalidatePlan();};
                ComboBox combo=control as ComboBox;if(combo!=null)combo.SelectedIndexChanged+=delegate {InvalidatePlan();};
            }
            mcp.CheckedChanged+=delegate {UpdateCredentialFields();};
            UpdateCredentialFields();
            codeExe.TextChanged+=delegate {if(File.Exists(codeExe.Text))userMode.SelectedIndex=Directory.Exists(Path.Combine(Path.GetDirectoryName(codeExe.Text),"data"))?0:1;ScheduleLoad();};
            projectRoot.TextChanged+=delegate {
                password.Clear();username.Clear();hasSavedCredentials=false;mcp.Checked=false;UpdateCredentialFields();loadedProject=null;
                alias.Text="project";host.Clear();port.Clear();ns.Clear();description.Clear();tls.Checked=false;
                if(Directory.Exists(projectRoot.Text))mcpExe.Text=Path.Combine(projectRoot.Text,".agents","vendor","iris-agentic-dev","windows-x64","iris-agentic-dev.exe");
                ScheduleLoad();
            };
            autoLoad.Interval=650;
            autoLoad.Tick+=delegate {autoLoad.Stop();if(!busy && HasProjectConfig() && File.Exists(codeExe.Text) && loadedProject!=projectRoot.Text)LoadExisting(null,EventArgs.Empty);};
            if(Directory.Exists(Get(previous,"projectRoot")))projectRoot.Text=Get(previous,"projectRoot");
            Shown+=delegate {ScheduleLoad();};
            FormClosing+=delegate(object sender,FormClosingEventArgs e){if(busy){e.Cancel=true;MessageBox.Show(this,"请等待当前配置操作完成。","正在处理");}};
            FormClosed+=delegate {autoLoad.Dispose();};
        }
        static string Version(Component[] components,string id) {return Array.Find(components,delegate(Component c){return c.id==id;}).version;}
        static string Get(Dictionary<string,string> values,string key) {return values.ContainsKey(key)?values[key]:"";}
        bool HasProjectConfig() {
            if(!Directory.Exists(projectRoot.Text))return false;
            foreach(string name in new[]{".mcp.json",".iris-agentic-dev.toml",".vscode/settings.json"})if(File.Exists(Path.Combine(projectRoot.Text,name)))return true;
            return false;
        }
        void ScheduleLoad() {autoLoad.Stop();if(IsHandleCreated && !busy)autoLoad.Start();}
        void LabelAt(string text,int x,int y) {inputs.Controls.Add(new Label {Text=text,Location=new Point(x,y+3),Size=new Size(124,24)});}
        void Field(string label,TextBox field,int x,int y,int width) {LabelAt(label,x,y);field.SetBounds(x+128,y,width,26);inputs.Controls.Add(field);}
        void Choose(TextBox field,int x,int y,bool folder,string name) {
            Button button=new Button {Text="…",Location=new Point(x,y),Size=new Size(50,28)};inputs.Controls.Add(button);
            button.Click+=delegate {
                if(folder) {using(FolderBrowserDialog dialog=new FolderBrowserDialog()){dialog.Description="选择需要配置的项目根目录";if(dialog.ShowDialog(this)==DialogResult.OK)field.Text=dialog.SelectedPath;}}
                else {using(OpenFileDialog dialog=new OpenFileDialog()){dialog.Filter=name+"|"+name;if(dialog.ShowDialog(this)==DialogResult.OK)field.Text=dialog.FileName;}}
            };
        }
        void UpdateCredentialFields() {
            credentials.Enabled=mcp.Checked && hasSavedCredentials;
            if(!mcp.Checked)credentials.Checked=false;
            else if(!hasSavedCredentials)credentials.Checked=true;
            username.Enabled=password.Enabled=mcp.Checked && credentials.Checked;
            mcpExe.Enabled=mcp.Checked;
            credentials.Text=mcp.Checked && !hasSavedCredentials?"首次配置 MCP，请填写本机账号密码":"更新本机 MCP 账号密码（保存到项目私有配置）";
        }
        void InvalidatePlan() {plannedRequest=null;applyButton.Enabled=false;}
        void Busy(bool value) {autoLoad.Stop();busy=value;inputs.Enabled=planButton.Enabled=restoreButton.Enabled=!value;applyButton.Enabled=!value && plannedRequest!=null;}
        Dictionary<string,object> BaseRequest(string action) {
            return new Dictionary<string,object>{{"action",action},{"projectRoot",projectRoot.Text.Trim()},{"codeExe",codeExe.Text.Trim()},{"userDataMode",userMode.SelectedIndex==0?"Portable":"Installed"}};
        }
        void Run(Dictionary<string,object> request,Action<Dictionary<string,object>> done) {
            Busy(true);status.Text="正在处理，请稍候…";
            execute(request,delegate(bool success,string result) {
                Busy(false);
                if(!success || String.IsNullOrEmpty(result)){
                    status.Text="操作失败，可修正后重试，主窗口支持导出日志。";
                    if(!String.IsNullOrEmpty(result))preview.Text=result;
                    return;
                }
                try {done(json.Deserialize<Dictionary<string,object>>(result));}
                catch(Exception){status.Text="返回结果无法读取，请查看主窗口日志。";}
            });
        }
        static string Value(Dictionary<string,object> result,string key) {return result.ContainsKey(key)&&result[key]!=null?Convert.ToString(result[key]):"";}
        void LoadExisting(object sender,EventArgs e) {
            Run(BaseRequest("projectInspect"),delegate(Dictionary<string,object> result){
                alias.Text=Value(result,"alias");host.Text=Value(result,"host");port.Text=Value(result,"port")=="0"?"":Value(result,"port");ns.Text=Value(result,"namespace");
                scheme.SelectedIndex=Value(result,"scheme")=="https"?1:0;description.Text=Value(result,"description");tls.Checked=Value(result,"tlsVerify")=="True";
                if(!String.IsNullOrWhiteSpace(Value(result,"mcpExe")))mcpExe.Text=Value(result,"mcpExe");
                loadedProject=projectRoot.Text;
                password.Clear();credentials.Checked=false;
                hasSavedCredentials=Value(result,"hasCredentials")=="True";
                mcp.Checked=Value(result,"hasMcp")=="True";UpdateCredentialFields();
                status.Text=mcp.Checked && !hasSavedCredentials?"已读取连接，MCP 需要填写账号密码。也可取消 MCP 选项，先配置 VS Code。":"已读取连接参数，已有凭据将沿用。";
            });
        }
        void Plan(object sender,EventArgs e) {
            int number;
            if(!Int32.TryParse(port.Text,out number)){MessageBox.Show(this,"请填写 Web 端口。","检查输入");return;}
            if(mcp.Checked && credentials.Checked && (String.IsNullOrWhiteSpace(username.Text) || String.IsNullOrEmpty(password.Text))){
                status.Text="请填写 MCP 账号密码，或取消 MCP 选项，先完成 VS Code 配置。";
                if(String.IsNullOrWhiteSpace(username.Text))username.Focus();else password.Focus();return;
            }
            Dictionary<string,object> request=BaseRequest("projectPlan");
            var connection=new Dictionary<string,object>{{"alias",alias.Text.Trim()},{"host",host.Text.Trim()},{"port",number},{"scheme",scheme.Text},{"namespace",ns.Text.Trim()},
                {"description",description.Text.Trim()},{"tlsVerify",tls.Checked},{"writeCredentials",credentials.Checked}};
            if(credentials.Checked) {
                if(!mcp.Checked){MessageBox.Show(this,"账号密码更新用于项目 MCP，请勾选同时配置 MCP 和 TOML。","检查输入");return;}
                connection["username"]=username.Text.Trim();
                byte[] bytes=Encoding.UTF8.GetBytes(password.Text);
                try {connection["protectedPassword"]=Convert.ToBase64String(ProtectedData.Protect(bytes,null,DataProtectionScope.CurrentUser));}
                finally {Array.Clear(bytes,0,bytes.Length);}
            }
            request["connection"]=connection;request["configureMcp"]=mcp.Checked;request["commonSettings"]=common.Checked;
            request["pwshExe"]=terminal.Checked?pwshExe.Text.Trim():"";request["gitExe"]=gitExe.Text.Trim();request["nodeExe"]=nodeExe.Text.Trim();request["mcpExe"]=mcpExe.Text.Trim();
            Run(request,delegate(Dictionary<string,object> result){
                var lines=new StringBuilder();
                lines.AppendLine("项目  "+projectRoot.Text);lines.AppendLine("连接  "+scheme.Text+" / "+host.Text+" / "+port.Text+" / "+ns.Text);
                if(result.ContainsKey("warnings"))foreach(object warning in (IEnumerable)result["warnings"])lines.AppendLine("提示  "+warning);
                foreach(object entry in (IEnumerable)result["files"]) {
                    var file=(Dictionary<string,object>)entry;lines.AppendLine(Value(file,"operation")+"  "+Value(file,"file"));
                    foreach(object key in (IEnumerable)file["keys"])lines.AppendLine("    "+key);
                }
                lines.AppendLine("修改前保存本机备份。VS Code 登录由扩展提示框处理。已有 MCP 禁用状态沿用。");
                preview.Text=lines.ToString();
                request["fingerprint"]=result["fingerprint"];request["action"]="projectApply";plannedRequest=request;
                applyButton.Enabled=Value(result,"state")!="unchanged";
                status.Text=applyButton.Enabled?"请核对文件与连接目标，然后应用配置。":Value(result,"mcpProgramPresent")=="False"?"配置已经一致，MCP 程序待安装。":"所选配置已经一致。";
            });
        }
        void Apply(object sender,EventArgs e) {
            if(plannedRequest==null)return;
            var accepted=plannedRequest;
            Run(accepted,delegate(Dictionary<string,object> result){
                receiptFile=Value(result,"receiptFile");InvalidatePlan();password.Clear();hasSavedCredentials=mcp.Checked;credentials.Checked=false;UpdateCredentialFields();
                status.Text=Value(result,"mcpProgramPresent")=="False"?"配置已保存并校验，MCP 程序待安装。":"配置已写入并读回校验。重新加载 VS Code 后连接验证。";
                if(receiptFile.Length>0)preview.AppendText(Environment.NewLine+"恢复回执  "+receiptFile);
                try {ToolLocations.Save(ToolLocations.PreferenceFile(),accepted);}
                catch(Exception){status.Text+=" 上次目录未能保存，可下次重新选择。";}
            });
        }
        void Restore(object sender,EventArgs e) {
            using(OpenFileDialog dialog=new OpenFileDialog()) {
                dialog.Title="选择本项目的配置回执";dialog.Filter="配置回执|receipt.json";
                string directory=Path.Combine(projectRoot.Text,".ai-dev-config-backups");if(Directory.Exists(directory))dialog.InitialDirectory=directory;
                if(dialog.ShowDialog(this)!=DialogResult.OK)return;
                if(MessageBox.Show(this,"恢复此批次配置？有后续修改时将停止。", "恢复配置",MessageBoxButtons.OKCancel)!=DialogResult.OK)return;
                var request=BaseRequest("projectRollback");request["receiptFile"]=dialog.FileName;
                Run(request,delegate(Dictionary<string,object> result){InvalidatePlan();status.Text="本批次配置已恢复，备份的 Git 忽略规则保留。";});
            }
        }
    }
    sealed class ObjectScriptInstallForm : Form {
        readonly TextBox code=new TextBox(),result=new TextBox();
        readonly Button install=new Button(),browse=new Button(),inspect=new Button(),restore=new Button();
        readonly Timer autoInspect=new Timer();
        readonly Action<object,Action<bool,string>> execute;
        Dictionary<string,object> current;
        bool busy;
        string inspectedCode;
        public ObjectScriptInstallForm(string root,string version,string selected,Action<object,Action<bool,string>> run) {
            execute=run;Text="ObjectScript 离线扩展";Font=new Font("Microsoft YaHei UI",9);
            BackColor=Color.FromArgb(245,247,251);ClientSize=new Size(760,358);
            FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;StartPosition=FormStartPosition.CenterParent;
            Controls.Add(new Label {Text="ObjectScript 3.8.3-SNAPSHOT",Font=new Font(Font.FontFamily,17,FontStyle.Bold),AutoSize=true,Location=new Point(24,22)});
            Controls.Add(new Label {Text="选择 VS Code，检查后安装。替换前自动备份旧版本。",AutoSize=true,Location=new Point(26,68)});
            Controls.Add(new Label {Text="VS Code",Location=new Point(26,110),AutoSize=true});
            code.SetBounds(100,106,550,27);Controls.Add(code);
            browse.Text="选择…";browse.SetBounds(664,104,70,31);Controls.Add(browse);
            browse.Click+=delegate {using(OpenFileDialog dialog=new OpenFileDialog()){dialog.Filter="VS Code|Code.exe";if(dialog.ShowDialog(this)==DialogResult.OK)code.Text=dialog.FileName;}};
            var previous=ToolLocations.Read(ToolLocations.PreferenceFile());
            string command=ToolLocations.FromPath("code.cmd");
            string fromCommand=String.IsNullOrEmpty(command)?"":Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(command)),"Code.exe");
            code.Text=ToolLocations.FirstFile(selected,Path.Combine(root,"VSCode",version,"Code.exe"),previous.ContainsKey("codeExe")?previous["codeExe"]:"",ToolLocations.FromPath("Code.exe"),fromCommand,ToolLocations.RegisteredCode(),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","Microsoft VS Code","Code.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Microsoft VS Code","Code.exe"));
            result.Multiline=true;result.ReadOnly=true;result.ScrollBars=ScrollBars.Vertical;result.BackColor=Color.White;result.SetBounds(26,150,708,132);Controls.Add(result);
            result.Text="支持普通安装与便携版，要求 VS Code 1.109.0 及以上。\r\n已有 Server Manager 自动复用，缺少时安装随包版本。";
            inspect.Text="重新检查";inspect.SetBounds(26,306,110,36);inspect.Click+=delegate {Run("extensionInspect");};Controls.Add(inspect);
            restore.Text="恢复上次版本";restore.SetBounds(150,306,150,36);restore.Enabled=false;Controls.Add(restore);
            restore.Click+=delegate {
                if(current==null)return;
                if(MessageBox.Show(this,"恢复 ObjectScript 为 "+Value("backupVersion")+"，并恢复替换前的自动更新状态？","恢复版本",MessageBoxButtons.OKCancel)==DialogResult.OK)Run("extensionRestore");
            };
            install.Text="安装并禁用自动更新";install.SetBounds(500,306,234,36);install.Enabled=false;
            install.BackColor=Color.FromArgb(37,99,235);install.ForeColor=Color.White;Controls.Add(install);
            install.Click+=delegate {
                if(current==null || inspectedCode!=code.Text){Run("extensionInspect");return;}
                string message="目标："+code.Text+"\r\n"+Value("backupDescription")+"\r\n安装 3.8.3-SNAPSHOT，仅禁用 ObjectScript 自动更新。";
                if(MessageBox.Show(this,message,"确认安装",MessageBoxButtons.OKCancel)==DialogResult.OK)Run("extensionInstall");
            };
            autoInspect.Interval=650;autoInspect.Tick+=delegate {autoInspect.Stop();if(!busy && File.Exists(code.Text))Run("extensionInspect");};
            code.TextChanged+=delegate {current=null;install.Enabled=restore.Enabled=false;autoInspect.Stop();if(IsHandleCreated)autoInspect.Start();};
            Shown+=delegate {autoInspect.Start();};
            FormClosing+=delegate(object sender,FormClosingEventArgs e){if(busy){e.Cancel=true;MessageBox.Show(this,"请在任务进度窗口停止任务，结束后即可关闭。");}};
            FormClosed+=delegate {autoInspect.Dispose();};
        }
        string Value(string key) {return current!=null && current.ContainsKey(key)?Convert.ToString(current[key]):"";}
        void Run(string action) {
            if(busy)return;
            autoInspect.Stop();
            if(!File.Exists(code.Text) || !String.Equals(Path.GetFileName(code.Text),"Code.exe",StringComparison.OrdinalIgnoreCase)){result.Text="请选择已安装的 Code.exe。";return;}
            var request=new Dictionary<string,object>{{"action",action},{"codeExe",code.Text.Trim()}};
            if(action=="extensionRestore")request["receiptFile"]=Value("receiptFile");
            busy=true;code.Enabled=browse.Enabled=install.Enabled=restore.Enabled=inspect.Enabled=false;
            execute(request,delegate(bool success,string output){
                busy=false;code.Enabled=browse.Enabled=inspect.Enabled=true;
                if(!success){current=null;result.Text="操作未完成，可重新检查后重试。\r\n"+output;return;}
                try {
                    current=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(output);inspectedCode=code.Text;
                    bool fixedVersion=Value("version")=="3.8.3-SNAPSHOT" && Value("autoUpdate")=="False";
                    install.Enabled=!fixedVersion || Value("dependencyPresent")!="True";restore.Enabled=Value("restoreAvailable")=="True";
                    result.Text="当前版本  "+(Value("version").Length==0?"尚未安装":Value("version"))+"\r\nObjectScript 自动更新  "+(Value("autoUpdate")=="False"?"已禁用":"沿 VS Code 设置")+"\r\n"+Value("backupDescription");
                    if(restore.Enabled)result.AppendText("\r\n可恢复版本  "+Value("backupVersion"));
                    if(Value("dependencyPresent")!="True")result.AppendText("\r\nServer Manager 尚未安装，点击安装可补齐。");
                    if(current.ContainsKey("warnings"))foreach(object warning in (IEnumerable)current["warnings"])result.AppendText("\r\n提示  "+warning);
                    if(action!="extensionInspect")result.AppendText("\r\n操作已核验，请重新加载 VS Code。");
                }catch(Exception error){current=null;result.Text="结果无法读取，请查看日志。"+error.Message;}
            });
        }
    }
    sealed class MaterialLocationForm : Form {
        readonly TextBox location=new TextBox();
        public string SelectedPath {get {return location.Text.Trim();}}
        public MaterialLocationForm(string current) {
            Text="离线物料位置";Font=new Font("Microsoft YaHei UI",9);BackColor=Color.FromArgb(245,247,251);
            ClientSize=new Size(680,210);StartPosition=FormStartPosition.CenterParent;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
            Controls.Add(new Label {Text="选择 ZIP 或所在目录，助手自动查找、校验并提取所需文件。",AutoSize=true,Location=new Point(22,24)});
            location.SetBounds(22,64,636,27);location.Text=current;Controls.Add(location);
            Button zip=new Button {Text="选择 ZIP…",Location=new Point(22,106),Size=new Size(126,32)};
            zip.Click+=delegate {using(OpenFileDialog dialog=new OpenFileDialog()){dialog.Filter="离线压缩包|*.zip";if(dialog.ShowDialog(this)==DialogResult.OK)location.Text=dialog.FileName;}};Controls.Add(zip);
            Button folder=new Button {Text="选择目录…",Location=new Point(160,106),Size=new Size(126,32)};
            folder.Click+=delegate {using(FolderBrowserDialog dialog=new FolderBrowserDialog()){if(dialog.ShowDialog(this)==DialogResult.OK)location.Text=dialog.SelectedPath;}};Controls.Add(folder);
            Button automatic=new Button {Text="自动查找",Location=new Point(298,106),Size=new Size(110,32)};
            automatic.Click+=delegate {location.Clear();};Controls.Add(automatic);
            Button save=new Button {Text="使用此位置",Location=new Point(520,160),Size=new Size(138,34),DialogResult=DialogResult.OK};Controls.Add(save);AcceptButton=save;
        }
    }

}
