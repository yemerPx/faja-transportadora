#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$BACKEND_DIR/.venv/bin/python"
OUTPUT_DIR="$BACKEND_DIR/../frontend/src-tauri/binaries"

if [[ ! -x "$PYTHON" ]]; then
    echo "Error: falta $BACKEND_DIR/.venv. Cree el entorno primero." >&2
    exit 1
fi

if ! command -v rustc >/dev/null 2>&1 && [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
fi

if ! command -v rustc >/dev/null 2>&1; then
    echo "Error: rustc no está disponible. Ejecute: source \"\$HOME/.cargo/env\"" >&2
    exit 1
fi

TARGET_TRIPLE="$(rustc --print host-tuple)"
mkdir -p "$OUTPUT_DIR"
"$PYTHON" -m PyInstaller --noconfirm --onefile --name "faja-backend-$TARGET_TRIPLE" \
    --distpath "$OUTPUT_DIR" --workpath "$BACKEND_DIR/.build" --specpath "$BACKEND_DIR/.build" \
    "$BACKEND_DIR/main.py"
