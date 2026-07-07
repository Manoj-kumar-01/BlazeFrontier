const fs = require('fs');
let f = fs.readFileSync('backend/views/organizer/clips.ejs', 'utf8');

f = f.replace(
    /const safeUrl = c\.videoUrl\.replace\(\/'\/g, "\\\\'"\);/g,
    "const safeUrl = (c.videoUrl || '').replace(/'/g, \"\\\\'\");"
);

f = f.replace(
    /const safeTitle = c\.title\.replace\(\/'\/g, "\\\\'"\);/g,
    "const safeTitle = (c.title || 'Untitled').replace(/'/g, \"\\\\'\").replace(/\\n/g, \" \").replace(/\\r/g, \"\").replace(/\"/g, '&quot;');"
);

fs.writeFileSync('backend/views/organizer/clips.ejs', f);
console.log('Fixed clips.ejs');
