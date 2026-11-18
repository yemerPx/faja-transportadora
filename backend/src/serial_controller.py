"""Transporte serial seguro e independiente de cualquier interfaz gráfica."""

from __future__ import annotations

import serial


class SerialController:
    def __init__(self) -> None:
        self._serial: serial.Serial | None = None
        self._port = ""
        self._read_buffer = bytearray()

    @property
    def connected(self) -> bool:
        return self._serial is not None and self._serial.is_open

    @property
    def port(self) -> str:
        return self._port

    def connect_port(self, port: str) -> None:
        self.disconnect_port(send_stop=True)
        self._port = port.strip()
        if not self._port:
            raise ValueError("Seleccione un puerto serial válido.")
        self._serial = serial.Serial(
            port=self._port, baudrate=9600, timeout=0, write_timeout=1
        )

    def send_pwm(self, value: int) -> None:
        value = max(0, min(255, int(value)))
        if not self.connected:
            raise serial.SerialException("Arduino desconectado.")
        self._serial.write(f"{value}\n".encode("ascii"))
        self._serial.flush()

    def read_lines(self) -> list[str]:
        if not self.connected:
            return []
        waiting = self._serial.in_waiting if self._serial else 0
        if not waiting:
            return []
        self._read_buffer.extend(self._serial.read(waiting))
        lines: list[str] = []
        while b"\n" in self._read_buffer:
            raw, _, remainder = self._read_buffer.partition(b"\n")
            self._read_buffer = bytearray(remainder)
            text = raw.decode("utf-8", errors="replace").strip()
            if text:
                lines.append(text)
        # A device that continuously sends data without line breaks must not
        # grow the in-memory buffer indefinitely.
        if len(self._read_buffer) > 4096:
            self._read_buffer.clear()
        return lines

    def disconnect_port(self, send_stop: bool = True) -> None:
        if self._serial is not None:
            try:
                if send_stop and self._serial.is_open:
                    self._serial.write(b"0\n")
                    self._serial.flush()
            except (serial.SerialException, OSError):
                pass
            try:
                self._serial.close()
            except (serial.SerialException, OSError):
                pass
        self._serial = None
        self._read_buffer.clear()
