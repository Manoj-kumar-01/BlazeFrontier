const User = require('../models/User');
const Match = require('../models/Match');

const resolvers = {
  Query: {
    // User Resolvers
    getUser: async (_, { id }) => {
      try {
        return await User.findById(id);
      } catch (err) {
        throw new Error(err);
      }
    },
    getUsers: async (_, { limit }) => {
      try {
        return await User.find().limit(limit || 50);
      } catch (err) {
        throw new Error(err);
      }
    },
    getTopCommanders: async (_, { limit }) => {
      try {
        return await User.find().sort({ blazeCoins: -1 }).limit(limit || 10);
      } catch (err) {
        throw new Error(err);
      }
    },

    // Match Resolvers
    getMatch: async (_, { id }) => {
      try {
        return await Match.findById(id).populate('playerId');
      } catch (err) {
        throw new Error(err);
      }
    },
    getMatchesByPlayer: async (_, { playerId }) => {
      try {
        return await Match.find({ playerId }).populate('playerId');
      } catch (err) {
        throw new Error(err);
      }
    },
    getLiveMatches: async () => {
      try {
        return await Match.find({ status: 'LIVE' }).populate('playerId');
      } catch (err) {
        throw new Error(err);
      }
    },

    // Dashboard
    getDashboardStats: async () => {
      try {
        const News = require('../models/News');
        const Tournament = require('../models/Tournament');
        const PlayerOfTheDay = require('../models/PlayerOfTheDay');
        const Registration = require('../models/Registration');
        const DailyContent = require('../models/DailyContent');

        let payload = null;
        if (global.graphqlStatsCache && (Date.now() - global.graphqlStatsCache.lastFetched < 5 * 60 * 1000)) {
            payload = { ...global.graphqlStatsCache.data };
        }

        if (!payload) {
            const activeCommanders = await User.countDocuments();
            
            const today = new Date();
            const tzOffset = today.getTimezoneOffset() * 60000;
            const localISOTime = new Date(today.getTime() - tzOffset).toISOString().split('T')[0];
            
            const todaysRegs = await Registration.find({
                startDate: localISOTime,
                status: { $in: ['Pending', 'Approved'] }
            });
            
            const uniqueSlots = new Set(todaysRegs.map(r => r.timeSlot).filter(Boolean));
            const matchesToday = `${uniqueSlots.size} / 5`;
            
            const load = Math.floor(Math.random() * (85 - 45 + 1) + 45);
            
            const activeTournaments = await Tournament.countDocuments({ status: 'ACTIVE' });
            const totalBPAgg = await Match.aggregate([{ $match: { status: 'COMPLETED' } }, { $group: { _id: null, total: { $sum: "$blazePoints" } } }]);
            const totalBP = totalBPAgg.length > 0 ? (totalBPAgg[0].total / 1000).toFixed(1) + 'K' : '0';
            
            let dailyContentRecord = await DailyContent.findOne();
            if (!dailyContentRecord) {
                dailyContentRecord = {
                    title: 'Daily Showcase',
                    youtubeLink: 'https://www.youtube.com/embed/live_stream?channel=UCYOURCHANNELID',
                    facebookLink: 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Ffacebook%2Fvideos%2F10153231379946729%2F&show_text=false'
                };
            }

            const formattedSeries = [
                {
                    id: 'main-broadcast',
                    game: 'DAILY HIGHLIGHTS',
                    name: dailyContentRecord.title,
                    status: 'NEW CONTENT',
                    isLive: true,
                    color: 'var(--blaze-orange)',
                    streamUrl: '/dashboard/content',
                    youtubeLink: dailyContentRecord.youtubeLink,
                    facebookLink: dailyContentRecord.facebookLink
                }
            ];
            
            const recentRegs = await Registration.find()
                .populate('userId', 'inGameName username')
                .sort({ createdAt: -1 })
                .limit(3);

            const recentTrusted = await User.find({ isGenuine: true })
                .sort({ createdAt: -1 })
                .limit(2);

            let dynamicNews = [];

            recentRegs.forEach(reg => {
                const playerName = reg.userId ? (reg.userId.inGameName || reg.userId.username) : 'A player';
                const action = reg.status === 'Approved' ? 'was APPROVED for' : 'REGISTERED for';
                dynamicNews.push({
                    tag: 'EVENT',
                    tagClass: 'event',
                    title: `${playerName.toUpperCase()} ${action} the ${reg.format.toUpperCase()} ${reg.mode.toUpperCase()} Qualification Series!`,
                    date: new Date(reg.createdAt).toLocaleDateString(),
                    timestamp: new Date(reg.createdAt).getTime()
                });
            });

            recentTrusted.forEach(user => {
                const playerName = user.inGameName || user.username;
                dynamicNews.push({
                    tag: 'UPDATE',
                    tagClass: 'update',
                    title: `${playerName.toUpperCase()} just became a TRUSTED PLAYER of BlazeFrontier!`,
                    date: new Date(user.createdAt).toLocaleDateString(),
                    timestamp: new Date(user.createdAt).getTime()
                });
            });

            const dbNews = await News.find().sort({ createdAt: -1 }).limit(2);
            dbNews.forEach(n => {
                dynamicNews.push({
                    tag: n.tag || 'ANNOUNCE',
                    tagClass: n.tagClass || 'announce',
                    title: n.title,
                    date: n.date || new Date(n.createdAt).toLocaleDateString(),
                    timestamp: new Date(n.createdAt).getTime() || Date.now()
                });
            });

            dynamicNews.sort((a, b) => b.timestamp - a.timestamp);
            dynamicNews = dynamicNews.slice(0, 5);

            const potdRecord = await PlayerOfTheDay.findOne({ isActive: true }).populate('userId', 'inGameName username playerId').lean();
            let potd = null;
            if (potdRecord && potdRecord.userId) {
                potd = {
                    videoUrl: potdRecord.videoUrl,
                    playerName: potdRecord.userId.inGameName || potdRecord.userId.username,
                    playerId: potdRecord.userId.playerId || 'N/A',
                    title: potdRecord.title,
                    isGenuine: potdRecord.userId.isGenuine || false
                };
            }
            
            payload = {
                serverLoad: `${load}%`,
                activeCommanders: activeCommanders.toLocaleString(),
                matchesToday: matchesToday,
                network: {
                    activeTournaments: activeTournaments || 0,
                    totalBCAwarded: totalBPAgg.length > 0 ? totalBP : '0',
                    region: 'IN-SOUTH',
                    latency: Math.floor(Math.random() * 15 + 15) + 'ms'
                },
                liveMatches: formattedSeries,
                news: dynamicNews,
                potd: potd
            };

            global.graphqlStatsCache = {
                data: payload,
                lastFetched: Date.now()
            };
        }

        const topPlayers = await User.find().sort({ blazeCoins: -1 }).limit(1).lean();
        const topPlayer = topPlayers.length > 0 ? topPlayers[0] : null;
        
        payload.topCommander = topPlayer ? {
            name: (topPlayer.inGameName || topPlayer.username).toUpperCase(),
            id: topPlayer.playerId || 'N/A',
            coins: topPlayer.blazeCoins || 0
        } : null;

        return payload;
      } catch (err) {
        throw new Error(err);
      }
    },
    
    // Global Nav Data
    getGlobalNavData: async (_, __, context) => {
        if (!context.user || !context.user.id) {
            throw new Error('Unauthorized');
        }
        
        try {
            const Registration = require('../models/Registration');
            const Notification = require('../models/Notification');

            const user = await User.findById(context.user.id);
            const tournaments = await Registration.find({ userId: context.user.id }).sort({ createdAt: -1 });
            const notifications = await Notification.find({ userId: context.user.id, isRead: false }).sort({ createdAt: -1 });
            
            return {
                user,
                tournaments: tournaments.map(t => ({
                    id: t._id,
                    game: t.game || 'N/A',
                    format: t.format || 'N/A',
                    mode: t.mode || 'N/A',
                    status: t.status,
                    date: t.startDate || new Date(t.createdAt).toLocaleDateString()
                })),
                notifications: notifications.map(n => ({
                    id: n._id,
                    title: n.title,
                    message: n.message,
                    type: n.type,
                    isRead: n.isRead,
                    createdAt: new Date(n.createdAt).toLocaleDateString()
                }))
            };
        } catch (err) {
            throw new Error(err);
        }
    }
  },
  
  // Resolve populated relationships correctly
  Match: {
    playerId: async (parent) => {
        // If it's already populated, return it directly
        if (parent.playerId && parent.playerId.username) {
            return parent.playerId;
        }
        // Otherwise, fetch the user
        return await User.findById(parent.playerId);
    }
  }
};

module.exports = resolvers;
