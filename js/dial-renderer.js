// ZENITH - DIAL RENDERER MODULE
// Handles 3D transformations and unified snap animations

const DialRenderer = {
    /**
     * Calculates 3D transform properties for a single station item
     */
    calculate3DTransform(distFromCenter, centerOffset, itemWidth) {
        const activeZone = centerOffset + itemWidth;
        
        // Return early if out of view (performance optimization)
        if (Math.abs(distFromCenter) > activeZone) {
            return { visible: false, opacity: 0 };
        }

        const normalizedDist = Math.abs(distFromCenter) / activeZone;
        const rawRotation = (distFromCenter / centerOffset) * CONFIG.MAX_ROTATION;
        const rotation = Math.max(-60, Math.min(60, rawRotation));
        const scale = 1.0 - (Math.pow(normalizedDist, 2) * 0.3);
        
        // Smoother opacity curve
        let opacity = Math.cos(normalizedDist * (Math.PI / 2)) * 1.2;
        opacity = Math.max(0, Math.min(1, opacity));
        
        const depth = 200 - (normalizedDist * CONFIG.MAX_DEPTH);
        const isActive = Math.abs(distFromCenter) < itemWidth / 2;

        return { visible: true, rotation, scale, opacity, depth, isActive };
    },

    /**
     * Updates styles for physical DOM elements (Standard/FM Dial)
     */
    updateStationStyles(container, trackElement, itemWidth) {
        if (!trackElement) return;
        
        const stations = trackElement.querySelectorAll('.station');
        const halfScreen = container.offsetWidth / 2;
        const currentX = gsap.getProperty(trackElement, 'x');

        stations.forEach((station, index) => {
            const stationX = currentX + (index * itemWidth) + itemWidth / 2;
            const dist = stationX - halfScreen;
            
            const style = this.calculate3DTransform(dist, halfScreen, itemWidth);

            if (!style.visible) {
                station.style.opacity = 0;
                return;
            }

            station.style.transform = `translateZ(-200px) rotateY(${style.rotation}deg) translateZ(${style.depth}px) scale(${style.scale})`;
            station.style.opacity = style.opacity;
            
            if (style.isActive) station.classList.add('active');
            else station.classList.remove('active');
        });
    },

    /**
     * Renders virtual items for large lists (AM Dial)
     */
    renderVirtualPool(pool, dataList, currentX, containerWidth, itemWidth) {
        if (!dataList.length || !containerWidth) return;

        const centerOffset = containerWidth / 2;
        const virtualCenter = -currentX;
        const centerIndex = Math.round(virtualCenter / itemWidth);
        const halfPool = Math.floor(pool.length / 2);
        const renderStart = centerIndex - halfPool;

        pool.forEach((el, i) => {
            const dataIndex = renderStart + i;
            
            // Boundary check
            if (dataIndex < 0 || dataIndex >= dataList.length) {
                el.style.opacity = 0;
                return;
            }

            // Calculate position
            const xPos = currentX + (dataIndex * itemWidth) + centerOffset - (itemWidth / 2);
            
            // Update content if index changed (Virtualization)
            if (el.dataset.renderedIndex != dataIndex) {
                const track = dataList[dataIndex];
                const artistEl = el.querySelector('.artist');
                if (artistEl) artistEl.textContent = Track.getArtist(track);
                
                const titleEl = el.querySelector('.title');
                if (titleEl) titleEl.textContent = Track.getTitle(track);
                
                el.dataset.renderedIndex = dataIndex;
                
                // Genre coloring
                const genre = Track.getGenre(track);
                el.style.color = (genre === 'News' || genre === 'Sports') ? '#ff6b35' : '';
            }

            // Calculate 3D style
            const dist = xPos - centerOffset + (itemWidth / 2);
            const style = this.calculate3DTransform(dist, centerOffset, itemWidth);

            if (!style.visible) {
                el.style.opacity = 0;
                return;
            }

            if (style.isActive) el.classList.add('active');
            else el.classList.remove('active');

            el.style.transform = `translate3d(${xPos}px, 0, -200px) rotateY(${style.rotation}deg) translateZ(${style.depth}px) scale(${style.scale})`;
            el.style.opacity = style.opacity;
        });
    },

    /**
     * Unified snap animation for both physical and virtual dials
     * Replaces snapToPosition and snapVirtualTo
     */
    animateSnap(target, targetX, options = {}) {
        const {
            duration = 0.5,
            ease = 'power2.out',
            immediate = false,
            onUpdate = null,
            onComplete = null,
            trackAudio = false
        } = options;

        // Kill existing animations
        gsap.killTweensOf(target);

        if (immediate) {
            gsap.set(target, { x: targetX });
            if (onUpdate) onUpdate();
            if (onComplete) onComplete();
            return;
        }

        gsap.to(target, {
            x: targetX,
            duration,
            ease,
            onUpdate: function() {
                // Audio effect during transition
                if (trackAudio) {
                    const dist = Math.abs(this.targets()[0]._gsap.x - targetX);
                    const sectionWidth = APP.sectionWidth || 180; 
                    const normDist = Math.min(dist / (sectionWidth / 2), 1);
                    
                    // Use AudioEngine if available, otherwise use APP directly
                    if (typeof AudioEngine !== 'undefined' && AudioEngine.context) {
                        AudioEngine.applyTuningEffect(normDist, 0.3);
                    } else {
                        if (APP.musicGain) APP.musicGain.gain.value = (1 - normDist) * APP.volume;
                        if (APP.staticGain && APP.isPlaying) APP.staticGain.gain.value = (normDist * 0.3 * APP.volume);
                    }
                }

                if (onUpdate) onUpdate();
            },
            onComplete: () => {
                if (trackAudio) {
                    // Use AudioEngine if available
                    if (typeof AudioEngine !== 'undefined' && AudioEngine.context) {
                        AudioEngine.clearTuningEffect();
                    } else {
                        if (APP.staticGain) APP.staticGain.gain.value = 0;
                        if (APP.musicGain) APP.musicGain.gain.value = APP.isPlaying ? APP.volume : 0;
                    }
                }
                if (onComplete) onComplete();
            }
        });
    }
};