/**
 * ═══════════════════════════════════════════════════════════════════
 *  BLAZE MATCHMAKING v2 — Queue-based pooling system
 *  Production-grade, Rapido-style request management
 *  - Queue pool: multiple pending requests visible
 *  - Session-scoped: events targeted to specific users
 *  - BroadcastChannel: multi-tab sync for same account
 *  - Mobile-first: compact, responsive UI
 * ═══════════════════════════════════════════════════════════════════
 */

let socket = null;
let currentMatchId = null;
let mmQuickMsgCount = 0;
const MM_QUICK_MSG_LIMIT = 8;
const msgUsageCount = {}; // Track usage of individual messages

// Queue state
let pendingQueue = [];      // Array of request objects from server
let myActiveRequest = null;  // My own request (if any) { id, expiresAt }
let myUserId = null;
let serverTimeOffset = 0;
let blockTimerInterval = null;
let mySearchTimerInterval = null;
let acceptInFlight = false;  // Global client-side accept lock
let syncInterval = null;     // Periodic re-sync interval

// BroadcastChannel for multi-tab sync (same account)
let mmChannel = null;
try {
    mmChannel = new BroadcastChannel('blaze_matchmaking');
} catch(e) {
    // BroadcastChannel not supported — degrade gracefully
}

// ─── PUBLIC API ──────────────────────────────────────────────────

window.BlazeMatchmaking = {
    startSearch: async function() {
        const token = localStorage.getItem('blaze_token');
        try {
            const res = await fetch('/api/matchmaking/request', {
                method: 'POST',
                headers: { 'x-auth-token': token }
            });
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 403 && data.blockedUntil) {
                    window.BlazeMatchmaking.startCooldown(new Date(data.blockedUntil));
                } else if (res.status === 403 && data.msg.toLowerCase().includes('limit')) {
                    showLimitOverlay();
                } else {
                    showMmToast(data.msg, 'error');
                }
                return false;
            }
            // Success — server will emit mm:my_request_created + mm:queue_updated
            return true;
        } catch (e) {
            console.error('Matchmaking request failed:', e);
            showMmToast('An error occurred. Please try again.', 'error');
            return false;
        }
    },

    cancelSearch: async function() {
        const token = localStorage.getItem('blaze_token');
        try {
            const res = await fetch('/api/matchmaking/cancel', {
                method: 'POST',
                headers: { 'x-auth-token': token }
            });
            if (!res.ok) {
                const data = await res.json();
                showMmToast(data.msg, 'error');
            }
            // Server will emit mm:my_request_cancelled + mm:queue_updated
        } catch(e) {
            console.error('Cancel failed:', e);
        }
    },

    acceptRequest: async function(requestId) {
        // Global client-side lock: only one accept at a time
        if (acceptInFlight) {
            showMmToast('Already processing an accept. Please wait.', 'warning');
            return false;
        }
        // Can't accept while already in a match
        if (currentMatchId) {
            showMmToast('You are already in a match.', 'warning');
            return false;
        }
        acceptInFlight = true;
        const token = localStorage.getItem('blaze_token');
        try {
            const res = await fetch(`/api/matchmaking/accept/${requestId}`, {
                method: 'POST',
                headers: { 'x-auth-token': token }
            });
            const data = await res.json();
            if (!res.ok) {
                showMmToast(data.msg, 'error');
                // If the request is gone (400/409), remove it from local queue and re-sync
                if (res.status === 400 || res.status === 409) {
                    pendingQueue = pendingQueue.filter(r => r.id !== requestId);
                    renderQueuePanel();
                    updateQueueCount();
                    // Full re-sync to get latest state
                    syncMatchmakingState();
                }
                return false;
            }
            return true;
        } catch(e) {
            console.error('Accept failed:', e);
            showMmToast('Network error. Try again.', 'error');
            return false;
        } finally {
            acceptInFlight = false;
        }
    },

    startCooldown: function(targetDate) {
        const overlay = document.getElementById('ff-mm-overlay');
        const sub = document.getElementById('ff-mm-overlay-sub');
        const text = document.getElementById('ff-mm-overlay-text');
        const banner = document.getElementById('ff-matchmaking-banner');
        
        if (overlay && sub && text) {
            overlay.style.display = 'flex';
            text.innerText = 'COOLDOWN';
            if (banner) {
                banner.style.background = 'rgba(15, 10, 12, 0.4)';
                banner.style.borderColor = 'rgba(255,255,255,0.1)';
            }
            
            clearInterval(blockTimerInterval);
            const updateTimer = () => {
                const trueNow = getServerTime();
                const diff = targetDate - trueNow;
                if (diff <= 0) {
                    clearInterval(blockTimerInterval);
                    overlay.style.display = 'none';
                    syncMatchmakingState();
                } else {
                    const m = Math.floor(diff / 60000).toString().padStart(2, '0');
                    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                    sub.innerHTML = `<span style="font-family: var(--font-display); font-size: 1.8rem; color: #fff; letter-spacing: 2px;">${m}:${s}</span><br><span style="color:var(--text-muted); font-size:0.9rem;">REMAINING</span>`;
                }
            };
            updateTimer();
            blockTimerInterval = setInterval(updateTimer, 1000);
        }
    }
};

// ─── SERVER TIME ─────────────────────────────────────────────────

function getServerTime() {
    return new Date(Date.now() + serverTimeOffset);
}
window._getServerTime = getServerTime;

// ─── JWT PARSE ───────────────────────────────────────────────────

function parseJwt(token) {
    try {
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch(e) { return null; }
}

// ─── INIT ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('blaze_token');
    if (!token) return;

    try {
        const payload = parseJwt(token);
        if (payload) myUserId = payload.id;
    } catch(e) {}

    // 1. Sync state instantly on load
    await syncMatchmakingState();
    
    // 2. Check and Initialize Web Push Notifications (with explicit user prompt if needed)
    checkAndInitWebPush();

    // 2. Periodic re-sync every 10 seconds (catches drift, stale state)
    clearInterval(syncInterval);
    syncInterval = setInterval(() => syncMatchmakingState(), 10000);

    // 3. Establish Socket.IO
    socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 10 });
    socket.emit('authenticate', token);
    socket.on('reconnect', () => {
        socket.emit('authenticate', token);
        syncMatchmakingState(); // Re-sync on reconnect
    });

    // ─── SOCKET EVENTS ──────────────────────────────────────────

    // Queue updated — full queue sync from server
    socket.on('mm:queue_updated', (payload) => {
        if (payload.serverTime) {
            serverTimeOffset = new Date(payload.serverTime).getTime() - Date.now();
        }
        pendingQueue = (payload.queue || []).filter(r => r.requesterId !== myUserId);
        renderQueuePanel();
        updateQueueCount();
        broadcastToOtherTabs('queue_updated', { queue: pendingQueue });
    });

    // My request was created
    socket.on('mm:my_request_created', (payload) => {
        myActiveRequest = {
            id: payload.requestId,
            expiresAt: payload.expiresAt
        };
        startMySearchUI(new Date(payload.expiresAt));
        broadcastToOtherTabs('my_request_created', myActiveRequest);
    });

    // My request was cancelled
    socket.on('mm:my_request_cancelled', (payload) => {
        myActiveRequest = null;
        resetFindSquadBtn();
        broadcastToOtherTabs('my_request_cancelled', {});
    });

    // My request expired
    socket.on('mm:search_expired', (payload) => {
        myActiveRequest = null;
        resetFindSquadBtn();
        if (payload.blockedUntil) {
            window.BlazeMatchmaking.startCooldown(new Date(payload.blockedUntil));
        }
        showMmToast(payload.msg || 'No one accepted. Cooldown applied.', 'warning');
        broadcastToOtherTabs('search_expired', { blockedUntil: payload.blockedUntil });
    });

    // Match formed — I got matched!
    socket.on('mm:match_formed', (payload) => {
        if (window.location.pathname !== '/dashboard/freefire') {
            window.location.href = '/dashboard/freefire';
            return;
        }
        currentMatchId = payload.matchId;
        myActiveRequest = null;
        resetFindSquadBtn();
        hideQueuePanel();
        openChatModal(payload.opponent, payload.opponentName);
        if (payload.cooldownUntil) {
            window.BlazeMatchmaking.startCooldown(new Date(payload.cooldownUntil));
        }
        updateDailyLimitUI();
        broadcastToOtherTabs('match_formed', { cooldownUntil: payload.cooldownUntil });
    });

    // Chat messages
    socket.on('mm:chat_message', (payload) => {
        appendChatMessage(payload.sender, payload.type, payload.message, myUserId);
        if (payload.sender === myUserId && typeof payload.remaining === 'number') {
            if (payload.remaining <= 0) disableQuickMsgButtons();
        }
    });

    // Chat ended
    socket.on('mm:chat_ended', (payload) => {
        showMmToast(payload.msg, 'info');
        closeChatModal();
    });

    // ─── BROADCAST CHANNEL (multi-tab sync) ─────────────────────

    if (mmChannel) {
        mmChannel.onmessage = (event) => {
            const { type, data } = event.data;
            switch(type) {
                case 'queue_updated':
                    pendingQueue = data.queue || [];
                    renderQueuePanel();
                    updateQueueCount();
                    break;
                case 'my_request_created':
                    myActiveRequest = data;
                    startMySearchUI(new Date(data.expiresAt));
                    break;
                case 'my_request_cancelled':
                    myActiveRequest = null;
                    resetFindSquadBtn();
                    break;
                case 'search_expired':
                    myActiveRequest = null;
                    resetFindSquadBtn();
                    if (data.blockedUntil) {
                        window.BlazeMatchmaking.startCooldown(new Date(data.blockedUntil));
                    }
                    break;
                case 'match_formed':
                    myActiveRequest = null;
                    resetFindSquadBtn();
                    hideQueuePanel();
                    if (data.cooldownUntil) {
                        window.BlazeMatchmaking.startCooldown(new Date(data.cooldownUntil));
                    }
                    break;
            }
        };
    }

    // ─── UI LISTENERS ───────────────────────────────────────────

    // Leave room
    const leaveRoomBtn = document.getElementById('mm-leave-room-btn');
    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', async () => {
            if (await mmConfirm('Are you sure you want to leave the chat? Your room will be closed.')) {
                if (currentMatchId) {
                    await fetch(`/api/matchmaking/leave/${currentMatchId}`, { method: 'POST', headers: { 'x-auth-token': token }});
                }
                closeChatModal();
            }
        });
    }

    // Quick messages
    document.querySelectorAll('.mm-quick-msg').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (mmQuickMsgCount >= MM_QUICK_MSG_LIMIT) return;
            const msgText = btn.dataset.msg || btn.innerText;
            
            if (!msgUsageCount[msgText]) msgUsageCount[msgText] = 0;
            if (msgUsageCount[msgText] >= 2) {
                showMmToast('You can only send this specific message 2 times.', 'error');
                return;
            }

            const success = await sendChat('predefined', msgText);
            if (success) {
                msgUsageCount[msgText]++;
                mmQuickMsgCount++;
                if (msgUsageCount[msgText] >= 2) {
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'not-allowed';
                }
                if (mmQuickMsgCount >= MM_QUICK_MSG_LIMIT) disableQuickMsgButtons();
            }
        });
    });

    // Send credentials
    const sendCredsBtn = document.getElementById('mm-send-creds-btn');
    if (sendCredsBtn) {
        sendCredsBtn.addEventListener('click', () => {
            const roomIdElem = document.getElementById('mm-room-id');
            const passElem = document.getElementById('mm-room-pass');
            if (!roomIdElem || !passElem) return;
            const roomId = roomIdElem.value;
            const pass = passElem.value;
            if (!roomId || !pass) return showMmToast('Enter both Room ID and Password', 'error');
            sendChat('credentials', null, roomId, pass);
            roomIdElem.value = '';
            passElem.value = '';
        });
    }


    // Queue panel toggle
    const queueToggle = document.getElementById('mm-queue-toggle');
    if (queueToggle) {
        queueToggle.addEventListener('click', () => {
            const panel = document.getElementById('mm-queue-panel');
            if (panel) {
                const isVisible = panel.classList.contains('mm-panel-visible');
                if (isVisible) {
                    hideQueuePanel();
                } else {
                    showQueuePanel();
                }
            }
        });
    }
});

// ─── STATE SYNC ──────────────────────────────────────────────────

async function syncMatchmakingState() {
    const token = localStorage.getItem('blaze_token');
    if (!token) return;
    try {
        const res = await fetch('/api/matchmaking/status', { headers: { 'x-auth-token': token }});
        if (res.ok) {
            const state = await res.json();
            
            // Sync clock
            if (state.serverTime) {
                serverTimeOffset = new Date(state.serverTime).getTime() - Date.now();
            }

            const trueNow = getServerTime();

            // 1. Cooldowns
            if (state.blockedUntil && new Date(state.blockedUntil) > trueNow) {
                window.BlazeMatchmaking.startCooldown(new Date(state.blockedUntil));
            }
            // 2. Daily limits
            if (state.dailyCount >= 5) {
                showLimitOverlay();
            }
            updateDailyLimitUIText(5 - state.dailyCount);

            // 3. My active request
            if (state.myRequest) {
                const expires = new Date(state.myRequest.expiresAt);
                if (expires > trueNow) {
                    myActiveRequest = state.myRequest;
                    startMySearchUI(expires);
                } else {
                    myActiveRequest = null;
                    resetFindSquadBtn();
                }
            } else {
                myActiveRequest = null;
                resetFindSquadBtn();
            }

            // 4. Queue (filter out own requests)
            pendingQueue = (state.queue || []).filter(r => r.requesterId !== myUserId);
            renderQueuePanel();
            updateQueueCount();

            // 5. Active Match
            if (state.activeMatch) {
                if (window.location.pathname !== '/dashboard/freefire') {
                    window.location.href = '/dashboard/freefire';
                    return;
                }
                currentMatchId = state.activeMatch.matchId;
                openChatModal(state.activeMatch.opponent, state.activeMatch.opponentName);
            }
        }
    } catch(e) {
        console.error('Failed to sync matchmaking state', e);
    }
}

// ─── QUEUE PANEL RENDERING ───────────────────────────────────────

function renderQueuePanel() {
    const list = document.getElementById('mm-queue-list');
    if (!list) return;

    if (pendingQueue.length === 0) {
        list.innerHTML = `
            <div class="mm-queue-empty">
                <div class="mm-queue-empty-icon">🔍</div>
                <div class="mm-queue-empty-text">No pending requests</div>
                <div class="mm-queue-empty-sub">Squad requests will appear here</div>
            </div>`;
        return;
    }

    let html = '';
    for (const req of pendingQueue) {
        const expiresAt = new Date(req.expiresAt);
        const trueNow = getServerTime();
        const remaining = Math.max(0, Math.ceil((expiresAt - trueNow) / 1000));
        
        if (remaining <= 0) continue; // Skip expired

        const progress = Math.min(100, (remaining / 60) * 100);
        const displayName = req.requesterName || req.requesterBlz;

        html += `
            <div class="mm-request-card" data-request-id="${req.id}" data-expires="${req.expiresAt}">
                <div class="mm-rc-header">
                    <div class="mm-rc-avatar">⚔️</div>
                    <div class="mm-rc-info">
                        <div class="mm-rc-name">${escapeHtml(displayName)}</div>
                        <div class="mm-rc-blz">${escapeHtml(req.requesterBlz)}</div>
                    </div>
                    <div class="mm-rc-timer-ring">
                        <svg viewBox="0 0 36 36" class="mm-timer-svg">
                            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>
                            <circle cx="18" cy="18" r="16" fill="none" stroke="#00bcd4" stroke-width="2"
                                stroke-dasharray="${progress} 100"
                                stroke-linecap="round" class="mm-timer-progress" />
                        </svg>
                        <span class="mm-rc-countdown">${remaining}s</span>
                    </div>
                </div>
                <button class="mm-rc-accept-btn" onclick="handleAcceptRequest('${req.id}', this)">
                    <span>ACCEPT</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
            </div>`;
    }

    list.innerHTML = html || `
        <div class="mm-queue-empty">
            <div class="mm-queue-empty-icon">🔍</div>
            <div class="mm-queue-empty-text">No pending requests</div>
            <div class="mm-queue-empty-sub">Squad requests will appear here</div>
        </div>`;

    // Start countdown timers for each card
    startCardTimers();
}

let cardTimerInterval = null;

function startCardTimers() {
    clearInterval(cardTimerInterval);
    cardTimerInterval = setInterval(() => {
        const cards = document.querySelectorAll('.mm-request-card');
        let hasActive = false;
        cards.forEach(card => {
            const expiresAt = new Date(card.dataset.expires);
            const trueNow = getServerTime();
            const remaining = Math.max(0, Math.ceil((expiresAt - trueNow) / 1000));
            const progress = Math.min(100, (remaining / 60) * 100);

            const countdown = card.querySelector('.mm-rc-countdown');
            const progressCircle = card.querySelector('.mm-timer-progress');

            if (remaining <= 0) {
                card.classList.add('mm-card-expired');
                setTimeout(() => card.remove(), 400);
            } else {
                hasActive = true;
                if (countdown) countdown.textContent = remaining + 's';
                if (progressCircle) progressCircle.setAttribute('stroke-dasharray', `${progress} 100`);
            }
        });

        if (!hasActive) {
            clearInterval(cardTimerInterval);
            // Check if list is now empty
            const list = document.getElementById('mm-queue-list');
            if (list && list.querySelectorAll('.mm-request-card:not(.mm-card-expired)').length === 0) {
                renderQueuePanel();
            }
            updateQueueCount();
        }
    }, 1000);
}

// ─── ACCEPT HANDLER ──────────────────────────────────────────────

window.handleAcceptRequest = async function(requestId, btn) {
    if (btn.disabled || acceptInFlight) return;
    btn.disabled = true;
    btn.innerHTML = '<span>ACCEPTING...</span>';
    btn.classList.add('mm-btn-loading');

    // Optimistic UI: immediately dim the card to signal it's being processed
    const card = btn.closest('.mm-request-card');
    if (card) card.style.opacity = '0.5';

    // Disable ALL other accept buttons to prevent multi-accept
    const allBtns = document.querySelectorAll('.mm-rc-accept-btn');
    allBtns.forEach(b => { b.disabled = true; });
    
    const success = await window.BlazeMatchmaking.acceptRequest(requestId);
    if (!success) {
        // Re-enable all buttons except the ones for expired/removed cards
        allBtns.forEach(b => {
            const parentCard = b.closest('.mm-request-card');
            if (parentCard && !parentCard.classList.contains('mm-card-expired')) {
                b.disabled = false;
            }
        });
        btn.innerHTML = '<span>ACCEPT</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.classList.remove('mm-btn-loading');
        if (card) card.style.opacity = '1';
    }
};

// ─── QUEUE PANEL VISIBILITY ──────────────────────────────────────

function showQueuePanel() {
    const panel = document.getElementById('mm-queue-panel');
    if (panel) {
        panel.classList.add('mm-panel-visible');
    }
}

function hideQueuePanel() {
    const panel = document.getElementById('mm-queue-panel');
    if (panel) {
        panel.classList.remove('mm-panel-visible');
    }
}

// ─── QUEUE COUNT BADGE ───────────────────────────────────────────

function updateQueueCount() {
    const badge = document.getElementById('mm-queue-badge');
    const countEl = document.getElementById('mm-queue-count-text');
    const activeCount = pendingQueue.filter(r => {
        const exp = new Date(r.expiresAt);
        return exp > getServerTime();
    }).length;

    if (badge) {
        if (activeCount > 0) {
            badge.textContent = activeCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    if (countEl) {
        countEl.textContent = activeCount > 0 ? `${activeCount} request${activeCount > 1 ? 's' : ''} pending` : 'No pending requests';
    }

    // Also update the freefire banner queue indicator
    const bannerQueue = document.getElementById('mm-banner-queue-count');
    if (bannerQueue) {
        bannerQueue.textContent = activeCount > 0 ? `${activeCount} request${activeCount > 1 ? 's' : ''} in queue` : '';
        bannerQueue.style.display = activeCount > 0 ? 'inline' : 'none';
    }
}

// ─── FIND SQUAD BUTTON STATE ─────────────────────────────────────

function startMySearchUI(expiresAt) {
    const btn = document.getElementById('find-squad-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.classList.add('mm-searching');
    
    clearInterval(mySearchTimerInterval);
    const updateTimer = () => {
        const trueNow = getServerTime();
        const diff = Math.ceil((expiresAt - trueNow) / 1000);
        if (diff <= 0) {
            clearInterval(mySearchTimerInterval);
            btn.innerHTML = 'SEARCHING...';
        } else {
            btn.innerHTML = `<span class="mm-pulse-dot"></span> SEARCHING (${diff}s)`;
        }
    };
    updateTimer();
    mySearchTimerInterval = setInterval(updateTimer, 1000);
}

function resetFindSquadBtn() {
    clearInterval(mySearchTimerInterval);
    const btn = document.getElementById('find-squad-btn');
    if (btn) {
        btn.innerHTML = 'FIND A SQUAD';
        btn.disabled = false;
        btn.classList.remove('mm-searching');
    }
}

// ─── LIMIT OVERLAY ───────────────────────────────────────────────

function showLimitOverlay() {
    const overlay = document.getElementById('ff-mm-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        document.getElementById('ff-mm-overlay-text').innerText = 'LIMIT REACHED';
        const banner = document.getElementById('ff-matchmaking-banner');
        if(banner) {
            banner.style.background = 'rgba(15, 10, 12, 0.4)';
            banner.style.borderColor = 'rgba(255,255,255,0.1)';
        }
        
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const sub = document.getElementById('ff-mm-overlay-sub');
        clearInterval(blockTimerInterval);
        
        const updateMidnightTimer = () => {
            const diff = midnight - new Date();
            if (diff <= 0) {
                window.location.reload();
            } else {
                const h = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
                const m = Math.floor((diff % (1000 * 60 * 60)) / 60000).toString().padStart(2, '0');
                const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                sub.innerHTML = `<span style="font-family: var(--font-display); font-size: 1.8rem; color: #fff; letter-spacing: 2px; text-transform: uppercase;">Daily Limit Reached</span><br><span style="color:var(--blaze-orange); font-size:0.9rem; font-weight:bold; letter-spacing:1px;">RESETS IN ${h}:${m}:${s}</span>`;
            }
        };
        updateMidnightTimer();
        blockTimerInterval = setInterval(updateMidnightTimer, 1000);
    }
}

function updateDailyLimitUIText(left) {
    const limitSpan = document.getElementById('mm-daily-limit');
    if (limitSpan) limitSpan.innerText = `(${Math.max(0, left)}/5 Left)`;
}

function updateDailyLimitUI() {
    const limitSpan = document.getElementById('mm-daily-limit');
    if (limitSpan) {
        const match = limitSpan.innerText.match(/\d+/);
        if (match) {
            updateDailyLimitUIText(parseInt(match[0]) - 1);
        }
    }
}

// ─── CHAT MODAL ──────────────────────────────────────────────────

function openChatModal(opponent, opponentName) {
    const modal = document.getElementById('mm-chat-modal');
    if (modal && modal.classList.contains('mm-chat-visible')) return;

    const nameEl = document.getElementById('mm-chat-opponent');
    if (nameEl) nameEl.innerText = `vs ${opponentName || opponent}`;
    
    const idEl = document.getElementById('mm-chat-opponent-id');
    if (idEl) idEl.innerText = opponent;

    const box = document.getElementById('mm-chat-box');
    box.innerHTML = '<div class="mm-chat-system-msg">Match confirmed! Chat is restricted to pre-defined phrases.</div>';
    
    if (modal) {
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('mm-chat-visible'));
    }
    
    mmQuickMsgCount = 0;
    enableQuickMsgButtons();
}

function closeChatModal() {
    currentMatchId = null;
    const modal = document.getElementById('mm-chat-modal');
    if (modal) {
        modal.classList.remove('mm-chat-visible');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
    }
}

function disableQuickMsgButtons() {
    document.querySelectorAll('.mm-quick-msg').forEach(btn => {
        btn.disabled = true;
        btn.classList.add('mm-msg-disabled');
        btn.title = 'Message limit reached (3/3 used)';
    });
}

function enableQuickMsgButtons() {
    document.querySelectorAll('.mm-quick-msg').forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('mm-msg-disabled');
        btn.title = '';
    });
}

async function sendChat(type, message = null, roomId = null, password = null) {
    if (!currentMatchId) return false;
    const token = localStorage.getItem('blaze_token');
    try {
        const res = await fetch(`/api/matchmaking/chat/${currentMatchId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify({ type, message, roomId, password })
        });
        if (!res.ok) {
            const data = await res.json();
            if (res.status === 429) disableQuickMsgButtons();
            showMmToast(data.msg, 'error');
            return false;
        }
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

function appendChatMessage(senderId, type, message, myUserId) {
    const box = document.getElementById('mm-chat-box');
    if (!box) return;
    
    const isMe = senderId === myUserId;
    const msgDiv = document.createElement('div');
    msgDiv.className = `mm-chat-bubble ${isMe ? 'mm-chat-mine' : 'mm-chat-theirs'}`;

    msgDiv.innerHTML = `<span>${escapeHtml(message)}</span>`;

    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}

// ─── TOAST NOTIFICATIONS ────────────────────────────────────────

function showMmToast(message, type = 'info') {
    const container = document.getElementById('mm-toast-container') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `mm-toast mm-toast-${type}`;
    
    const icons = { info: 'ℹ️', error: '❌', warning: '⚠️', success: '✅' };
    toast.innerHTML = `
        <span class="mm-toast-icon">${icons[type] || icons.info}</span>
        <span class="mm-toast-msg">${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('mm-toast-visible'));
    
    setTimeout(() => {
        toast.classList.remove('mm-toast-visible');
        toast.classList.add('mm-toast-exit');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function createToastContainer() {
    const c = document.createElement('div');
    c.id = 'mm-toast-container';
    c.className = 'mm-toast-container';
    document.body.appendChild(c);
    return c;
}

// ─── BROADCAST CHANNEL HELPERS ───────────────────────────────────

function broadcastToOtherTabs(type, data) {
    if (mmChannel) {
        try {
            mmChannel.postMessage({ type, data });
        } catch(e) {}
    }
}

// ─── UTILITIES ───────────────────────────────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Legacy compatibility — keep hideMmPopup on window for any remaining references
window.hideMmPopup = function() {
    hideQueuePanel();
};

// Web Push Registration & Prompt
async function checkAndInitWebPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    
    if (Notification.permission === 'granted') {
        // Already granted, silently initialize and sync
        initWebPush();
    } else if (Notification.permission === 'default') {
        // Hasn't asked yet. Check if we should prompt.
        const dismissed = localStorage.getItem('push_prompt_dismissed');
        // Prompt if not dismissed, or if it was dismissed over 24 hours ago
        if (!dismissed || (Date.now() - parseInt(dismissed)) > 24 * 60 * 60 * 1000) {
            // Delay slightly so the user sees the page first
            setTimeout(() => {
                showCustomPushPrompt();
            }, 1500);
        }
    }
}

function showCustomPushPrompt() {
    if (document.getElementById('custom-push-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'custom-push-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.backdropFilter = 'blur(10px)';

    const box = document.createElement('div');
    box.style.backgroundColor = '#120a0f';
    box.style.border = '1px solid rgba(255,87,34,0.4)';
    box.style.borderRadius = '12px';
    box.style.padding = '24px';
    box.style.maxWidth = '320px';
    box.style.textAlign = 'center';
    box.style.boxShadow = '0 10px 40px rgba(255,87,34,0.2)';
    box.style.fontFamily = "'Inter', sans-serif";
    
    box.innerHTML = `
        <div style="font-family: 'Bebas Neue', sans-serif; font-size: 2rem; color: #ff5722; letter-spacing: 2px; margin-bottom: 12px; line-height: 1;">ENABLE NOTIFICATIONS</div>
        <div style="color: #ccc; font-size: 0.95rem; margin-bottom: 24px; line-height: 1.5;">Get instantly notified on your phone when someone searches for a squad, even when the app is closed!</div>
        <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="push-btn-later" style="background: transparent; border: 1px solid #555; color: #ccc; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; flex: 1; font-family: 'Inter', sans-serif; transition: all 0.2s;">LATER</button>
            <button id="push-btn-allow" style="background: #ff5722; border: none; color: #fff; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; flex: 1; box-shadow: 0 4px 15px rgba(255,87,34,0.4); font-family: 'Inter', sans-serif; transition: all 0.2s;">ALLOW</button>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('push-btn-later').onclick = () => {
        localStorage.setItem('push_prompt_dismissed', Date.now());
        document.body.removeChild(overlay);
    };

    document.getElementById('push-btn-allow').onclick = async () => {
        document.body.removeChild(overlay);
        try {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
                initWebPush();
            }
        } catch (e) {
            // Safari older versions callback style
            Notification.requestPermission(function (perm) {
                if (perm === 'granted') {
                    initWebPush();
                }
            });
        }
    };
}

// Actual Web Push Subscription logic
async function initWebPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
        const swReg = await navigator.serviceWorker.register('/sw.js');
        let sub = await swReg.pushManager.getSubscription();
        
        const token = localStorage.getItem('blaze_token');
        if (!token) return;

        if (!sub) {
            const keyRes = await fetch('/api/push/public-key');
            const keyData = await keyRes.json();
            const vapidPublicKey = keyData.publicKey;
            const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
            sub = await swReg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey
            });
        }

        // Always send to backend to ensure DB has it and user ID is updated
        if (sub) {
            await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify(sub)
            });
        }
    } catch (e) {
        console.error('Web Push Init Error:', e);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
