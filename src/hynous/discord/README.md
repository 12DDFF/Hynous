# Discord Module

> Chat relay, daemon notifications, and live stats panel via Discord.

---

## Structure

```
discord/
├── bot.py         # HynousDiscordBot client, start/stop lifecycle, notify functions
├── stats.py       # Stats embed builder (portfolio, positions, regime, performance)
└── __init__.py
```

---

## Three Capabilities

### 1. Chat Relay

Messages sent by an allowed user in the configured channel (or via DM) are forwarded to the shared Agent singleton via `agent.chat()`. The response is sent back to the same channel.

- Messages are prefixed with the sender's display name: `[David via Discord] <text>`
- A typing indicator is shown while the agent thinks and uses tools
- Long responses (>2000 chars) are split at line boundaries before sending

### 2. Daemon Notifications

When the daemon triggers a wake event (fills, watchpoints, reviews, scanner alerts, profit alerts, etc.), it can push the notification to Discord via the `notify()` function.

```python
from hynous.discord.bot import notify

# Called from daemon thread — schedules on the bot's event loop
notify(title="BTC SL Hit", wake_type="Trade", response="Closed BTC long at $96,400...")
```

There is also `notify_simple(message)` for plain-text messages without the header/formatting.

Both functions are thread-safe: they use `asyncio.run_coroutine_threadsafe()` to schedule onto the bot's dedicated event loop.

### 3. Stats Panel

The `!stats` command posts a rich Discord embed showing live portfolio data. The embed auto-updates every 30 seconds via `discord.ext.tasks.loop`.

The embed includes 7 sections (built in `stats.py`):

| Section | Source | Data |
|---------|--------|------|
| Portfolio | HyperliquidProvider | Account value, unrealized PnL, daily PnL, session % change |
| Positions | HyperliquidProvider | Coin, side, leverage, size, entry, PnL, return %, liquidation price, SL/TP |
| Regime | Daemon snapshot | Combined label, macro/micro scores, session, reversal flags, guidance |
| Market | Daemon snapshot | BTC/ETH/SOL prices, Fear & Greed index |
| Performance | trade_analytics | Win rate, avg win/loss, profit factor, total PnL |
| System | Daemon | Scanner status (pairs, anomalies, wakes), wake count, next review, circuit breaker |
| Footer | Config | Execution mode (PAPER/TESTNET/LIVE), refresh interval |

The stats embed uses zero Claude tokens. All data comes from provider HTTP calls and daemon snapshots.

---

## Configuration

In `config/default.yaml`:

```yaml
discord:
  enabled: true                              # Master switch
  channel_id: 1469952346028245097            # Notifications + chat
  stats_channel_id: 1469946713471975476      # Stats panel (falls back to channel_id)
  allowed_user_ids:                          # Only respond to these users
    - 1415781451474927657
    - 614868895643205639
```

The bot token is read from the `DISCORD_BOT_TOKEN` environment variable (mapped to `config.discord.token`).

---

## How It Starts

1. `start_bot(agent, config)` is called from the dashboard startup
2. A new `asyncio.AbstractEventLoop` is created (the dashboard owns the main loop via Reflex)
3. `HynousDiscordBot` is instantiated with the shared Agent singleton and config
4. The bot runs in a daemon thread named `hynous-discord`
5. `atexit.register(stop_bot)` ensures graceful shutdown
6. On `on_ready`, the bot resolves both `channel_id` and `stats_channel_id`, then starts the stats auto-update loop

---

## Message Handling Flow

```
Discord message
  │
  ├─ Ignore if from self (bot's own messages)
  │
  ├─ _is_allowed() check:
  │   ├─ User ID must be in allowed_user_ids (if set)
  │   ├─ DMs from allowed users: always OK
  │   └─ Channel messages: only in channel_id or stats_channel_id
  │
  ├─ "!stats" command → _post_stats() → build_stats_embed()
  │
  └─ Anything else → agent.chat(prefixed_message) → send response
```

---

## Integration with Agent

The bot holds a direct reference to the Agent singleton (`self.agent`). This means:

- Same memory context as the dashboard chat
- Same position state
- Same conversation history
- Tool calls work identically (market data, memory, trading)

The `agent.chat()` call runs in `asyncio.to_thread()` since the agent is synchronous and the bot is async.

---

## Module-Level Functions

| Function | Purpose |
|----------|---------|
| `start_bot(agent, config)` | Start bot in background thread. Returns `True` if started, `False` if disabled/already running |
| `stop_bot()` | Graceful shutdown (closes bot, clears globals) |
| `notify(title, wake_type, response)` | Send formatted daemon notification (thread-safe) |
| `notify_simple(message)` | Send plain-text message (thread-safe) |
| `get_bot()` | Get running `HynousDiscordBot` instance or `None` |

---

Last updated: 2026-03-01
