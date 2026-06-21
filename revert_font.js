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
            
            if (content.includes('Rajdhani:wght@600;700')) {
                content = content.replace(/Rajdhani:wght@600;700/g, 'Bebas+Neue');
                changed = true;
            }
            if (content.includes('Montserrat:wght@800;900')) {
                content = content.replace(/Montserrat:wght@800;900/g, 'Bebas+Neue');
                changed = true;
            }
            if (content.includes('<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Montserrat')) {
                content = content.replace(/<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Montserrat[^>]+>\r?\n\s*/g, '');
                changed = true;
            }
            if (content.includes('<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Rajdhani')) {
                content = content.replace(/<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Rajdhani[^>]+>\r?\n\s*/g, '');
                changed = true;
            }
            
            if (changed) {
                fs.writeFileSync(fullPath, content);
                console.log('Reverted ' + fullPath);
            }
        }
    }
}

replaceInDir('c:/Users/manoj/OneDrive/Desktop/BlazeFrontier/public');
replaceInDir('c:/Users/manoj/OneDrive/Desktop/BlazeFrontier/backend/views');
