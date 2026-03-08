"""Run all ML experiments and produce a combined scorecard.

Usage:
    python -m satellite.experiments.run_all --db storage/satellite.db
    python -m satellite.experiments.run_all --db storage/satellite.db --only exit_model,hold_duration
    python -m satellite.experiments.run_all --db storage/satellite.db --no-baseline  # faster, skip permutation
"""

import argparse
import importlib
import logging
import json
import time
from pathlib import Path

log = logging.getLogger(__name__)

EXPERIMENTS = [
    "exp_hold_duration",
    "exp_stop_survival",
    "exp_regime_transition",
    "exp_exit_model",
    "exp_funding_flip",
    "exp_vol_regime_shift",
    "exp_best_side",
    "exp_liq_cascade",
    "exp_fakeout",
    "exp_asymmetric_risk",
    "exp_exit_timing",
    "exp_squeeze",
]


def main():
    parser = argparse.ArgumentParser(description="Run all ML experiments")
    parser.add_argument("--db", default="storage/satellite.db")
    parser.add_argument("--coin", default="BTC")
    parser.add_argument("--data-db", default=None, help="Path to data-layer DB for v3+v4 feature enrichment")
    parser.add_argument("--only", default=None, help="Comma-separated experiment names to run")
    parser.add_argument("--no-baseline", action="store_true", help="Skip permutation baselines (faster)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    # Filter experiments if --only is specified
    experiments = EXPERIMENTS
    if args.only:
        only_set = set(args.only.split(","))
        experiments = [e for e in experiments if e.replace("exp_", "") in only_set]

    print("\n" + "=" * 70)
    print("ML EXPERIMENT SUITE")
    print(f"DB: {args.db}  |  Coin: {args.coin}")
    print(f"Running: {len(experiments)} experiments")
    print(f"Data DB: {args.data_db or 'NONE (v3+v4 features will be neutral)'}")
    print(f"Permutation baseline: {'SKIP' if args.no_baseline else 'ENABLED'}")
    print("=" * 70 + "\n")

    t0 = time.time()

    for exp_name in experiments:
        print(f"\n{'#' * 70}")
        print(f"# RUNNING: {exp_name}")
        print(f"{'#' * 70}\n")

        try:
            import sys
            original_argv = sys.argv
            sys.argv = [
                f"satellite.experiments.{exp_name}",
                "--db", args.db,
                "--coin", args.coin,
            ]
            if args.data_db:
                sys.argv.extend(["--data-db", args.data_db])
            if args.verbose:
                sys.argv.append("-v")
            if args.no_baseline:
                sys.argv.append("--no-baseline")

            mod = importlib.import_module(f"satellite.experiments.{exp_name}")
            mod.main()

            sys.argv = original_argv
        except SystemExit:
            log.warning("Experiment %s called sys.exit — skipping", exp_name)
            sys.argv = original_argv
            continue
        except Exception:
            log.exception("Experiment %s FAILED", exp_name)
            continue

    elapsed = time.time() - t0

    # Load all results and print scorecard
    results_dir = Path("satellite/experiments/results")
    if results_dir.exists():
        print("\n\n" + "=" * 90)
        print("EXPERIMENT SCORECARD")
        print("=" * 90)
        print(f"\n  {'Experiment':<25} {'Spearman':>10} {'±std':>7} {'Baseline':>9} {'Lift':>7} {'Sig':>5} {'Verdict':>10}")
        print("  " + "-" * 78)

        for result_file in sorted(results_dir.glob("*.json")):
            with open(result_file) as f:
                data = json.load(f)
            verdict = data.get("verdict", "???")
            marker = {"PASS": "+++", "MARGINAL": "~~~", "FAIL": "---"}.get(verdict, "???")
            sig = f"{data.get('significant_generations', 0)}/{data['generations']}"
            print(
                f"  {data['name']:<25} {data['avg_spearman']:>+10.4f} "
                f"{data.get('spearman_std', 0):>6.4f} "
                f"{data.get('baseline_spearman', 0):>+8.4f} "
                f"{data.get('lift_over_baseline', 0):>+6.4f} "
                f"{sig:>5} [{marker}] {verdict}"
            )

        print("\n  " + "-" * 78)
        print(f"  Total time: {elapsed:.0f}s ({elapsed/60:.1f}min)")
        print("=" * 90)

    print("\n  Verdict criteria:")
    print("    PASS:     Spearman >= 0.25 AND lift >= 0.10 AND majority gens significant (p<0.05)")
    print("    MARGINAL: Spearman >= 0.15 AND lift >= 0.05")
    print("    FAIL:     Below thresholds or unstable (std > mean)")
    print("  Only PASS models should be promoted to production training.\n")


if __name__ == "__main__":
    main()
