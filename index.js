import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const {
  DISCORD_TOKEN,
  ANNOUNCEMENT_CHANNEL_ID,
  DATA_DIR = './data',
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment');
  process.exit(1);
}

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  replyText:
    "Hi! It looks like you're asking about account creation or server status — please check {channel} where this is covered. If your question isn't answered there, feel free to follow up here.",
  triggers: [
    { id: 1, keywords: [['account', 'acount'], ['create', 'make', 'register', 'signup', 'sign-up', 'open']] },
    { id: 2, keywords: [['account', 'acount'], ['website', 'page', 'site']] },
    { id: 3, keywords: [['server'], ['off', 'down', 'offline', 'dead', 'broken']] },
    { id: 4, keywords: [['web', 'website', 'site'], ['down', 'offline', 'problem', 'problems', 'issue', 'broken']] },
  ],
  ignores: [],
  nextTriggerId: 5,
  nextIgnoreId: 1,
};

let config = structuredClone(DEFAULT_CONFIG);

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const loaded = JSON.parse(raw);
    config = { ...DEFAULT_CONFIG, ...loaded };
    console.log(`Loaded config from ${CONFIG_PATH}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await saveConfig();
      console.log(`Seeded default config at ${CONFIG_PATH}`);
    } else {
      throw err;
    }
  }
}

async function saveConfig() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// "account|acount create|make" → [['account','acount'], ['create','make']]
function parseKeywords(input) {
  return input
    .trim()
    .split(/\s+/)
    .map((word) => word.split('|').map((s) => s.toLowerCase()).filter(Boolean))
    .filter((slot) => slot.length);
}

function formatKeywords(slots) {
  return slots.map((slot) => slot.join('|')).join(' ');
}

function slotMatches(message, slot) {
  return slot.some((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(message);
  });
}

function ruleMatches(message, rule) {
  return rule.keywords.every((slot) => slotMatches(message, slot));
}

function findTrigger(message) {
  if (config.ignores.some((r) => ruleMatches(message, r))) return null;
  return config.triggers.find((r) => ruleMatches(message, r)) ?? null;
}

function buildReply() {
  const channelMention = ANNOUNCEMENT_CHANNEL_ID
    ? `<#${ANNOUNCEMENT_CHANNEL_ID}>`
    : 'the announcements channel';
  return config.replyText.replaceAll('{channel}', channelMention);
}

const COOLDOWN_MS = 5 * 60 * 1000;
const recentlyReplied = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('trigger')
    .setDescription('Manage auto-reply triggers')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a trigger (all slots must match, use | for alternatives)')
        .addStringOption((o) =>
          o
            .setName('keywords')
            .setDescription('e.g. "account|acount create|make" — each word is a slot')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a trigger by ID')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('ID from /trigger list').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all triggers')),

  new SlashCommandBuilder()
    .setName('ignore')
    .setDescription('Manage ignore rules (suppress replies)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add an ignore rule — matching messages never get a reply')
        .addStringOption((o) =>
          o.setName('keywords').setDescription('Same format as triggers').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove an ignore rule by ID')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('ID from /ignore list').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all ignore rules')),

  new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Configure the reply message')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set reply text. Use {channel} to insert the announcement channel mention.')
        .addStringOption((o) => o.setName('text').setDescription('Reply text').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Show current reply text')),
].map((c) => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once('clientReady', async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    await c.application.commands.set(commands);
    console.log('Slash commands registered globally.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content) return;

  const trigger = findTrigger(message.content);
  if (!trigger) return;

  const key = `${message.channelId}:${message.author.id}`;
  const last = recentlyReplied.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  recentlyReplied.set(key, Date.now());

  try {
    await message.reply({
      content: buildReply(),
      allowedMentions: { repliedUser: true },
    });
    console.log(`Replied to ${message.author.tag} (trigger #${trigger.id})`);
  } catch (err) {
    console.error('Failed to reply:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const sub = interaction.options.getSubcommand();
  const ephemeral = { flags: MessageFlags.Ephemeral };

  try {
    if (commandName === 'trigger' || commandName === 'ignore') {
      const bucket = commandName === 'trigger' ? 'triggers' : 'ignores';
      const idKey = commandName === 'trigger' ? 'nextTriggerId' : 'nextIgnoreId';
      const label = commandName === 'trigger' ? 'Trigger' : 'Ignore rule';

      if (sub === 'add') {
        const keywords = parseKeywords(interaction.options.getString('keywords'));
        if (!keywords.length) {
          await interaction.reply({ content: 'No keywords provided.', ...ephemeral });
          return;
        }
        const id = config[idKey]++;
        config[bucket].push({ id, keywords });
        await saveConfig();
        await interaction.reply({
          content: `Added ${label.toLowerCase()} **#${id}** — \`${formatKeywords(keywords)}\``,
          ...ephemeral,
        });
      } else if (sub === 'remove') {
        const id = interaction.options.getInteger('id');
        const before = config[bucket].length;
        config[bucket] = config[bucket].filter((r) => r.id !== id);
        if (config[bucket].length === before) {
          await interaction.reply({ content: `No ${label.toLowerCase()} with ID ${id}.`, ...ephemeral });
          return;
        }
        await saveConfig();
        await interaction.reply({ content: `Removed ${label.toLowerCase()} **#${id}**.`, ...ephemeral });
      } else if (sub === 'list') {
        if (!config[bucket].length) {
          await interaction.reply({ content: `No ${label.toLowerCase()}s configured.`, ...ephemeral });
          return;
        }
        const lines = config[bucket].map(
          (r) => `**#${r.id}** — \`${formatKeywords(r.keywords)}\``,
        );
        await interaction.reply({
          content: `**${label}s:**\n${lines.join('\n')}`,
          ...ephemeral,
        });
      }
    } else if (commandName === 'reply') {
      if (sub === 'set') {
        config.replyText = interaction.options.getString('text');
        await saveConfig();
        await interaction.reply({ content: 'Reply text updated.', ...ephemeral });
      } else if (sub === 'show') {
        await interaction.reply({
          content: `**Current reply:**\n${config.replyText}`,
          ...ephemeral,
        });
      }
    }
  } catch (err) {
    console.error('Interaction failed:', err);
    const payload = { content: 'Something went wrong.', ...ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

await loadConfig();
await client.login(DISCORD_TOKEN);
