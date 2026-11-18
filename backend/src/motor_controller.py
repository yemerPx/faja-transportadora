"""Estado lógico y reglas de seguridad del motor."""

from dataclasses import dataclass


@dataclass
class MotorState:
    selected_pwm: int = 150
    sent_pwm: int = 0
    is_running: bool = False

    def select_pwm(self, value: int) -> int:
        self.selected_pwm = max(0, min(255, int(value)))
        return self.selected_pwm

    def command_to_start(self) -> int:
        """Return the safe start command, without changing hardware itself."""
        pwm = self.selected_pwm or 150
        self.selected_pwm = pwm
        self.sent_pwm = pwm
        self.is_running = True
        return pwm

    def command_to_stop(self) -> int:
        self.sent_pwm = 0
        self.is_running = False
        return 0

    def command_for_selection(self) -> int | None:
        """Apply a new selection only while the motor is deliberately running."""
        if self.is_running:
            self.sent_pwm = self.selected_pwm
            return self.selected_pwm
        return None

    def mark_disconnected(self) -> None:
        self.sent_pwm = 0
        self.is_running = False
