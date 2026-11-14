using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public static class BaselineLiveViewTest {
    const BindingFlags Flags = BindingFlags.Instance | BindingFlags.NonPublic;
    static object Field(ExporterForm form, string name) {return typeof(ExporterForm).GetField(name, Flags).GetValue(form);}
    static void Set(ExporterForm form, string name, object value) {typeof(ExporterForm).GetField(name, Flags).SetValue(form, value);}
    static object Call(ExporterForm form, string name, params object[] args) {return typeof(ExporterForm).GetMethod(name, Flags).Invoke(form, args);}
    static void Text(ExporterForm form, string name, string value) {((Control)Field(form, name)).Text = value;}
    static void Check(bool pass, string name) {if (!pass) throw new Exception(name);}
    static string Name(int i) {return i % 2 == 0 ? "app/item" + i + ".js" : "Demo.Item" + i + ".cls";}
    static string Source(int i) {return i % 2 == 0 ? "src/" + Name(i) : "src/Demo/Item" + i + ".cls";}
    static List<object> Plan(int count) {
        var items = new List<object>();
        for (int i = 0; i < count; i++) items.Add(new Dictionary<string, object> {{"document", Name(i)}, {"path", Source(i)}});
        return items;
    }
    static void Capture(Control control, string file) {using (var bitmap = new Bitmap(control.Width, control.Height)) {control.DrawToBitmap(bitmap, new Rectangle(Point.Empty, control.Size)); bitmap.Save(file);}}
    [STAThread] public static int Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        ProjectBaseline project = null; Form popup = null;
        try {
            using (var form = new ExporterForm(Path.Combine(args[0], "state"))) {
                form.ShowInTaskbar = false; form.StartPosition = FormStartPosition.Manual; form.Location = new Point(-20000, -20000); form.Show();
                Text(form, "url", "http://127.0.0.1:1/api/atelier/"); Text(form, "ns", "TEST"); Text(form, "profiles", "Synthetic project"); Text(form, "destination", Path.Combine(args[0], "project"));
                Call(form, "SaveProfile"); Call(form, "EnsureProject"); project = (ProjectBaseline)Field(form, "project");
                var sample = project.NewRun("append"); project.Plan(sample, Plan(10), "sample");
                for (int i = 0; i < 10; i++) {
                    var entry = project.Find(Name(i)); entry.outcome = i < 6 ? "fetched" : "missing";
                    if (i < 6) {var bytes = Encoding.UTF8.GetBytes("original"); ProjectBaseline.Atomic(Path.Combine(project.Root, Source(i)), bytes); entry.sha256 = ProjectBaseline.Hash(bytes); entry.bytes = bytes.Length; entry.contentAt = "2026-11-13T08:00:00Z";}
                }
                project.EndRun(sample); Call(form, "RenderProject");
                var rows = (List<ListViewItem>)Field(form, "resultRows");
                Check(rows.Count == 10, "initial-sample-has-ten-rows");
                var run = project.NewRun("append"); var queue = project.Plan(run, Plan(3791), "full scope");
                string batch = project.RunDirectory(run.id);
                Set(form, "projectRun", run); Set(form, "batch", batch);
                Set(form, "job", new Dictionary<string, object> {{"projectRun", run.id}, {"batch", batch}, {"sessions", 4}, {"url", "http://127.0.0.1:1/api/atelier/"}, {"ns", "TEST"}});
                Call(form, "SaveJob"); Set(form, "reading", true); Set(form, "busy", true); run.state = "running"; project.Save();
                Call(form, "RenderProject");
                Check(rows.Count == 3791 && queue.Count == 3785, "expanded-scope-visible-before-first-receipt");
                var nodes = new List<Dictionary<string, object>>();
                for (int i = 0; i < queue.Count; i++) nodes.Add(new Dictionary<string, object> {{"document", queue[i]}, {"status", i < 496 ? "missing" : i < 2940 ? "fetched" : "pending"}, {"bytes", i >= 496 && i < 2940 ? 8 : 0}, {"observedAt", i < 2940 ? "2026-11-13T08:10:00Z" : null}});
                var json = new JavaScriptSerializer {MaxJsonLength = 16777216};
                string receipt = Path.Combine(batch, "export/baseline-state.json");
                ProjectBaseline.Atomic(receipt, Encoding.UTF8.GetBytes(json.Serialize(new {items = nodes})));
                Call(form, "RefreshReceipt");
                Check(((Label)Field(form, "status")).Text.Contains("已处理 2940 / 3785   已取得 2444   未找到 496"), "live-progress-matches-receipt");
                Check(((Label)Field(form, "projectOverview")).Text.Contains("已取得待核对 2444 / 等待采集 845 / 需处理 496"), "normal-waiting-items-are-not-problems");
                Check(rows.FindAll(r => Convert.ToString(((Dictionary<string, object>)r.Tag)["status"]) == "missing").Count == 496, "all-496-missing-rows-visible-during-collection");
                Check(((Label)Field(form, "projectOverview")).Text.Contains("登记 3791"), "overview-scope-not-stuck-at-sample");
                Check(((Label)Field(form, "pageLabel")).Text.Contains("19 页"), "expanded-scope-is-paginated");
                var filter = (ComboBox)Field(form, "resultFilter"); filter.SelectedIndex = 1;
                Check(((Label)Field(form, "pageLabel")).Text.Contains("496 / 3791 项"), "missing-filter-covers-full-scope");
                string copied = (string)Call(form, "CopyText", rows.FindAll(r => Convert.ToString(((Dictionary<string, object>)r.Tag)["status"]) == "missing"), false);
                Check(copied.Split(new[] {"\r\n"}, StringSplitOptions.RemoveEmptyEntries).Length == 496 && copied.Contains("/app/item6.js"), "copy-missing-includes-all-pages-and-web-prefix");
                filter.SelectedIndex = 2; Check(((List<ListViewItem>)Field(form,"visibleRows")).Count == 496, "issue-filter-excludes-normal-pending-items");
                filter.SelectedIndex = 4; Check(((List<ListViewItem>)Field(form,"visibleRows")).Count == 845, "waiting-filter-keeps-pending-items-accessible");
                filter.SelectedIndex = 1;
                Set(form, "resultPage", 1); Call(form, "RenderPage", true);
                var list = (ListView)Field(form, "results"); list.SelectedIndices.Add(5); list.EnsureVisible(100); int top = list.TopItem.Index;
                var originalRow = rows[6]; nodes[2940]["status"] = "missing"; nodes[2940]["observedAt"] = "2026-11-13T08:11:00Z";
                ProjectBaseline.Atomic(receipt, Encoding.UTF8.GetBytes(json.Serialize(new {items = nodes}))); Call(form, "RefreshReceipt");
                Check((int)Field(form, "resultPage") == 1 && list.SelectedIndices.Contains(5) && list.TopItem.Index == top && Object.ReferenceEquals(originalRow, rows[6]), "live-refresh-keeps-page-selection-scroll-and-row");
                Check(((Label)Field(form, "pageLabel")).Text.Contains("497 / 3791 项"), "missing-filter-updates-on-next-checkpoint");
                filter.SelectedIndex = 3; Check(((List<ListViewItem>)Field(form, "visibleRows")).Count == 6, "current-files-only-includes-published-source");
                Check(project.Find(queue[496]).sha256 == null && project.Index.activeRun == run.id && !File.Exists(Path.Combine(project.Root, "src/" + project.Find(queue[496]).path)), "display-refresh-never-publishes-unverified-source-or-completes-run");
                filter.SelectedIndex = 0;
                var body = (Panel)Field(form, "projectBody"); Size bodySize = body.Size;
                Call(form, "Append", "Synthetic diagnostic line"); ((Button)Field(form, "diagnosticToggle")).PerformClick(); Application.DoEvents();
                var dialog = (Form)Field(form, "diagnosticWindow"); popup = dialog; var log = (TextBox)Field(form, "log");
                Check(dialog.Visible && dialog.Owner == form && form.Enabled && body.Size == bodySize && log.Height > 300, "diagnostics-is-large-modeless-window-without-main-layout-change");
                Call(form, "Append", "Live update while diagnostics open"); Check(log.Text.Contains("Live update while diagnostics open"), "diagnostics-stays-live");
                int width = log.Width; dialog.Width += 80; dialog.Height += 40; Application.DoEvents(); Check(log.Width > width && log.ReadOnly && !log.WordWrap, "diagnostics-resizes-and-preserves-copyable-log");
                Capture(dialog, Path.Combine(args[0], "diagnostics-1.png"));
                dialog.Font = new Font(dialog.Font.FontFamily, dialog.Font.Size * 1.5f); Application.DoEvents(); Capture(dialog, Path.Combine(args[0], "diagnostics-1.5.png"));
                dialog.Close(); Application.DoEvents();
                Check(!dialog.Visible && !dialog.IsDisposed && (bool)Field(form, "reading") && (bool)Field(form, "busy"), "closing-diagnostics-does-not-stop-collection");
                ((Button)Field(form, "diagnosticToggle")).PerformClick(); Check(Object.ReferenceEquals(dialog, Field(form, "diagnosticWindow")) && log.Text.Contains("Synthetic diagnostic line"), "reopen-diagnostics-reuses-log-and-window"); dialog.Close();
                Capture(form, Path.Combine(args[0], "live-workbench.png"));
                // A paused/reopened collection must also show its newer receipt over the old index.
                Set(form, "reading", false); Set(form, "busy", false); project.Dispose(); project = null;
                using (var reopened = new ExporterForm(Path.Combine(args[0], "state"))) {
                    Check(((List<ListViewItem>)Field(reopened, "resultRows")).FindAll(r => Convert.ToString(((Dictionary<string, object>)r.Tag)["status"]) == "missing").Count == 497, "reopened-active-run-keeps-live-receipt");
                    ((ProjectBaseline)Field(reopened, "project")).Dispose();
                }
            }
            Check(popup.IsDisposed, "disposing-workbench-disposes-diagnostics-window");
            Console.WriteLine("live-view-passed"); return 0;
        } catch (Exception ex) {Console.Error.WriteLine(ex); return 1;}
        finally {if (project != null) project.Dispose();}
    }
}
