"""Servicio JSON-line que protege el puerto serial y conserva el estado del motor."""

from __future__ import annotations

import json
import queue
import sys
import threading
from datetime import datetime
from typing import Any

import serial
from serial.tools import list_ports

from .motor_controller import MotorState
from .serial_controller import SerialController

DEFAULT_PORT = "COM3" if sys.platform.startswith("win") else "/dev/ttyACM0"


class SerialService:
    def __init__(self) -> None:
        self.transport = SerialController()
        self.motor = MotorState()
        self.commands: queue.Queue[dict[str, Any] | None] = queue.Queue()
        self.running = True

    def emit(self, event_type: str, **payload: Any) -> None:
        event = {
            "type": event_type,
            "timestamp": datetime.now().strftime("%H:%M:%S"),
            **payload,
        }
        print(json.dumps(event, ensure_ascii=False), flush=True)

    def emit_state(self) -> None:
        self.emit(
            "state",
            connected=self.transport.connected,
            port=self.transport.port or DEFAULT_PORT,
            selected_pwm=self.motor.selected_pwm,
            sent_pwm=self.motor.sent_pwm,
            running=self.motor.is_running,
        )

    def log(self, direction: str, message: str) -> None:
        self.emit("log", direction=direction, message=message)

    def _stdin_reader(self) -> None:
        for line in sys.stdin:
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    self.commands.put(value)
                else:
                    self.emit("error", message="Comando serial inválido.")
            except json.JSONDecodeError:
                self.emit("error", message="JSON inválido recibido por el sidecar.")
        self.commands.put(None)

    def list_serial_ports(self) -> None:
        ports = [entry.device for entry in list_ports.comports()]
        if DEFAULT_PORT not in ports:
            ports.insert(0, DEFAULT_PORT)
        self.emit("ports", ports=ports)

    def connect(self, port: str) -> None:
        try:
            self.transport.connect_port(port)
            self.transport.send_pwm(0)
            self.motor.mark_disconnected()
            self.log("TX", "0 (parada de seguridad)")
            self.emit("connection", connected=True, port=self.transport.port)
            self.log("INFO", f"Conectado a {self.transport.port} (9600 baudios)")
        except (serial.SerialException, OSError, ValueError) as exc:
            self.transport.disconnect_port(send_stop=False)
            self.motor.mark_disconnected()
            self.emit("connection", connected=False, port=port)
            self.emit("error", message=f"No se pudo abrir {port}: {exc}")
        self.emit_state()

    def disconnect(self) -> None:
        was_connected = self.transport.connected
        self.transport.disconnect_port(send_stop=True)
        self.motor.mark_disconnected()
        if was_connected:
            self.log("TX", "0 (parada de seguridad)")
            self.log("INFO", "Arduino desconectado")
        self.emit("connection", connected=False, port=self.transport.port or DEFAULT_PORT)
        self.emit_state()

    def set_pwm(self, value: int) -> None:
        self.motor.select_pwm(value)
        command = self.motor.command_for_selection()
        if command is not None:
            self._send(command)
        self.emit_state()

    def _send(self, value: int) -> bool:
        try:
            self.transport.send_pwm(value)
            self.log("TX", str(value))
            return True
        except (serial.SerialException, OSError) as exc:
            self.emit("error", message=f"Conexión serial perdida: {exc}")
            self.disconnect()
            return False

    def start_motor(self) -> None:
        if not self.transport.connected:
            self.emit("error", message="Conecte el Arduino antes de encender el motor.")
            return
        command = self.motor.command_to_start()
        if not self._send(command):
            self.motor.mark_disconnected()
        self.emit_state()

    def stop_motor(self) -> None:
        self.motor.command_to_stop()
        if self.transport.connected:
            self._send(0)
        self.emit_state()

    def handle(self, command: dict[str, Any]) -> None:
        action = command.get("action")
        if action == "ports":
            self.list_serial_ports()
        elif action == "connect":
            self.connect(str(command.get("port", DEFAULT_PORT)))
        elif action == "disconnect":
            self.disconnect()
        elif action == "set_pwm":
            self.set_pwm(int(command.get("value", self.motor.selected_pwm)))
        elif action == "start":
            self.start_motor()
        elif action == "stop":
            self.stop_motor()
        elif action == "shutdown":
            self.disconnect()
            self.running = False
        else:
            self.emit("error", message="Acción desconocida.")

    def read_serial(self) -> None:
        try:
            for line in self.transport.read_lines():
                self.log("RX", line)
        except (serial.SerialException, OSError) as exc:
            self.emit("error", message=f"Conexión serial perdida: {exc}")
            self.disconnect()

    def run(self) -> int:
        threading.Thread(target=self._stdin_reader, daemon=True).start()
        self.emit("ready", port=DEFAULT_PORT)
        self.emit_state()
        self.list_serial_ports()
        try:
            while self.running:
                try:
                    command = self.commands.get(timeout=0.04)
                    if command is None:
                        self.running = False
                    else:
                        self.handle(command)
                except queue.Empty:
                    pass
                self.read_serial()
        finally:
            self.disconnect()
        return 0
