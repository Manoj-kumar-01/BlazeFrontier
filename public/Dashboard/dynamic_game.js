document.addEventListener('DOMContentLoaded', async () => {
    // Determine which game we are on based on the path
    const path = window.location.pathname;
    let gameId = 'minimilitia'; // default
    if (path.includes('freefire')) gameId = 'freefire';
    else if (path.includes('cod')) gameId = 'cod';

    try {
        // Fetch Overview Stats
        const overviewRes = await fetch(`/api/game/${gameId}/overview`);
        if (overviewRes.ok) {
            const overview = await overviewRes.json();
            
            // Inject into Overview Stats container if it exists
            const statsContainer = document.querySelector('.game-overview-stats');
            if (statsContainer) {
                statsContainer.innerHTML = `
                    <div class="game-stat-card">
                        <div class="gsc-icon">🎖️</div>
                        <div class="gsc-label">COMMANDERS</div>
                        <div class="gsc-value" style="color: #cd7f32;">${overview.activeCommanders}</div>
                        <div class="gsc-sub">Live active players</div>
                    </div>
                    <div class="game-stat-card">
                        <div class="gsc-icon">💥</div>
                        <div class="gsc-label">LIVE NOW</div>
                        <div class="gsc-value" style="color: #fff;">${overview.liveMatches}</div>
                        <div class="gsc-sub">Matches currently ongoing</div>
                    </div>
                    <div class="game-stat-card">
                        <div class="gsc-icon">🏆</div>
                        <div class="gsc-label">TOURNAMENTS</div>
                        <div class="gsc-value" style="color: #cd7f32;">${overview.activeTournaments}</div>
                        <div class="gsc-sub">Active & upcoming events</div>
                    </div>
                    <div class="game-stat-card">
                        <div class="gsc-icon">⏱️</div>
                        <div class="gsc-label">AVG MATCH</div>
                        <div class="gsc-value" style="color: #fff;">${overview.avgMatchLength}</div>
                        <div class="gsc-sub">Intense pace</div>
                    </div>
                `;
            }
        }

        // Fetch Leaderboard
        const lbRes = await fetch(`/api/game/${gameId}/leaderboard`);
        if (lbRes.ok) {
            const leaderboard = await lbRes.json();
            
            // Handle Podium
            const podiumContainer = document.querySelector('.lb-podium');
            if (podiumContainer && leaderboard.length >= 3) {
                podiumContainer.innerHTML = `
                    <!-- Rank 2 -->
                    <div class="lb-podium-card glass-lb-panel rank-2">
                        <div class="lb-podium-avatar">
                            <div class="avatar-ring">
                                <div class="avatar-initials">${leaderboard[1].initials}</div>
                            </div>
                            <span class="lb-rank-badge">#2</span>
                        </div>
                        <div class="lb-podium-name">${leaderboard[1].name}</div>
                        <div class="lb-podium-tier" style="color: #cd7f32;">${leaderboard[1].tier}</div>
                        <div class="lb-podium-rp">
                            <span class="rp-value">${leaderboard[1].rp}</span>
                            <span class="rp-label">PTS</span>
                        </div>
                        <div class="lb-rp-bar"><div class="rp-fill" style="width: ${leaderboard[1].percent}%"></div></div>
                    </div>

                    <!-- Rank 1 -->
                    <div class="lb-podium-card glass-lb-panel rank-1">
                        <div class="lb-podium-avatar">
                            <span class="crown-icon">👑</span>
                            <div class="avatar-ring">
                                <div class="avatar-initials">${leaderboard[0].initials}</div>
                            </div>
                            <span class="lb-rank-badge">#1</span>
                        </div>
                        <div class="lb-podium-name">${leaderboard[0].name}</div>
                        <div class="lb-podium-tier" style="color: var(--gold);">${leaderboard[0].tier}</div>
                        <div class="lb-podium-rp">
                            <span class="rp-value">${leaderboard[0].rp}</span>
                            <span class="rp-label">PTS</span>
                        </div>
                        <div class="lb-rp-bar"><div class="rp-fill" style="width: ${leaderboard[0].percent}%"></div></div>
                    </div>

                    <!-- Rank 3 -->
                    <div class="lb-podium-card glass-lb-panel rank-3">
                        <div class="lb-podium-avatar">
                            <div class="avatar-ring">
                                <div class="avatar-initials">${leaderboard[2].initials}</div>
                            </div>
                            <span class="lb-rank-badge">#3</span>
                        </div>
                        <div class="lb-podium-name">${leaderboard[2].name}</div>
                        <div class="lb-podium-tier" style="color: #cd7f32;">${leaderboard[2].tier}</div>
                        <div class="lb-podium-rp">
                            <span class="rp-value">${leaderboard[2].rp}</span>
                            <span class="rp-label">PTS</span>
                        </div>
                        <div class="lb-rp-bar"><div class="rp-fill" style="width: ${leaderboard[2].percent}%"></div></div>
                    </div>
                `;
            }

            // Handle List (Rank 4+)
            const listContainer = document.querySelector('.lb-list');
            if (listContainer && leaderboard.length > 3) {
                let html = '';
                for (let i = 3; i < leaderboard.length; i++) {
                    let p = leaderboard[i];
                    html += `
                        <div class="lb-list-item glass-lb-panel">
                            <div class="lb-item-rank">#${p.rank}</div>
                            <div class="lb-item-avatar"><div class="avatar-initials">${p.initials}</div></div>
                            <div class="lb-item-name">${p.name}</div>
                            <div class="lb-item-tier" style="color: #cd7f32;">${p.tier}</div>
                            <div class="lb-item-rp">${p.rp} PTS</div>
                        </div>
                    `;
                }
                listContainer.innerHTML = html;
            }
        }

        // Fetch Clips
        const clipsRes = await fetch(`/api/game/${gameId}/clips`);
        if (clipsRes.ok) {
            const clips = await clipsRes.json();
            const clipsContainer = document.querySelector('.clips-grid');
            if (clipsContainer) {
                let html = '';
                clips.forEach(clip => {
                    html += `
                        <div class="clip-card glass-panel">
                            <div class="clip-thumbnail">
                                <img src="${clip.thumbnail}" alt="Clip Thumbnail" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.7;">
                                <div class="clip-play-btn">▶</div>
                            </div>
                            <div class="clip-info">
                                <h4 class="clip-title" style="color: #fff; margin: 0 0 5px 0;">${clip.title}</h4>
                                <div class="clip-meta" style="color: var(--text-400); font-size: 0.9rem;">
                                    <span>👤 ${clip.author}</span> • <span>👁️ ${clip.views}</span>
                                </div>
                            </div>
                        </div>
                    `;
                });
                clipsContainer.innerHTML = html;
            }
        }
        
    } catch (err) {
        console.error('Error fetching dynamic game data:', err);
    }
});
