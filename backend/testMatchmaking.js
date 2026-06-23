const puppeteer = require('puppeteer');

async function run() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    
    // User 1
    const page1 = await browser.newPage();
    // User 2
    const page2 = await browser.newPage();

    const url = 'http://localhost:5000/dashboard/freefire';

    console.log("Setting tokens and navigating...");
    
    // Quick way to set local storage: Go to origin, set, then go to path
    await page1.goto('http://localhost:5000/');
    await page1.evaluate((t) => localStorage.setItem('blaze_token', t), process.argv[2]);
    await page1.goto(url);

    await page2.goto('http://localhost:5000/');
    await page2.evaluate((t) => localStorage.setItem('blaze_token', t), process.argv[3]);
    await page2.goto(url);

    console.log("Pages loaded.");
    
    // Wait for the find-squad-btn to appear
    await page1.waitForSelector('#find-squad-btn');
    await page2.waitForSelector('#find-squad-btn');

    // Attach console listeners
    page1.on('console', msg => console.log('PAGE 1 LOG:', msg.text()));
    page2.on('console', msg => console.log('PAGE 2 LOG:', msg.text()));

    console.log("Clicking 'Find a Squad' on Page 1...");

    // Wait and accept the custom Confirm popup
    // Wait, the customConfirm waits for #custom-confirm-yes. We can click it after it appears.
    page1.click('#find-squad-btn');
    await page1.waitForSelector('#custom-confirm-yes', { visible: true });
    await page1.click('#custom-confirm-yes');
    
    console.log("Button clicked and confirmed. Waiting for UI updates...");
    
    // Wait 2 seconds to let websockets fire
    await new Promise(r => setTimeout(r, 2000));
    
    // Check Page 1 Button Text
    const btnText1 = await page1.$eval('#find-squad-btn', el => el.innerText);
    console.log("Page 1 Button Text:", btnText1);

    // Check Page 2 Popup
    const popupStyle = await page2.$eval('#mm-request-popup', el => el.style.display);
    console.log("Page 2 Popup Display Style:", popupStyle);

    if (popupStyle !== 'none' && popupStyle !== '') {
        const reqName = await page2.$eval('#mm-requester', el => el.innerText);
        console.log("Page 2 Popup says request from:", reqName);
    } else {
        console.log("ERROR: Page 2 Popup is NOT VISIBLE!");
    }

    await browser.close();
}

run().catch(console.error);
