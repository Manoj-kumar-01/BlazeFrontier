document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('blaze_token');
    if (!token) {
        window.location.href = '/auth';
        return;
    }

    try {
        const res = await fetch('/api/profile', {
            headers: { 'x-auth-token': token }
        });

        if (!res.ok) {
            localStorage.removeItem('blaze_token');
            window.location.href = '/auth';
            return;
        }

        const user = await res.json();

        if (user.isBanned) {
            window.location.href = '/banned';
            return;
        }

        if (!user.isSetupComplete && window.location.pathname !== '/onboarding') {
            window.location.href = '/onboarding';
            return;
        }

        // Dynamically update profile fields if they exist on the page
        const dynIgn = document.getElementById('dyn-ign');
        if (dynIgn) {
            dynIgn.innerText = user.inGameName || user.username;
            document.getElementById('dyn-game').innerText = user.favoriteGame ? user.favoriteGame.replace('-', ' ') : 'UNASSIGNED';
            document.getElementById('dyn-uid').innerText = user.gameUid || 'N/A';
            document.getElementById('dyn-loc').innerText = user.location || 'UNKNOWN';
            
            document.getElementById('dyn-rank').innerText = user.rankText || 'UNRANKED';
            document.getElementById('dyn-bp-sub').innerText = `${user.totalBP || 0} Total Blaze Points`;
            
            const progress = document.getElementById('dyn-progress');
            if (progress && user.globalRankPercentile) {
                // Just a visual representation. 0.1% means 100% full bar.
                const percent = Math.max(5, 100 - parseFloat(user.globalRankPercentile));
                setTimeout(() => { progress.style.width = percent + '%'; }, 500);
            }

            document.getElementById('dyn-wins').innerText = user.tournamentsWon || 0;
            document.getElementById('dyn-matches').innerText = user.totalMatches || 0;
        }

        // Fetch Tournaments (Dynamic Integration Mockup)
        const tourneyRes = await fetch('/api/tournaments');
        const tourneys = await tourneyRes.json();
        
        // Fetch Champion (Hall of Fame)
        try {
            const champRes = await fetch('/api/champion');
            if (champRes.ok) {
                const champ = await champRes.json();
                const champNameEl = document.getElementById('hof-champion-name');
                const champPointsEl = document.getElementById('hof-champion-points');
                if (champNameEl && champPointsEl) {
                    champNameEl.innerText = champ.name;
                    champPointsEl.innerText = champ.bp + ' BP';
                }
            }
        } catch(e) {
            console.error('Error fetching champion', e);
        }

        console.log("Dynamic Data Loaded:", { user, tourneys });
    } catch (err) {
        console.error('Error fetching dynamic data', err);
    }
});
