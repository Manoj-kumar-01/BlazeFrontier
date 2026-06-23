// Global Matchmaking Logic — Clean State Architecture
let socket = null;
let currentMatchId = null;
let popupTimerInterval = null;
let searchTimerInterval = null;
let blockTimerInterval = null;

let mmQuickMsgCount = 0;
const MM_QUICK_MSG_LIMIT = 3;

// We export these functions so specific pages (like freefire.ejs) can call them
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
                    alert(data.msg);
                }
                return false;
            }
            // Search started successfully. Local UI will be updated by the mm:search_started socket event.
            return true;
        } catch (e) {
            console.error('Matchmaking request failed:', e);
            alert('An error occurred. Please try again.');
            return false;
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
                const diff = targetDate - new Date();
                if (diff <= 0) {
                    clearInterval(blockTimerInterval);
                    overlay.style.display = 'none';
                    // Refresh status when cooldown ends
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

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('blaze_token');
    if (!token) return;

    let myUserId = null;
    try {
        myUserId = JSON.parse(atob(token.split('.')[1])).id;
    } catch(e) {}

    // 1. Sync state instantly on load
    await syncMatchmakingState();

    // 2. Establish Socket.IO
    socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 10 });
    socket.emit('authenticate', token);
    socket.on('reconnect', () => socket.emit('authenticate', token));

    // ─── SOCKET EVENTS ──────────────────────────────────────────────────

    socket.on('mm:search_started', (payload) => {
        // If I am the searcher, update my button
        if (payload.requesterId === myUserId) {
            startSearchTimerUI(new Date(payload.expiresAt));
        } else {
            // Show popup to everyone else
            showMmPopup(payload.requesterBlz, new Date(payload.expiresAt));
        }
    });

    socket.on('mm:search_cleared', () => {
        hideMmPopup();
        resetSearchButtonUI();
    });

    socket.on('mm:search_expired', (payload) => {
        hideMmPopup();
        resetSearchButtonUI();
        if (payload.blockedUntil) {
            window.BlazeMatchmaking.startCooldown(new Date(payload.blockedUntil));
        }
        if (payload.msg) alert(payload.msg);
    });

    socket.on('mm:match_formed', (payload) => {
        currentMatchId = payload.matchId;
        hideMmPopup();
        resetSearchButtonUI();
        openChatModal(payload.opponent);
        if (payload.cooldownUntil) {
            window.BlazeMatchmaking.startCooldown(new Date(payload.cooldownUntil));
        }
        updateDailyLimitUI(); // Refresh visual count
    });

    socket.on('mm:chat_message', (payload) => {
        appendChatMessage(payload.sender, payload.type, payload.message, myUserId);
        if (payload.sender === myUserId && typeof payload.remaining === 'number') {
            if (payload.remaining <= 0) disableQuickMsgButtons();
        }
    });

    socket.on('mm:chat_ended', (payload) => {
        alert(payload.msg);
        closeChatModal();
    });

    // ─── UI LISTENERS ──────────────────────────────────────────────────

    const acceptBtn = document.getElementById('mm-accept-btn');
    if (acceptBtn) {
        let accepting = false;
        acceptBtn.addEventListener('click', async () => {
            if (accepting) return;
            accepting = true;
            acceptBtn.disabled = true;
            acceptBtn.innerText = 'ACCEPTING...';
            try {
                const res = await fetch('/api/matchmaking/accept', {
                    method: 'POST',
                    headers: { 'x-auth-token': token }
                });
                const data = await res.json();
                if (!res.ok) {
                    alert(data.msg);
                    acceptBtn.innerText = 'ACCEPT';
                    acceptBtn.disabled = false;
                }
            } catch(e) {
                console.error(e);
                acceptBtn.innerText = 'ACCEPT';
                acceptBtn.disabled = false;
            }
            accepting = false;
        });
    }

    const leaveRoomBtn = document.getElementById('mm-leave-room-btn');
    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', async () => {
            if (currentMatchId) {
                await fetch(`/api/matchmaking/leave/${currentMatchId}`, { method: 'POST', headers: { 'x-auth-token': token }});
            }
            closeChatModal();
        });
    }

    document.querySelectorAll('.mm-quick-msg').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (mmQuickMsgCount >= MM_QUICK_MSG_LIMIT) return;
            const success = await sendChat('predefined', btn.innerText);
            if (success) {
                mmQuickMsgCount++;
                if (mmQuickMsgCount >= MM_QUICK_MSG_LIMIT) disableQuickMsgButtons();
            }
        });
    });

    const sendCredsBtn = document.getElementById('mm-send-creds-btn');
    if (sendCredsBtn) {
        sendCredsBtn.addEventListener('click', () => {
            const roomId = document.getElementById('mm-room-id').value;
            const pass = document.getElementById('mm-room-pass').value;
            if (!roomId || !pass) return alert('Enter both ID and Password');
            sendChat('credentials', null, roomId, pass);
            document.getElementById('mm-room-id').value = '';
            document.getElementById('mm-room-pass').value = '';
        });
    }
});

// ─── HELPER FUNCTIONS ────────────────────────────────────────────────

async function syncMatchmakingState() {
    const token = localStorage.getItem('blaze_token');
    if (!token) return;
    try {
        const res = await fetch('/api/matchmaking/status', { headers: { 'x-auth-token': token }});
        if (res.ok) {
            const state = await res.json();
            
            // 1. Cooldowns
            if (state.blockedUntil && new Date(state.blockedUntil) > new Date()) {
                window.BlazeMatchmaking.startCooldown(new Date(state.blockedUntil));
            }
            // 2. Limits
            if (state.dailyCount >= 3) {
                showLimitOverlay();
            }
            updateDailyLimitUIText(3 - state.dailyCount);

            // 3. Active Search
            if (state.isSearchActive && state.search) {
                const expires = new Date(state.search.expiresAt);
                if (expires > new Date()) {
                    if (state.search.isMySearch) {
                        startSearchTimerUI(expires);
                    } else {
                        showMmPopup(state.search.requesterBlz, expires);
                    }
                }
            } else {
                hideMmPopup();
                resetSearchButtonUI();
            }
        }
    } catch(e) {
        console.error('Failed to sync matchmaking state', e);
    }
}

function showMmPopup(blz, expiresAt) {
    document.getElementById('mm-requester').innerText = blz;
    const popup = document.getElementById('mm-request-popup');
    if (!popup) return;
    
    const acceptBtn = document.getElementById('mm-accept-btn');
    if (acceptBtn) {
        acceptBtn.innerText = 'ACCEPT';
        acceptBtn.disabled = false;
    }
    
    popup.style.display = 'block';
    setTimeout(() => popup.style.bottom = '20px', 10);
    
    clearInterval(popupTimerInterval);
    const updateTimer = () => {
        const diff = Math.ceil((expiresAt - new Date()) / 1000);
        if (diff <= 0) {
            clearInterval(popupTimerInterval);
            hideMmPopup();
        } else {
            document.getElementById('mm-timer').innerText = diff + 's';
        }
    };
    updateTimer();
    popupTimerInterval = setInterval(updateTimer, 1000);
}

window.hideMmPopup = function() {
    clearInterval(popupTimerInterval);
    const popup = document.getElementById('mm-request-popup');
    if (!popup) return;
    popup.style.bottom = '-200px';
    setTimeout(() => { popup.style.display = 'none'; }, 400);
}

function startSearchTimerUI(expiresAt) {
    const btn = document.getElementById('find-squad-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = '0.7';

    clearInterval(searchTimerInterval);
    const updateTimer = () => {
        const diff = Math.ceil((expiresAt - new Date()) / 1000);
        if (diff <= 0) {
            clearInterval(searchTimerInterval);
            btn.innerText = 'SEARCHING...';
        } else {
            btn.innerText = `SEARCHING (${diff}s)`;
        }
    };
    updateTimer();
    searchTimerInterval = setInterval(updateTimer, 1000);
}

function resetSearchButtonUI() {
    clearInterval(searchTimerInterval);
    const btn = document.getElementById('find-squad-btn');
    if (btn) {
        btn.innerText = 'FIND A SQUAD';
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

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
        clearInterval(blockTimerInterval); // Reuse block timer
        
        const updateMidnightTimer = () => {
            const diff = midnight - new Date();
            if (diff <= 0) {
                window.location.reload();
            } else {
                const h = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
                const m = Math.floor((diff % (1000 * 60 * 60)) / 60000).toString().padStart(2, '0');
                const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                sub.innerHTML = `<span style="font-family: var(--font-display); font-size: 1.8rem; color: #fff; letter-spacing: 2px;">0/3 LEFT</span><br><span style="color:var(--blaze-orange); font-size:0.9rem; font-weight:bold; letter-spacing:1px;">RESETS IN ${h}:${m}:${s}</span>`;
            }
        };
        updateMidnightTimer();
        blockTimerInterval = setInterval(updateMidnightTimer, 1000);
    }
}

function updateDailyLimitUIText(left) {
    const limitSpan = document.getElementById('mm-daily-limit');
    if (limitSpan) limitSpan.innerText = `(${Math.max(0, left)}/3 Left)`;
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

function openChatModal(opponent) {
    document.getElementById('mm-chat-opponent').innerText = `vs ${opponent}`;
    const box = document.getElementById('mm-chat-box');
    box.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.8rem; margin-bottom:10px;">Match confirmed! You may now share credentials. Chat is restricted to pre-defined phrases.</div>';
    document.getElementById('mm-chat-modal').style.display = 'flex';
    
    mmQuickMsgCount = 0;
    enableQuickMsgButtons();
}

function closeChatModal() {
    currentMatchId = null;
    const modal = document.getElementById('mm-chat-modal');
    if (modal) modal.style.display = 'none';
}

function disableQuickMsgButtons() {
    document.querySelectorAll('.mm-quick-msg').forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.3';
        btn.style.cursor = 'not-allowed';
        btn.title = 'Message limit reached (3/3 used)';
    });
}

function enableQuickMsgButtons() {
    document.querySelectorAll('.mm-quick-msg').forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
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
            alert(data.msg);
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
    const align = isMe ? 'flex-end' : 'flex-start';
    const bg = isMe ? 'rgba(0,188,212,0.2)' : 'rgba(255,255,255,0.05)';
    const color = isMe ? '#00bcd4' : '#fff';
    const border = isMe ? '1px solid rgba(0,188,212,0.4)' : '1px solid rgba(255,255,255,0.1)';

    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = `display:flex; flex-direction:column; align-items:${align}; margin-bottom:8px;`;
    msgDiv.innerHTML = `<div style="background:${bg}; color:${color}; border:${border}; padding:10px 14px; border-radius:12px; font-size:0.85rem; max-width:80%; word-break:break-word;">${message}</div>`;
    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}
