"""Portable core tests. Picker is mocked; POSIX-specific checks run on macOS/Linux."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "native/macos" / filename)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
host = load("macos_host", "host.py")
setup = load("macos_setup", "setup.py")
ID = "a" * 32
ORIGIN = "chrome-extension://" + ID + "/"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")

class MacHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / "native/test-output")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.folder = self.home / "參考圖"; self.folder.mkdir()
        (self.home / "host.json").write_text(json.dumps({"allowed_origins": [ORIGIN]}), encoding="utf-8")
        (self.home / f"folder-{ID}.txt").write_text(str(self.folder), encoding="utf-8")
        self.client = host.Host(self.home, ORIGIN); self.addCleanup(self.client.cleanup)

    def save(self, data=PNG, name="[山景] #水彩 '光影 好'.png"):
        self.client.handle({"op":"begin","size":len(data),"name":name})
        self.client.handle({"op":"chunk","data":base64.b64encode(data).decode()})
        return self.client.handle({"op":"commit"})

    def test_persistence_bytes_and_no_overwrite(self):
        self.assertEqual(self.client.handle({"op":"status"})["folder"],str(self.folder))
        one = self.save(); two = self.save()
        self.assertNotEqual(one["path"],two["path"])
        self.assertEqual(Path(one["path"]).read_bytes(),PNG)
        self.assertEqual(Path(two["path"]).read_bytes(),PNG)
        again = host.Host(self.home,ORIGIN)
        self.assertEqual(again.handle({"op":"status"})["folder"],str(self.folder))
        again.cleanup()

    def test_names_origins_limits_and_commands(self):
        for name in ["../evil.png","/evil.png","a\\evil.png",".hidden.png","\0.png","圖"*100+".png"]:
            with self.assertRaises(ValueError): host.valid_name(name)
        self.assertEqual(host.valid_name('"描述 有空白".png'),'"描述 有空白".png')
        for origin in ["https://evil.test/","chrome-extension://"+"b"*32+"/"]:
            with self.assertRaises(ValueError): host.Host(self.home,origin)
        for message in [{"op":"exec","command":"whoami"},{"op":"begin","size":host.LIMIT+1,"name":"a.png"},{"op":"begin","size":True,"name":"a.png"}]:
            with self.assertRaises(ValueError): self.client.handle(message)

    def test_image_type_and_svg_security(self):
        self.assertEqual(host.image_extension(PNG),"png")
        svg=b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
        result=self.save(svg,"vector.png");self.assertTrue(result["path"].endswith(".svg"))
        for invalid in [b"<html>login</html>",b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>', '<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'.encode("utf-16")]:
            with self.assertRaises(ValueError): host.image_extension(invalid)

    def test_incomplete_invalid_chunks_cleanup_and_missing_folder(self):
        self.client.handle({"op":"begin","size":10,"name":"partial.png"})
        with self.assertRaises(ValueError): self.client.handle({"op":"commit"})
        with self.assertRaises(ValueError): self.client.handle({"op":"chunk","data":"%%%"})
        self.client.cleanup();self.assertFalse(any(self.folder.glob("*.part")))
        self.client.config.write_text(str(self.folder / "missing"), encoding="utf-8")
        with self.assertRaises(ValueError): self.client.handle({"op":"status"})

    def test_picker_cancel_and_selection_are_fixed_commands(self):
        result = subprocess.CompletedProcess([],1,"","User canceled. (-128)")
        with patch.object(host.subprocess,"run",return_value=result) as call:
            self.assertTrue(self.client.handle({"op":"choose"})["cancelled"])
            self.assertEqual(call.call_args.args[0][0],"/usr/bin/osascript")
        result = subprocess.CompletedProcess([],0,str(self.folder)+"/\n","")
        with patch.object(host.subprocess,"run",return_value=result):
            self.assertEqual(self.client.handle({"op":"choose","path":"/ignored"})["folder"],str(self.folder))

    def test_installer_preserves_folder_and_ids_and_uninstall_keeps_images(self):
        destination=setup.install(ID,self.home,ROOT / "native/macos")
        settings=destination / f"folder-{ID}.txt";settings.write_text(str(self.folder), encoding="utf-8")
        setup.install("b"*32,self.home,ROOT / "native/macos")
        self.assertEqual(settings.read_text(encoding="utf-8"),str(self.folder))
        manifest=json.loads((destination / "host.json").read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["allowed_origins"]),2)
        prefs=self.home / "chrome/Profile 1";prefs.mkdir(parents=True)
        (prefs / "Preferences").write_text(json.dumps({"extensions":{"settings":{ID:{"path":str(ROOT)}}}}), encoding="utf-8")
        self.assertEqual(setup.detect_ids(prefs.parent,ROOT),[ID])
        collected=Path(self.save()["path"]);setup.uninstall(self.home)
        self.assertTrue(collected.exists());self.assertFalse(destination.exists())

    @unittest.skipUnless(sys.platform=="darwin","Requires a real macOS host process")
    def test_real_native_message_protocol(self):
        shutil.copyfile(ROOT / "native/macos/host.py", self.home / "host.py")
        messages=[{"op":"begin","size":len(PNG),"name":"protocol.png"},{"op":"chunk","data":base64.b64encode(PNG).decode()},{"op":"commit"}]
        wire=b""
        for message in messages:
            data=json.dumps(message).encode();wire+=struct.pack("=I",len(data))+data
        result=subprocess.run([sys.executable,str(self.home / "host.py"),ORIGIN],input=wire,capture_output=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        output=result.stdout;replies=[]
        while output:
            size=struct.unpack("=I",output[:4])[0];replies.append(json.loads(output[4:4+size]));output=output[4+size:]
        self.assertEqual(len(replies),3);self.assertTrue(all(reply["ok"] for reply in replies))
        self.assertEqual(Path(replies[-1]["path"]).read_bytes(),PNG)

    @unittest.skipIf(os.name=="nt","Requires POSIX directory descriptors and filenames")
    def test_posix_quotes_and_symbolic_links(self):
        result=self.save(name='"描述 有空白".png')
        self.assertEqual(Path(result["path"]).name,'"描述 有空白".png')
        link=self.home / "link";link.symlink_to(self.folder,target_is_directory=True)
        with self.assertRaises(ValueError): host.valid_directory(str(link))

    @unittest.skipIf(os.name=="nt","Requires POSIX directory descriptors")
    def test_replaced_destination_is_rejected(self):
        self.client.handle({"op":"begin","size":len(PNG),"name":"a.png"})
        self.client.handle({"op":"chunk","data":base64.b64encode(PNG).decode()})
        moved=self.home / "moved";self.folder.rename(moved);self.folder.mkdir()
        with self.assertRaises(ValueError): self.client.handle({"op":"commit"})
        self.client.cleanup();self.assertFalse(any(moved.glob("*.part")));self.assertFalse(any(self.folder.iterdir()))

if __name__ == "__main__":
    (ROOT / "native/test-output").mkdir(exist_ok=True)
    unittest.main()
