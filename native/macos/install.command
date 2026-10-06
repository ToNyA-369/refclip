#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'Please install Python 3.9+ from https://www.python.org/downloads/macos/ and retry.' >&2
  exit 1
fi
exec python3 "$script_dir/setup.py" install "$@"
