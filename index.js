import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';

const { DISCORD_TOKEN, ANNOUNCEMENT_CHANNEL_ID } = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Each rule: if ANY "any" group matches, the message triggers a reply.
// A group matches when ALL its regexes hit.
const rules = [
  {
    name: 'account-creation',
    any: [
      // "account" with common typo "acount"
      [/\bac+ou?n+t\w*\b/i, /\b(creat|make|register|sign[\s-]?up|open)\w*\b/i],
      [/\b(website|page|site)\b/i, /\bac+ou?n+t\w*\b/i],
      [/\bcan'?t\b/i, /\b(register|sign[\s-]?up)\b/i],
    ],
  },
  {
    name: 'server-status',
    any: [
      [/\bserver\b/i, /\b(off|down|offline|dead|broken)\b/i],
      [/\b(web|website|site|page)\b/i, /\b(down|offline|problem|issue|broken|not working)\b/i],
      [/\bare\b/i, /\bproblems?\b/i, /\b(web|website|server|site)\b/i],
    ],
  },
];

const matchesRule = (content) =>
  rules.find((rule) => rule.any.some((group) => group.every((re) => re.test(content))));

// Avoid replying to the same user twice within this window (ms)
const COOLDOWN_MS = 5 * 60 * 1000;
const recentlyReplied = new Map();

const buildReply = () => {
  const channelMention = ANNOUNCEMENT_CHANNEL_ID
    ? `<#${ANNOUNCEMENT_CHANNEL_ID}>`
    : 'the announcements channel';
  return `Hi! It looks like you're asking about account creation or server status — please check ${channelMention} where this is covered. If your question isn't answered there, feel free to follow up here.`;
};

client.once('clientReady', (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content) return;

  const rule = matchesRule(message.content);
  if (!rule) return;

  const key = `${message.channelId}:${message.author.id}`;
  const last = recentlyReplied.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  recentlyReplied.set(key, Date.now());

  try {
    await message.reply({
      content: buildReply(),
      allowedMentions: { repliedUser: true },
    });
    console.log(`Replied to ${message.author.tag} (rule: ${rule.name})`);
  } catch (err) {
    console.error('Failed to reply:', err);
  }
});

client.login(DISCORD_TOKEN);
