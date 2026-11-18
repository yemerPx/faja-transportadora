# Panel de Control - Faja Transportadora

Aplicación local para controlar un Arduino UNO por USB Serial. La interfaz final se desarrollará con React, Vite, TypeScript y Tauri 2; el backend Python administra la comunicación con `pyserial`.

## Estructura

```text
faja-transportadora/
├── backend/                 # Python y comunicación con Arduino
│   ├── .venv/               # Dependencias Python aisladas
│   ├── main.py
│   ├── requirements.txt
│   ├── run.sh
│   └── src/
├── frontend/                # React + Vite + TypeScript
│   └── src-tauri/           # Tauri 2 y Rust
├── .gitignore
└── README.md
```

## Requisitos preparados

- Fedora Linux con dependencias de compilación para Tauri.
- Rust y Cargo.
- Node.js y npm.
- Arduino accesible como `/dev/ttyACM0`.
- Usuario miembro de `dialout`.

El Monitor Serial del Arduino IDE debe estar **cerrado** mientras cualquier componente de este proyecto use el puerto serial.

## Backend Python

Las dependencias Python viven solamente en `backend/.venv`; no se requieren paquetes Python globales.

El backend ya no abre una ventana propia: es un **sidecar JSON** que Tauri inicia
automáticamente. Es el único componente autorizado para abrir el puerto serial.

Para comprobar las dependencias aisladas:

```bash
backend/.venv/bin/python -m pip list
```

## Frontend Tauri

Para desarrollo:

```bash
cd ~/Arduino/faja-transportadora/frontend
npm run tauri dev
```

Si una nueva terminal no encuentra `cargo`, cargue el entorno de Rust:

```bash
source "$HOME/.cargo/env"
```

## Protocolo serial actual

El firmware Arduino recibe un entero ASCII entre `0` y `255`, seguido por una nueva línea:

```text
150\n
```

- `0`: motor apagado.
- `1` a `255`: nivel PWM solicitado.

El sidecar mantiene la política de seguridad de enviar `0\n` al conectar y antes de cerrar. No representa RPM ni velocidad física real.

## Sidecar y empaquetado portable

React se comunica con comandos Tauri y Tauri gestiona el sidecar Python por
stdin/stdout. El sidecar es el único componente que abre el puerto serial.

Para generar una distribución portable de Linux x86_64, primero empaquete el
backend Python y después genere los paquetes Tauri:

```bash
cd ~/Arduino/faja-transportadora
source "$HOME/.cargo/env"
./backend/build_sidecar.sh

cd frontend
npm run tauri build
```

El sidecar se registra como binario externo de Tauri y queda incluido en los
paquetes finales. Los artefactos se generan en:

```text
frontend/src-tauri/target/release/bundle/
```

En Fedora, instale preferentemente el archivo `.rpm`. El `.AppImage` permite
ejecutar la aplicación sin instalarla. Ambos paquetes requieren que el usuario
del equipo destino tenga permiso sobre el puerto serial, por ejemplo mediante
el grupo `dialout`.

## Instalador Windows mediante GitHub Actions

No es necesario disponer de una computadora Windows. El workflow
`.github/workflows/build-windows.yml` usa un runner Windows de GitHub para
generar el instalador y el sidecar Python `.exe`.

En GitHub, abra la pestaña **Actions**, seleccione **Compilar instalador
Windows**, pulse **Run workflow** y espere a que finalice. Descargue el
artefacto `FajaControl-Windows-x64`; contiene el instalador `.msi` y/o
`setup.exe`.

El usuario final de Windows solo instala ese archivo y selecciona el puerto
Arduino detectado, por ejemplo `COM3` o `COM4`. No necesita instalar Python,
Node.js, Rust ni Tauri.
