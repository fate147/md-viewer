// MD Viewer 便携版启动器：转发到 runtime\pythonw.exe app\main.pyw。
// 兼作 .md 文件关联的 exe 目标（命令行参数原样透传给 main.pyw）。
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class MdLauncher {
    static void Main(string[] args) {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string pyw = Path.Combine(baseDir, "runtime", "pythonw.exe");
        string script = Path.Combine(baseDir, "app", "main.pyw");
        if (!File.Exists(pyw) || !File.Exists(script)) return;
        StringBuilder sb = new StringBuilder("\"" + script + "\"");
        foreach (string a in args) {
            sb.Append(" \"").Append(a.Replace("\"", "")).Append("\"");
        }
        Process.Start(new ProcessStartInfo {
            FileName = pyw,
            Arguments = sb.ToString(),
            UseShellExecute = false,
            WorkingDirectory = baseDir
        });
    }
}
