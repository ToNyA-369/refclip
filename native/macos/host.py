#!/usr/bin/env python3
"""Local image writer for macOS. No network, user-supplied commands or destination API."""
import base64
import binascii
import json
import os
from pathlib import Path
import re
import secrets
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

LIMIT = 20 * 1024 * 1024
MESSAGE_LIMIT = 400000
ORIGIN = re.compile(r"chrome-extension://[a-p]{32}/\Z")
ERRORS = {
    "FOLDER_NOT_SET": "尚未選擇資料夾。請在設定頁按「選擇資料夾」。",
    "FOLDER_MISSING": "儲存資料夾已不存在或磁碟未連線，請重新選擇資料夾。",
    "FOLDER_LINK": "不支援符號連結資料夾，請選擇實際的本機資料夾。",
    "FOLDER_INVALID": "請選擇有效的本機資料夾。",
    "INVALID_NAME": "檔名無效或過長，請縮短標籤；不可包含路徑分隔符號。",
    "NOT_IMAGE": "資料不是支援的圖片格式，可能是登入頁。",
    "SIZE_LIMIT": "圖片超過 20 MB 或傳輸大小不符，未儲存。",
    "INCOMPLETE": "圖片傳輸不完整，未儲存。請重新收圖。",
    "INVALID_REQUEST": "本機程式拒絕無效的要求，未儲存。",
    "PICKER_FAILED": "無法開啟 macOS 資料夾選擇器，請檢查系統權限並重試。",
    "NAME_CONFLICT": "同名檔案過多，請調整標籤後再試。",
}


def valid_directory(value):
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError("FOLDER_INVALID")
    path = Path(value)
    if not path.is_absolute() or str(path) != os.path.normpath(value):
        raise ValueError("FOLDER_INVALID")
    for component in (path, *path.parents):
        if component.is_symlink():
            raise ValueError("FOLDER_LINK")
    if not path.is_dir():
        raise ValueError("FOLDER_MISSING")
    return path


def valid_name(value):
    if not isinstance(value, str) or not value or value.startswith(".") or re.search(r"[/\\\x00-\x1f\x7f]", value):
        raise ValueError("INVALID_NAME")
    if len(value.encode("utf-8")) > 255:
        raise ValueError("INVALID_NAME")
    return value


def image_extension(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"): return "png"
    if data.startswith(b"\xff\xd8\xff"): return "jpg"
    if data.startswith((b"GIF87a", b"GIF89a")): return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP": return "webp"
    if data.startswith(b"BM"): return "bmp"
    if data.startswith(b"\0\0\1\0"): return "ico"
    if data.startswith((b"II*\0", b"MM\0*")): return "tif"
    if data[4:8] == b"ftyp" and any(data[i:i+4] in (b"avif", b"avis") for i in range(8, min(len(data), 64), 4)): return "avif"
    # Detect declarations even in UTF-16/32 XML; never resolve external entities.
    if re.search(br"<!\s*(?:DOCTYPE|ENTITY)", data.replace(b"\0", b""), re.I):
        raise ValueError("NOT_IMAGE")
    try:
        root = ET.fromstring(data)
        if root.tag == "{http://www.w3.org/2000/svg}svg": return "svg"
    except (ET.ParseError, ValueError):
        pass
    raise ValueError("NOT_IMAGE")


def open_directory(path):
    """Hold the selected directory open. No-follow on every POSIX path component."""
    if os.name == "nt": return None  # Portable core tests; production uses the Windows C# host.
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open("/", flags)
    try:
        for part in path.parts[1:]:
            next_fd = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


class Host:
    def __init__(self, home, origin):
        if not isinstance(origin, str) or not ORIGIN.fullmatch(origin): raise ValueError("ORIGIN_INVALID")
        self.home = Path(home)
        registration = json.loads((self.home / "host.json").read_text(encoding="utf-8"))
        if origin not in registration.get("allowed_origins", []): raise ValueError("ORIGIN_INVALID")
        self.config = self.home / ("folder-" + origin[19:51] + ".txt")
        self.pending = None
        self.temporary = None
        self.fd = None

    def selected(self):
        if not self.config.exists(): raise ValueError("FOLDER_NOT_SET")
        return valid_directory(self.config.read_text(encoding="utf-8"))

    def probe(self, directory):
        fd = open_directory(directory)
        name = ".shake-save-probe-" + secrets.token_hex(12)
        created = False
        try:
            target = name if fd is not None else str(directory / name)
            handle = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=fd)
            created = True
            with os.fdopen(handle, "wb") as stream:
                stream.write(b"0"); stream.flush(); os.fsync(stream.fileno())
        finally:
            if created: os.unlink(name if fd is not None else directory / name, dir_fd=fd)
            if fd is not None: os.close(fd)

    def cleanup(self):
        if self.pending is not None: self.pending.close(); self.pending = None
        if self.temporary is not None:
            try: os.unlink(self.temporary if self.fd is not None else self.directory / self.temporary, dir_fd=self.fd)
            except OSError: pass
            self.temporary = None
        if self.fd is not None: os.close(self.fd); self.fd = None

    def handle(self, message):
        if not isinstance(message, dict): raise ValueError("INVALID_REQUEST")
        op = message.get("op")
        if op == "status":
            directory = self.selected(); self.probe(directory)
            return {"ok": True, "folder": str(directory), "version": "0.7.0"}
        if op == "choose":
            if self.pending is not None: raise ValueError("INVALID_REQUEST")
            # A fixed AppleScript; no data from extension requests is interpolated.
            result = subprocess.run(["/usr/bin/osascript", "-e", 'POSIX path of (choose folder with prompt "RefClip：選擇儲存圖片的資料夾")'], capture_output=True, text=True, timeout=240)
            if result.returncode:
                if "(-128)" in result.stderr: return {"ok": True, "cancelled": True}
                raise ValueError("PICKER_FAILED")
            directory = valid_directory(result.stdout.strip().rstrip("/") or "/"); self.probe(directory)
            handle, temporary = tempfile.mkstemp(prefix="folder-", dir=self.home)
            try:
                with os.fdopen(handle, "w", encoding="utf-8") as stream:
                    stream.write(str(directory)); stream.flush(); os.fsync(stream.fileno())
                os.replace(temporary, self.config)
            finally:
                if os.path.exists(temporary): os.unlink(temporary)
            return {"ok": True, "folder": str(directory)}
        if op == "begin":
            if self.pending is not None: raise ValueError("INVALID_REQUEST")
            self.name = valid_name(message.get("name"))
            self.expected = message.get("size")
            if type(self.expected) is not int or not 0 < self.expected <= LIMIT: raise ValueError("SIZE_LIMIT")
            self.directory = self.selected(); self.fd = open_directory(self.directory)
            self.identity = self.directory.stat()
            self.temporary = ".shake-save-" + secrets.token_hex(16) + ".part"
            target = self.temporary if self.fd is not None else str(self.directory / self.temporary)
            handle = os.open(target, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=self.fd)
            self.pending = os.fdopen(handle, "w+b")
            return {"ok": True}
        if op == "chunk":
            if self.pending is None: raise ValueError("INVALID_REQUEST")
            try: data = base64.b64decode(message["data"], validate=True)
            except (KeyError, TypeError, binascii.Error): raise ValueError("INVALID_REQUEST")
            if not data or len(data) > 192 * 1024 or self.pending.tell() + len(data) > self.expected: raise ValueError("SIZE_LIMIT")
            self.pending.write(data)
            return {"ok": True}
        if op == "commit":
            if self.pending is None or self.pending.tell() != self.expected: raise ValueError("INCOMPLETE")
            valid_directory(str(self.directory))
            current = self.directory.stat()
            if (current.st_dev, current.st_ino) != (self.identity.st_dev, self.identity.st_ino): raise ValueError("FOLDER_MISSING")
            if self.fd is not None:
                held = os.fstat(self.fd)
                if (held.st_dev, held.st_ino) != (current.st_dev, current.st_ino): raise ValueError("FOLDER_MISSING")
            self.pending.seek(0); extension = image_extension(self.pending.read())
            stem = self.name.rsplit(".", 1)[0] if "." in self.name else self.name
            if not stem: raise ValueError("INVALID_NAME")
            self.pending.flush(); os.fsync(self.pending.fileno()); self.pending.close(); self.pending = None
            for number in range(10000):
                name = valid_name(stem + (f" ({number})" if number else "") + "." + extension)
                try:
                    # Hard-link publishes the fully written file without overwriting any destination.
                    if self.fd is None: os.link(self.directory / self.temporary, self.directory / name)
                    else: os.link(self.temporary, name, src_dir_fd=self.fd, dst_dir_fd=self.fd, follow_symlinks=False)
                except FileExistsError: continue
                if self.fd is not None: os.fsync(self.fd)
                path = str(self.directory / name); self.cleanup()
                return {"ok": True, "path": path}
            raise ValueError("NAME_CONFLICT")
        raise ValueError("INVALID_REQUEST")


def error_message(error):
    if isinstance(error, PermissionError): return "沒有資料夾寫入權限，請在設定頁重新選擇可寫入的資料夾。"
    if isinstance(error, OSError): return "磁碟寫入失敗，請檢查磁碟空間、磁碟連線及權限；沒有改存其他位置。"
    return ERRORS.get(str(error), "本機程式拒絕無效的要求，未儲存。")


def read_exact(stream, size):
    parts = bytearray()
    while len(parts) < size:
        part = stream.read(size - len(parts))
        if not part: return None
        parts.extend(part)
    return bytes(parts)


def main():
    host = None
    try:
        if sys.platform != "darwin" or len(sys.argv) < 2: return 2
        host = Host(Path(__file__).resolve().parent, sys.argv[1])
        while True:
            header = read_exact(sys.stdin.buffer, 4)
            if header is None: return 0
            length = struct.unpack("=I", header)[0]
            if not 0 < length <= MESSAGE_LIMIT: return 3
            payload = read_exact(sys.stdin.buffer, length)
            if payload is None: return 3
            try: reply = host.handle(json.loads(payload.decode("utf-8")))
            except Exception as error:
                host.cleanup(); reply = {"ok": False, "error": error_message(error)}
            response = json.dumps(reply, ensure_ascii=False).encode("utf-8")
            sys.stdout.buffer.write(struct.pack("=I", len(response)) + response); sys.stdout.buffer.flush()
    except (OSError, ValueError): return 2
    finally:
        if host is not None: host.cleanup()


if __name__ == "__main__": sys.exit(main())
