"""User-level Chrome Native Messaging installation. No sudo or Chrome preferences edits."""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sys
import tempfile

NAME = "com.shakesave.host"
ID = re.compile(r"[a-p]{32}\Z")


def checked_directory(path):
    for item in (path, *path.parents):
        if item.is_symlink(): raise ValueError("Installation directories must not be symbolic links.")
    path.mkdir(parents=True, exist_ok=True)
    return path


def atomic_write(path, content, mode=0o600):
    handle, temporary = tempfile.mkstemp(prefix=".shake-save-", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temporary, mode); os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def detect_ids(chrome_dir, project):
    found = set()
    if not chrome_dir.is_dir(): return []
    for profile in chrome_dir.iterdir():
        if not profile.is_dir(): continue
        for filename in ("Preferences", "Secure Preferences"):
            try:
                prefs = json.loads((profile / filename).read_text(encoding="utf-8"))
                for extension_id, settings in prefs.get("extensions", {}).get("settings", {}).items():
                    source = settings.get("path")
                    if ID.fullmatch(extension_id) and source and Path(source).is_absolute() and Path(source).resolve() == project:
                        found.add(extension_id)
            except (OSError, ValueError, AttributeError): pass
    return sorted(found)


def install(extension_id, home, source):
    if not ID.fullmatch(extension_id): raise ValueError("Invalid extension ID. Copy the 32-letter ID from RefClip settings.")
    destination = checked_directory(home / "Library/Application Support/ShakeSave")
    registration_dir = checked_directory(home / "Library/Application Support/Google/Chrome/NativeMessagingHosts")
    registration = destination / "host.json"
    origins = {f"chrome-extension://{extension_id}/"}
    if registration.exists():
        for origin in json.loads(registration.read_text(encoding="utf-8")).get("allowed_origins", []):
            if isinstance(origin, str) and re.fullmatch(r"chrome-extension://[a-p]{32}/", origin): origins.add(origin)
    interpreter = Path(sys.executable).resolve()
    launcher = destination / "launch-host"
    atomic_write(destination / "host.py", (source / "host.py").read_text(encoding="utf-8"))
    atomic_write(launcher, "#!/bin/sh\nexec " + shlex.quote(str(interpreter)) + " " + shlex.quote(str(destination / "host.py")) + ' "$@"\n', 0o700)
    manifest = json.dumps({"name": NAME, "description": "RefClip image writer", "path": str(launcher), "type": "stdio", "allowed_origins": sorted(origins)}, ensure_ascii=False, indent=2)
    atomic_write(registration, manifest)
    atomic_write(registration_dir / (NAME + ".json"), manifest)
    return destination


def uninstall(home):
    destination = home / "Library/Application Support/ShakeSave"
    registration = home / "Library/Application Support/Google/Chrome/NativeMessagingHosts" / (NAME + ".json")
    # Only delete the exact user-level paths owned by this helper.
    for target in (destination, registration):
        if not target.is_relative_to(home): raise ValueError("Unsafe uninstall path.")
        for item in (target, *target.parents):
            if item.is_symlink(): raise ValueError("Refusing to remove a symbolic-link installation.")
    if registration.exists(): registration.unlink()
    if destination.exists(): shutil.rmtree(destination)


def main():
    if sys.platform != "darwin": raise ValueError("This installer is for macOS. Windows users should run native/install.cmd.")
    if sys.version_info < (3, 9): raise ValueError("Python 3.9+ is required.")
    home = Path.home(); source = Path(__file__).resolve().parent
    action = sys.argv[1] if len(sys.argv) > 1 else "install"
    if action == "uninstall":
        uninstall(home); print("Removed the helper and folder settings. Collected images were not deleted."); return
    if action != "install": raise ValueError("Use install or uninstall.")
    extension_id = sys.argv[2] if len(sys.argv) > 2 else None
    if not extension_id:
        found = detect_ids(home / "Library/Application Support/Google/Chrome", source.parent.parent)
        extension_id = found[0] if len(found) == 1 else input("Paste extension ID from RefClip settings (32 letters): ").strip()
    path = install(extension_id, home, source)
    print(f"Installed in {path}. Return to RefClip settings, choose a folder and save Native mode.")


if __name__ == "__main__":
    try: main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr); sys.exit(1)
