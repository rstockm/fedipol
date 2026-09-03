"""Anwendungsweiter Interprozess-Lock gegen ueberlappende ETL-Laeufe."""

from __future__ import annotations

import fcntl
import os
from pathlib import Path


class LockBusy(RuntimeError):
    """Ein anderer Lauf haelt den Lock bereits."""


class FileLock:
    """fcntl-basierter Lock; wirft LockBusy statt zu blockieren."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._fd: int | None = None

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(fd)
            raise LockBusy(f"ETL-Lock belegt: {self.path}") from exc
        self._fd = fd
        os.write(fd, str(os.getpid()).encode() + b"\n")

    def release(self) -> None:
        if self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
            finally:
                os.close(self._fd)
                self._fd = None

    def __enter__(self) -> FileLock:
        self.acquire()
        return self

    def __exit__(self, *exc_info) -> None:  # noqa: ANN002
        self.release()
