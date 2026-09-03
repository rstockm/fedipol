#!/usr/bin/env python
"""Django-Verwaltungsskript fuer fedipol."""
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fedipol.settings")
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)