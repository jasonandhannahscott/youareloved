const gate = document.getElementById('security-gate');

if (gate && gate.dataset.authenticated === 'true') {
    initializeApp().then(() => {
        if (APP.audioContext && APP.audioContext.state === 'running') {
            gate.classList.add('hidden');
        }
    });
}
