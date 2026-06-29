const typeDefs = `#graphql
  type User {
    id: ID!
    playerId: String!
    username: String!
    email: String
    tourneysWon: Int
    location: String
    gameUid: String
    inGameName: String
    profilePic: String
    isSetupComplete: Boolean
    isAdmin: Boolean
    isBanned: Boolean
    role: String
    blazeCoins: Int
    firstLoginClaimed: Boolean
    lastLoginClaimDate: String
    trustedPlayerClaimed: Boolean
    isGenuine: Boolean
    hasCompletedTwoSeries: Boolean
    createdAt: String
  }

  type Match {
    id: ID!
    seriesId: ID
    matchNumber: Int
    playerId: User
    team: String
    slot: String
    format: String
    mode: String
    kills: Int
    survivalTimeMinutes: Int
    placement: Int
    blazePoints: Int
    isCompleted: Boolean
    status: String
    startTime: String
  }

  type TopCommander {
    name: String
    id: String
    coins: Int
  }

  type NetworkStats {
    activeTournaments: Int
    totalBCAwarded: String
    region: String
    latency: String
  }

  type LiveMatchItem {
    id: String
    game: String
    name: String
    status: String
    isLive: Boolean
    color: String
    streamUrl: String
    youtubeLink: String
    facebookLink: String
  }

  type NewsItem {
    tag: String
    tagClass: String
    title: String
    date: String
    timestamp: Float
  }

  type PotdItem {
    videoUrl: String
    playerName: String
    playerId: String
    title: String
    isGenuine: Boolean
  }

  type DashboardStats {
    topCommander: TopCommander
    serverLoad: String
    activeCommanders: String
    matchesToday: String
    network: NetworkStats
    liveMatches: [LiveMatchItem]
    news: [NewsItem]
    potd: PotdItem
  }

  type TournamentRegistration {
    id: ID!
    game: String
    format: String
    mode: String
    status: String
    date: String
  }

  type NotificationItem {
    id: ID!
    title: String
    message: String
    type: String
    isRead: Boolean
    createdAt: String
  }

  type GlobalNavData {
    user: User
    tournaments: [TournamentRegistration]
    notifications: [NotificationItem]
  }

  type Query {
    # Users
    getUser(id: ID!): User
    getUsers(limit: Int): [User]
    getTopCommanders(limit: Int): [User]
    
    # Matches
    getMatch(id: ID!): Match
    getMatchesByPlayer(playerId: ID!): [Match]
    getLiveMatches: [Match]
    
    # Dashboard
    getDashboardStats: DashboardStats
    
    # Global Nav Data
    getGlobalNavData: GlobalNavData
  }
`;

module.exports = typeDefs;
