window.customConfirm = function(message) {
    return new Promise((resolve) => {
        // Create modal container
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.background = 'rgba(0, 0, 0, 0.8)';
        modal.style.backdropFilter = 'blur(5px)';
        modal.style.zIndex = '100000';
        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';

        // Create modal content box
        const box = document.createElement('div');
        box.style.background = '#111116';
        box.style.border = '1px solid #00bcd4';
        box.style.borderRadius = '12px';
        box.style.padding = '30px';
        box.style.width = '90%';
        box.style.maxWidth = '400px';
        box.style.boxShadow = '0 10px 40px rgba(0,0,0,0.5)';
        box.style.textAlign = 'center';

        // Message
        const msg = document.createElement('p');
        msg.style.color = '#fff';
        msg.style.fontSize = '1.1rem';
        msg.style.lineHeight = '1.5';
        msg.style.marginBottom = '20px';
        msg.innerText = message;

        // Button Container
        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '10px';
        btnContainer.style.justifyContent = 'center';

        // Yes Button
        const btnYes = document.createElement('button');
        btnYes.innerText = 'CONFIRM';
        btnYes.style.flex = '1';
        btnYes.style.background = '#00bcd4';
        btnYes.style.color = '#fff';
        btnYes.style.border = 'none';
        btnYes.style.padding = '12px';
        btnYes.style.borderRadius = '8px';
        btnYes.style.fontWeight = 'bold';
        btnYes.style.cursor = 'pointer';

        // No Button
        const btnNo = document.createElement('button');
        btnNo.innerText = 'CANCEL';
        btnNo.style.flex = '1';
        btnNo.style.background = 'rgba(255,255,255,0.1)';
        btnNo.style.color = '#fff';
        btnNo.style.border = 'none';
        btnNo.style.padding = '12px';
        btnNo.style.borderRadius = '8px';
        btnNo.style.cursor = 'pointer';

        btnContainer.appendChild(btnNo);
        btnContainer.appendChild(btnYes);
        box.appendChild(msg);
        box.appendChild(btnContainer);
        modal.appendChild(box);
        document.body.appendChild(modal);

        const cleanup = () => {
            document.body.removeChild(modal);
        };

        btnYes.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });

        btnNo.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });
    });
};
