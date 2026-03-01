#!/usr/bin/env bash
# Daily Artemis sync: process yesterday's data.
# Run via cron: 0 1 * * * /path/to/artemis_sync.sh
#
# Processes one day of Artemis data and updates satellite features.

set -euo pipefail

HYNOUS_ROOT="${HYNOUS_ROOT:-/root/hynous}"
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)

echo "=== Artemis Daily Sync: ${YESTERDAY} ==="

cd "$HYNOUS_ROOT"

python3 -c "
from datetime import date
from satellite.artemis.pipeline import process_single_day, ArtemisConfig
from hynous_data.core.db import Database
from satellite.store import SatelliteStore

# Connect to databases
dl_db = Database('storage/hynous-data.db')
dl_db.connect()

sat_store = SatelliteStore('storage/satellite.db')
sat_store.connect()

# Process yesterday
result = process_single_day(
    date_str='${YESTERDAY}',
    data_layer_db=dl_db,
    satellite_store=sat_store,
    config=ArtemisConfig(),
)

print(f'Done: {result.addresses_discovered} addresses, '
      f'{result.snapshots_reconstructed} snapshots, '
      f'{result.elapsed_seconds:.0f}s')

dl_db.close()
sat_store.close()
"

echo "=== Sync complete ==="
