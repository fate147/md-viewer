// MD Viewer 便携版启动器：转发到 runtime\pythonw.exe app\main.pyw。
// 兼作 .md 文件关联的 exe 目标（命令行参数原样透传给 main.pyw）。
//
// 纪律 D-02（AGENTS.md）：缺依赖不得静默退出。winexe 没有控制台，唯一可观测
// 通道是 MessageBox + 非 0 退出码；三种失败分别给不同文案与退出码，避免
// 「双击没反应」这种无从下手的现象。用 user32 的 MessageBoxW（P/Invoke）
// 而非 System.Windows.Forms，这样 csc 不用额外 /r 引用，打包命令保持不变。
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

class MdLauncher {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    const uint MB_ICONERROR = 0x00000010;

    static int Fail(string detail, int code) {
        MessageBoxW(IntPtr.Zero,
            detail + "\n\n安装包可能不完整，请重新安装 MD Viewer。",
            "MD Viewer 无法启动（错误码 " + code + "）", MB_ICONERROR);
        return code;
    }

    static int Main(string[] args) {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string pyw = Path.Combine(baseDir, "runtime", "pythonw.exe");
        string script = Path.Combine(baseDir, "app", "main.pyw");

        if (!File.Exists(pyw))
            return Fail("缺少运行时：\n" + pyw, 1);
        if (!File.Exists(script))
            return Fail("缺少程序文件：\n" + script, 2);

        StringBuilder sb = new StringBuilder("\"" + script + "\"");
        foreach (string a in args) {
            sb.Append(" \"").Append(a.Replace("\"", "")).Append("\"");
        }

        try {
            Process.Start(new ProcessStartInfo {
                FileName = pyw,
                Arguments = sb.ToString(),
                UseShellExecute = false,
                WorkingDirectory = baseDir
            });
        } catch (Exception ex) {
            return Fail("调用运行时失败：\n" + ex.GetType().Name + ": " + ex.Message, 3);
        }
        return 0;
    }
}
