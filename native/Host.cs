using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Xml;

// .NET Framework 4.x, binary stdin/stdout; no shell, network or arbitrary path API.
public static class Host {
    const int Limit = 20 * 1024 * 1024;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 400000 };
    static string home = AppDomain.CurrentDomain.BaseDirectory, config;
    static FileStream pending;
    static string temporary, directory, name;
    static int expected;
    static string Text(Dictionary<string, object> m, string key) {
        object v; if (!m.TryGetValue(key, out v) || !(v is string)) throw new Exception("INVALID_REQUEST"); return (string)v;
    }
    static string DirectoryPath(string path) {
        if (String.IsNullOrEmpty(path) || !Regex.IsMatch(path, @"^[A-Za-z]:\\") || path.Length > 180 || path.IndexOf('/') >= 0)
            throw new Exception("FOLDER_INVALID");
        string full = Path.GetFullPath(path);
        if (!String.Equals(full.TrimEnd('\\'), path.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) throw new Exception("FOLDER_INVALID");
        if (!Directory.Exists(full)) throw new Exception("FOLDER_MISSING");
        for (DirectoryInfo p = new DirectoryInfo(full); p != null; p = p.Parent)
            if ((p.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("FOLDER_LINK");
        return full;
    }
    static string Selected() {
        if (!File.Exists(config)) throw new Exception("FOLDER_NOT_SET");
        return DirectoryPath(File.ReadAllText(config, Encoding.UTF8));
    }
    static void Probe(string dir) {
        using (var f = new FileStream(Path.Combine(dir, ".shake-save-probe-" + Guid.NewGuid().ToString("N")), FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.DeleteOnClose)) { f.WriteByte(0); f.Flush(true); }
    }
    static void Clean() {
        if (pending != null) { pending.Dispose(); pending = null; }
        if (temporary != null) { try { File.Delete(temporary); } catch {} temporary = null; }
    }
    static string ImageExtension(byte[] b) {
        Func<int, string, bool> at = (o, s) => b.Length >= o + s.Length && Encoding.ASCII.GetString(b, o, s.Length) == s;
        if (b.Length >= 8 && b[0] == 137 && at(1, "PNG\r\n\x1a\n")) return "png";
        if (b.Length >= 3 && b[0] == 255 && b[1] == 216 && b[2] == 255) return "jpg";
        if (at(0, "GIF87a") || at(0, "GIF89a")) return "gif";
        if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
        if (at(0, "BM")) return "bmp";
        if (b.Length >= 4 && b[0] == 0 && b[1] == 0 && b[2] == 1 && b[3] == 0) return "ico";
        if (at(0, "II*\0") || at(0, "MM\0*")) return "tif";
        if (at(4, "ftyp")) {
            for (int i = 8; i + 4 <= Math.Min(b.Length, 64); i += 4)
                if (at(i, "avif") || at(i, "avis")) return "avif";
        }
        try {
            using (var r = XmlReader.Create(new MemoryStream(b), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = Limit })) {
                r.MoveToContent();
                if (r.LocalName != "svg" || r.NamespaceURI != "http://www.w3.org/2000/svg") throw new Exception();
                while (r.Read()) {} return "svg";
            }
        } catch { throw new Exception("NOT_IMAGE"); }
    }
    static object Handle(Dictionary<string, object> m) {
        string op = Text(m, "op");
        if (op == "status") { string dir = Selected(); Probe(dir); return new { ok = true, folder = dir, version = "0.2.0" }; }
        if (op == "choose") {
            if (pending != null) throw new Exception("INVALID_REQUEST");
            using (var dialog = new FolderBrowserDialog { Description = "RefClip：選擇儲存圖片的本機資料夾", ShowNewFolderButton = true }) {
                try { dialog.SelectedPath = Selected(); } catch {}
                // A small topmost owner keeps the OS picker visible even when Chrome has focus.
                using (var owner = new Form { TopMost = true, ShowInTaskbar = false, Opacity = 0, Width = 1, Height = 1 }) {
                    owner.Show(); owner.Activate();
                    if (dialog.ShowDialog(owner) != DialogResult.OK) return new { ok = true, cancelled = true };
                }
                string dir = DirectoryPath(dialog.SelectedPath); Probe(dir);
                string tempConfig = config + "." + Guid.NewGuid().ToString("N");
                try {
                    File.WriteAllText(tempConfig, dir, new UTF8Encoding(false));
                    if (File.Exists(config)) File.Replace(tempConfig, config, null); else File.Move(tempConfig, config);
                } finally { if (File.Exists(tempConfig)) File.Delete(tempConfig); }
                return new { ok = true, folder = dir };
            }
        }
        if (op == "begin") {
            if (pending != null) throw new Exception("INVALID_REQUEST");
            name = Text(m, "name");
            if (name.Length < 1 || name.Length > 120 || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || name.EndsWith(".") || name.EndsWith(" ") || name.StartsWith(".") || Regex.IsMatch(name, @"^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)", RegexOptions.IgnoreCase)) throw new Exception("INVALID_NAME");
            object size; if (!m.TryGetValue("size", out size) || !(size is int)) throw new Exception("INVALID_REQUEST");
            expected = (int)size; if (expected < 1 || expected > Limit) throw new Exception("SIZE_LIMIT");
            directory = Selected();
            temporary = Path.Combine(directory, ".shake-save-" + Guid.NewGuid().ToString("N") + ".part");
            pending = new FileStream(temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
            return new { ok = true };
        }
        if (op == "chunk") {
            if (pending == null) throw new Exception("INVALID_REQUEST");
            byte[] bytes = Convert.FromBase64String(Text(m, "data"));
            if (bytes.Length == 0 || bytes.Length > 192 * 1024 || pending.Length + bytes.Length > expected) throw new Exception("SIZE_LIMIT");
            pending.Write(bytes, 0, bytes.Length); return new { ok = true };
        }
        if (op == "commit") {
            if (pending == null || pending.Length != expected) throw new Exception("INCOMPLETE");
            DirectoryPath(directory);
            pending.Position = 0; byte[] bytes = new byte[expected]; int read = 0;
            while (read < bytes.Length) { int n = pending.Read(bytes, read, bytes.Length - read); if (n == 0) throw new Exception("INCOMPLETE"); read += n; }
            string ext = ImageExtension(bytes), stem = Path.GetFileNameWithoutExtension(name);
            if (String.IsNullOrEmpty(stem)) throw new Exception("INVALID_NAME");
            pending.Flush(true); pending.Dispose(); pending = null;
            for (int i = 0; i < 10000; i++) {
                string path = Path.Combine(directory, stem + (i == 0 ? "" : " (" + i + ")") + "." + ext);
                try { File.Move(temporary, path); temporary = null; return new { ok = true, path = path }; }
                catch (IOException) { if (!File.Exists(path) && !Directory.Exists(path)) throw; }
            }
            throw new Exception("NAME_CONFLICT");
        }
        throw new Exception("INVALID_REQUEST");
    }
    static string Error(Exception e) {
        if (e is UnauthorizedAccessException) return "沒有資料夾寫入權限。請在設定頁重新選擇可寫入的資料夾，或檢查 Windows 受控資料夾存取。";
        if (e is IOException) return "磁碟寫入失敗。請檢查磁碟空間、磁碟是否連線、資料夾權限，再重新選擇資料夾。";
        switch (e.Message) {
            case "FOLDER_NOT_SET": return "尚未選擇資料夾。請在設定頁按「選擇資料夾」。";
            case "FOLDER_MISSING": return "儲存資料夾已不存在或磁碟未連線。請接回磁碟或重新選擇資料夾。";
            case "FOLDER_LINK": return "暫不支援含符號連結或接合點的資料夾。請選擇實際的本機資料夾。";
            case "FOLDER_INVALID": return "請選擇本機磁碟中的資料夾（完整路徑最多 180 字元）；不支援 UNC 網路路徑。";
            case "NOT_IMAGE": return "資料不是支援的圖片格式，可能是登入頁。支援 PNG、JPEG、GIF、WebP、AVIF、SVG、BMP、ICO、TIFF。";
            case "SIZE_LIMIT": return "圖片超過 20 MB 或傳輸大小不符，未儲存。";
            case "INCOMPLETE": return "圖片傳輸不完整，未儲存。請重新收圖。";
            default: return "本機程式拒絕無效的要求或檔名，未儲存。請更新擴充功能與本機程式。";
        }
    }
    static bool ReadExact(Stream stream, byte[] bytes) {
        int offset = 0; while (offset < bytes.Length) { int n = stream.Read(bytes, offset, bytes.Length - offset); if (n == 0) return false; offset += n; } return true;
    }
    [STAThread] public static int Main(string[] args) {
        try {
            if (args.Length == 0 || !Regex.IsMatch(args[0], @"^chrome-extension://[a-p]{32}/$")) return 2;
            var registration = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(home, "host.json")));
            var origins = (System.Collections.IEnumerable)registration["allowed_origins"]; bool allowed = false;
            foreach (object origin in origins) if ((string)origin == args[0]) allowed = true;
            if (!allowed) return 2;
            config = Path.Combine(home, "folder-" + args[0].Substring(19, 32) + ".txt");
            using (Stream input = Console.OpenStandardInput(), output = Console.OpenStandardOutput()) {
                var header = new byte[4];
                while (ReadExact(input, header)) {
                    uint length = BitConverter.ToUInt32(header, 0); if (length == 0 || length > 400000) return 3;
                    byte[] payload = new byte[length]; if (!ReadExact(input, payload)) return 3;
                    object reply;
                    try { reply = Handle(Json.Deserialize<Dictionary<string, object>>(new UTF8Encoding(false, true).GetString(payload))); }
                    catch (Exception e) { Clean(); reply = new { ok = false, error = Error(e) }; }
                    byte[] response = Encoding.UTF8.GetBytes(Json.Serialize(reply));
                    byte[] count = BitConverter.GetBytes(response.Length); output.Write(count, 0, 4); output.Write(response, 0, response.Length); output.Flush();
                }
            }
            return 0;
        } catch { return 1; } finally { Clean(); }
    }
}
