// Global Matchmaking Logic
let mmEventSource = null;
let currentRequestId = null;
let currentMatchId = null;
let mmTimerInterval = null;
let mmBlockInterval = null;

let socket = null;

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('blaze_token');
    if (!token) return;

    let myUserId = null;
    try {
        myUserId = JSON.parse(atob(token.split('.')[1])).id;
    } catch(e) {}

    // Establish Socket.IO connection
    socket = io();
    socket.emit('authenticate', token);

    socket.on('incoming_request', (payload) => {
        // DO NOT show popup if I am the sender
        if (payload.requesterId === myUserId) return;
        
        showMmPopup(payload.requestId, payload.requesterBlz);
    });

    socket.on('request_cleared', (payload) => {
        if (currentRequestId === payload.requestId) {
            hideMmPopup();
        }
    });

    socket.on('request_expired', (payload) => {
        const overlay = document.getElementById('ff-mm-overlay');
        const isBlocked = overlay && overlay.style.display === 'flex';
        
        if (!isBlocked) {
            alert(payload.msg);
            const findBtn = document.getElementById('find-squad-btn');
            if (findBtn) {
                findBtn.innerText = 'FIND A SQUAD';
                findBtn.disabled = false;
                findBtn.style.opacity = '1';
            }
        }
    });

    socket.on('match_formed', (payload) => {
        currentMatchId = payload.matchId;
        hideMmPopup();
        openChatModal(payload.opponent);
    });

    socket.on('chat_message', (payload) => {
        appendChatMessage(payload.sender, payload.type, payload.message);
    });

    socket.on('chat_ended', (payload) => {
        alert(payload.msg);
        closeChatModal();
    });

    // Accept Match Button
    const acceptBtn = document.getElementById('mm-accept-btn');
    if (acceptBtn) {
        acceptBtn.addEventListener('click', async () => {
            if (!currentRequestId) return;
            try {
                const res = await fetch(`/api/matchmaking/accept/${currentRequestId}`, {
                    method: 'POST',
                    headers: { 'x-auth-token': token }
                });
                const data = await res.json();
                if (!res.ok) alert(data.msg);
            } catch(e) { console.error(e); }
        });
    }

    // Leave Room
    const leaveRoomBtn = document.getElementById('mm-leave-room-btn');
    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', async () => {
            if (currentMatchId) {
                await fetch(`/api/matchmaking/leave/${currentMatchId}`, { method: 'POST', headers: { 'x-auth-token': token }});
            }
            closeChatModal();
        });
    }

    // Send Quick Message
    document.querySelectorAll('.mm-quick-msg').forEach(btn => {
        btn.addEventListener('click', () => sendChat('predefined', btn.innerText));
    });

    // Send Credentials
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

function showMmPopup(reqId, blz) {
    currentRequestId = reqId;
    document.getElementById('mm-requester').innerText = blz;
    const popup = document.getElementById('mm-request-popup');
    if (!popup) return;
    
    popup.style.display = 'block';
    setTimeout(() => popup.style.bottom = '20px', 10);
    
    let timeLeft = 30;
    document.getElementById('mm-timer').innerText = timeLeft + 's';
    clearInterval(mmTimerInterval);
    mmTimerInterval = setInterval(() => {
        timeLeft--;
        document.getElementById('mm-timer').innerText = timeLeft + 's';
        if (timeLeft <= 0) {
            clearInterval(mmTimerInterval);
            hideMmPopup();
        }
    }, 1000);
}

window.hideMmPopup = function() {
    currentRequestId = null;
    clearInterval(mmTimerInterval);
    const popup = document.getElementById('mm-request-popup');
    if (!popup) return;
    
    popup.style.bottom = '-200px';
    setTimeout(() => {
        popup.style.display = 'none';
    }, 400);

    const findBtn = document.getElementById('find-squad-btn');
    if (findBtn) {
        if (findBtn.innerText === 'SEARCHING...') {
            findBtn.disabled = false;
            findBtn.style.opacity = '1';
            findBtn.innerText = 'FIND A SQUAD';
        }
    }
}

function openChatModal(opponent) {
    document.getElementById('mm-chat-opponent').innerText = `vs ${opponent}`;
    document.getElementById('mm-chat-box').innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.8rem; margin-bottom:10px;">Match confirmed! You may now share credentials. Chat is restricted to pre-defined phrases.</div>';
    document.getElementById('mm-chat-modal').style.display = 'flex';
    
    startCooldownTimer(new Date(Date.now() + 30 * 60 * 1000));
    
    const limitSpan = document.getElementById('mm-daily-limit');
    if (limitSpan) {
        const match = limitSpan.innerText.match(/\d+/);
        if (match) {
            const currentLeft = parseInt(match[0]);
            if (currentLeft > 0) {
                limitSpan.innerText = `(${currentLeft - 1}/3 Left)`;
            }
        }
    }
}

function startCooldownTimer(targetDate) {
    const overlay = document.getElementById('ff-mm-overlay');
    const sub = document.getElementById('ff-mm-overlay-sub');
    const text = document.getElementById('ff-mm-overlay-text');
    
    if (overlay && sub && text) {
        overlay.style.display = 'flex';
        text.innerText = 'COOLDOWN';
        
        const banner = document.getElementById('ff-matchmaking-banner');
        if(banner) {
            banner.style.background = 'rgba(15, 10, 12, 0.4)';
            banner.style.borderColor = 'rgba(255,255,255,0.1)';
        }
        
        clearInterval(mmBlockInterval);
        const updateTimer = () => {
            const diff = targetDate - new Date();
            if (diff <= 0) {
                clearInterval(mmBlockInterval);
                overlay.style.display = 'none';
            } else {
                const m = Math.floor(diff / 60000).toString().padStart(2, '0');
                const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                sub.innerHTML = `<span style="font-family: var(--font-display); font-size: 1.8rem; color: #fff; letter-spacing: 2px;">${m}:${s}</span><br><span style="color:var(--text-muted); font-size:0.9rem;">REMAINING</span>`;
            }
        };
        updateTimer();
        mmBlockInterval = setInterval(updateTimer, 1000);
    }
}

function closeChatModal() {
    currentMatchId = null;
    const modal = document.getElementById('mm-chat-modal');
    if (modal) modal.style.display = 'none';
}

async function sendChat(type, message = null, roomId = null, password = null) {
    if (!currentMatchId) return;
    const token = localStorage.getItem('blaze_token');
    await fetch(`/api/matchmaking/chat/${currentMatchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ type, message, roomId, password })
    });
}

function appendChatMessage(senderId, type, message) {
    const box = document.getElementById('mm-chat-box');
    if (!box) return;
    
    const token = localStorage.getItem('blaze_token');
    const myUserId = JSON.parse(atob(token.split('.')[1])).id; 
    
    const isMe = senderId === myUserId;
    const align = isMe ? 'flex-end' : 'flex-start';
    const bg = isMe ? 'rgba(0,188,212,0.2)' : 'rgba(255,255,255,0.05)';
    const color = isMe ? '#00bcd4' : '#fff';
    const border = isMe ? '1px solid rgba(0,188,212,0.4)' : '1px solid rgba(255,255,255,0.1)';

    let html = `<div style="display:flex; flex-direction:column; align-items:${align}; margin-bottom:8px;">
        <div style="background:${bg}; color:${color}; border:${border}; padding:10px 14px; border-radius:12px; font-size:0.85rem; max-width:80%; word-break:break-word;">
            ${message}
        </div>
    </div>`;
    box.innerHTML += html;
    box.scrollTop = box.scrollHeight;
}
