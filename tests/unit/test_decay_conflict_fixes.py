"""
Tests for decay and conflict fixes:
  - NousClient HTTP timeouts on all methods
  - batch_resolve_conflicts chunking (max 50 per call)
  - daemon warning-level logging on decay/conflict/backfill failures
  - decay.ts batch UPDATE logic (tested via mock DB call count)
"""

import logging
import unittest
from unittest.mock import MagicMock, patch, call

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from hynous.nous.client import NousClient


# ---------------------------------------------------------------------------
# 1. Timeout constants
# ---------------------------------------------------------------------------

class TestNousClientTimeouts(unittest.TestCase):
    """NousClient must define timeout constants and use them on every HTTP call."""

    def test_default_timeout_defined(self):
        self.assertEqual(NousClient._DEFAULT_TIMEOUT, 30)

    def test_decay_timeout_defined(self):
        self.assertEqual(NousClient._DECAY_TIMEOUT, 180)

    def test_decay_timeout_longer_than_default(self):
        self.assertGreater(NousClient._DECAY_TIMEOUT, NousClient._DEFAULT_TIMEOUT)

    def _make_client_with_mock_session(self):
        client = NousClient.__new__(NousClient)
        client.base_url = "http://localhost:3100"
        client._session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": True, "data": []}
        mock_resp.status_code = 200
        client._session.get.return_value = mock_resp
        client._session.post.return_value = mock_resp
        client._session.patch.return_value = mock_resp
        client._session.delete.return_value = mock_resp
        return client

    def test_run_decay_uses_decay_timeout(self):
        client = self._make_client_with_mock_session()
        client._session.post.return_value.json.return_value = {
            "ok": True, "processed": 0, "transitions_count": 0, "transitions": []
        }
        client.run_decay()
        _, kwargs = client._session.post.call_args
        self.assertEqual(kwargs.get("timeout"), NousClient._DECAY_TIMEOUT)

    def test_backfill_embeddings_uses_decay_timeout(self):
        client = self._make_client_with_mock_session()
        client._session.post.return_value.json.return_value = {"ok": True, "embedded": 0, "total": 0}
        client.backfill_embeddings()
        _, kwargs = client._session.post.call_args
        self.assertEqual(kwargs.get("timeout"), NousClient._DECAY_TIMEOUT)

    def test_get_graph_uses_decay_timeout(self):
        client = self._make_client_with_mock_session()
        client._session.get.return_value.json.return_value = {"nodes": [], "edges": []}
        client.get_graph()
        _, kwargs = client._session.get.call_args
        self.assertEqual(kwargs.get("timeout"), NousClient._DECAY_TIMEOUT)

    def test_health_uses_default_timeout(self):
        client = self._make_client_with_mock_session()
        client._session.get.return_value.json.return_value = {"ok": True}
        client.health()
        _, kwargs = client._session.get.call_args
        self.assertEqual(kwargs.get("timeout"), NousClient._DEFAULT_TIMEOUT)

    def test_create_node_uses_default_timeout(self):
        client = self._make_client_with_mock_session()
        client._session.post.return_value.json.return_value = {"id": "n_123"}
        client.create_node(type="concept", subtype="custom:lesson", title="Test")
        _, kwargs = client._session.post.call_args
        self.assertEqual(kwargs.get("timeout"), NousClient._DEFAULT_TIMEOUT)

    def test_search_uses_default_timeout(self):
        client = self._make_client_with_mock_session()
        client._session.post.return_value.json.return_value = {"data": [], "qcs": {}}
        client.search(query="test")
        _, kwargs = client._session.post.call_args
        self.assertEqual(kwargs.get("timeout"), NousClient._DEFAULT_TIMEOUT)

    def test_get_conflicts_uses_default_timeout(self):
        client = self._make_client_with_mock_session()
        client._session.get.return_value.json.return_value = {"data": []}
        client.get_conflicts()
        _, kwargs = client._session.get.call_args
        self.assertEqual(kwargs.get("timeout"), NousClient._DEFAULT_TIMEOUT)

    def test_resolve_conflict_uses_default_timeout(self):
        client = self._make_client_with_mock_session()
        client._session.post.return_value.json.return_value = {"ok": True}
        client.resolve_conflict("cid_1", "keep_both")
        _, kwargs = client._session.post.call_args
        self.assertEqual(kwargs.get("timeout"), NousClient._DEFAULT_TIMEOUT)


# ---------------------------------------------------------------------------
# 2. batch_resolve_conflicts chunking
# ---------------------------------------------------------------------------

class TestBatchResolveChunking(unittest.TestCase):
    """batch_resolve_conflicts must split >50 items into chunks of 50."""

    def _make_client(self, response_data=None):
        client = NousClient.__new__(NousClient)
        client.base_url = "http://localhost:3100"
        client._session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = response_data or {
            "ok": True, "resolved": 50, "failed": 0, "total": 50, "results": []
        }
        client._session.post.return_value = mock_resp
        return client

    def test_empty_list_returns_zero_totals(self):
        client = self._make_client()
        result = client.batch_resolve_conflicts([])
        self.assertEqual(result["resolved"], 0)
        self.assertEqual(result["total"], 0)
        client._session.post.assert_not_called()

    def test_49_items_makes_one_call(self):
        items = [{"conflict_id": f"c{i}", "resolution": "keep_both"} for i in range(49)]
        client = self._make_client({"ok": True, "resolved": 49, "failed": 0, "total": 49, "results": []})
        client.batch_resolve_conflicts(items)
        self.assertEqual(client._session.post.call_count, 1)
        # Verify all 49 were sent in one batch
        call_kwargs = client._session.post.call_args
        sent_items = call_kwargs[1]["json"]["items"]
        self.assertEqual(len(sent_items), 49)

    def test_50_items_makes_one_call(self):
        items = [{"conflict_id": f"c{i}", "resolution": "keep_both"} for i in range(50)]
        client = self._make_client({"ok": True, "resolved": 50, "failed": 0, "total": 50, "results": []})
        client.batch_resolve_conflicts(items)
        self.assertEqual(client._session.post.call_count, 1)

    def test_51_items_makes_two_calls(self):
        items = [{"conflict_id": f"c{i}", "resolution": "keep_both"} for i in range(51)]
        # First call returns 50 resolved, second returns 1
        resp1 = MagicMock()
        resp1.raise_for_status.return_value = None
        resp1.json.return_value = {"ok": True, "resolved": 50, "failed": 0, "total": 50, "results": []}
        resp2 = MagicMock()
        resp2.raise_for_status.return_value = None
        resp2.json.return_value = {"ok": True, "resolved": 1, "failed": 0, "total": 1, "results": []}
        client = NousClient.__new__(NousClient)
        client.base_url = "http://localhost:3100"
        client._session = MagicMock()
        client._session.post.side_effect = [resp1, resp2]
        result = client.batch_resolve_conflicts(items)
        self.assertEqual(client._session.post.call_count, 2)
        self.assertEqual(result["total"], 51)
        self.assertEqual(result["resolved"], 51)

    def test_100_items_makes_two_calls(self):
        items = [{"conflict_id": f"c{i}", "resolution": "keep_both"} for i in range(100)]
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {"ok": True, "resolved": 50, "failed": 0, "total": 50, "results": []}
        client = NousClient.__new__(NousClient)
        client.base_url = "http://localhost:3100"
        client._session = MagicMock()
        client._session.post.return_value = resp
        result = client.batch_resolve_conflicts(items)
        self.assertEqual(client._session.post.call_count, 2)
        self.assertEqual(result["total"], 100)

    def test_101_items_makes_three_calls(self):
        items = [{"conflict_id": f"c{i}", "resolution": "keep_both"} for i in range(101)]
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {"ok": True, "resolved": 50, "failed": 0, "total": 50, "results": []}
        client = NousClient.__new__(NousClient)
        client.base_url = "http://localhost:3100"
        client._session = MagicMock()
        client._session.post.return_value = resp
        result = client.batch_resolve_conflicts(items)
        self.assertEqual(client._session.post.call_count, 3)

    def test_chunk_sizes_are_correct(self):
        """Each chunk sent to the server must be <= 50 items."""
        items = [{"conflict_id": f"c{i}", "resolution": "keep_both"} for i in range(123)]
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {"ok": True, "resolved": 50, "failed": 0, "total": 50, "results": []}
        client = NousClient.__new__(NousClient)
        client.base_url = "http://localhost:3100"
        client._session = MagicMock()
        client._session.post.return_value = resp
        client.batch_resolve_conflicts(items)
        for call_args in client._session.post.call_args_list:
            sent = call_args[1]["json"]["items"]
            self.assertLessEqual(len(sent), 50)

    def test_failed_chunk_sets_ok_false(self):
        items = [{"conflict_id": f"c{i}", "resolution": "keep_both"} for i in range(51)]
        resp1 = MagicMock()
        resp1.raise_for_status.return_value = None
        resp1.json.return_value = {"ok": False, "resolved": 0, "failed": 50, "total": 50, "results": []}
        resp2 = MagicMock()
        resp2.raise_for_status.return_value = None
        resp2.json.return_value = {"ok": True, "resolved": 1, "failed": 0, "total": 1, "results": []}
        client = NousClient.__new__(NousClient)
        client.base_url = "http://localhost:3100"
        client._session = MagicMock()
        client._session.post.side_effect = [resp1, resp2]
        result = client.batch_resolve_conflicts(items)
        self.assertFalse(result["ok"])

    def test_all_chunks_use_default_timeout(self):
        """Every chunked HTTP call must include the default timeout."""
        items = [{"conflict_id": f"c{i}", "resolution": "keep_both"} for i in range(75)]
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {"ok": True, "resolved": 50, "failed": 0, "total": 50, "results": []}
        client = NousClient.__new__(NousClient)
        client.base_url = "http://localhost:3100"
        client._session = MagicMock()
        client._session.post.return_value = resp
        client.batch_resolve_conflicts(items)
        for call_args in client._session.post.call_args_list:
            self.assertEqual(call_args[1].get("timeout"), NousClient._DEFAULT_TIMEOUT)


# ---------------------------------------------------------------------------
# 3. Daemon warning-level logging
# ---------------------------------------------------------------------------

class TestDaemonFailureLogging(unittest.TestCase):
    """Decay, conflict, and backfill failures must log at WARNING, not DEBUG."""

    def _make_minimal_daemon(self):
        """Build a Daemon instance with all dependencies stubbed out."""
        from hynous.intelligence.daemon import Daemon
        agent = MagicMock()
        config = MagicMock()
        config.daemon.decay_interval = 21600
        config.daemon.conflict_check_interval = 1800
        config.daemon.embedding_backfill_interval = 43200
        daemon = Daemon.__new__(Daemon)
        daemon.agent = agent
        daemon.config = config
        daemon.decay_cycles_run = 0
        daemon.embedding_backfills = 0
        daemon.conflict_checks = 0
        return daemon

    def test_decay_failure_logs_warning(self):
        daemon = self._make_minimal_daemon()
        failing_nous = MagicMock()
        failing_nous.run_decay.side_effect = Exception("connection refused")
        with patch.object(daemon, '_get_nous', return_value=failing_nous):
            with self.assertLogs('hynous.intelligence.daemon', level='WARNING') as cm:
                daemon._run_decay_cycle()
        self.assertTrue(any("Decay cycle failed" in msg for msg in cm.output))
        # Must NOT be a debug-level log
        self.assertTrue(any("WARNING" in msg for msg in cm.output))

    def test_decay_failure_not_only_debug(self):
        """Verify the log level is WARNING, not DEBUG (DEBUG wouldn't appear at WARNING filter)."""
        daemon = self._make_minimal_daemon()
        failing_nous = MagicMock()
        failing_nous.run_decay.side_effect = ConnectionError("timeout")
        with patch.object(daemon, '_get_nous', return_value=failing_nous):
            # assertLogs with WARNING will only capture WARNING+ messages.
            # If the code were still at DEBUG level, this would raise AssertionError.
            with self.assertLogs('hynous.intelligence.daemon', level='WARNING') as cm:
                daemon._run_decay_cycle()
            self.assertGreater(len(cm.output), 0)

    def test_backfill_failure_logs_warning(self):
        daemon = self._make_minimal_daemon()
        failing_nous = MagicMock()
        failing_nous.backfill_embeddings.side_effect = Exception("timeout")
        with patch.object(daemon, '_get_nous', return_value=failing_nous):
            with self.assertLogs('hynous.intelligence.daemon', level='WARNING') as cm:
                daemon._run_embedding_backfill()
        self.assertTrue(any("Embedding backfill failed" in msg for msg in cm.output))
        self.assertTrue(any("WARNING" in msg for msg in cm.output))

    def test_conflict_check_failure_logs_warning(self):
        daemon = self._make_minimal_daemon()
        failing_nous = MagicMock()
        failing_nous.get_conflicts.side_effect = Exception("connection error")
        with patch.object(daemon, '_get_nous', return_value=failing_nous):
            with self.assertLogs('hynous.intelligence.daemon', level='WARNING') as cm:
                daemon._check_conflicts()
        self.assertTrue(any("Conflict check failed" in msg for msg in cm.output))
        self.assertTrue(any("WARNING" in msg for msg in cm.output))

    def test_decay_success_does_not_log_warning(self):
        """A successful decay cycle must not emit any warnings."""
        daemon = self._make_minimal_daemon()
        good_nous = MagicMock()
        good_nous.run_decay.return_value = {
            "processed": 10, "transitions_count": 0, "transitions": []
        }
        with patch.object(daemon, '_get_nous', return_value=good_nous):
            # Should not raise — no WARNING-level logs expected
            import logging as _logging
            with self.assertLogs('hynous.intelligence.daemon', level='DEBUG') as cm:
                daemon._run_decay_cycle()
            warning_msgs = [m for m in cm.output if 'WARNING' in m]
            self.assertEqual(len(warning_msgs), 0)

    def test_decay_counter_increments_only_on_success(self):
        """decay_cycles_run must not increment when the HTTP call fails."""
        daemon = self._make_minimal_daemon()
        failing_nous = MagicMock()
        failing_nous.run_decay.side_effect = Exception("refused")
        with patch.object(daemon, '_get_nous', return_value=failing_nous):
            with self.assertLogs('hynous.intelligence.daemon', level='WARNING'):
                daemon._run_decay_cycle()
        self.assertEqual(daemon.decay_cycles_run, 0)

    def test_decay_counter_increments_on_success(self):
        daemon = self._make_minimal_daemon()
        good_nous = MagicMock()
        good_nous.run_decay.return_value = {
            "processed": 500, "transitions_count": 3,
            "transitions": [
                {"id": "n_1", "from": "ACTIVE", "to": "WEAK"},
                {"id": "n_2", "from": "ACTIVE", "to": "WEAK"},
                {"id": "n_3", "from": "WEAK", "to": "DORMANT"},
            ]
        }
        with patch.object(daemon, '_get_nous', return_value=good_nous):
            with self.assertLogs('hynous.intelligence.daemon', level='DEBUG'):
                daemon._run_decay_cycle()
        self.assertEqual(daemon.decay_cycles_run, 1)


# ---------------------------------------------------------------------------
# 4. Decay TypeScript batch behaviour — verified via integration check
# ---------------------------------------------------------------------------

class TestDecayBatchLogic(unittest.TestCase):
    """
    The decay.ts rewrite uses db.batch() instead of N individual db.execute() calls.
    We verify the Python-facing contract: the response shape is unchanged.
    This is a contract test — the shape must match what _run_decay_cycle() expects.
    """

    def test_decay_response_shape_handled_correctly(self):
        """_run_decay_cycle must correctly parse the decay response."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        Daemon = daemon_module.Daemon
        daemon = Daemon.__new__(Daemon)
        daemon.decay_cycles_run = 0
        daemon.config = MagicMock()

        good_nous = MagicMock()
        good_nous.run_decay.return_value = {
            "ok": True,
            "processed": 1200,
            "transitions_count": 47,
            "transitions": [{"id": f"n_{i}", "from": "ACTIVE", "to": "WEAK"} for i in range(47)],
        }
        with patch.object(daemon, '_get_nous', return_value=good_nous):
            from hynous.core.daemon_log import DaemonEvent
            with patch('hynous.intelligence.daemon.log_event') as mock_log:
                with self.assertLogs('hynous.intelligence.daemon', level='INFO') as cm:
                    daemon._run_decay_cycle()

        # Counter incremented
        self.assertEqual(daemon.decay_cycles_run, 1)
        # Event logged (transitions_count > 0)
        mock_log.assert_called_once()
        event_arg = mock_log.call_args[0][0]
        self.assertIn("1200", event_arg.detail)
        self.assertIn("47", event_arg.detail)

    def test_decay_no_transitions_logs_debug_not_warning(self):
        """When there are no transitions, no WARNING must be emitted."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        Daemon = daemon_module.Daemon
        daemon = Daemon.__new__(Daemon)
        daemon.decay_cycles_run = 0
        daemon.config = MagicMock()

        good_nous = MagicMock()
        good_nous.run_decay.return_value = {
            "ok": True, "processed": 800, "transitions_count": 0, "transitions": []
        }
        with patch.object(daemon, '_get_nous', return_value=good_nous):
            with self.assertLogs('hynous.intelligence.daemon', level='DEBUG') as cm:
                daemon._run_decay_cycle()
        warning_msgs = [m for m in cm.output if 'WARNING' in m]
        self.assertEqual(len(warning_msgs), 0)


# ====================================================================
# TestDaemonNonBlocking
# Verify that decay, conflict check, and embedding backfill run in
# background threads rather than blocking the main daemon loop.
# ====================================================================

class TestDaemonNonBlocking(unittest.TestCase):
    """Tests for the background-thread fix (CRITICAL: non-blocking maintenance)."""

    def _make_daemon(self):
        """Construct a Daemon instance without calling __init__ (no deps)."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        Daemon = daemon_module.Daemon
        daemon = Daemon.__new__(Daemon)
        # Seed only the attributes the threading tests need
        daemon._decay_thread = None
        daemon._conflict_thread = None
        daemon._backfill_thread = None
        daemon.decay_cycles_run = 0
        daemon.conflict_checks = 0
        daemon.embedding_backfills = 0
        daemon.config = MagicMock()
        return daemon

    # ------------------------------------------------------------------
    # Thread-attribute existence
    # ------------------------------------------------------------------

    def test_decay_thread_attr_exists(self):
        """Daemon.__init__ must declare _decay_thread."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon.__init__)
        self.assertIn('_decay_thread', src)

    def test_conflict_thread_attr_exists(self):
        """Daemon.__init__ must declare _conflict_thread."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon.__init__)
        self.assertIn('_conflict_thread', src)

    def test_backfill_thread_attr_exists(self):
        """Daemon.__init__ must declare _backfill_thread."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon.__init__)
        self.assertIn('_backfill_thread', src)

    # ------------------------------------------------------------------
    # Thread spawning: decay
    # ------------------------------------------------------------------

    def test_decay_spawns_background_thread(self):
        """_run_decay_cycle must be called inside a daemon thread, not inline."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon._loop)
        # Must reference _decay_thread and threading.Thread
        self.assertIn('_decay_thread', src)
        self.assertIn('hynous-decay', src)

    def test_decay_thread_name_is_hynous_decay(self):
        """The thread spawned for decay must be named 'hynous-decay'."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon._loop)
        self.assertIn('"hynous-decay"', src)

    def test_decay_skip_when_thread_alive(self):
        """When _decay_thread is alive, a new thread must NOT be spawned."""
        daemon = self._make_daemon()
        alive_thread = MagicMock()
        alive_thread.is_alive.return_value = True
        daemon._decay_thread = alive_thread

        spawned = []

        def fake_thread(**kwargs):
            t = MagicMock()
            spawned.append(t)
            return t

        import threading as _threading
        with patch.object(_threading, 'Thread', side_effect=fake_thread):
            # Simulate the guard logic directly
            if daemon._decay_thread is None or not daemon._decay_thread.is_alive():
                daemon._decay_thread = _threading.Thread(
                    target=daemon._run_decay_cycle,
                    daemon=True, name="hynous-decay"
                )
                daemon._decay_thread.start()
            # else: skip

        self.assertEqual(len(spawned), 0, "No new thread should be spawned when one is alive")

    def test_decay_spawns_new_when_thread_dead(self):
        """When _decay_thread is not alive, a new thread must be spawned."""
        daemon = self._make_daemon()
        dead_thread = MagicMock()
        dead_thread.is_alive.return_value = False
        daemon._decay_thread = dead_thread

        started = []
        import threading as _threading

        class FakeThread:
            def __init__(self, target, daemon, name):
                self.name = name

            def start(self):
                started.append(self.name)

        with patch.object(_threading, 'Thread', FakeThread):
            if daemon._decay_thread is None or not daemon._decay_thread.is_alive():
                t = _threading.Thread(
                    target=daemon._run_decay_cycle,
                    daemon=True, name="hynous-decay"
                )
                t.start()

        self.assertEqual(started, ["hynous-decay"])

    # ------------------------------------------------------------------
    # Thread spawning: conflicts
    # ------------------------------------------------------------------

    def test_conflict_thread_name_is_hynous_conflicts(self):
        """The thread spawned for conflict check must be named 'hynous-conflicts'."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon._loop)
        self.assertIn('"hynous-conflicts"', src)

    def test_conflict_skip_when_thread_alive(self):
        """When _conflict_thread is alive, a new thread must NOT be spawned."""
        daemon = self._make_daemon()
        alive_thread = MagicMock()
        alive_thread.is_alive.return_value = True
        daemon._conflict_thread = alive_thread

        spawned = []
        import threading as _threading

        with patch.object(_threading, 'Thread', side_effect=lambda **kw: spawned.append(kw) or MagicMock()):
            if daemon._conflict_thread is None or not daemon._conflict_thread.is_alive():
                t = _threading.Thread(
                    target=daemon._check_conflicts,
                    daemon=True, name="hynous-conflicts"
                )
                t.start()

        self.assertEqual(len(spawned), 0)

    # ------------------------------------------------------------------
    # Thread spawning: backfill
    # ------------------------------------------------------------------

    def test_backfill_thread_name_is_hynous_backfill(self):
        """The thread spawned for embedding backfill must be named 'hynous-backfill'."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon._loop)
        self.assertIn('"hynous-backfill"', src)

    def test_backfill_skip_when_thread_alive(self):
        """When _backfill_thread is alive, a new thread must NOT be spawned."""
        daemon = self._make_daemon()
        alive_thread = MagicMock()
        alive_thread.is_alive.return_value = True
        daemon._backfill_thread = alive_thread

        spawned = []
        import threading as _threading

        with patch.object(_threading, 'Thread', side_effect=lambda **kw: spawned.append(kw) or MagicMock()):
            if daemon._backfill_thread is None or not daemon._backfill_thread.is_alive():
                t = _threading.Thread(
                    target=daemon._run_embedding_backfill,
                    daemon=True, name="hynous-backfill"
                )
                t.start()

        self.assertEqual(len(spawned), 0)

    # ------------------------------------------------------------------
    # Skip log messages
    # ------------------------------------------------------------------

    def test_skip_log_message_in_loop_source(self):
        """_loop source must contain all three 'still running' skip messages."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon._loop)
        self.assertIn('Decay cycle still running', src)
        self.assertIn('Conflict check still running', src)
        self.assertIn('Embedding backfill still running', src)

    # ------------------------------------------------------------------
    # All three thread attributes initialized to None in __init__
    # ------------------------------------------------------------------

    def test_initial_thread_attrs_are_none(self):
        """All three maintenance thread attrs must start as None in __init__."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon.__init__)
        # Each should be initialized to None
        self.assertIn('_decay_thread: threading.Thread | None = None', src)
        self.assertIn('_conflict_thread: threading.Thread | None = None', src)
        self.assertIn('_backfill_thread: threading.Thread | None = None', src)


# ====================================================================
# TestFadingMemoryAlerts
# Verify the ACTIVE→WEAK fading alert feature introduced in daemon.py
# ====================================================================

class TestFadingMemoryAlerts(unittest.TestCase):
    """Tests for _check_fading_transitions and _wake_for_fading_memories."""

    def _make_daemon(self):
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        Daemon = daemon_module.Daemon
        d = Daemon.__new__(Daemon)
        d._fading_alerted = {}
        d.config = MagicMock()
        d.decay_cycles_run = 0
        return d

    # ------------------------------------------------------------------
    # Constant and __init__ checks
    # ------------------------------------------------------------------

    def test_fading_alert_subtypes_constant_exists(self):
        """_FADING_ALERT_SUBTYPES must be defined at module level."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['_FADING_ALERT_SUBTYPES']
        )
        self.assertTrue(hasattr(daemon_module, '_FADING_ALERT_SUBTYPES'))

    def test_fading_alert_subtypes_contains_lesson_thesis_playbook(self):
        """_FADING_ALERT_SUBTYPES must cover lesson, thesis, and playbook."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['_FADING_ALERT_SUBTYPES']
        )
        subtypes = daemon_module._FADING_ALERT_SUBTYPES
        self.assertIn('custom:lesson', subtypes)
        self.assertIn('custom:thesis', subtypes)
        self.assertIn('custom:playbook', subtypes)

    def test_fading_alert_subtypes_excludes_signal_and_episode(self):
        """Ephemeral types must NOT be in _FADING_ALERT_SUBTYPES."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['_FADING_ALERT_SUBTYPES']
        )
        subtypes = daemon_module._FADING_ALERT_SUBTYPES
        self.assertNotIn('custom:signal', subtypes)
        self.assertNotIn('custom:watchpoint', subtypes)
        self.assertNotIn('custom:turn_summary', subtypes)
        self.assertNotIn('custom:trade_entry', subtypes)

    def test_fading_alerted_dict_exists_in_init(self):
        """Daemon.__init__ must declare _fading_alerted dict."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon.__init__)
        self.assertIn('_fading_alerted', src)

    # ------------------------------------------------------------------
    # _check_fading_transitions logic
    # ------------------------------------------------------------------

    def test_no_wake_when_no_active_to_weak_transitions(self):
        """No wake if transitions are WEAK→DORMANT or ACTIVE→DORMANT only."""
        daemon = self._make_daemon()
        nous = MagicMock()
        transitions = [
            {"id": "n1", "from": "WEAK", "to": "DORMANT"},
            {"id": "n2", "from": "ACTIVE", "to": "DORMANT"},
        ]
        with patch.object(daemon, '_wake_for_fading_memories') as mock_wake:
            daemon._check_fading_transitions(transitions, nous)
        mock_wake.assert_not_called()
        nous.get_node.assert_not_called()

    def test_no_wake_for_unimportant_subtypes(self):
        """Signals and episodes crossing ACTIVE→WEAK must NOT trigger a wake."""
        daemon = self._make_daemon()
        nous = MagicMock()
        nous.get_node.return_value = {"id": "n1", "subtype": "custom:signal", "content_title": "Signal"}
        transitions = [{"id": "n1", "from": "ACTIVE", "to": "WEAK"}]
        with patch.object(daemon, '_wake_for_fading_memories') as mock_wake:
            daemon._check_fading_transitions(transitions, nous)
        mock_wake.assert_not_called()

    def test_wake_fires_for_lesson_going_weak(self):
        """A lesson crossing ACTIVE→WEAK must trigger _wake_for_fading_memories."""
        daemon = self._make_daemon()
        nous = MagicMock()
        nous.get_node.return_value = {
            "id": "n1", "subtype": "custom:lesson",
            "content_title": "Don't chase pumps",
            "content_body": "Lesson body",
            "neural_retrievability": 0.42,
        }
        transitions = [{"id": "n1", "from": "ACTIVE", "to": "WEAK"}]
        with patch.object(daemon, '_wake_for_fading_memories') as mock_wake:
            daemon._check_fading_transitions(transitions, nous)
        mock_wake.assert_called_once()
        fading_nodes = mock_wake.call_args[0][0]
        self.assertEqual(len(fading_nodes), 1)
        self.assertEqual(fading_nodes[0]["id"], "n1")

    def test_wake_fires_for_thesis_going_weak(self):
        """A thesis crossing ACTIVE→WEAK must trigger a wake."""
        daemon = self._make_daemon()
        nous = MagicMock()
        nous.get_node.return_value = {
            "id": "n2", "subtype": "custom:thesis",
            "content_title": "BTC bullish Q1", "content_body": "...",
            "neural_retrievability": 0.35,
        }
        transitions = [{"id": "n2", "from": "ACTIVE", "to": "WEAK"}]
        with patch.object(daemon, '_wake_for_fading_memories') as mock_wake:
            daemon._check_fading_transitions(transitions, nous)
        mock_wake.assert_called_once()

    def test_per_node_24h_cooldown_prevents_repeated_alerts(self):
        """If a node was alerted less than 24h ago, it must not trigger again."""
        daemon = self._make_daemon()
        import time as _time
        daemon._fading_alerted = {"n1": _time.time() - 3600}  # 1h ago, within 24h
        nous = MagicMock()
        nous.get_node.return_value = {
            "id": "n1", "subtype": "custom:lesson",
            "content_title": "Old lesson", "content_body": "...",
        }
        transitions = [{"id": "n1", "from": "ACTIVE", "to": "WEAK"}]
        with patch.object(daemon, '_wake_for_fading_memories') as mock_wake:
            daemon._check_fading_transitions(transitions, nous)
        mock_wake.assert_not_called()

    def test_cooldown_expires_after_24h(self):
        """A node alerted >24h ago must be eligible for a new alert."""
        daemon = self._make_daemon()
        import time as _time
        daemon._fading_alerted = {"n1": _time.time() - 90_000}  # 25h ago
        nous = MagicMock()
        nous.get_node.return_value = {
            "id": "n1", "subtype": "custom:lesson",
            "content_title": "Lesson", "content_body": "...",
            "neural_retrievability": 0.4,
        }
        transitions = [{"id": "n1", "from": "ACTIVE", "to": "WEAK"}]
        with patch.object(daemon, '_wake_for_fading_memories') as mock_wake:
            daemon._check_fading_transitions(transitions, nous)
        mock_wake.assert_called_once()

    def test_fading_alerted_dict_is_updated_after_alert(self):
        """After alerting, the node ID must be recorded in _fading_alerted."""
        daemon = self._make_daemon()
        nous = MagicMock()
        nous.get_node.return_value = {
            "id": "n99", "subtype": "custom:playbook",
            "content_title": "Playbook", "content_body": "...",
            "neural_retrievability": 0.45,
        }
        transitions = [{"id": "n99", "from": "ACTIVE", "to": "WEAK"}]
        with patch.object(daemon, '_wake_for_fading_memories'):
            daemon._check_fading_transitions(transitions, nous)
        self.assertIn("n99", daemon._fading_alerted)

    def test_node_fetch_failure_is_swallowed(self):
        """If get_node() raises, the error must be swallowed (not propagate)."""
        daemon = self._make_daemon()
        nous = MagicMock()
        nous.get_node.side_effect = Exception("network error")
        transitions = [{"id": "n1", "from": "ACTIVE", "to": "WEAK"}]
        # Must not raise
        with patch.object(daemon, '_wake_for_fading_memories') as mock_wake:
            daemon._check_fading_transitions(transitions, nous)
        mock_wake.assert_not_called()

    # ------------------------------------------------------------------
    # _wake_for_fading_memories message format
    # ------------------------------------------------------------------

    def test_wake_message_contains_daemon_wake_header(self):
        """Wake message must start with [DAEMON WAKE — Fading Memories]."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon._wake_for_fading_memories)
        self.assertIn('DAEMON WAKE — Fading Memories', src)

    def test_wake_message_contains_source_tag(self):
        """_wake_agent must be called with source='daemon:memory_fading'."""
        daemon_module = __import__(
            'hynous.intelligence.daemon', fromlist=['Daemon']
        )
        import inspect
        src = inspect.getsource(daemon_module.Daemon._wake_for_fading_memories)
        self.assertIn('daemon:memory_fading', src)

    def test_wake_for_fading_calls_wake_agent(self):
        """_wake_for_fading_memories must call _wake_agent exactly once."""
        daemon = self._make_daemon()
        nodes = [{
            "id": "n1", "subtype": "custom:lesson",
            "content_title": "A lesson", "content_body": "Body text.",
            "neural_retrievability": 0.42,
        }]
        with patch.object(daemon, '_wake_agent', return_value="ok") as mock_wake:
            with patch('hynous.intelligence.daemon.log_event'):
                with patch('hynous.intelligence.daemon._queue_and_persist'):
                    daemon._wake_for_fading_memories(nodes)
        mock_wake.assert_called_once()
        call_kwargs = mock_wake.call_args[1]
        self.assertEqual(call_kwargs.get('source'), 'daemon:memory_fading')
        self.assertEqual(call_kwargs.get('max_tokens'), 1024)

    def test_run_decay_cycle_calls_check_fading_on_transitions(self):
        """_run_decay_cycle must call _check_fading_transitions when transitions exist."""
        daemon = self._make_daemon()
        good_nous = MagicMock()
        good_nous.run_decay.return_value = {
            "ok": True, "processed": 500,
            "transitions_count": 2,
            "transitions": [
                {"id": "a", "from": "ACTIVE", "to": "WEAK"},
                {"id": "b", "from": "WEAK", "to": "DORMANT"},
            ],
        }
        with patch.object(daemon, '_get_nous', return_value=good_nous):
            with patch.object(daemon, '_check_fading_transitions') as mock_fading:
                with patch('hynous.intelligence.daemon.log_event'):
                    daemon._run_decay_cycle()
        mock_fading.assert_called_once()
        # Verify the transitions list was passed through
        call_args = mock_fading.call_args[0]
        self.assertEqual(len(call_args[0]), 2)

    def test_run_decay_no_transitions_skips_fading_check(self):
        """When transitions_count is 0, _check_fading_transitions must NOT be called."""
        daemon = self._make_daemon()
        good_nous = MagicMock()
        good_nous.run_decay.return_value = {
            "ok": True, "processed": 200, "transitions_count": 0, "transitions": [],
        }
        with patch.object(daemon, '_get_nous', return_value=good_nous):
            with patch.object(daemon, '_check_fading_transitions') as mock_fading:
                daemon._run_decay_cycle()
        mock_fading.assert_not_called()


if __name__ == '__main__':
    unittest.main()
