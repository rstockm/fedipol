.PHONY: check lint test migrate etl etl-smoke lock serve image clean

PY ?= .venv/bin/python

.venv/bin/python:
	python3 -m venv .venv && .venv/bin/python -m ensurepip --upgrade && \
		.venv/bin/python -m pip install -e '.[dev]'

## Einheitlicher Einstieg: Lint + Tests (lokal und in CI identisch)
check: lint test

lint:
	$(PY) -m ruff check src tests

test:
	$(PY) -m pytest -q

migrate:
	PYTHONPATH=src $(PY) manage.py migrate

## Vollstaendiger ETL-Lauf (echte Quellen, fuer Cloudron/Betrieb)
etl:
	PYTHONPATH=src $(PY) manage.py run_fedipol_etl --trigger manual

## Entwicklungsmodus: wenige Accounts, schneller Durchlauf
etl-smoke:
	PYTHONPATH=src $(PY) manage.py run_fedipol_etl --trigger manual --limit 25

lock:
	$(PY) -m uv lock

## Lokaler App-Server (Dashboard + Export + Health)
serve:
	PYTHONPATH=src $(PY) manage.py runserver 127.0.0.1:8000

## Container-Image bauen (Digest-Pinning im Dockerfile bei Release erneuern)
image:
	docker build -t fedipol:local .

clean:
	rm -rf .pytest_cache .ruff_cache tests/.test-data