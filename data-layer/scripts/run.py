"""Entry point: python -m scripts.run"""

import signal
import sys

from hynous_data.main import Orchestrator


def main():
    orch = Orchestrator()

    def _signal_handler(sig, frame):
        orch.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    orch.start()


if __name__ == "__main__":
    main()
