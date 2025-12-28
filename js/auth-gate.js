const gateBtn = document.getElementById('gate-power-btn');
if(gateBtn) {
    gateBtn.addEventListener('click', async () => {
        const gate = document.getElementById('security-gate');
        
        if (gate.dataset.authenticated === 'true') {
            if (typeof APP !== 'undefined' && APP.initialized && APP.audioContext) {
                if (APP.audioContext.state === 'suspended') {
                    await APP.audioContext.resume();
                }
                gate.classList.add('hidden');
                if (APP.currentHowl && !APP.currentHowl.playing()) APP.currentHowl.play();
                const vid = document.getElementById('video-player');
                if (vid && vid.paused) vid.play().catch(()=>{});
                return; 
            }

            if (typeof initializeApp === 'function') {
                await initializeApp();
                gate.classList.add('hidden');
            } else {
                window.location.reload(); 
            }
        } else {
            const input = document.getElementById('password-input');
            const errorMsg = document.getElementById('error-msg');
            try {
                const response = await fetch('login.php', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: input.value })
                });
                const result = await response.json();
                if (result.success) {
                    gate.dataset.authenticated = 'true';
                    document.querySelector('.password-container').style.display = 'none';
                    await initializeApp();
                    gate.classList.add('hidden');
                } else {
                    errorMsg.classList.add('show');
                    setTimeout(() => errorMsg.classList.remove('show'), 2000);
                    input.value = '';
                }
            } catch (e) { console.error("Login error", e); }
        }
    });

    const pwInput = document.getElementById('password-input');
    if(pwInput) {
        pwInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') gateBtn.click();
        });
    }
}
