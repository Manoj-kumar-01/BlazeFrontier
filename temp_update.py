import os
import glob

dir_path = 'backend/views/organizer'
files = glob.glob(os.path.join(dir_path, '*.ejs'))

old_code = '''        async function loadSlotReport() {
            const reportContainer = document.getElementById('slot-report-container');
            if (reportContainer) {
                try {
                    const res = await fetch(`/api/organizer/slot-report?t=${Date.now()}`, { 
                        headers: { 'x-auth-token': token },
                        cache: 'no-store' 
                    });
                    if (res.ok) {
                        const report = await res.json();
                        reportContainer.innerHTML = report.map(r => `
                            <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:15px; min-width: 120px; text-align: center; flex: 1;">
                                <div style="color:var(--text-400); font-size:0.85rem; margin-bottom: 8px; font-weight:600;">${r.date}</div>
                                <div style="color:var(--cyan); font-size:1.8rem; font-family:var(--font-display);">${r.count} <span style="font-size:0.9rem; color:var(--text-muted);">/ 5</span></div>
                            </div>
                        `).join('');
                    }
                } catch(e) { console.error('Error loading slot report', e); }
            }
        }'''

new_code = '''        async function loadSlotReport() {
            const reportContainer = document.getElementById('slot-report-container');
            if (reportContainer) {
                try {
                    const res = await fetch(`/api/organizer/slot-report?t=${Date.now()}`, { 
                        headers: { 'x-auth-token': token },
                        cache: 'no-store' 
                    });
                    if (res.ok) {
                        const report = await res.json();
                        window.slotReportData = report;
                        
                        if(!document.getElementById('slot-modal')) {
                            const m = document.createElement('div');
                            m.id = 'slot-modal';
                            m.innerHTML = `<div style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); backdrop-filter:blur(5px); z-index:9999; justify-content:center; align-items:center;" id="slot-modal-bg">
                                <div style="background:#111116; border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:30px; width: 90%; max-width:700px; max-height: 80vh; overflow-y: auto; position:relative;">
                                    <div style="display:flex; justify-content:space-between; margin-bottom:20px;">
                                        <h2 style="color:#fff; font-family:var(--font-display); font-size:1.5rem; letter-spacing:1px;" id="slot-modal-title">Slot Details</h2>
                                        <button onclick="document.getElementById('slot-modal-bg').style.display='none'" style="background:transparent; border:none; color:var(--text-muted); font-size:1.5rem; cursor:pointer;">&times;</button>
                                    </div>
                                    <div id="slot-modal-content" style="color:var(--text-300); font-size:0.9rem;"></div>
                                </div>
                            </div>`;
                            document.body.appendChild(m);
                            
                            window.openSlotModal = function(idx) {
                                const data = window.slotReportData[idx];
                                document.getElementById('slot-modal-title').innerText = 'Registrations for ' + data.date;
                                const content = document.getElementById('slot-modal-content');
                                if(!data.details || data.details.length === 0) {
                                    content.innerHTML = '<p>No registrations for this day.</p>';
                                } else {
                                    let html = '<table style="width:100%; border-collapse:collapse; text-align:left;">';
                                    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.1); color:var(--text-muted);"><th>Slot</th><th>Player</th><th>Blaze ID</th><th>Discord</th><th>Mode</th></tr>';
                                    data.details.forEach(d => {
                                        html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                            <td style="padding:10px 0; color:#fff;">${d.timeSlot}</td>
                                            <td style="padding:10px 0; color:var(--cyan);">${d.playerName}</td>
                                            <td style="padding:10px 0;">${d.playerId}</td>
                                            <td style="padding:10px 0;">${d.discord}</td>
                                            <td style="padding:10px 0;">${d.format} ${d.mode}</td>
                                        </tr>`;
                                    });
                                    html += '</table>';
                                    content.innerHTML = html;
                                }
                                document.getElementById('slot-modal-bg').style.display = 'flex';
                            };
                        }

                        reportContainer.innerHTML = report.map((r, i) => `
                            <div onclick="window.openSlotModal(${i})" style="cursor:pointer; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:15px; min-width: 120px; text-align: center; flex: 1; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='rgba(0,0,0,0.3)'">
                                <div style="color:var(--text-400); font-size:0.85rem; margin-bottom: 8px; font-weight:600;">${r.date}</div>
                                <div style="color:var(--cyan); font-size:1.8rem; font-family:var(--font-display);">${r.count} <span style="font-size:0.9rem; color:var(--text-muted);">/ 5</span></div>
                            </div>
                        `).join('');
                    }
                } catch(e) { console.error('Error loading slot report', e); }
            }
        }'''

for file_path in files:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    if 'loadSlotReport()' in content:
        if old_code in content:
            new_content = content.replace(old_code, new_code)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f'Replaced in {file_path}')
        else:
            print(f'Did not find exact match in {file_path}. Trying normalized replacement.')
            # sometimes \r\n vs \n issues
            old_code_norm = old_code.replace('\r\n', '\n')
            content_norm = content.replace('\r\n', '\n')
            if old_code_norm in content_norm:
                new_content = content_norm.replace(old_code_norm, new_code.replace('\r\n', '\n'))
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f'Replaced (norm) in {file_path}')
            else:
                print(f'Still failed in {file_path}')
