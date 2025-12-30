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
                        <input type="range" id="volume-slider" class="vertical-slider" min="0" max="1" step="0.01">
                    </div>
                    <button id="volume-btn" class="bakelite-knob" title="Volume"></button>
                    <div class="knob-label">VOL</div>
                </div>

                <div class="center-console">
                    <div class="transport-controls-group">
                        <button class="transport-btn" id="stop-btn" title="Stop">&#x23F9;</button>
                        <button class="transport-btn" id="pause-btn" title="Pause">&#x23F8;</button>
                        <button class="transport-btn active" id="play-btn" title="Play">&#x23F5;</button>
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
                <button class="shuffle-btn-icon active" id="shuffle-btn" title="Shuffle">&#x1F500;</button>
                <button class="repeat-btn" id="repeat-btn" title="Repeat">&#x1F501;</button>
            </div>
        </div>

        <div class="program-guide-content" id="program-guide-content"></div>
    </div>
