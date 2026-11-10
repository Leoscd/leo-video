using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class LeoVideo {
    [STAThread]
    private static void Main() {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(root, "abrir.ps1");
        if (!File.Exists(script)) {
            MessageBox.Show("Conservá Leo Video.exe junto a los archivos de la aplicación.", "Leo Video");
            return;
        }
        try {
            ProcessStartInfo p = new ProcessStartInfo("powershell.exe");
            p.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
            p.WorkingDirectory = root;
            p.UseShellExecute = false;
            p.CreateNoWindow = true;
            using (Process child = Process.Start(p)) {
                child.WaitForExit();
                if (child.ExitCode != 0) MessageBox.Show("No se pudo iniciar el editor. Revisá los registros de .cache y los requisitos de README.md.", "Leo Video");
            }
        } catch (Exception e) { MessageBox.Show(e.Message, "Leo Video"); }
    }
}
