.PHONY: install dev run test lint format clean

install:
	python3 -m pip install -e .

dev:
	python3 -m pip install -e ".[dev]"

run:
	python3 -m scripts.run

test:
	python3 -m pytest tests/ -v

lint:
	python3 -m ruff check src/ tests/

format:
	python3 -m ruff format src/ tests/

clean:
	rm -rf storage/hynous-data.db
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
