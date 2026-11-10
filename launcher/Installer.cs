using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

internal static class Installer {
    private static Stream Payload() { return Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"); }
    private static void Install(string directory) {
        string root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
        if (root == Path.GetPathRoot(root).TrimEnd(Path.DirectorySeparatorChar)) throw new Exception("Elegí una carpeta para la aplicación.");
        if (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any() && !File.Exists(Path.Combine(root,".leo-installed"))) throw new Exception("La carpeta contiene otros archivos. Elegí una carpeta nueva o una instalación anterior de Leo Video.");
        Directory.CreateDirectory(root);
        using (Stream payload = Payload()) using (ZipArchive zip = new ZipArchive(payload,ZipArchiveMode.Read)) {
            foreach (ZipArchiveEntry entry in zip.Entries) {
                string dest = Path.GetFullPath(Path.Combine(root,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                if (!dest.StartsWith(root + Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new Exception("Ruta de paquete inválida.");
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                using (Stream input = entry.Open()) using (FileStream output = new FileStream(dest,FileMode.Create,FileAccess.Write)) input.CopyTo(output);
            }
        }
        File.WriteAllText(Path.Combine(root,".leo-installed"),"Leo Video 0.2.1",Encoding.UTF8);
    }
    private static void Shortcut(string root) {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic shortcut = shell.CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"Leo Video.lnk"));
        shortcut.TargetPath = Path.Combine(root,"Leo Video.exe"); shortcut.WorkingDirectory = root;
        shortcut.Description = "Leo Video — editor personal"; shortcut.Save();
    }
    [STAThread]
    private static int Main(string[] args) {
        try {
            if (args.Length == 2 && args[0] == "--install") { Install(args[1]); return 0; }
            Application.EnableVisualStyles();
            Form form = new Form { Text="Instalar Leo Video 0.2.1", Width=620,Height=345,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false };
            Label title = new Label { Left=25,Top=24,Width=560,Height=27,Text="Leo Video — editor personal",Font=new System.Drawing.Font("Segoe UI",14) };
            Label info = new Label { Left=25,Top=66,Width=550,Height=64,Text="Instala la aplicación para tu usuario. Utiliza Node.js, FFmpeg, Python, Whisper y los modelos locales de este equipo. No descarga dependencias ni modifica tus videos." };
            TextBox folder = new TextBox { Left=25,Top=142,Width=465,Text=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LeoVideo") };
            Button browse = new Button { Left=498,Top=139,Width=85,Height=27,Text="Carpeta…" };
            browse.Click += delegate { using(FolderBrowserDialog d = new FolderBrowserDialog()) { if(d.ShowDialog(form)==DialogResult.OK)folder.Text=Path.Combine(d.SelectedPath,"LeoVideo"); } };
            CheckBox desktop = new CheckBox { Left=25,Top=182,Width=400,Text="Crear acceso directo en el Escritorio",Checked=true };
            Button install = new Button { Left=390,Top=238,Width=190,Height=34,Text="Instalar y abrir" };
            install.Click += delegate {
                try {
                    install.Enabled=false; Install(folder.Text); if(desktop.Checked)Shortcut(folder.Text);
                    Process.Start(new ProcessStartInfo(Path.Combine(folder.Text,"Leo Video.exe")) { WorkingDirectory=folder.Text,UseShellExecute=false,CreateNoWindow=true });
                    MessageBox.Show(form,"Instalación terminada. Conservá tus proyectos y videos originales en sus carpetas.","Leo Video"); form.Close();
                } catch(Exception e) { install.Enabled=true;MessageBox.Show(form,e.Message,"No se pudo instalar"); }
            };
            form.Controls.AddRange(new Control[]{title,info,folder,browse,desktop,install});Application.Run(form);return 0;
        } catch(Exception e) { if(args.Length==0)MessageBox.Show(e.Message,"Leo Video");return 1; }
    }
}
