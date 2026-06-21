const fs = require('fs');
const path = require('path');

function replaceInDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !fullPath.includes('node_modules')) {
            replaceInDir(fullPath);
        } else if (fullPath.endsWith('.html') || fullPath.endsWith('.ejs')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;
            
            if (content.includes('&display=swap')) {
                content = content.replace(/&display=swap/g, '&display=block');
                changed = true;
            }
            
            if (changed) {
                fs.writeFileSync(fullPath, content);
                console.log('Fixed FOUT in ' + fullPath);
            }
        }
    }
}

replaceInDir('c:/Users/manoj/OneDrive/Desktop/BlazeFrontier/public');
replaceInDir('c:/Users/manoj/OneDrive/Desktop/BlazeFrontier/backend/views');
