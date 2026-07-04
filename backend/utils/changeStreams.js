const mongoose = require('mongoose');
const agenda = require('./queue');
const { sendAnnouncement } = require('../discordBot');

const ANNOUNCEMENT_CHANNEL_ID = '1513788275196690454'; // Or use process.env.DISCORD_ANNOUNCEMENT_CHANNEL

function initChangeStreams() {
    console.log('Initializing MongoDB Change Streams...');
    const User = require('../models/User');

    let userStream;
    try {
        userStream = User.watch([
            { 
                $match: { 
                    'operationType': 'update',
                    'updateDescription.updatedFields.isGenuine': true
                } 
            }
        ]);
    } catch (err) {
        console.warn('[ChangeStream] Failed to initialize (Requires MongoDB Replica Set):', err.message);
        return; // Fallback to manual methods if not supported
    }

    userStream.on('change', async (change) => {
        try {
            console.log('[ChangeStream] Detected isGenuine=true for user', change.documentKey._id);
            const userId = change.documentKey._id;
            const user = await User.findById(userId);
            if (!user) return;

            // Only trigger if we haven't already claimed the reward to avoid duplicates
            if (!user.trustedPlayerClaimed) {
                user.trustedPlayerClaimed = true;
                user.blazeCoins = (user.blazeCoins || 0) + 100;
                await user.save(); // Note: This will trigger another update, but isGenuine won't be in updatedFields, so it won't loop

                // 1. In-App Notification
                agenda.now('send-inapp-notification', {
                    userId: user._id,
                    title: '🎉 You are now a Trusted Player!',
                    message: `Your recent matches have been verified! You have been granted the Trusted Player Golden Banner and 100 BlazeCoins!`,
                    type: 'success'
                });

                // 2. Email Notification
                if (user.email) {
                    agenda.now('send-email', {
                        email: user.email,
                        subject: 'You are now a Trusted Player! - Blaze Frontier',
                        html: `
                            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                                <div style="text-align: center; background-color: #111; padding: 20px;">
                                    <img src="cid:trusted_member.jpg" alt="Trusted Member Verified" style="max-width: 100%; border-radius: 12px; display: block; margin: 0 auto;">
                                </div>
                                <div style="padding: 30px; text-align: left;">
                                    <h2 style="color: #ff4e00; margin-top: 0;">Account Upgraded</h2>
                                    <p style="font-size: 1.1rem; color: #333;">Hello <strong>${user.inGameName || user.username}</strong>,</p>
                                    <p style="font-size: 1.1rem; line-height: 1.6; color: #333;">Your recent matches were verified by the admin team. You are now officially a <strong>Trusted Player</strong> in Blaze Frontier.</p>
                                    <div style="background-color: #f1f1f1; padding: 15px; border-left: 4px solid #ff4e00; margin: 20px 0;">
                                        <p style="margin: 0 0 10px 0;"><strong>Rewards Unlocked:</strong></p>
                                        <ul style="margin: 0; padding-left: 20px;">
                                            <li>Golden Trusted Player Banner</li>
                                            <li>100 BlazeCoins</li>
                                            <li>Access to Elite Tournaments</li>
                                        </ul>
                                    </div>
                                </div>
                                <div style="background-color: #111; padding: 15px; text-align: center;">
                                    <p style="color: #ff4e00; font-weight: bold; letter-spacing: 1px; margin: 0;">- The Blaze Frontier Team</p>
                                </div>
                            </div>
                        `,
                        attachments: [
                            {
                                filename: 'trusted_member.jpg',
                                path: require('path').join(__dirname, '../../public/trusted_member.jpg')
                            }
                        ]
                    });
                }

                // 3. Platform Update (Discord)
                sendAnnouncement(ANNOUNCEMENT_CHANNEL_ID, `🎉 **Platform Update!** 🎉\n\nPlease welcome **${user.inGameName || user.username}** as our newest verified **Trusted Player**!\nThey have earned their Golden Banner and unlocked access to Elite Tournaments. Welcome to the top tiers of Blaze Frontier! 🏆✨`);

                // 4. Socket Platform Update (Frontend Refresh)
                try {
                    const app = require('../server').app;
                    if (app) {
                        const io = app.get('io');
                        if (io) {
                            io.to(user._id.toString()).emit('platformUpdate', { 
                                msg: 'Your account was just verified as a Trusted Player! Please refresh the page.' 
                            });
                        }
                    }
                } catch(e) {}
                
                // Clear Cache
                global.graphqlStatsCache = null;
                if (global.clearApiStatsCache) global.clearApiStatsCache();
            }
        } catch (err) {
            console.error('[ChangeStream Error]', err);
        }
    });

    userStream.on('error', err => {
        console.error('[ChangeStream Error]', err);
    });
}

module.exports = initChangeStreams;
