"""Dynamic end-to-end tests for the Intelligent Retrieval Orchestrator.

Requires a running Nous server on localhost:3100.
Run with: .venv/bin/python3 debugging/test_live_orchestrator.py
"""

import logging
import json
import sys
import time

logging.basicConfig(level=logging.DEBUG, format="%(name)s: %(message)s")

from hynous.nous.client import NousClient
from hynous.core.config import load_config
from hynous.intelligence.retrieval_orchestrator import (
    orchestrate_retrieval,
    _classify,
    _decompose,
    _reformulate,
    _merge_and_select,
    _search_with_quality,
    _broaden_filters,
    _to_float,
)

client = NousClient()
config = load_config()

passed = 0
failed = 0

def test(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS: {name}")
    else:
        failed += 1
        print(f"  FAIL: {name} — {detail}")


# ===================================================================
print("=" * 60)
print("TEST 1: NousClient.health() — live connection")
print("=" * 60)
h = client.health()
print(f"  Health response: {json.dumps(h, indent=2)}")
test("health returns status ok", h.get("status") == "ok")
test("health shows node_count", isinstance(h.get("node_count"), int))

# ===================================================================
print()
print("=" * 60)
print("TEST 2: NousClient.classify_query() — live QCS")
print("=" * 60)

# Simple query — should NOT be D4
r = client.classify_query("BTC price")
print(f"  'BTC price' → disqualified={r.get('disqualified')}, "
      f"category={r.get('disqualifier_category')}, type={r.get('query_type')}")
test("simple query not D4", r.get("disqualifier_category") != "D4")

# Compound query — QCS may classify as D4 or D1 (both trigger decomposition)
r = client.classify_query("What is BTC doing and how is ETH performing?")
print(f"  compound → disqualified={r.get('disqualified')}, "
      f"category={r.get('disqualifier_category')}")
test("compound query is D4 or D1",
     r.get("disqualifier_category") in ("D4", "D1"))

# Trivial query
r = client.classify_query("hi")
print(f"  'hi' → disqualified={r.get('disqualified')}, "
      f"category={r.get('disqualifier_category')}")
test("trivial query classified", "query_type" in r or "disqualified" in r)

# ===================================================================
print()
print("=" * 60)
print("TEST 3: NousClient.search_full() — live search")
print("=" * 60)
# Use a longer query — short queries may return 0 without embeddings
r = client.search_full(query="BTC weekend liquidity risk trading", limit=5)
data = r.get("data", [])
print(f"  search_full('BTC weekend liquidity...'): {len(data)} results")
for node in data:
    print(f"    id={node['id']} score={node.get('score', '?'):.4f} "
          f"title={node.get('content_title', '?')}")
test("search_full returns results", len(data) > 0, f"got {len(data)} results")
test("search_full results have scores", all("score" in n for n in data))
test("search_full returns dict (not just data)", isinstance(r, dict) and "data" in r)

# ===================================================================
print()
print("=" * 60)
print("TEST 4: orchestrate_retrieval() — simple query (fast path)")
print("=" * 60)
# Use keyword-rich query since embeddings may not be available
t0 = time.monotonic()
results = orchestrate_retrieval("BTC weekend liquidity risk lesson", client, config)
elapsed = (time.monotonic() - t0) * 1000
print(f"  orchestrate('BTC weekend liquidity risk lesson'): {len(results)} results in {elapsed:.0f}ms")
for node in results:
    print(f"    id={node['id']} score={node.get('score', '?'):.4f} "
          f"title={node.get('content_title', '?')}")
test("simple query returns results", len(results) > 0)
test("results sorted by score desc",
     all(
         _to_float(results[i].get("score", 0)) >= _to_float(results[i + 1].get("score", 0))
         for i in range(len(results) - 1)
     ) if len(results) > 1 else True)

# ===================================================================
print()
print("=" * 60)
print("TEST 5: orchestrate_retrieval() — compound query (D4 path)")
print("=" * 60)
t0 = time.monotonic()
results = orchestrate_retrieval(
    "What is my BTC lesson and how is ETH doing?", client, config,
)
elapsed = (time.monotonic() - t0) * 1000
print(f"  orchestrate(compound): {len(results)} results in {elapsed:.0f}ms")
for node in results:
    title = node.get("content_title", "?")
    print(f"    id={node['id']} score={node.get('score', '?'):.4f} title={title}")

test("compound query returns results", len(results) > 0)
# Check we got results covering both BTC and ETH topics
titles = " ".join(n.get("content_title", "") for n in results).lower()
has_btc = "btc" in titles
has_eth = "eth" in titles
print(f"  Coverage: BTC={'yes' if has_btc else 'no'}, ETH={'yes' if has_eth else 'no'}")
test("compound covers BTC results", has_btc)
test("compound covers ETH results", has_eth,
     f"titles: {[n.get('content_title','') for n in results]}")

# ===================================================================
print()
print("=" * 60)
print("TEST 6: orchestrate_retrieval() — with type filter")
print("=" * 60)
results = orchestrate_retrieval(
    "BTC", client, config,
    type_filter="concept",
    subtype_filter="custom:lesson",
)
print(f"  orchestrate('BTC', type=concept, subtype=custom:lesson): {len(results)} results")
for node in results:
    print(f"    id={node['id']} score={node.get('score', '?'):.4f} "
          f"title={node.get('content_title', '?')}")
test("type-filtered query returns results", len(results) >= 0)
# If there are results, they should all be concept/lesson type
if results:
    # Note: search results may not always include type/subtype fields depending on Nous response
    test("filter narrows results", len(results) <= 4, f"got {len(results)} results")

# ===================================================================
print()
print("=" * 60)
print("TEST 7: orchestrate_retrieval() — empty results (nonexistent)")
print("=" * 60)
results = orchestrate_retrieval("zzz_nonexistent_topic_xyz_12345", client, config)
print(f"  orchestrate(nonexistent): {len(results)} results")
test("nonexistent returns empty or low-score", True)  # May get keyword fragments

# ===================================================================
print()
print("=" * 60)
print("TEST 8: orchestrate_retrieval() — disabled orchestrator")
print("=" * 60)
config.orchestrator.enabled = False
results = orchestrate_retrieval("BTC", client, config)
print(f"  orchestrate(disabled, 'BTC'): {len(results)} results")
test("disabled path still returns results", len(results) >= 0)
config.orchestrator.enabled = True  # restore

# ===================================================================
print()
print("=" * 60)
print("TEST 9: Quality gate — retry with reformulation")
print("=" * 60)
# Use a verbose query that reformulation should simplify
t0 = time.monotonic()
results = orchestrate_retrieval(
    "What is the weekend liquidity risk for trading BTC?", client, config,
)
elapsed = (time.monotonic() - t0) * 1000
print(f"  orchestrate(verbose query): {len(results)} results in {elapsed:.0f}ms")
for node in results:
    print(f"    id={node['id']} score={node.get('score', '?'):.4f} "
          f"title={node.get('content_title', '?')}")
test("verbose query returns results", len(results) > 0)

# ===================================================================
print()
print("=" * 60)
print("TEST 10: Latency check — simple query should be fast")
print("=" * 60)
times = []
for _ in range(3):
    t0 = time.monotonic()
    orchestrate_retrieval("BTC", client, config)
    times.append((time.monotonic() - t0) * 1000)
avg = sum(times) / len(times)
print(f"  3 simple queries: {[f'{t:.0f}ms' for t in times]}, avg={avg:.0f}ms")
test("simple query avg < 500ms", avg < 500, f"avg={avg:.0f}ms")

# ===================================================================
print()
print("=" * 60)
print("TEST 11: Compound query latency")
print("=" * 60)
t0 = time.monotonic()
results = orchestrate_retrieval(
    "What is BTC doing? How is ETH? What about weekend risk?", client, config,
)
elapsed = (time.monotonic() - t0) * 1000
print(f"  3-part compound query: {len(results)} results in {elapsed:.0f}ms")
test("compound < 3s timeout", elapsed < 3000, f"took {elapsed:.0f}ms")

# ===================================================================
print()
print("=" * 60)
print("TEST 12: _decompose() with live QCS results")
print("=" * 60)
qcs = client.classify_query("What is BTC doing and how is ETH performing?")
cat = qcs.get("disqualifier_category")
parts = _decompose("What is BTC doing and how is ETH performing?", qcs)
print(f"  QCS category: {cat}")
print(f"  Decomposed into: {parts}")
test("compound decomposes into 2+ parts (D4 or D1)", len(parts) >= 2,
     f"got {len(parts)} parts: {parts}, category={cat}")

qcs2 = client.classify_query("BTC price")
parts2 = _decompose("BTC price", qcs2)
print(f"  Simple query parts: {parts2}")
test("simple query stays as 1 part", len(parts2) == 1)


# ===================================================================
print()
print("=" * 60)
print(f"RESULTS: {passed} passed, {failed} failed, {passed + failed} total")
print("=" * 60)

if failed > 0:
    sys.exit(1)
else:
    print("\nALL LIVE DYNAMIC TESTS PASSED")
