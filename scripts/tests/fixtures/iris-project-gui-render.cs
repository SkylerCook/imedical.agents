using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

// A non-activating render of the real form; deliberately does not start its network worker.
public static class BaselineGuiRender {
    [STAThread] public static int Main(string[] args) {
        try {
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            using(var form=new ExporterForm(args[0])) {
                form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-20000,-20000);
                form.Show();Application.DoEvents();form.PerformLayout();
                using(var bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(Point.Empty,form.Size));bitmap.Save(args[1]);}
                form.Close();
            }
            Console.WriteLine("rendered-without-network");return 0;
        }catch(Exception ex){Console.Error.WriteLine(ex);return 1;}
    }
}
