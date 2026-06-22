/* ============================================================
   DISPLAYFORGE — Cinematic Engine v2
   Mesh Grid · Mouse Glow · Parallax · Counters · Reveal
   ============================================================ */

(function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        initMeshGrid();
        initMouseGlow();
        initScrollProgress();
        initNavigation();
        initRevealSystem();
        initCounters();
        initBarFills();
        initRingProgress();
        initParallaxRings();
        initCardDepthHover();
        initDeepParallax();
        // initShowcaseTabs(); // Commented out to prevent JS crash (function undefined)
        initVideoSpeed();
        initMobile();
    }

    /* ============================================================
       INTERACTIVE MESH GRID — Animated dot grid background
       Points react to mouse proximity with glow and connections
       ============================================================ */
    function initMeshGrid() {
        const canvas = document.getElementById('mesh-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        let w, h;
        let cols, rows;
        const SPACING = 50;
        let points = [];
        let mouse = { x: -1000, y: -1000 };
        const MOUSE_RADIUS = 200;

        function resize() {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
            cols = Math.ceil(w / SPACING) + 1;
            rows = Math.ceil(h / SPACING) + 1;
            buildGrid();
        }

        function buildGrid() {
            points = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    points.push({
                        x: c * SPACING,
                        y: r * SPACING,
                        baseX: c * SPACING,
                        baseY: r * SPACING,
                        size: 1,
                        alpha: 0.06
                    });
                }
            }
        }

        document.addEventListener('mousemove', e => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        });

        document.addEventListener('mouseleave', () => {
            mouse.x = -1000;
            mouse.y = -1000;
        });

        function draw() {
            ctx.clearRect(0, 0, w, h);

            // Scroll offset for parallax
            const scrollY = window.scrollY * 0.15;

            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                const drawY = p.baseY - (scrollY % SPACING);

                // Distance to mouse
                const dx = mouse.x - p.baseX;
                const dy = mouse.y - drawY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                let targetAlpha = 0.04;
                let targetSize = 1;
                let offsetX = 0;
                let offsetY = 0;

                if (dist < MOUSE_RADIUS) {
                    const proximity = 1 - (dist / MOUSE_RADIUS);
                    targetAlpha = 0.04 + proximity * 0.25;
                    targetSize = 1 + proximity * 2;

                    // Push away from mouse slightly
                    const angle = Math.atan2(dy, dx);
                    const pushStrength = proximity * 8;
                    offsetX = -Math.cos(angle) * pushStrength;
                    offsetY = -Math.sin(angle) * pushStrength;
                }

                // Smooth interpolation
                p.alpha += (targetAlpha - p.alpha) * 0.08;
                p.size += (targetSize - p.size) * 0.08;
                p.x += (p.baseX + offsetX - p.x) * 0.08;
                p.y += (drawY + offsetY - p.y) * 0.08;

                // Draw point
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(230, 57, 70, ${p.alpha})`;
                ctx.fill();

                // Connect to neighbors if close to mouse
                if (dist < MOUSE_RADIUS * 1.2) {
                    // Right neighbor
                    const rightIdx = i + 1;
                    if (rightIdx < points.length && (i + 1) % cols !== 0) {
                        const rp = points[rightIdx];
                        const lineAlpha = p.alpha * 0.4;
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(rp.x, rp.y);
                        ctx.strokeStyle = `rgba(230, 57, 70, ${lineAlpha})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                    // Bottom neighbor
                    const bottomIdx = i + cols;
                    if (bottomIdx < points.length) {
                        const bp = points[bottomIdx];
                        const lineAlpha = p.alpha * 0.4;
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(bp.x, bp.y);
                        ctx.strokeStyle = `rgba(230, 57, 70, ${lineAlpha})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(draw);
        }

        resize();
        draw();
        window.addEventListener('resize', resize);
    }

    /* ============================================================
       MOUSE GLOW — Ambient following glow
       ============================================================ */
    function initMouseGlow() {
        const glow = document.getElementById('mouse-glow');
        if (!glow) return;

        document.addEventListener('mousemove', e => {
            glow.style.left = e.clientX + 'px';
            glow.style.top = e.clientY + 'px';
            glow.classList.add('visible');
        });

        document.addEventListener('mouseleave', () => {
            glow.classList.remove('visible');
        });
    }

    /* ============================================================
       SCROLL PROGRESS BAR
       ============================================================ */
    function initScrollProgress() {
        const bar = document.getElementById('scroll-progress');
        if (!bar) return;

        window.addEventListener('scroll', () => {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = (scrollTop / docHeight) * 100;
            bar.style.width = progress + '%';
        }, { passive: true });
    }

    /* ============================================================
       NAVIGATION
       ============================================================ */
    function initNavigation() {
        const nav = document.getElementById('nav');
        const items = document.querySelectorAll('.nav-item');
        const sections = document.querySelectorAll('section[id]');
        const toggle = document.getElementById('mobile-toggle');
        const menu = document.getElementById('nav-menu');

        window.addEventListener('scroll', () => {
            nav.classList.toggle('scrolled', window.scrollY > 40);

            let current = 'hero';
            sections.forEach(s => {
                const rect = s.getBoundingClientRect();
                if (rect.top <= 250 && rect.bottom >= 250) {
                    current = s.id;
                }
            });
            items.forEach(item => {
                const rawHref = item.getAttribute('href');
                if (rawHref && rawHref.startsWith('#') && rawHref.length > 1) {
                    const href = rawHref.replace('#', '');
                    item.classList.toggle('active', href === current);
                }
            });
        }, { passive: true });

        items.forEach(item => {
            item.addEventListener('click', e => {
                const href = item.getAttribute('href');
                // Only intercept internal anchor links for smooth scrolling
                if (href && href.startsWith('#')) {
                    e.preventDefault();
                    const target = document.querySelector(href);
                    if (target) {
                        window.scrollTo({
                            top: target.offsetTop - 72,
                            behavior: 'smooth'
                        });
                    }
                    if (menu) menu.classList.remove('open');
                }
                // If it doesn't start with '#', let the browser naturally navigate to the other page
            });
        });

        if (toggle && menu) {
            toggle.addEventListener('click', () => {
                menu.classList.toggle('open');
            });
        }
        
        // Trigger once on load to set initial active state
        window.dispatchEvent(new Event('scroll'));
    }

    /* ============================================================
       REVEAL SYSTEM — Intersection Observer
       ============================================================ */
    function initRevealSystem() {
        const elements = document.querySelectorAll('[data-reveal]');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.08,
            rootMargin: '0px 0px -40px 0px'
        });

        elements.forEach(el => observer.observe(el));
    }

    /* ============================================================
       COUNTER ANIMATIONS
       ============================================================ */
    function initCounters() {
        const elements = document.querySelectorAll('[data-count]');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    countUp(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        elements.forEach(el => observer.observe(el));
    }

    function countUp(el) {
        const target = parseFloat(el.dataset.count);
        const isDecimal = target % 1 !== 0;
        const duration = 2200;
        const start = performance.now();

        function tick(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 4);
            const val = target * ease;

            el.textContent = isDecimal ? val.toFixed(1) : Math.floor(val).toLocaleString();

            if (progress < 1) {
                requestAnimationFrame(tick);
            } else {
                el.textContent = isDecimal ? target.toFixed(1) : target.toLocaleString();
            }
        }

        requestAnimationFrame(tick);
    }

    /* ============================================================
       BAR FILL ANIMATIONS
       ============================================================ */
    function initBarFills() {
        const bars = document.querySelectorAll('.card-bar-fill[data-width]');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.style.width = entry.target.dataset.width + '%';
                    }, 300);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });

        bars.forEach(bar => observer.observe(bar));
    }

    /* ============================================================
       SVG RING PROGRESS
       ============================================================ */
    function initRingProgress() {
        const rings = document.querySelectorAll('.ring-progress');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const circle = entry.target;
                    const circumference = 2 * Math.PI * 52;
                    const targetPercent = parseFloat(circle.dataset.target) || 0;
                    const offset = circumference - (circumference * (targetPercent / 100));

                    setTimeout(() => {
                        circle.style.strokeDashoffset = offset;
                    }, 400);

                    observer.unobserve(circle);
                }
            });
        }, { threshold: 0.5 });

        rings.forEach(ring => observer.observe(ring));
    }

    /* ============================================================
       PARALLAX RINGS — Mouse-following depth
       ============================================================ */
    function initParallaxRings() {
        const rings = document.querySelectorAll('[data-parallax]');
        if (rings.length === 0) return;

        let mouseX = 0, mouseY = 0;
        let currentX = 0, currentY = 0;

        document.addEventListener('mousemove', e => {
            mouseX = (e.clientX - window.innerWidth / 2);
            mouseY = (e.clientY - window.innerHeight / 2);
        });

        function animate() {
            currentX += (mouseX - currentX) * 0.04;
            currentY += (mouseY - currentY) * 0.04;

            rings.forEach(ring => {
                const depth = parseFloat(ring.dataset.parallax) || 0.02;
                const x = currentX * depth;
                const y = currentY * depth;
                ring.style.transform = `translate(${x}px, ${y}px)`;
            });

            requestAnimationFrame(animate);
        }

        animate();
    }

    /* ============================================================
       CARD DEPTH HOVER — Smooth perspective tilt
       ============================================================ */
    function initCardDepthHover() {
        const cards = document.querySelectorAll('.player-card');

        cards.forEach(card => {
            card.addEventListener('mousemove', e => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;

                const rotateX = (0.5 - y) * 8;
                const rotateY = (x - 0.5) * 8;

                card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(600px) rotateX(0) rotateY(0) translateY(0)';
                card.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
            });

            card.addEventListener('mouseenter', () => {
                card.style.transition = 'transform 0.15s ease-out';
            });
        });
    }

    /* ============================================================
       VIDEO PLAYBACK SPEED
       ============================================================ */
    function initDeepParallax() {
        const cards = document.querySelectorAll('.tilt-card-3d');
        
        cards.forEach(card => {
            const layers = card.querySelectorAll('.parallax-layer');
            const bg = card.querySelector('.cinematic-bg');
            
            card.addEventListener('mousemove', e => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;
                
                const rotateX = (0.5 - y) * 15;
                const rotateY = (x - 0.5) * 15;
                
                card.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
                card.style.transition = 'transform 0.1s linear';
                
                layers.forEach(layer => {
                    let z = 0;
                    if(layer.classList.contains('parallax-layer-1')) z = 30;
                    else if(layer.classList.contains('parallax-layer-2')) z = 60;
                    else if(layer.classList.contains('parallax-layer-3')) z = 100;
                    
                    const moveX = (0.5 - x) * (z * 0.5);
                    const moveY = (0.5 - y) * (z * 0.5);
                    
                    layer.style.transform = `translateZ(${z}px) translate(${moveX}px, ${moveY}px)`;
                    layer.style.transition = 'transform 0.1s linear';
                });

                if (bg) {
                    const bgMoveX = (x - 0.5) * 20;
                    const bgMoveY = (y - 0.5) * 20;
                    bg.style.transform = `translate(${bgMoveX}px, ${bgMoveY}px)`;
                    bg.style.transition = 'transform 0.1s linear';
                }
            });
            
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(1200px) rotateX(0) rotateY(0)';
                card.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
                
                layers.forEach(layer => {
                    let z = 0;
                    if(layer.classList.contains('parallax-layer-1')) z = 30;
                    else if(layer.classList.contains('parallax-layer-2')) z = 60;
                    else if(layer.classList.contains('parallax-layer-3')) z = 100;
                    layer.style.transform = `translateZ(${z}px) translate(0, 0)`;
                    layer.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
                });
                if (bg) {
                    bg.style.transform = `translate(0, 0)`;
                    bg.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
                }
            });
        });

        // Also add scroll-based tilt for showcase heroes
        const heroes = document.querySelectorAll('.showcase-hero');
        if (heroes.length > 0) {
            window.addEventListener('scroll', () => {
                const scrolled = window.scrollY;
                heroes.forEach(hero => {
                    const title = hero.querySelector('.showcase-title-3d');
                    if (title) {
                        const tilt = 20 - (scrolled * 0.05);
                        title.style.transform = `rotateX(${tilt}deg)`;
                    }
                });
            }, {passive: true});
        }
    }

    /* ============================================================
       VIDEO PLAYBACK SPEED
       ============================================================ */
    function initVideoSpeed() {
        const video = document.getElementById('hero-bg-video');
        if (video) {
            video.playbackRate = 1.0; // Normal speed
        }
    }

    /* ============================================================
       MOBILE NAVIGATION & VIDEO
       ============================================================ */
    function initMobile() {
        const mobileToggle = document.getElementById('mobile-toggle');
        const navMenu = document.getElementById('nav-menu');
        const navRight = document.querySelector('.nav-right');
        
        function closeMenu() {
            if (mobileToggle) mobileToggle.classList.remove('active');
            if (navMenu) navMenu.classList.remove('active');
            if (navRight) navRight.classList.remove('active');
        }

        if (mobileToggle) {
            mobileToggle.addEventListener('click', () => {
                mobileToggle.classList.toggle('active');
                if (navMenu) navMenu.classList.toggle('active');
                if (navRight) navRight.classList.toggle('active');
            });
        }

        const navLinks = document.querySelectorAll('.nav-item');
        navLinks.forEach(link => {
            if (!link.classList.contains('notif-wrapper')) {
                link.addEventListener('click', closeMenu);
            }
        });

        const videoSource = document.querySelector('#hero-bg-video source');
        const video = document.getElementById('hero-bg-video');
        
        if (videoSource && video) {
            function updateVideoSource() {
                if (window.innerWidth <= 768) {
                    if (!videoSource.src.includes('MobileBG')) {
                        videoSource.src = '../public/MobileBG.mp4';
                        video.load();
                    }
                } else {
                    if (!videoSource.src.includes('DesktopBG')) {
                        videoSource.src = '../public/DesktopBG.mp4';
                        video.load();
                    }
                }
            }
            updateVideoSource();
            window.addEventListener('resize', updateVideoSource);
        }
    }

})();


/* ============================================================
   GLOBAL CUSTOM PROMPTS (TOASTS & MODALS)
   ============================================================ */
(function() {
    // Inject Toast Container
    let toastContainer = document.getElementById("blaze-toast-container");
    if (!toastContainer) {
        toastContainer = document.createElement("div");
        toastContainer.id = "blaze-toast-container";
        toastContainer.className = "blaze-toast-container";
        document.body.appendChild(toastContainer);
    }

    // Override native alert globally
    window.alert = function(msg) {
        const toast = document.createElement("div");
        toast.className = "blaze-toast";
        toast.innerHTML = msg;
        
        // Error styling if it contains "error" or "failed"
        if (msg && (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("denied"))) {
            toast.style.borderColor = "rgba(239, 68, 68, 0.4)";
            toast.style.borderLeftColor = "#ef4444";
            toast.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5), 0 0 15px rgba(239, 68, 68, 0.15)";
        } else if (msg && (msg.toLowerCase().includes("success") || msg.toLowerCase().includes("verified") || msg.toLowerCase().includes("approved"))) {
            toast.style.borderColor = "rgba(34, 197, 94, 0.4)";
            toast.style.borderLeftColor = "#22c55e";
            toast.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5), 0 0 15px rgba(34, 197, 94, 0.15)";
        }

        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add("closing");
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    };

    // Custom Confirm Modal (Async)
    window.customConfirm = function(msg) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "blaze-modal-overlay";

            const box = document.createElement("div");
            box.className = "blaze-modal-box";
            
            const title = document.createElement("div");
            title.className = "bm-title";
            title.innerText = "CONFIRMATION REQUIRED";

            const message = document.createElement("div");
            message.className = "bm-msg";
            message.innerText = msg;

            const actions = document.createElement("div");
            actions.className = "bm-actions";

            const btnCancel = document.createElement("button");
            btnCancel.className = "bm-btn bm-btn-cancel";
            btnCancel.innerText = "CANCEL";
            
            const btnConfirm = document.createElement("button");
            btnConfirm.className = "bm-btn bm-btn-confirm";
            btnConfirm.innerText = "PROCEED";

            btnCancel.onclick = () => {
                overlay.style.opacity = "0";
                setTimeout(() => overlay.remove(), 200);
                resolve(false);
            };

            btnConfirm.onclick = () => {
                overlay.style.opacity = "0";
                setTimeout(() => overlay.remove(), 200);
                resolve(true);
            };

            actions.appendChild(btnCancel);
            actions.appendChild(btnConfirm);
            
            box.appendChild(title);
            box.appendChild(message);
            box.appendChild(actions);
            overlay.appendChild(box);
            
            document.body.appendChild(overlay);
        });
    };
})();

