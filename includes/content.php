    <div id="security-gate" data-authenticated="<?php echo $isLoggedIn ? 'true' : 'false'; ?>">
        <div class="password-container" <?php echo $isLoggedIn ? 'style="display:none;"' : ''; ?>>
            <input type="password" id="password-input" placeholder="Enter Password" autocomplete="off">
            <div class="error-msg" id="error-msg">Incorrect password</div>
        </div>
        <div class="power-btn" id="gate-power-btn"></div>
    </div>

    <div class="radio-cabinet" id="radio-cabinet">
        <div class="speaker-grille">
            <div class="excerpt-display" id="excerpt-display">
                <p>Welcome to The Zenith Companion</p>
            </div>
            <div class="video-overlay" id="video-overlay">
                <video id="video-player" controls muted playsinline></video>
            </div>
            
            <div class="zenith-logo">Zenith</div>
        </div>

        <div class="control-strip">
            
            <div class="dial-container" id="main-dial-container">
                <div class="scroll-indicator left" id="scroll-left">&#x300A;</div>
                <div class="scroll-indicator right" id="scroll-right">&#x27EB;</div>
                <div class="needle"></div>
                <div class="dial-track" id="dial-track"></div>
            </div>

            <div class="controls-row">
                
                <div class="volume-control-group">
                    <div class="volume-slider-popup">
                        <input type="range" id="volume-slider" class="vertical-slider" min="0" max="1" step="0.01" value="1">
                    </div>
                    <button id="volume-btn" class="bakelite-knob" title="Volume"></button>
                    <div class="knob-label">VOL</div>
                </div>

                <div class="center-console">
                    <div class="transport-controls-group">
                        <button class="transport-btn" id="stop-btn" title="Stop">
                            <svg viewBox="0 0 24 24" class="transport-icon" aria-hidden="true">
                                <rect x="7" y="7" width="10" height="10"></rect>
                            </svg>
                        </button>
                        <button class="transport-btn" id="pause-btn" title="Pause">
                            <svg viewBox="0 0 24 24" class="transport-icon" aria-hidden="true">
                                <rect x="7" y="5" width="3" height="14"></rect>
                                <rect x="14" y="5" width="3" height="14"></rect>
                            </svg>
                        </button>
                        <button class="transport-btn active" id="play-btn" title="Play">
                            <svg viewBox="0 0 24 24" class="transport-icon" aria-hidden="true">
                                <polygon points="8,5 19,12 8,19"></polygon>
                            </svg>
                        </button>
                    </div>
                    <button class="push-button program-guide-btn" id="guide-btn">List</button>
                </div>

                <div class="tuning-control-group">
                    <div class="tuning-rocker">
                        <button class="rocker-half left" id="left-arrow">&#x2039;</button>
                        <button class="rocker-half right" id="right-arrow">&#x203A;</button>
                    </div>
                    <div class="knob-label">TUNE</div>
                </div>

            </div>
        </div>
    </div>

    <div class="modal-overlay" id="modal-overlay"></div>
    <div class="program-guide" id="program-guide">
        <div class="program-guide-header">
            <span>Program Guide</span>
            <span class="close-guide" id="close-guide">&#x2716;</span>
        </div>
        
        <div class="guide-controls-container" id="guide-controls">
            <div class="guide-tabs">
                <div class="tab-btn active" data-view="tracks">Tracks</div>
                <div class="tab-btn" data-view="book1">Book I</div>
                <div class="tab-btn" data-view="book2">Book II</div>
                <div class="tab-btn" data-view="artists">Artists</div>
                <div class="tab-btn" data-view="genres">Genres</div>
                <div class="tab-btn" data-view="playlists">Playlists</div>
            </div>
            
            <div class="shuffle-container">
                <button class="search-btn" id="search-btn" title="Search">&#x1F50D;</button>
                <button class="shuffle-btn" id="shuffle-btn" title="Shuffle">
                    <svg viewBox="0 0 24 24" class="control-icon" aria-hidden="true">
                        <path d="M16.47 5.47a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H14.5a2.25 2.25 0 0 0-1.81.91l-2.12 2.83a3.75 3.75 0 0 1-3.01 1.51H4a.75.75 0 0 1 0-1.5h3.56a2.25 2.25 0 0 0 1.81-.91l2.12-2.83a3.75 3.75 0 0 1 3.01-1.51h3.69l-1.72-1.72a.75.75 0 0 1 0-1.06ZM4 6.75a.75.75 0 0 1 .75-.75h2.81a3.75 3.75 0 0 1 3.01 1.51l.56.75a.75.75 0 0 1-1.2.9l-.56-.75a2.25 2.25 0 0 0-1.81-.91H4.75A.75.75 0 0 1 4 6.75Zm16.53 7.72a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H14.5a3.75 3.75 0 0 1-3.01-1.51l-.56-.75a.75.75 0 0 1 1.2-.9l.56.75a2.25 2.25 0 0 0 1.81.91h3.69l-1.72-1.72a.75.75 0 1 1 1.06-1.06l3 3Z"/>
                    </svg>
                </button>
                <button class="repeat-btn" id="repeat-btn" title="Repeat">
                    <svg viewBox="0 0 24 24" class="control-icon" aria-hidden="true">
                        <path d="M17.53 3.47a.75.75 0 0 1 0 1.06L16.06 6H18a4 4 0 0 1 4 4v4a.75.75 0 0 1-1.5 0v-4A2.5 2.5 0 0 0 18 7.5h-1.94l1.47 1.47a.75.75 0 1 1-1.06 1.06l-2.75-2.75a.75.75 0 0 1 0-1.06l2.75-2.75a.75.75 0 0 1 1.06 0ZM6.47 20.53a.75.75 0 0 1 0-1.06L7.94 18H6a4 4 0 0 1-4-4v-4a.75.75 0 0 1 1.5 0v4A2.5 2.5 0 0 0 6 16.5h1.94l-1.47-1.47a.75.75 0 1 1 1.06-1.06l2.75 2.75a.75.75 0 0 1 0 1.06l-2.75 2.75a.75.75 0 0 1-1.06 0Z"/>
                    </svg>
                </button>
            </div>
        </div>

        <div class="program-guide-content" id="program-guide-content"></div>
    </div>
