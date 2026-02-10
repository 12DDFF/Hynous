"""Tests for the gate filter module (MF-15)."""

import pytest

from hynous.intelligence.gate_filter import (
    GateResult,
    check_content,
    _is_gibberish,
    _shannon_entropy,
    _matches_spam,
    _is_social_only,
    MIN_CONTENT_LENGTH,
)


class TestCheckContent:
    """Tests for the main check_content function."""

    # --- R-001: Too short ---

    def test_rejects_empty_string(self):
        result = check_content("")
        assert not result.passed
        assert result.reason == "too_short"

    def test_rejects_very_short_content(self):
        result = check_content("hi")
        assert not result.passed
        assert result.reason == "too_short"

    def test_rejects_whitespace_only(self):
        result = check_content("   \t\n   ")
        assert not result.passed
        assert result.reason == "too_short"

    def test_rejects_content_below_threshold(self):
        result = check_content("short txt")  # 9 chars
        assert not result.passed
        assert result.reason == "too_short"

    def test_passes_content_at_threshold(self):
        result = check_content("good stuff")  # 10 chars
        assert result.passed

    # --- R-002: Gibberish ---

    def test_passes_normal_english_text(self):
        result = check_content("Hello, how are you today? I need help with something.")
        assert result.passed

    def test_passes_technical_content(self):
        result = check_content("BTC funding rate dropped to -0.01% with OI increasing by 5%")
        assert result.passed

    # --- R-003: Spam patterns ---

    def test_rejects_test_content(self):
        # "testtesttesting" is 15 chars (passes R-001) and matches ^(test|testing)+$
        result = check_content("testtesttesting")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_rejects_asdf_content(self):
        result = check_content("asdfasdfasdf")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_rejects_marketing_spam(self):
        result = check_content("Buy now and save on this limited offer!")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_rejects_number_only_content(self):
        result = check_content("123-456-7890")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_rejects_digits_only(self):
        result = check_content("1234567890")
        assert not result.passed
        assert result.reason == "spam_pattern"

    def test_passes_numbers_in_context(self):
        result = check_content("BTC price is $68,500 with funding at 0.01%")
        assert result.passed

    # --- R-004: Repeated characters ---

    def test_rejects_repeated_chars(self):
        # R-003's (.{1,3})\1{5,} catches repeated single chars before R-004,
        # so we just verify rejection (matching TypeScript test approach).
        result = check_content("This is greaaaaaaaaaaat")
        assert not result.passed
        # Caught by spam_pattern (repeated group) or repeated_chars — both valid
        assert result.reason in ("spam_pattern", "repeated_chars")

    def test_repeated_chars_regex_directly(self):
        from hynous.intelligence.gate_filter import REPEATED_CHARS_RE
        assert REPEATED_CHARS_RE.search("aaaaaaaaaaaa")   # 12 a's → match
        assert not REPEATED_CHARS_RE.search("hello")       # no repeats → no match

    def test_passes_normal_repetition(self):
        result = check_content("This is really good stuff here")
        assert result.passed

    # --- R-005: Pure filler ---

    def test_rejects_pure_filler_content(self):
        result = check_content("um like basically yeah so anyway hmm")
        assert not result.passed
        assert result.reason == "pure_filler"

    def test_passes_filler_mixed_with_substance(self):
        result = check_content("so basically BTC is showing a bullish divergence on the 4h chart")
        assert result.passed

    def test_skips_filler_check_for_short_messages(self):
        # < 5 words — filler check doesn't apply
        result = check_content("um like yeah okay")
        # Should NOT be rejected for filler (only 4 words, below MIN_WORDS_FOR_FILLER)
        if not result.passed:
            assert result.reason != "pure_filler"

    # --- R-006: Empty semantic ---

    def test_rejects_emoji_only(self):
        # Use 10 different emojis (10 chars) to pass R-001 threshold, avoid R-003
        # repeated pattern, and trigger R-006 (empty semantic)
        result = check_content("\U0001F600\U0001F389\U0001F525\U0001F4AF\U0001F680\U00002728\U0001F38A\U0001F4AB\U0001F31F\U00002B50")
        assert not result.passed
        assert result.reason == "empty_semantic"

    def test_rejects_punctuation_only(self):
        result = check_content("!!!...???!!!")
        assert not result.passed
        assert result.reason == "empty_semantic"

    def test_passes_text_with_emoji(self):
        result = check_content("Great analysis on BTC \U0001F680\U0001F680")
        assert result.passed

    # --- R-008: Social only ---

    def test_rejects_hello(self):
        # "How are you?" = 12 chars (passes R-001), matches social pattern
        result = check_content("How are you?")
        assert not result.passed
        assert result.reason == "social_only"

    def test_rejects_thanks(self):
        result = check_content("Thank you!")
        assert not result.passed
        assert result.reason == "social_only"

    def test_rejects_goodbye(self):
        result = check_content("Goodbye!!!")
        assert not result.passed
        assert result.reason == "social_only"

    def test_rejects_good_morning(self):
        result = check_content("Good morning!")
        assert not result.passed
        assert result.reason == "social_only"

    def test_short_social_caught_by_too_short_first(self):
        # "ok" is < 10 chars, so it's caught by too_short before social_only
        result = check_content("ok")
        assert not result.passed
        assert result.reason == "too_short"

    def test_passes_greeting_with_substance(self):
        result = check_content("Hello, I need to analyze the BTC funding rate divergence")
        assert result.passed

    # --- PASS cases (legitimate content) ---

    def test_passes_meaningful_lesson(self):
        result = check_content(
            "Funding rate inversions that persist for more than 4 hours "
            "during low volume periods tend to resolve with a 2-3% move "
            "in the direction opposite to the crowded side."
        )
        assert result.passed

    def test_passes_thesis(self):
        result = check_content(
            "BTC is setting up for a short squeeze. Funding has been negative "
            "for 12 hours, OI is rising, and we just bounced off the 200 EMA "
            "on the 4h with strong bid walls at 67K."
        )
        assert result.passed

    def test_passes_episode(self):
        result = check_content(
            "BTC dropped 5% in 2 hours after a cascade of liquidations "
            "triggered by a large sell wall at 70K being swept."
        )
        assert result.passed

    def test_passes_signal_content(self):
        result = check_content(
            "BTC funding: -0.015%, OI: $18.2B (+3%), Fear/Greed: 35, "
            "24h volume: $42B, dominance: 54.2%"
        )
        assert result.passed

    def test_passes_watchpoint_content(self):
        result = check_content(
            "Alert me if BTC funding drops below -0.05% — that would signal "
            "extreme short crowding and a potential squeeze setup."
        )
        assert result.passed

    def test_passes_long_content(self):
        result = check_content("This is a detailed analysis. " * 50)
        assert result.passed


class TestHelpers:
    """Tests for individual helper functions."""

    def test_shannon_entropy_empty(self):
        assert _shannon_entropy("") == 0.0

    def test_shannon_entropy_single_char(self):
        assert _shannon_entropy("aaaa") == 0.0

    def test_shannon_entropy_varied_higher(self):
        low = _shannon_entropy("aaaa")
        high = _shannon_entropy("abcd")
        assert high > low

    def test_is_gibberish_normal_text(self):
        assert not _is_gibberish("Hello, how are you today?")

    def test_is_gibberish_common_words(self):
        assert not _is_gibberish("the cat is on the mat and it is sleeping")

    def test_matches_spam_test(self):
        assert _matches_spam("test")
        assert _matches_spam("testing")
        assert _matches_spam("asdf")

    def test_matches_spam_marketing(self):
        assert _matches_spam("Click here for more info")
        assert _matches_spam("Buy now while supplies last")

    def test_matches_spam_repeated(self):
        assert _matches_spam("hahahahahahahahahaha")

    def test_matches_spam_normal_text(self):
        assert not _matches_spam("I need to buy groceries tomorrow")

    def test_is_social_only_greetings(self):
        assert _is_social_only("hi")
        assert _is_social_only("hello!")
        assert _is_social_only("hey")
        assert _is_social_only("Hello?")

    def test_is_social_only_thanks(self):
        assert _is_social_only("thanks")
        assert _is_social_only("thank you!")
        assert _is_social_only("ty")

    def test_is_social_only_with_substance(self):
        assert not _is_social_only("Hello, I need help with BTC analysis")

    def test_is_social_only_case_insensitive(self):
        assert _is_social_only("HELLO!")
        assert _is_social_only("Thanks!")
        assert _is_social_only("YEP")


class TestGateResult:
    """Tests for the GateResult dataclass."""

    def test_passed_result(self):
        result = GateResult(passed=True, reason="pass", detail="")
        assert result.passed
        assert result.reason == "pass"

    def test_rejected_result(self):
        result = GateResult(passed=False, reason="too_short", detail="Content too short.")
        assert not result.passed
        assert result.reason == "too_short"
        assert "too short" in result.detail.lower()

    def test_frozen(self):
        result = GateResult(passed=True, reason="pass", detail="")
        with pytest.raises(AttributeError):
            result.passed = False  # type: ignore
