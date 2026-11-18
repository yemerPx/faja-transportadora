#!/usr/bin/env python3
"""Entrada del sidecar serial para Tauri."""

import sys

from src.service import SerialService


def main() -> int:
    del sys.argv
    return SerialService().run()


if __name__ == "__main__":
    raise SystemExit(main())
