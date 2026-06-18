const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../Dashboard');
const destDir = path.join(__dirname, 'views/dashboard');

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

['minimilitia.html', 'freefire.html', 'cod.html'].forEach(file => {
    let content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    
    // Replace <nav> block
    content = content.replace(/<nav class="nav scrolled" id="nav">[\s\S]*?<\/nav>/, '<%- include(\'../partials/navbar\') %>');
    
    // Replace paths
    content = content.replace(/\.\.\/public\//g, '/public/');
    content = content.replace(/\.\.\/style\.css/g, '/style.css');
    content = content.replace(/\.\.\/script\.js/g, '/script.js');
    content = content.replace(/src="dynamic_game\.js"/g, 'src="/Dashboard/dynamic_game.js"');
    
    fs.writeFileSync(path.join(destDir, file.replace('.html', '.ejs')), content);
    console.log('Converted ' + file);
});
