"""
Discord Bot — Chat Relay + Daemon Notifications

Runs alongside the dashboard in a background thread with its own asyncio
event loop. Shares the same Agent singleton — same memory, same positions,
same conversation context.

Three capabilities:
  1. Chat relay: David sends a message → agent.chat() → response back
  2. Daemon notifications: fills, watchpoints, reviews → auto-posted to channel
  3. Stats panel: !stats → live-updating embed (edits every 30s)

Usage:
    from hynous.discord.bot import start_bot, stop_bot
    start_bot(agent, config)  # Background thread
    stop_bot()                # Graceful shutdown
"""

import asyncio
import atexit
import logging
import threading

import discord
from discord.ext import tasks

logger = logging.getLogger(__name__)


# ================================================================
# Bot Client
# ================================================================

class HynousDiscordBot(discord.Client):
    """Discord client that relays messages to the Hynous agent."""

    def __init__(self, agent, config, intents):
        super().__init__(intents=intents)
        self.agent = agent
        self.config = config
        self._channel: discord.TextChannel | None = None
        self._stats_channel: discord.TextChannel | None = None
        self._stats_message: discord.Message | None = None

    async def on_ready(self):
        channel_id = self.config.discord.channel_id
        if channel_id:
            self._channel = self.get_channel(channel_id)
            if self._channel:
                logger.info("Discord bot ready as %s (channel: #%s)",
                            self.user, self._channel.name)
            else:
                logger.warning("Discord bot ready but channel %d not found", channel_id)
        else:
            logger.info("Discord bot ready as %s (no notification channel set)", self.user)

        # Resolve stats channel (falls back to main channel)
        stats_id = self.config.discord.stats_channel_id
        if stats_id:
            self._stats_channel = self.get_channel(stats_id)
            if self._stats_channel:
                logger.info("Stats channel: #%s", self._stats_channel.name)
            else:
                logger.warning("Stats channel %d not found, using main channel", stats_id)
                self._stats_channel = self._channel
        else:
            self._stats_channel = self._channel

        # Start the stats auto-update loop
        if not self._update_stats.is_running():
            self._update_stats.start()

    async def on_message(self, message: discord.Message):
        # Ignore own messages
        if message.author == self.user:
            return

        # Filter: only respond to allowed user in allowed channel/DMs
        if not self._is_allowed(message):
            return

        user_text = message.content.strip()
        if not user_text:
            return

        # Stats command — post/refresh in the stats channel
        if user_text.lower() == "!stats":
            target = self._stats_channel or message.channel
            try:
                await self._post_stats(target)
            except discord.Forbidden:
                await message.channel.send("I don't have permission to post in the stats channel.")
            except Exception as e:
                logger.error("Stats command failed: %s", e)
                await message.channel.send(f"Stats error: {e}")
            return

        # Prefix with sender name so the agent knows who's talking
        sender = message.author.display_name
        prefixed = f"[{sender} via Discord] {user_text}"

        # Show typing indicator while agent thinks + uses tools
        try:
            async with message.channel.typing():
                response = await asyncio.to_thread(self.agent.chat, prefixed)
        except Exception as e:
            logger.error("Discord chat error: %s", e)
            response = "Something went wrong on my end. Give me a moment and try again."

        await self._send_chunked(message.channel, response)

    def _is_allowed(self, message: discord.Message) -> bool:
        """Check if this message should be handled.

        Rules:
        - If allowed_user_id is set, only that user can interact
        - DMs from allowed user: always OK
        - Channel messages: only in the configured channel
        """
        cfg = self.config.discord

        # User filter
        if cfg.allowed_user_ids and message.author.id not in cfg.allowed_user_ids:
            return False

        # DMs are always allowed (if user check passed)
        if isinstance(message.channel, discord.DMChannel):
            return True

        # Channel filter — respond in main channel and stats channel
        allowed_channels = {cfg.channel_id, cfg.stats_channel_id} - {0}
        if allowed_channels and message.channel.id not in allowed_channels:
            return False

        return True

    async def send_notification(self, title: str, wake_type: str, response: str):
        """Send a daemon wake notification to the configured channel."""
        if not self._channel:
            return

        header = f"**{wake_type}: {title}**"
        full = f"> {header}\n\n{response}"
        await self._send_chunked(self._channel, full)

    @staticmethod
    async def _send_chunked(channel, text: str, limit: int = 2000):
        """Send text to a channel, splitting at line boundaries if >2000 chars."""
        if len(text) <= limit:
            await channel.send(text)
            return

        chunks = []
        current = ""
        for line in text.split("\n"):
            candidate = current + "\n" + line if current else line
            if len(candidate) > limit:
                if current:
                    chunks.append(current)
                # Handle single lines longer than limit
                while len(line) > limit:
                    chunks.append(line[:limit])
                    line = line[limit:]
                current = line
            else:
                current = candidate
        if current:
            chunks.append(current)

        for chunk in chunks:
            if chunk.strip():
                await channel.send(chunk)

    # ================================================================
    # Stats Panel
    # ================================================================

    async def _post_stats(self, channel: discord.TextChannel):
        """Post a new stats embed (or refresh existing one)."""
        embed = await asyncio.to_thread(self._build_embed)
        if embed is None:
            await channel.send("Could not build stats embed.")
            return

        # Delete old stats message if it exists
        if self._stats_message:
            try:
                await self._stats_message.delete()
            except discord.NotFound:
                pass

        self._stats_message = await channel.send(embed=embed)

    def _build_embed(self) -> "discord.Embed | None":
        """Build the stats embed from live data (sync, runs in executor)."""
        try:
            from .stats import build_stats_embed
            from ..data.providers.hyperliquid import get_provider
            from ..intelligence.daemon import get_active_daemon

            provider = get_provider()
            daemon = get_active_daemon()
            return build_stats_embed(provider, daemon, self.config)
        except Exception as e:
            logger.error("Stats embed build failed: %s", e)
            return None

    @tasks.loop(seconds=30)
    async def _update_stats(self):
        """Edit the stats message every 30s with fresh data."""
        if self._stats_message is None:
            return

        embed = await asyncio.to_thread(self._build_embed)
        if embed is None:
            return

        try:
            await self._stats_message.edit(embed=embed)
        except discord.NotFound:
            self._stats_message = None
        except Exception as e:
            logger.debug("Stats update failed: %s", e)

    @_update_stats.before_loop
    async def _before_stats(self):
        await self.wait_until_ready()


# ================================================================
# Module-Level Bot Management
# ================================================================

_bot: HynousDiscordBot | None = None
_thread: threading.Thread | None = None
_loop: asyncio.AbstractEventLoop | None = None


def start_bot(agent, config) -> bool:
    """Start the Discord bot in a background thread.

    The bot gets its own asyncio event loop because the dashboard (Reflex)
    owns the main event loop. discord.py is fully async, so it needs its
    own loop running in a daemon thread.

    Returns True if started, False if disabled or already running.
    """
    global _bot, _thread, _loop

    if _bot is not None:
        return True  # Already running

    if not config.discord.enabled:
        return False

    token = config.discord.token
    if not token:
        logger.warning("Discord bot enabled but DISCORD_BOT_TOKEN not set")
        return False

    intents = discord.Intents.default()
    intents.message_content = True

    _bot = HynousDiscordBot(agent, config, intents)
    _loop = asyncio.new_event_loop()

    def _run():
        asyncio.set_event_loop(_loop)
        try:
            _loop.run_until_complete(_bot.start(token))
        except Exception as e:
            logger.error("Discord bot crashed: %s", e)

    _thread = threading.Thread(target=_run, daemon=True, name="hynous-discord")
    _thread.start()
    atexit.register(stop_bot)
    logger.info("Discord bot thread started")
    return True


def stop_bot():
    """Gracefully stop the Discord bot."""
    global _bot, _thread, _loop

    if _bot and _loop:
        try:
            future = asyncio.run_coroutine_threadsafe(_bot.close(), _loop)
            future.result(timeout=10)
        except Exception as e:
            logger.debug("Discord bot shutdown: %s", e)

    _bot = None
    _thread = None
    _loop = None


def notify(title: str, wake_type: str, response: str):
    """Send a daemon notification to Discord (thread-safe).

    Called from the daemon thread. Schedules the coroutine
    on the Discord bot's event loop via run_coroutine_threadsafe.
    """
    if _bot is None or _loop is None:
        return

    try:
        asyncio.run_coroutine_threadsafe(
            _bot.send_notification(title, wake_type, response),
            _loop,
        )
    except Exception as e:
        logger.debug("Discord notify failed: %s", e)


def get_bot() -> HynousDiscordBot | None:
    """Get the running bot instance."""
    return _bot
