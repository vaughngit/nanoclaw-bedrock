/**
 * Slack integration for NanoClaw
 * Socket Mode connection using @slack/bolt — no public URL needed.
 */
import { App, type LogLevel } from '@slack/bolt';

import { SLACK_APP_TOKEN, SLACK_BOT_TOKEN } from './config.js';
import { storeChatMetadata, storeGenericMessage } from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

let app: App | null = null;

export interface SlackConnectOpts {
  registeredGroups: () => Record<string, RegisteredGroup>;
  onMessage: (channelId: string) => void;
}

/**
 * Check if a JID is a Slack channel ID.
 * Slack channel IDs start with C (public), D (DM), or G (group DM),
 * followed by uppercase alphanumeric characters, and never contain '@'.
 */
export function isSlackId(id: string): boolean {
  return /^[CDG][A-Z0-9]{8,}$/.test(id);
}

/**
 * Connect to Slack via Socket Mode and start listening for messages.
 */
export async function connectSlack(opts: SlackConnectOpts): Promise<void> {
  app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    socketMode: true,
    logger: {
      debug: (...msgs: string[]) => logger.debug(msgs.join(' ')),
      info: (...msgs: string[]) => logger.info(msgs.join(' ')),
      warn: (...msgs: string[]) => logger.warn(msgs.join(' ')),
      error: (...msgs: string[]) => logger.error(msgs.join(' ')),
      getLevel: () => 'INFO' as LogLevel,
      setLevel: () => {},
      setName: () => {},
    },
  });

  // Cache user display names to avoid repeated API calls
  const userNameCache = new Map<string, string>();

  async function resolveUserName(userId: string): Promise<string> {
    const cached = userNameCache.get(userId);
    if (cached) return cached;

    try {
      const result = await app!.client.users.info({ user: userId });
      const name =
        result.user?.profile?.display_name ||
        result.user?.real_name ||
        result.user?.name ||
        userId;
      userNameCache.set(userId, name);
      return name;
    } catch (err) {
      logger.debug({ userId, err }, 'Failed to resolve Slack user name');
      return userId;
    }
  }

  app.message(async ({ message }) => {
    // Only handle regular user messages (not bot messages, edits, etc.)
    if (message.subtype) return;
    if (!('text' in message) || !message.text) return;
    if (!('user' in message) || !message.user) return;

    const channelId = message.channel;
    const timestamp = new Date(
      parseFloat(message.ts) * 1000,
    ).toISOString();
    const senderName = await resolveUserName(message.user);

    // Store chat metadata for all channels (enables discovery)
    storeChatMetadata(channelId, timestamp, channelId);

    // Store full message content for registered channels
    const groups = opts.registeredGroups();
    if (groups[channelId]) {
      storeGenericMessage(
        message.ts,
        channelId,
        message.user,
        senderName,
        message.text,
        timestamp,
        false,
      );
      // Notify the message loop to process this channel
      opts.onMessage(channelId);
    }
  });

  await app.start();
  logger.info('Slack connected (Socket Mode)');
}

/**
 * Send a message to a Slack channel.
 */
export async function sendSlackMessage(
  channelId: string,
  text: string,
): Promise<void> {
  if (!app) {
    logger.error('Slack not connected, cannot send message');
    return;
  }
  try {
    await app.client.chat.postMessage({ channel: channelId, text });
    logger.info({ channelId, length: text.length }, 'Slack message sent');
  } catch (err) {
    logger.error({ channelId, err }, 'Failed to send Slack message');
  }
}

/**
 * Typing indicator for Slack — no-op since Bot API doesn't support it.
 */
export function setSlackTyping(_channelId: string, _isTyping: boolean): void {
  // Slack Bot API does not support typing indicators
}

/**
 * Gracefully disconnect from Slack.
 */
export async function disconnectSlack(): Promise<void> {
  if (app) {
    try {
      await app.stop();
      logger.info('Slack disconnected');
    } catch (err) {
      logger.warn({ err }, 'Error disconnecting Slack');
    }
    app = null;
  }
}
