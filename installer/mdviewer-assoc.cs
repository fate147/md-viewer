// MD Viewer 关联守护 + 安装器（无第三方依赖，用系统自带 csc.exe 编译）
//
//   mdviewer-assoc.exe --install <onedir目录>   就地注册该目录里的 md-viewer.exe 并接管 .md
//   mdviewer-assoc.exe                          静默重新接管 .md（登录时由 Run 项自动调用）
//   mdviewer-assoc.exe --uninstall              撤销关联守护与自启项（不删除程序文件）
//
// 存在的原因：md-viewer.exe 只在自身启动时注册关联（src/main.pyw:81），而 WorkBuddy 这类
// Electron 应用每次启动都会重写 .md 的默认程序。UserChoice 优先级高于 Classes\.md，
// 本程序实现 Windows 的 UserChoice 哈希校验，在登录时把关联夺回来。
//
// 注册表一律用 P/Invoke 以最小权限（KEY_SET_VALUE / KEY_READ）打开：
// .NET 的 RegistryKey.CreateSubKey 请求 KEY_ALL_ACCESS，会被这些键的 ACL 直接拒绝。

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

static class MdAssoc
{
    struct Pair { public uint A; public uint B; public Pair(uint a, uint b) { A = a; B = b; } }

    const string ProgId = "mdfile";
    const string AppName = "MD Viewer";
    const string CapKey = @"Software\Classes\md-viewer";   // 与 mdviewer_reg.py 用的是同一个键
    const string UserChoiceKey =
        @"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice";
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunValueName = "MDViewerAssoc";
    const string ConfigName = "mdviewer-app.txt";
    const string ExeName = "md-viewer.exe";

    // Windows UserChoice 哈希的固定盐值（公开逆向所得）
    const string GuidStr =
        "user choice set via windows user experience {d18b6dd5-6124-4341-9318-804003bafa0b}";

    const int KEY_READ = 0x20019;
    const int KEY_WRITE = 0x20006;
    const int KEY_SET_VALUE = 0x0002;
    const int REG_OPTION_NON_VOLATILE = 0;
    const int REG_SZ = 1;
    const int REG_NONE = 0;
    // 注意：预定义键句柄必须零扩展成 64 位，用 (int) 转型会被符号扩展成无效句柄
    static readonly IntPtr HKCU = new IntPtr((long)0x80000001);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegOpenKeyEx(IntPtr hKey, string subKey, int options, int sam,
                                   out IntPtr result);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegCreateKeyEx(IntPtr hKey, string subKey, int reserved,
        IntPtr classType, int options, int sam, IntPtr securityAttributes,
        out IntPtr result, out int disposition);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegSetValueEx(IntPtr hKey, string name, int reserved, int type,
                                    byte[] data, int size);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegQueryValueEx(IntPtr hKey, string name, IntPtr reserved,
        out int type, IntPtr buffer, out int size);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegDeleteValue(IntPtr hKey, string name);

    [DllImport("advapi32.dll")]
    static extern int RegCloseKey(IntPtr hKey);

    [DllImport("advapi32.dll")]
    static extern int RegQueryInfoKey(IntPtr hKey, StringBuilder cls, IntPtr clsLen,
        IntPtr reserved, IntPtr subKeys, IntPtr maxSubKeyLen, IntPtr maxClassLen,
        IntPtr numValues, IntPtr maxValueNameLen, IntPtr maxValueLen,
        IntPtr secDesc, out long lastWrite);

    [DllImport("shell32.dll")]
    static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);

    // ---------------------------------------------------------------- 注册表读写

    static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

    static string LogPath()
    {
        return Path.Combine(Path.GetDirectoryName(
            Process.GetCurrentProcess().MainModule.FileName), "mdviewer-assoc.log");
    }

    // 登录时静默运行（winexe 无控制台），执行结果写到同目录日志，便于事后排查
    static void Say(string s)
    {
        try { Console.WriteLine(s); } catch { }
        try
        {
            string log = LogPath();
            if (File.Exists(log) && new FileInfo(log).Length > 200000) File.Delete(log);
            File.AppendAllText(log,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + s + "\r\n", Utf8NoBom);
        }
        catch { }
    }

    static void RunReg(string arguments)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("reg.exe", arguments);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            using (Process p = Process.Start(psi)) { p.WaitForExit(8000); }
        }
        catch (Exception ex) { Say("  reg.exe 调用失败：" + ex.Message); }
    }

    // 先按最小权限打开已有键（这些键的 ACL 通常允许改值但拒绝建子键），
    // 键不存在时再退到 KEY_WRITE 创建（RegCreateKeyEx 用 KEY_SET_VALUE 建新键会被拒）
    static IntPtr OpenForWrite(string path, out int err)
    {
        IntPtr h;
        int r = RegOpenKeyEx(HKCU, path, 0, KEY_SET_VALUE, out h);
        if (r == 0) { err = 0; return h; }
        int disp;
        r = RegCreateKeyEx(HKCU, path, 0, IntPtr.Zero, REG_OPTION_NON_VOLATILE,
                           KEY_SET_VALUE, IntPtr.Zero, out h, out disp);
        if (r == 0) { err = 0; return h; }
        err = RegCreateKeyEx(HKCU, path, 0, IntPtr.Zero, REG_OPTION_NON_VOLATILE,
                             KEY_WRITE, IntPtr.Zero, out h, out disp);
        return err == 0 ? h : IntPtr.Zero;
    }

    static void SetString(string path, string name, string value)
    {
        int err;
        IntPtr h = OpenForWrite(path, out err);
        if (h == IntPtr.Zero)
        {
            Say("  跳过 " + path + "（错误码 " + err + "）");
            return;
        }
        try
        {
            byte[] data = Encoding.Unicode.GetBytes(value + "\0");
            int r = RegSetValueEx(h, name, 0, REG_SZ, data, data.Length);
            if (r != 0) Say("  写值失败 " + path + " -> " + (name == null ? "(默认)" : name)
                + "（错误码 " + r + "）");
        }
        finally { RegCloseKey(h); }
    }

    static void SetEmpty(string path, string name)
    {
        IntPtr h; int disp;
        int r = RegCreateKeyEx(HKCU, path, 0, IntPtr.Zero, REG_OPTION_NON_VOLATILE,
                               KEY_WRITE, IntPtr.Zero, out h, out disp);
        if (r != 0) { Say("  跳过 " + path + "（错误码 " + r + "）"); return; }
        try { RegSetValueEx(h, name, 0, REG_NONE, new byte[0], 0); }
        finally { RegCloseKey(h); }
    }

    static string ReadString(string path, string name)
    {
        IntPtr h;
        if (RegOpenKeyEx(HKCU, path, 0, KEY_READ, out h) != 0) return null;
        try
        {
            int type, size = 0;
            if (RegQueryValueEx(h, name, IntPtr.Zero, out type, IntPtr.Zero, out size) != 0)
                return null;
            if (size == 0) return null;
            IntPtr buf = Marshal.AllocHGlobal(size);
            try
            {
                if (RegQueryValueEx(h, name, IntPtr.Zero, out type, buf, out size) != 0)
                    return null;
                return type == REG_SZ ? Marshal.PtrToStringUni(buf) : null;
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        finally { RegCloseKey(h); }
    }

    static long KeyLastWriteTime(string subkey)
    {
        IntPtr h;
        if (RegOpenKeyEx(HKCU, subkey, 0, KEY_READ, out h) != 0)
            throw new IOException("RegOpenKeyEx 失败");
        try
        {
            long ft;
            if (RegQueryInfoKey(h, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero,
                    IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero,
                    out ft) != 0) throw new IOException("RegQueryInfoKey 失败");
            return ft;
        }
        finally { RegCloseKey(h); }
    }

    // ------------------------------------------------------------ UserChoice 哈希

    static uint U(ulong x) { return (uint)(x & 0xFFFFFFFF); }
    static uint M(uint a, uint b) { return U((ulong)a * b); }
    static uint R32(byte[] d, int off) { return BitConverter.ToUInt32(d, off); }

    static Pair WordSwap(byte[] a, uint sz, byte[] md5)
    {
        uint o1 = 0, o2 = 0, ta = 0, ts = sz;
        uint ti = ((sz - 2) >> 1) + 1;
        uint c0 = U((ulong)(R32(md5, 0) | 1) + 0x69FB0000UL);
        uint c1 = U((ulong)(R32(md5, 4) | 1) + 0x13DB0000UL);
        for (uint i = 0; i < ti; i++)
        {
            uint n = U((ulong)R32(a, (int)ta) + o1);
            ta += 8; ts -= 2;
            uint t = U((ulong)M(n, c0) - M(0x10FA9605, n >> 16));
            uint v1 = U((ulong)M(0x79F8A395, t) + M(0x689B6B9F, t >> 16));
            uint v2 = U((ulong)M(0xEA970001, v1) - M(0x3C101569, v1 >> 16));
            uint v3 = U((ulong)R32(a, (int)ta - 4) + v2);
            uint v4 = U((ulong)M(v3, c1) - M(0x3CE8EC25, v3 >> 16));
            uint v5 = U((ulong)M(0x59C3AF2D, v4) - M(0x2232E0F1, v4 >> 16));
            o1 = U((ulong)M(0x1EC90001, v5) + M(0x35BD1EC9, v5 >> 16));
            o2 = U((ulong)o2 + o1 + v2);
        }
        if (ts == 1)
        {
            uint n = U((ulong)R32(a, (int)ta) + o1);
            uint t = U((ulong)M(n, c0) - M(0x10FA9605, n >> 16));
            uint inner = U((ulong)M(0x79F8A395, t) + M(0x689B6B9F, t >> 16));
            uint v2 = U((ulong)M(0xEA970001, inner) - M(0x3C101569, inner >> 16));
            uint v3 = U((ulong)M(v2, c1) - M(0x3CE8EC25, v2 >> 16));
            uint inner2 = U((ulong)M(0x59C3AF2D, v3) - M(0x2232E0F1, v3 >> 16));
            o1 = U((ulong)M(0x1EC90001, inner2) + M(0x35BD1EC9, inner2 >> 16));
            o2 = U((ulong)o2 + o1 + v2);
        }
        return new Pair(o1, o2);
    }

    static Pair Reversible(byte[] a, uint sz, byte[] md5)
    {
        uint o1 = 0, o2 = 0, ta = 0, ts = sz;
        uint ti = ((sz - 2) >> 1) + 1;
        uint c0 = R32(md5, 0) | 1;
        uint c1 = R32(md5, 4) | 1;
        for (uint i = 0; i < ti; i++)
        {
            uint n = U((ulong)M(U((ulong)R32(a, (int)ta) + o1), c0));
            n = U((ulong)M(0xB1110000, n) - M(0x30674EEF, n >> 16));
            ta += 8; ts -= 2;
            uint v1 = U((ulong)M(0x5B9F0000, n) - M(0x78F7A461, n >> 16));
            uint inner = U((ulong)M(0x12CEB96D, v1 >> 16) - M(0x46930000, v1));
            uint v2 = U((ulong)M(0x1D830000, inner) + M(0x257E1D83, inner >> 16));
            uint v3 = U((ulong)R32(a, (int)ta - 4) + v2);
            uint v4 = U((ulong)M(M(0x16F50000, c1), v3) - M(0x5D8BE90B, U((ulong)c1 * v3) >> 16));
            uint inner2 = U((ulong)M(0x96FF0000, v4) - M(0x2C7C6901, v4 >> 16));
            uint v5 = U((ulong)M(0x2B890000, inner2) + M(0x7C932B89, inner2 >> 16));
            o1 = U((ulong)M(0x9F690000, v5) - M(0x405B6097, v5 >> 16));
            o2 = U((ulong)o2 + o1 + v2);
        }
        if (ts == 1)
        {
            uint n = U((ulong)R32(a, (int)ta) + o1);
            uint v1 = U((ulong)M(M(0xB1110000, c0), n) - M(0x30674EEF, U((ulong)c0 * n) >> 16));
            uint v2 = U((ulong)M(0x5B9F0000, v1) - M(0x78F7A461, v1 >> 16));
            uint inner = U((ulong)M(0x12CEB96D, v2 >> 16) - M(0x46930000, v2));
            uint v3 = U((ulong)M(0x1D830000, inner) + M(0x257E1D83, inner >> 16));
            uint v4 = U((ulong)M(M(0x16F50000, c1), v3) - M(0x5D8BE90B, U((ulong)c1 * v3) >> 16));
            uint v5 = U((ulong)M(0x96FF0000, v4) - M(0x2C7C6901, v4 >> 16));
            uint inner2 = U((ulong)M(0x2B890000, v5) + M(0x7C932B89, v5 >> 16));
            o1 = U((ulong)M(0x9F690000, inner2) - M(0x405B6097, inner2 >> 16));
            o2 = U((ulong)o2 + o1 + v2);
        }
        return new Pair(o1, o2);
    }

    static ulong PatentHash(byte[] a)
    {
        uint words = (uint)(a.Length / 4);
        uint sz = words - (words & 1);
        byte[] md5;
        using (MD5 md = MD5.Create()) md5 = md.ComputeHash(a);
        Pair p1 = WordSwap(a, sz, md5);
        Pair p2 = Reversible(a, sz, md5);
        return ((ulong)(p1.B ^ p2.B) << 32) | (p1.A ^ p2.A);
    }

    static string UserChoiceHash(string ext, string sid, string progid, string writeTimeHex)
    {
        string raw = (ext + sid + progid + writeTimeHex + GuidStr).ToLowerInvariant();
        byte[] data = Encoding.Unicode.GetBytes(raw);            // UTF-16LE，无 BOM
        byte[] withTerm = new byte[data.Length + 2];             // 追加 0x0000 终结
        Array.Copy(data, withTerm, data.Length);
        return Convert.ToBase64String(BitConverter.GetBytes(PatentHash(withTerm)));
    }

    // ------------------------------------------------------------------ 关联逻辑

    static void RegisterProgid(string exePath)
    {
        string cmd = "\"" + exePath + "\" \"%1\"";
        string icon = "\"" + exePath + "\",0";

        SetString(@"Software\Classes\.md", null, ProgId);
        SetEmpty(@"Software\Classes\.md\OpenWithProgids", ProgId);
        SetString(@"Software\Classes\" + ProgId, null, "Markdown File");
        SetString(@"Software\Classes\" + ProgId + @"\DefaultIcon", null, icon);
        SetString(@"Software\Classes\" + ProgId + @"\shell\open\command", null, cmd);
        SetString(@"Software\Classes\Applications\md-viewer.exe\shell\open\command", null, cmd);
        SetString(@"Software\Classes\Applications\md-viewer.exe", "FriendlyAppName", AppName);

        SetString(CapKey + @"\Capabilities", "ApplicationName", AppName);
        SetString(CapKey + @"\Capabilities", "ApplicationDescription", "Markdown 阅读与编辑器");
        SetString(CapKey + @"\Capabilities", "ApplicationIcon", icon);
        SetString(CapKey + @"\Capabilities\FileAssociations", ".md", ProgId);
        SetString(@"Software\RegisteredApplications", AppName, CapKey + @"\Capabilities");
    }

    static string ReadUserChoiceProgid() { return ReadString(UserChoiceKey, "ProgId"); }

    // 系统校验 UserChoice 时用的是键 LastWriteTime 按分钟截断后的值，
    // 因此“当前该配什么哈希”可以直接从键时间反推出来。
    static string HashForTime(string sid, long filetime)
    {
        long trunc = filetime / 600000000L * 600000000L;
        string wtHex = string.Format("{0:x8}{1:x8}",
            (uint)(trunc >> 32), (uint)(trunc & 0xFFFFFFFFu));
        return UserChoiceHash(".md", sid, ProgId, wtHex);
    }

    // 哈希与键时间对得上，系统才会认这个关联；只看 ProgId 会漏掉被改坏的哈希
    static bool UserChoiceValid(string sid)
    {
        if (ReadUserChoiceProgid() != ProgId) return false;
        string stored = ReadString(UserChoiceKey, "Hash");
        if (stored == null) return false;
        try
        {
            return stored == HashForTime(sid, KeyLastWriteTime(UserChoiceKey));
        }
        catch (IOException) { return false; }
    }

    static bool WriteUserChoice(string sid)
    {
        int err;
        IntPtr h = OpenForWrite(UserChoiceKey, out err);
        if (h == IntPtr.Zero)
        {
            Say("  无法写入 UserChoice 键（错误码 " + err + "）");
            return false;
        }
        try
        {
            byte[] pid = Encoding.Unicode.GetBytes(ProgId + "\0");
            RegSetValueEx(h, "ProgId", 0, REG_SZ, pid, pid.Length);
            RegDeleteValue(h, "Hash");
        }
        finally { RegCloseKey(h); }

        // 写 ProgId/Hash 本身会推进 LastWriteTime，若正好跨过整分钟哈希就失效，
        // 所以按当前键时间重算并重写，直到两者自洽。
        for (int i = 0; i < 5; i++)
        {
            if (UserChoiceValid(sid)) break;
            string hash;
            try { hash = HashForTime(sid, KeyLastWriteTime(UserChoiceKey)); }
            catch (IOException) { break; }
            SetString(UserChoiceKey, "ProgId", ProgId);
            SetString(UserChoiceKey, "Hash", hash);
        }
        SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
        return UserChoiceValid(sid);
    }

    static int Main(string[] args)
    {
        string self = Process.GetCurrentProcess().MainModule.FileName;
        foreach (string a in args)
            if (a.StartsWith("--self=", StringComparison.OrdinalIgnoreCase))
                self = a.Substring(7).Trim('"');   // 由宿主（脚本/测试）指定守护程序自身路径
        string selfDir = Path.GetFullPath(Path.GetDirectoryName(self));
        string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "--assert";
        string configFile = Path.Combine(selfDir, ConfigName);

        if (mode == "--uninstall")
        {
            // 删除 UserChoice 的权限由其 DACL 决定，交给系统自带的 reg.exe 处理最稳
            RunReg(@"delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v "
                   + RunValueName + " /f");
            RunReg(@"delete HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice /f");
            SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
            Say("已撤销 .md 关联守护与登录自启（程序文件保留）。");
            return 0;
        }

        string exePath;
        if (mode == "--install")
        {
            string src = args.Length > 1 ? args[1] : Path.Combine(selfDir, "md-viewer");
            if (!File.Exists(Path.Combine(src, ExeName)))
            {
                Say("在 " + src + " 找不到 " + ExeName);
                return 1;
            }
            exePath = Path.GetFullPath(Path.Combine(src, ExeName));
            try { File.WriteAllText(configFile, exePath, Utf8NoBom); } catch { }
            try { File.Delete(LogPath()); } catch { }   // 本次安装的日志从零开始，便于批处理回显
            Say("主程序位置：" + exePath);
        }
        else
        {
            exePath = File.Exists(configFile)
                ? File.ReadAllText(configFile, Encoding.UTF8).Trim()
                : Path.Combine(selfDir, "md-viewer", ExeName);
        }

        if (!File.Exists(exePath))
        {
            Say("未找到主程序：" + exePath);
            return 1;
        }

        RegisterProgid(exePath);
        string sid = WindowsIdentity.GetCurrent().User.Value;
        bool ok = UserChoiceValid(sid) || WriteUserChoice(sid);

        SetString(RunKey, RunValueName, "\"" + self + "\" --assert");

        Say(ok ? ".md 默认程序已确认为 MD Viewer。"
               : "已注册 ProgID，但 UserChoice 未被系统接受，双击可能仍走其他程序。");
        return ok ? 0 : 2;
    }
}
