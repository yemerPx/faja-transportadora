use std::{
  io::{BufRead, BufReader, Write},
  path::PathBuf,
  process::{Child, ChildStdin, Command, Stdio},
  sync::Mutex,
  thread,
};

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::{
  ShellExt,
  process::{CommandChild, CommandEvent},
};

enum BackendProcess {
  None,
  Development { stdin: ChildStdin, _child: Child },
  Packaged { child: CommandChild },
}

struct BackendState(Mutex<BackendProcess>);

impl Default for BackendState {
  fn default() -> Self {
    Self(Mutex::new(BackendProcess::None))
  }
}

fn backend_directory() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join("backend")
}

fn emit_backend_error(app: &AppHandle, message: impl Into<String>) {
  let payload = serde_json::json!({
    "type": "error",
    "message": message.into(),
  })
  .to_string();
  let _ = app.emit("backend-event", payload);
}

fn spawn_development_backend(app: AppHandle, state: &BackendState) -> Result<(), String> {
  let backend_dir = backend_directory();
  let python = backend_dir.join(".venv/bin/python");
  let script = backend_dir.join("main.py");
  if !python.is_file() {
    return Err(format!("No se encontró el entorno Python en {}", python.display()));
  }

  let mut child = Command::new(python)
    .arg(script)
    .current_dir(&backend_dir)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("No se pudo iniciar el sidecar Python: {error}"))?;
  let stdout = child.stdout.take().ok_or("No se pudo leer stdout del sidecar.")?;
  let stderr = child.stderr.take().ok_or("No se pudo leer stderr del sidecar.")?;
  let stdin = child.stdin.take().ok_or("No se pudo abrir stdin del sidecar.")?;

  {
    let mut process = state.0.lock().map_err(|_| "Estado del sidecar bloqueado.")?;
    *process = BackendProcess::Development { stdin, _child: child };
  }

  let stdout_app = app.clone();
  thread::spawn(move || {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
      let _ = stdout_app.emit("backend-event", line);
    }
  });
  thread::spawn(move || {
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
      emit_backend_error(&app, format!("Sidecar Python: {line}"));
    }
  });
  Ok(())
}

fn spawn_packaged_backend(app: AppHandle, state: &BackendState) -> Result<(), String> {
  let (mut receiver, child) = app
    .shell()
    .sidecar("faja-backend")
    .map_err(|error| format!("No se encontró el sidecar empaquetado: {error}"))?
    .spawn()
    .map_err(|error| format!("No se pudo iniciar el sidecar empaquetado: {error}"))?;

  {
    let mut process = state.0.lock().map_err(|_| "Estado del sidecar bloqueado.")?;
    *process = BackendProcess::Packaged { child };
  }

  tauri::async_runtime::spawn(async move {
    while let Some(event) = receiver.recv().await {
      match event {
        CommandEvent::Stdout(bytes) => {
          let line = String::from_utf8_lossy(&bytes).trim().to_string();
          if !line.is_empty() {
            let _ = app.emit("backend-event", line);
          }
        }
        CommandEvent::Stderr(bytes) => {
          emit_backend_error(&app, format!("Sidecar Python: {}", String::from_utf8_lossy(&bytes).trim()));
        }
        CommandEvent::Error(error) => emit_backend_error(&app, format!("Sidecar Python: {error}")),
        CommandEvent::Terminated(_) => break,
        _ => {}
      }
    }
  });
  Ok(())
}

fn spawn_backend(app: AppHandle, state: &BackendState) -> Result<(), String> {
  if cfg!(debug_assertions) {
    spawn_development_backend(app, state)
  } else {
    spawn_packaged_backend(app, state)
  }
}

fn write_command(state: &BackendState, command: serde_json::Value) -> Result<(), String> {
  let line = format!(
    "{}\n",
    serde_json::to_string(&command).map_err(|error| error.to_string())?
  );
  let mut process = state.0.lock().map_err(|_| "Estado del sidecar bloqueado.")?;
  match &mut *process {
    BackendProcess::Development { stdin, .. } => stdin
      .write_all(line.as_bytes())
      .and_then(|_| stdin.flush())
      .map_err(|error| format!("No se pudo enviar el comando al sidecar: {error}")),
    BackendProcess::Packaged { child } => child
      .write(line.as_bytes())
      .map_err(|error| format!("No se pudo enviar el comando al sidecar: {error}")),
    BackendProcess::None => Err("El sidecar Python no está disponible.".into()),
  }
}

#[tauri::command]
fn backend_command(state: State<'_, BackendState>, command: serde_json::Value) -> Result<(), String> {
  write_command(&state, command)
}

pub fn run() {
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(BackendState::default())
    .setup(|app| {
      let app_handle = app.handle().clone();
      let state = app.state::<BackendState>();
      if let Err(error) = spawn_backend(app_handle.clone(), &state) {
        emit_backend_error(&app_handle, error);
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![backend_command])
    .build(tauri::generate_context!())
    .expect("error while building Tauri application");

  app.run(|app, event| {
    if matches!(event, RunEvent::ExitRequested { .. }) {
      let state = app.state::<BackendState>();
      let _ = write_command(&state, serde_json::json!({ "action": "shutdown" }));
    }
  });
}
