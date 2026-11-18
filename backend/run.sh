#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$PROJECT_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
    echo "Error: no existe el entorno virtual en $PROJECT_DIR/.venv." >&2
    echo "Créelo e instale dependencias siguiendo README.md." >&2
    exit 1
fi

exec "$PYTHON" "$PROJECT_DIR/main.py"
