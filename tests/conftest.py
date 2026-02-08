"""
Pytest fixtures for Hynous tests.

Fixtures defined here are available to all tests.
"""

import pytest


@pytest.fixture
def mock_config():
    """Provide a mock configuration for tests."""
    # TODO: Implement when Config class is created
    pass


@pytest.fixture
def memory_store():
    """Provide an in-memory Nous store for tests."""
    # TODO: Implement when NousStore is created
    # return NousStore(":memory:")
    pass


@pytest.fixture
def mock_agent():
    """Provide a mock agent for tests."""
    # TODO: Implement when Agent is created
    pass
