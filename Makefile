# Hynous Makefile
# Common commands for development

.PHONY: install dev dashboard daemon test lint clean

# Install dependencies
install:
	pip install -e .

# Install with dev dependencies
dev:
	pip install -e ".[dev]"

# Run dashboard
dashboard:
	cd dashboard && reflex run

# Run daemon (background agent)
daemon:
	python -m scripts.run_daemon

# Run tests
test:
	pytest

# Run tests with coverage
coverage:
	pytest --cov=src/hynous --cov-report=html

# Lint code
lint:
	ruff check src/ dashboard/ tests/
	mypy src/

# Format code
format:
	ruff format src/ dashboard/ tests/

# Clean build artifacts
clean:
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info/
	rm -rf .pytest_cache/
	rm -rf .mypy_cache/
	rm -rf .coverage
	rm -rf htmlcov/
	find . -type d -name __pycache__ -exec rm -rf {} +

# Initialize database
init-db:
	python -c "from hynous.nous import NousStore; NousStore('data/intelligence.db')"

# Help
help:
	@echo "Available commands:"
	@echo "  make install    - Install dependencies"
	@echo "  make dev        - Install with dev dependencies"
	@echo "  make dashboard  - Run Reflex dashboard"
	@echo "  make daemon     - Run background agent"
	@echo "  make test       - Run tests"
	@echo "  make coverage   - Run tests with coverage"
	@echo "  make lint       - Lint code"
	@echo "  make format     - Format code"
	@echo "  make clean      - Clean build artifacts"
