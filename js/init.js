const gate = document.getElementById('security-gate');

if (gate && gate.dataset.authenticated === 'true') {
    Debug.INIT('Authenticated user detected, auto-initializing');
    // For authenticated users, try to auto-initialize
    initializeApp().then(() => {
        Debug.INIT('initializeApp complete', { 
            audioContext: APP.audioContext?.state,
            hasHowl: !!APP.currentHowl,
            isPlaying: APP.isPlaying 
        });
        
        // Check if audio is actually playing or can play
        const checkAndHideGate = () => {
            Debug.INIT('Checking if gate can be hidden', { 
                contextState: APP.audioContext?.state,
                howlPlaying: APP.currentHowl?.playing() 
            });
            
            if (APP.audioContext) {
                if (APP.audioContext.state === 'running') {
                    // Audio context is running, hide gate immediately
                    Debug.INIT('Audio context running, hiding gate');
                    gate.classList.add('hidden');
                } else if (APP.audioContext.state === 'suspended') {
                    // Try to resume - some browsers allow this without interaction
                    Debug.INIT('Audio context suspended, attempting resume');
                    APP.audioContext.resume().then(() => {
                        if (APP.audioContext.state === 'running') {
                            Debug.INIT('Audio context resumed, hiding gate');
                            gate.classList.add('hidden');
                            // Try to start playback
                            if (APP.currentHowl && !APP.currentHowl.playing()) {
                                Debug.PLAYBACK('Starting playback after gate hide');
                                APP.currentHowl.play();
                            }
                        }
                    }).catch((err) => {
                        // Resume failed, user needs to click - show minimal gate
                        Debug.warn('Audio context resume failed, waiting for user interaction', err);
                    });
                }
            }
            
            // Also check if Howl is playing (it might work even if context check fails)
            if (APP.currentHowl && APP.currentHowl.playing()) {
                Debug.INIT('Howl already playing, hiding gate');
                gate.classList.add('hidden');
            }
        };
        
        // Check immediately
        checkAndHideGate();
        
        // Also check after a short delay (some browsers need this)
        setTimeout(checkAndHideGate, 500);
    }).catch((err) => {
        Debug.error('initializeApp failed', err);
    });
}
