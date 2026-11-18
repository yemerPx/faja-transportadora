$ErrorActionPreference = "Stop"

$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $BackendDir ".venv\Scripts\python.exe"
$OutputDir = Join-Path $BackendDir "..\frontend\src-tauri\binaries"

if (-not (Test-Path $Python)) {
    throw "No existe el entorno virtual en $BackendDir\.venv. Créelo antes de empaquetar."
}

$TargetTriple = (rustc --print host-tuple).Trim()
if (-not $TargetTriple) {
    throw "No se pudo detectar el target de Rust."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

& $Python -m PyInstaller `
    --noconfirm `
    --onefile `
    --name "faja-backend-$TargetTriple" `
    --distpath $OutputDir `
    --workpath (Join-Path $BackendDir ".build") `
    --specpath (Join-Path $BackendDir ".build") `
    (Join-Path $BackendDir "main.py")
