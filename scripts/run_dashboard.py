"""
Run Dashboard

Launch the Reflex dashboard.

Usage:
    python -m scripts.run_dashboard
    # or
    make dashboard
"""

import subprocess
import sys
from pathlib import Path


def main():
    """Launch the Reflex dashboard."""
    project_root = Path(__file__).parent.parent
    dashboard_dir = project_root / "dashboard"

    if not dashboard_dir.exists():
        print(f"Error: Dashboard directory not found at {dashboard_dir}")
        sys.exit(1)

    print("Starting Hynous Dashboard...")
    print(f"Directory: {dashboard_dir}")
    print("URL: http://localhost:3000")
    print("-" * 40)

    try:
        subprocess.run(["reflex", "run"], cwd=str(dashboard_dir), check=True)
    except KeyboardInterrupt:
        print("\nDashboard stopped.")
    except subprocess.CalledProcessError as e:
        print(f"Error running dashboard: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
