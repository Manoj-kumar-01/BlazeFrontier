const { Client, GatewayIntentBits } = require('discord.js');
const dotenv = require('dotenv');
dotenv.config();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

let isBotReady = false;

if (process.env.DISCORD_BOT_TOKEN) {
    client.login(process.env.DISCORD_BOT_TOKEN);
    client.once('clientReady', () => {
        // console.log('Discord Bot logged in successfully.');
        // console.log('Bot is currently in these servers (Guild IDs):', client.guilds.cache.map(g => g.id));
        isBotReady = true;
    });
} else {
    console.warn('DISCORD_BOT_TOKEN is missing. Discord verification will fail.');
}

const TARGET_GUILD_ID = '1513772783505506384';

client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== TARGET_GUILD_ID) return;

    try {
        const currentName = member.user.globalName || member.user.username;
        const newNickname = `BLZ ${currentName}`;
        const finalNickname = newNickname.substring(0, 32); // Discord max length is 32

        await member.setNickname(finalNickname, 'Auto-assigned BLZ prefix on join');
        console.log(`Assigned nickname "${finalNickname}" to new member ${member.user.username}`);
    } catch (error) {
        console.error(`Failed to assign nickname to ${member.user.username}:`, error);
        console.error('Note: The bot might need the "Manage Nicknames" permission and its role must be higher than the user\'s role.');
    }
});

async function verifyUserInServer(discordName) {
    if (!process.env.DISCORD_BOT_TOKEN || !isBotReady) {
        return { success: false, msg: "Server verification offline (No Bot Token). Please contact an admin." };
    }

    try {
        const guild = await client.guilds.fetch(TARGET_GUILD_ID);
        if (!guild) {
            return { success: false, msg: "Target Discord server not found by bot." };
        }

        const members = await guild.members.search({ query: discordName, limit: 10 });
        
        if (members.size > 0) {
            const cleanTarget = discordName.toLowerCase().trim();
            // Match against any name they might appear as in the server
            const match = members.find(m => 
                m.user.username.toLowerCase() === cleanTarget || 
                (m.nickname && m.nickname.toLowerCase() === cleanTarget) ||
                m.user.globalName?.toLowerCase() === cleanTarget
            );

            if (match) {
                return { success: true, msg: "Identity verified in server." };
            }
        }

        return { success: false, msg: "Identity not found in server. Please ensure you joined and typed your exact name." };

    } catch (err) {
        console.error("Discord verification error:", err);
        return { success: false, msg: "Error communicating with Discord API." };
    }
}

module.exports = {
    client,
    verifyUserInServer
};
