const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, 'backend', 'views', 'organizer');
const files = ['dashboard.ejs', 'tournaments.ejs', 'results.ejs', 'registrations.ejs', 'clips.ejs', 'daily.ejs'];

const tabsHtml = `
        <!-- Global Tab Navigation -->
        <div class="org-global-tabs" style="display: flex; gap: 15px; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; scrollbar-width: none;">
            <a href="/organizer/tournaments" class="org-g-tab <%= activePage === '/organizer/tournaments' || activePage === '/organizer' ? 'active' : '' %>" style="text-decoration:none;">TOURNAMENTS</a>
            <a href="/organizer/results" class="org-g-tab <%= activePage === '/organizer/results' ? 'active' : '' %>" style="text-decoration:none;">RESULTS</a>
            <a href="/organizer/registrations" class="org-g-tab <%= activePage === '/organizer/registrations' ? 'active' : '' %>" style="text-decoration:none;">REGISTRATIONS</a>
            <a href="/organizer/clips" class="org-g-tab <%= activePage === '/organizer/clips' ? 'active' : '' %>" style="text-decoration:none;">CLIP SUBMISSIONS</a>
            <a href="/organizer/daily" class="org-g-tab <%= activePage === '/organizer/daily' ? 'active' : '' %>" style="text-decoration:none;">DAILY HIGHLIGHTS</a>
        </div>
`;

const videoModalHtml = `
    <!-- Clip Watch Modal -->
    <div class="org-modal-overlay" id="clipModal" style="z-index: 10000;">
        <div class="org-modal" style="width: 95%; max-width: 1000px; padding: 24px; background: #000; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin:0; font-size: 1.5rem;" id="clip-modal-title">WATCH CLIP</h2>
                <button onclick="closeClipModal()" style="background: rgba(255,255,255,0.1); border: none; color: #fff; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 1.2rem;">&times;</button>
            </div>
            <div style="flex: 1; background: #000; border-radius: 12px; overflow: hidden; display: flex; justify-content: center; align-items: center;">
                <video id="clip-modal-video" controls playsinline style="max-width: 100%; max-height: 70vh; width: 100%; border-radius: 12px;"></video>
            </div>
        </div>
    </div>
`;

files.forEach(filename => {
    const filepath = path.join(viewsDir, filename);
    if (!fs.existsSync(filepath)) return;
    
    let content = fs.readFileSync(filepath, 'utf-8');
    
    // Replace tabs block
    content = content.replace(/<div class="org-global-tabs"[\s\S]*?<div class="org-g-tab"[\s\S]*?DAILY HIGHLIGHTS<\/div>\s*<\/div>/, tabsHtml);
    
    // Disable all sections initially
    content = content.replace(/class="org-panel-section active"/g, 'class="org-panel-section"');
    content = content.replace(/\.org-panel-section \{ display: none; \}/g, '.org-panel-section { display: none; } /* removed */');
    
    // Hardcode display block for the intended panel
    if (filename === 'dashboard.ejs' || filename === 'tournaments.ejs') {
        content = content.replace('id="sec-tournaments"', 'id="sec-tournaments" style="display: block;"');
    } else if (filename === 'results.ejs') {
        content = content.replace('id="sec-results"', 'id="sec-results" style="display: block;"');
    } else if (filename === 'registrations.ejs') {
        content = content.replace('id="sec-registrations"', 'id="sec-registrations" style="display: block;"');
    } else if (filename === 'daily.ejs') {
        content = content.replace('id="sec-daily"', 'id="sec-daily" style="display: block;"');
    } else if (filename === 'clips.ejs') {
        content = content.replace('id="sec-clips"', 'id="sec-clips" style="display: block;"');
        // Fix video player
        content = content.replace(
            '<td><video src="${c.videoUrl}" controls width="180" style="border-radius:6px; background:#000; box-shadow: 0 4px 10px rgba(0,0,0,0.5);"></video></td>',
            '<td><button class="org-btn org-btn-primary" style="padding: 8px 16px; font-size: 0.8rem;" onclick="openClipModal(\\\'${c.videoUrl}\\\', \\\'${c.title}\\\')">▶ WATCH CLIP</button></td>'
        );
        // Inject modal
        content = content.replace('<!-- Create/Edit Tournament Modal -->', videoModalHtml + '\\n    <!-- Create/Edit Tournament Modal -->');
        // Inject JS
        content = content.replace('function switchGlobalTab(tabId, el) {', 'function openClipModal(url, title) { document.getElementById("clip-modal-title").innerText = title; document.getElementById("clip-modal-video").src = url; document.getElementById("clipModal").classList.add("active"); } function closeClipModal() { document.getElementById("clipModal").classList.remove("active"); document.getElementById("clip-modal-video").pause(); } function switchGlobalTab(tabId, el) {');
    }
    
    fs.writeFileSync(filepath, content, 'utf-8');
});

console.log("Refactor complete!");
