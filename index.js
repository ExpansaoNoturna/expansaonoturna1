const { Client, GatewayIntentBits, Partials } = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

require("./systems/expansao.js")(client);

client.once("clientReady", () => {
  console.log(`✅ Logado como ${client.user.tag}`);
});

(async () => {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("❌ DISCORD_TOKEN não encontrado no .env");
    process.exit(1);
  }
  try {
    await client.login(token);
  } catch (err) {
    console.error(`❌ Falha ao logar: ${err.message}`);
    process.exit(1);
  }
})();