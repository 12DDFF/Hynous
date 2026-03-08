# ML Experiments — New Model Discovery

Each experiment trains and evaluates ONE new prediction target independently.
Run on VPS where `storage/satellite.db` exists.

## Pass/Fail Criteria
- **Spearman > 0.25** = viable signal, worth deploying
- **Spearman 0.15-0.25** = marginal, investigate feature engineering
- **Spearman < 0.15** = dead, discard (like direction prediction)

## Running
```bash
# Run a single experiment
python -m satellite.experiments.exp_hold_duration --db storage/satellite.db

# Run all experiments in parallel
for exp in hold_duration stop_survival regime_transition exit_model funding_flip vol_regime_shift; do
    python -m satellite.experiments.exp_${exp} --db storage/satellite.db &
done
wait
```

## Experiments

| # | Experiment | Target | Features | Expected Spearman |
|---|-----------|--------|----------|-------------------|
| 1 | hold_duration | Time (5m intervals) until ROE peaks | Same 14 market | 0.3-0.5 (vol correlates with duration) |
| 2 | stop_survival | Probability of SL hit at 0.3/0.5/1/2% | Same 14 market | 0.3-0.6 (MAE models already work) |
| 3 | regime_transition | Binary: regime changes within 4h | Same 14 market | 0.2-0.4 (untested, may fail) |
| 4 | exit_model | Hold vs exit at each checkpoint | 14 market + 5 position | 0.3-0.5 (simulated_exits data exists) |
| 5 | funding_flip | Binary: funding sign flips in 4h | Same 14 market | 0.2-0.4 (funding_4h already 0.3+) |
| 6 | vol_regime_shift | Vol regime changes within 4h | Same 14 market | 0.3-0.5 (vol models already strong) |
