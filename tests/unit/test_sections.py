"""Unit tests for the memory sections module."""

import pytest
from hynous.nous.sections import (
    MemorySection,
    SUBTYPE_TO_SECTION,
    MEMORY_TYPE_TO_SECTION,
    SECTION_PROFILES,
    SUBTYPE_INITIAL_STABILITY,
    get_section_for_subtype,
    get_section_for_memory_type,
    get_section_profile,
    get_profile_for_subtype,
    get_initial_stability_for_subtype,
    RerankingWeights,
    calculate_salience,
    modulate_stability,
    classify_intent,
    _INTENT_PATTERNS,
)


class TestMemorySection:
    def test_has_four_sections(self):
        assert len(MemorySection) == 4

    def test_section_values(self):
        assert MemorySection.EPISODIC.value == "EPISODIC"
        assert MemorySection.SIGNALS.value == "SIGNALS"
        assert MemorySection.KNOWLEDGE.value == "KNOWLEDGE"
        assert MemorySection.PROCEDURAL.value == "PROCEDURAL"


class TestSubtypeToSection:
    def test_maps_all_15_subtypes(self):
        assert len(SUBTYPE_TO_SECTION) == 15

    def test_episodic_subtypes(self):
        episodic = ["custom:trade_entry", "custom:trade_close", "custom:trade_modify",
                     "custom:trade", "custom:turn_summary", "custom:session_summary",
                     "custom:market_event"]
        for st in episodic:
            assert SUBTYPE_TO_SECTION[st] == MemorySection.EPISODIC, f"{st} should be EPISODIC"

    def test_signal_subtypes(self):
        assert SUBTYPE_TO_SECTION["custom:signal"] == MemorySection.SIGNALS
        assert SUBTYPE_TO_SECTION["custom:watchpoint"] == MemorySection.SIGNALS

    def test_knowledge_subtypes(self):
        assert SUBTYPE_TO_SECTION["custom:lesson"] == MemorySection.KNOWLEDGE
        assert SUBTYPE_TO_SECTION["custom:thesis"] == MemorySection.KNOWLEDGE
        assert SUBTYPE_TO_SECTION["custom:curiosity"] == MemorySection.KNOWLEDGE

    def test_procedural_subtypes(self):
        assert SUBTYPE_TO_SECTION["custom:playbook"] == MemorySection.PROCEDURAL
        assert SUBTYPE_TO_SECTION["custom:missed_opportunity"] == MemorySection.PROCEDURAL
        assert SUBTYPE_TO_SECTION["custom:good_pass"] == MemorySection.PROCEDURAL


class TestGetSectionForSubtype:
    def test_known_subtypes(self):
        assert get_section_for_subtype("custom:signal") == MemorySection.SIGNALS
        assert get_section_for_subtype("custom:lesson") == MemorySection.KNOWLEDGE

    def test_unknown_subtype_defaults_to_knowledge(self):
        assert get_section_for_subtype("custom:unknown") == MemorySection.KNOWLEDGE

    def test_none_defaults_to_knowledge(self):
        assert get_section_for_subtype(None) == MemorySection.KNOWLEDGE


class TestGetSectionForMemoryType:
    def test_agent_facing_names(self):
        assert get_section_for_memory_type("signal") == MemorySection.SIGNALS
        assert get_section_for_memory_type("lesson") == MemorySection.KNOWLEDGE
        assert get_section_for_memory_type("trade_entry") == MemorySection.EPISODIC
        assert get_section_for_memory_type("playbook") == MemorySection.PROCEDURAL

    def test_episode_maps_to_episodic(self):
        # "episode" is the agent-facing name that maps to custom:market_event
        assert get_section_for_memory_type("episode") == MemorySection.EPISODIC


class TestSectionProfiles:
    def test_all_sections_have_profiles(self):
        for section in MemorySection:
            assert section in SECTION_PROFILES

    def test_reranking_weights_sum_to_one(self):
        for section, profile in SECTION_PROFILES.items():
            w = profile.reranking_weights
            total = w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity
            assert abs(total - 1.0) < 0.01, f"{section} weights sum to {total}"

    def test_decay_thresholds_ordered(self):
        for section, profile in SECTION_PROFILES.items():
            assert profile.decay.weak_threshold < profile.decay.active_threshold, (
                f"{section}: weak >= active"
            )

    def test_decay_stability_positive(self):
        for section, profile in SECTION_PROFILES.items():
            assert profile.decay.initial_stability_days > 0
            assert profile.decay.max_stability_days > profile.decay.initial_stability_days


class TestRerankingWeightsValidation:
    def test_valid_weights(self):
        w = RerankingWeights(semantic=0.30, keyword=0.15, graph=0.20,
                             recency=0.15, authority=0.10, affinity=0.10)
        assert w.semantic == 0.30

    def test_invalid_weights_raise(self):
        with pytest.raises(ValueError):
            RerankingWeights(semantic=0.50, keyword=0.50, graph=0.50,
                             recency=0.50, authority=0.50, affinity=0.50)


class TestInitialStability:
    def test_all_subtypes_have_stability(self):
        for subtype in SUBTYPE_TO_SECTION:
            assert subtype in SUBTYPE_INITIAL_STABILITY, f"Missing stability for {subtype}"

    def test_signals_decay_fastest(self):
        signal_stability = get_initial_stability_for_subtype("custom:signal")
        lesson_stability = get_initial_stability_for_subtype("custom:lesson")
        assert signal_stability < lesson_stability

    def test_playbooks_most_durable(self):
        playbook_stability = get_initial_stability_for_subtype("custom:playbook")
        for subtype in SUBTYPE_TO_SECTION:
            stability = get_initial_stability_for_subtype(subtype)
            assert playbook_stability >= stability, (
                f"Playbook ({playbook_stability}d) should be >= {subtype} ({stability}d)"
            )

    def test_fallback_for_unknown(self):
        stability = get_initial_stability_for_subtype("custom:future_type")
        assert stability == 60  # KNOWLEDGE section default


class TestSyncWithTypeScript:
    """Verify Python and TypeScript definitions are in sync."""

    def test_subtype_count_matches(self):
        # TypeScript has 15 entries in SUBTYPE_TO_SECTION
        assert len(SUBTYPE_TO_SECTION) == 15

    def test_stability_count_matches(self):
        # TypeScript has entries for all 15 subtypes
        assert len(SUBTYPE_INITIAL_STABILITY) == 15

    def test_section_count_matches(self):
        # TypeScript has 4 sections
        assert len(MemorySection) == 4


class TestCalculateSalience:
    """Test salience calculation from trade metadata."""

    # ---- Trade close ----

    def test_trade_close_routine_win(self):
        """Small win → low salience."""
        s = calculate_salience("custom:trade_close", {"pnl_pct": 0.5})
        assert 0.3 <= s <= 0.45, f"Expected low salience for +0.5%, got {s}"

    def test_trade_close_notable_loss(self):
        """5% loss → high salience (with loss boost)."""
        s = calculate_salience("custom:trade_close", {"pnl_pct": -5.0})
        assert s > 0.7, f"Expected high salience for -5%, got {s}"

    def test_trade_close_catastrophic_loss(self):
        """10% loss → max salience."""
        s = calculate_salience("custom:trade_close", {"pnl_pct": -10.0})
        assert s >= 0.95, f"Expected max salience for -10%, got {s}"

    def test_trade_close_exceptional_win(self):
        """10% win → high salience (but lower than equivalent loss)."""
        win = calculate_salience("custom:trade_close", {"pnl_pct": 10.0})
        loss = calculate_salience("custom:trade_close", {"pnl_pct": -10.0})
        assert win > 0.8, f"Expected high salience for +10%, got {win}"
        assert loss > win, f"Loss ({loss}) should encode stronger than equivalent win ({win})"

    def test_trade_close_loss_bias(self):
        """Same magnitude: loss encodes stronger than win."""
        win_5 = calculate_salience("custom:trade_close", {"pnl_pct": 5.0})
        loss_5 = calculate_salience("custom:trade_close", {"pnl_pct": -5.0})
        assert loss_5 > win_5, f"Loss salience ({loss_5}) should exceed win ({win_5})"

    def test_trade_close_no_signals(self):
        """No signals → neutral salience."""
        assert calculate_salience("custom:trade_close", None) == 0.5
        assert calculate_salience("custom:trade_close", {}) == 0.5

    # ---- Trade entry ----

    def test_trade_entry_high_confidence(self):
        """High confidence entry → high salience."""
        s = calculate_salience("custom:trade_entry", {"confidence": 0.9, "rr_ratio": 2.5})
        assert s > 0.7, f"Expected high salience for 90% confidence, got {s}"

    def test_trade_entry_low_confidence(self):
        """Low confidence entry → low salience."""
        s = calculate_salience("custom:trade_entry", {"confidence": 0.3, "rr_ratio": 1.0})
        assert s < 0.6, f"Expected low salience for 30% confidence, got {s}"

    def test_trade_entry_no_confidence(self):
        """Missing confidence → neutral."""
        s = calculate_salience("custom:trade_entry", {})
        assert 0.4 <= s <= 0.6, f"Expected neutral-ish salience, got {s}"

    # ---- Phantom outcomes ----

    def test_missed_opportunity_large(self):
        """Large phantom gain → high salience."""
        s = calculate_salience("custom:missed_opportunity", {"pnl_pct": 15.0})
        assert s > 0.8, f"Expected high salience for 15% phantom, got {s}"

    def test_good_pass_small(self):
        """Small phantom loss → low salience."""
        s = calculate_salience("custom:good_pass", {"pnl_pct": -1.0})
        assert s < 0.5, f"Expected low salience for 1% phantom, got {s}"

    # ---- Section enforcement ----

    def test_signals_section_disabled(self):
        """SIGNALS section has salience_enabled=False → always neutral."""
        s = calculate_salience("custom:signal", {"pnl_pct": -20.0})
        assert s == 0.5, f"SIGNALS should ignore salience, got {s}"

    def test_unknown_subtype_neutral(self):
        """Unknown subtype → neutral salience."""
        assert calculate_salience("custom:unknown", {"pnl_pct": -20.0}) == 0.5

    # ---- Bounds ----

    def test_salience_bounds(self):
        """Salience is always in [0.1, 1.0]."""
        for pnl in [-100, -50, -10, -5, 0, 5, 10, 50, 100]:
            s = calculate_salience("custom:trade_close", {"pnl_pct": pnl})
            assert 0.1 <= s <= 1.0, f"Salience {s} out of bounds for pnl_pct={pnl}"

    def test_salience_monotonic_with_magnitude(self):
        """Higher PnL magnitude → higher salience (for wins)."""
        s1 = calculate_salience("custom:trade_close", {"pnl_pct": 1.0})
        s5 = calculate_salience("custom:trade_close", {"pnl_pct": 5.0})
        s10 = calculate_salience("custom:trade_close", {"pnl_pct": 10.0})
        assert s1 < s5 < s10, f"Expected monotonic: {s1} < {s5} < {s10}"


class TestModulateStability:
    """Test stability modulation from salience scores."""

    def test_neutral_returns_none(self):
        """Neutral salience (0.5) → no override needed."""
        assert modulate_stability("custom:trade_close", 0.5) is None

    def test_high_salience_amplifies(self):
        """High salience → stability above base."""
        base = 21.0  # trade_close base
        result = modulate_stability("custom:trade_close", 0.9)
        assert result is not None
        assert result > base, f"Expected amplification: {result} > {base}"

    def test_low_salience_reduces(self):
        """Low salience → stability below base."""
        base = 21.0
        result = modulate_stability("custom:trade_close", 0.2)
        assert result is not None
        assert result < base, f"Expected reduction: {result} < {base}"

    def test_max_salience_at_max_multiplier(self):
        """Salience 1.0 → base × max_salience_multiplier."""
        base = 21.0  # trade_close base
        max_mult = 2.0  # EPISODIC max_salience_multiplier
        result = modulate_stability("custom:trade_close", 1.0)
        assert result is not None
        expected = base * max_mult
        assert abs(result - expected) < 0.5, f"Expected ~{expected}, got {result}"

    def test_disabled_section_returns_none(self):
        """SIGNALS section (salience_enabled=False) → None."""
        assert modulate_stability("custom:signal", 0.9) is None

    def test_procedural_higher_multiplier(self):
        """PROCEDURAL section has max_salience_multiplier=3.0."""
        base = 180.0  # playbook base
        result = modulate_stability("custom:playbook", 1.0)
        assert result is not None
        expected = base * 3.0
        assert abs(result - expected) < 1.0, f"Expected ~{expected}, got {result}"

    def test_result_is_rounded(self):
        """Modulated stability is rounded to 2 decimal places."""
        result = modulate_stability("custom:trade_close", 0.7)
        assert result is not None
        assert result == round(result, 2)

    def test_catastrophic_loss_example(self):
        """Verify the -10% loss example from Architecture Decisions table."""
        # trade_close: base=21, salience=1.0, max_mult=2.0 → 42.0
        salience = calculate_salience("custom:trade_close", {"pnl_pct": -10.0})
        result = modulate_stability("custom:trade_close", salience)
        assert result is not None
        assert result >= 38.0, f"Catastrophic loss should have stability ~42d, got {result}"


class TestClassifyIntent:
    """Tests for keyword-based intent classification (Issue 6)."""

    def test_signal_intent(self):
        result = classify_intent("what signals are firing right now?")
        assert MemorySection.SIGNALS in result

    def test_signal_intent_current(self):
        result = classify_intent("what's happening in the market right now?")
        assert MemorySection.SIGNALS in result

    def test_episodic_intent(self):
        result = classify_intent("what was my trade on ETH last week?")
        assert MemorySection.EPISODIC in result

    def test_episodic_intent_history(self):
        result = classify_intent("show me my trade history for BTC")
        assert MemorySection.EPISODIC in result

    def test_knowledge_intent(self):
        result = classify_intent("what lessons have I learned about funding rates?")
        assert MemorySection.KNOWLEDGE in result

    def test_knowledge_intent_thesis(self):
        result = classify_intent("what's my thesis on ETH?")
        assert MemorySection.KNOWLEDGE in result

    def test_procedural_intent(self):
        result = classify_intent("show me my playbook for funding squeezes")
        assert MemorySection.PROCEDURAL in result

    def test_procedural_intent_setup(self):
        result = classify_intent("what's my setup for momentum breakouts?")
        assert MemorySection.PROCEDURAL in result

    def test_multi_intent(self):
        result = classify_intent("what signals are firing and what lessons apply?")
        assert MemorySection.SIGNALS in result
        assert MemorySection.KNOWLEDGE in result

    def test_no_intent(self):
        result = classify_intent("ETH funding rate 0.15%")
        assert isinstance(result, list)

    def test_empty_query(self):
        result = classify_intent("")
        assert result == []

    def test_case_insensitive(self):
        result = classify_intent("WHAT SIGNALS ARE FIRING?")
        assert MemorySection.SIGNALS in result

    def test_watchpoint_maps_to_signals(self):
        result = classify_intent("what watchpoints do I have?")
        assert MemorySection.SIGNALS in result

    def test_missed_opportunity_maps_to_procedural(self):
        result = classify_intent("show me missed opportunity analysis")
        assert MemorySection.PROCEDURAL in result

    def test_all_sections_have_patterns(self):
        for section in MemorySection:
            assert section in _INTENT_PATTERNS, f"Missing patterns for {section}"
            assert len(_INTENT_PATTERNS[section]) >= 3, f"Too few patterns for {section}"
