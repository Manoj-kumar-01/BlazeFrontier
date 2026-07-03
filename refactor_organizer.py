import os
import re

views_dir = r"backend\views\organizer"
files = ["dashboard.ejs", "tournaments.ejs", "results.ejs", "registrations.ejs", "clips.ejs", "daily.ejs"]

tabs_html = """
        <!-- Global Tab Navigation -->
        <div class="org-global-tabs" style="display: flex; gap: 15px; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; scrollbar-width: none;">
            <a href="/organizer/tournaments" class="org-g-tab <%= activePage === '/organizer/tournaments' || activePage === '/organizer' ? 'active' : '' %>" style="text-decoration:none;">TOURNAMENTS</a>
            <a href="/organizer/results" class="org-g-tab <%= activePage === '/organizer/results' ? 'active' : '' %>" style="text-decoration:none;">RESULTS</a>
            <a href="/organizer/registrations" class="org-g-tab <%= activePage === '/organizer/registrations' ? 'active' : '' %>" style="text-decoration:none;">REGISTRATIONS</a>
            <a href="/organizer/clips" class="org-g-tab <%= activePage === '/organizer/clips' ? 'active' : '' %>" style="text-decoration:none;">CLIP SUBMISSIONS</a>
            <a href="/organizer/daily" class="org-g-tab <%= activePage === '/organizer/daily' ? 'active' : '' %>" style="text-decoration:none;">DAILY HIGHLIGHTS</a>
        </div>
"""

video_modal_html = """
    <!-- Clip Watch Modal -->
    <div class="org-modal-overlay" id="clipModal">
        <div class="org-modal" style="width: 90%; max-width: 800px; padding: 24px; background: #000; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin:0; font-size: 1.5rem;" id="clip-modal-title">WATCH CLIP</h2>
                <button onclick="closeClipModal()" style="background: rgba(255,255,255,0.1); border: none; color: #fff; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 1.2rem;">&times;</button>
            </div>
            <div style="flex: 1; background: #000; border-radius: 12px; overflow: hidden; display: flex; justify-content: center; align-items: center;">
                <video id="clip-modal-video" controls playsinline style="max-width: 100%; max-height: 70vh; width: 100%; border-radius: 12px;"></video>
            </div>
        </div>
    </div>
"""

for filename in files:
    filepath = os.path.join(views_dir, filename)
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Replace global tabs using regex to catch the whole block
    content = re.sub(
        r'<div class="org-global-tabs".*?<div class="org-g-tab".*?DAILY HIGHLIGHTS</div>\s*</div>',
        tabs_html,
        content,
        flags=re.DOTALL
    )
    
    # Let's just hardcode the display inline style for the specific active page!
    if filename == "dashboard.ejs" or filename == "tournaments.ejs":
        content = content.replace('class="org-panel-section active" id="sec-tournaments"', 'class="org-panel-section active" id="sec-tournaments" style="display: block;"')
    elif filename == "results.ejs":
        content = content.replace('id="sec-results"', 'id="sec-results" style="display: block;"')
        content = content.replace('class="org-panel-section active"', 'class="org-panel-section"')
    elif filename == "registrations.ejs":
        content = content.replace('id="sec-registrations"', 'id="sec-registrations" style="display: block;"')
        content = content.replace('class="org-panel-section active"', 'class="org-panel-section"')
    elif filename == "clips.ejs":
        content = content.replace('id="sec-clips"', 'id="sec-clips" style="display: block;"')
        content = content.replace('class="org-panel-section active"', 'class="org-panel-section"')
        # Fix the video player
        content = content.replace(
            '<td><video src="${c.videoUrl}" controls width="180" style="border-radius:6px; background:#000; box-shadow: 0 4px 10px rgba(0,0,0,0.5);"></video></td>',
            '<td><button class="org-btn org-btn-primary" style="padding: 8px 16px; font-size: 0.8rem;" onclick="openClipModal(\'${c.videoUrl}\', \'${c.title}\')">▶ WATCH CLIP</button></td>'
        )
        # Inject modal
        content = content.replace('<!-- Create/Edit Tournament Modal -->', video_modal_html + '\n    <!-- Create/Edit Tournament Modal -->')
        # Inject JS
        content = content.replace('function switchGlobalTab(tabId, el) {', 'function openClipModal(url, title) { document.getElementById("clip-modal-title").innerText = title; document.getElementById("clip-modal-video").src = url; document.getElementById("clipModal").classList.add("active"); } function closeClipModal() { document.getElementById("clipModal").classList.remove("active"); document.getElementById("clip-modal-video").pause(); } function switchGlobalTab(tabId, el) {')

    elif filename == "daily.ejs":
        content = content.replace('id="sec-daily"', 'id="sec-daily" style="display: block;"')
        content = content.replace('class="org-panel-section active"', 'class="org-panel-section"')

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

print("Refactor complete!")
