/**
 * Beyond Showrooms — First Look (repo-root shared; see style.css)
 * Masonry grid + lightbox + sticky room nav + collapsible rooms.
 *
 * Expects window.FIRST_LOOK_CONFIG (defined in the client index.html):
 * {
 *   rooms: [
 *     {
 *       id: 'living-room',          // used for anchors + sticky nav
 *       title: 'Living Room',
 *       images: [
 *         { src: 'livingroom1_01.jpg', caption: 'Material — detail.', alt: '…' }
 *       ]
 *     }
 *   ]
 * }
 */

(function () {
    'use strict';

    const config = window.FIRST_LOOK_CONFIG;
    if (!config) {
        console.error('FIRST_LOOK_CONFIG is required.');
        return;
    }

    const isProductLayout = config.pageLayout === 'products';
    if (isProductLayout) {
        if (!Array.isArray(config.products)) {
            console.error('FIRST_LOOK_CONFIG.products is required when pageLayout is "products".');
            return;
        }
    } else if (!Array.isArray(config.rooms)) {
        console.error('FIRST_LOOK_CONFIG.rooms is required.');
        return;
    }

    function getNavSections() {
        return isProductLayout ? (config.products || []) : (config.rooms || []);
    }

    function shouldShowStickyNav(sectionCount) {
        if (!sectionCount) return false;
        if (config.hideRoomNav) return false;
        if (isProductLayout) return config.showProductNav === true;
        return true;
    }

    const roomsRoot = document.getElementById('fl-rooms');
    const navRoot = document.getElementById('fl-room-nav');
    const quoteRoot = document.getElementById('fl-quote');
    // Quote-only pages may omit #fl-rooms; look pages always have it.
    if (!roomsRoot && !quoteRoot) return;

    const aspectCache = new Map();
    const masonryState = new WeakMap();
    let resizeTimer = null;

    /* ─── Column count (mobile 1 / tablet 2 / desktop 3) ─── */

    /* Column count uses gallery width (page is capped ~68rem, so viewport≥1280 never applied before). */
    function getColumnCount(width) {
        if (config.galleryLayout === 'single-column') return 1;
        if (width < 640) return 1;
        if (width < 960) return 2;
        return 3;
    }

    function getColumnGap(columnCount) {
        if (columnCount >= 3) return 16;
        if (columnCount >= 2) return 14;
        return 10;
    }

    /* ─── Masonry helpers (adapted from homepage showroom modal) ─── */

    function createColumns(parent, columnCount) {
        const columns = [];
        for (let i = 0; i < columnCount; i++) {
            const col = document.createElement('div');
            col.className = 'masonry-column';
            parent.appendChild(col);
            columns.push(col);
        }
        return columns;
    }

    function pickShortestColumn(columns, heights) {
        let target = 0;
        for (let c = 1; c < columns.length; c++) {
            if (heights[c] < heights[target]) {
                target = c;
            } else if (
                heights[c] === heights[target] &&
                columns[c].children.length < columns[target].children.length
            ) {
                target = c;
            }
        }
        return target;
    }

    function getColumnWidth(columnCount, gridEl) {
        const columnGap = getColumnGap(columnCount);
        const galleryWidth = gridEl.clientWidth || window.innerWidth;
        return Math.max(120, (galleryWidth - columnGap * (columnCount - 1)) / columnCount);
    }

    function loadAspect(src) {
        if (aspectCache.has(src)) {
            return Promise.resolve(aspectCache.get(src));
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
                const ratio =
                    img.naturalWidth > 0 && img.naturalHeight > 0
                        ? img.naturalHeight / img.naturalWidth
                        : 1.2;
                aspectCache.set(src, ratio);
                resolve(ratio);
            };
            img.onerror = () => {
                aspectCache.set(src, 1.2);
                resolve(1.2);
            };
            img.src = src;
        });
    }

    const EAGER_IMAGE_COUNT = 6; // first N images on the page load immediately (above the fold)

    function createGalleryItem(item, globalIndex) {
        const figure = document.createElement('figure');
        figure.className = 'fl-gallery__item';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'View larger: ' + (item.alt || item.caption || 'Furniture piece'));
        btn.dataset.lightboxIndex = String(globalIndex);

        const img = document.createElement('img');
        img.src = item.src;
        img.alt = item.alt || item.caption || '';
        // Top of page: eager. Below fold: browser lazy-loads as user scrolls.
        const eager = globalIndex < EAGER_IMAGE_COUNT;
        img.loading = eager ? 'eager' : 'lazy';
        img.decoding = 'async';
        if (globalIndex < 2) {
            img.fetchPriority = 'high';
        }

        btn.appendChild(img);
        figure.appendChild(btn);

        if (item.caption) {
            const caption = document.createElement('figcaption');
            caption.className = 'fl-gallery__caption';
            caption.textContent = item.caption;
            figure.appendChild(caption);
        }

        return figure;
    }

    function distributeImages(columns, images, columnCount, aspects, gridEl, indexOffset) {
        const heights = new Array(columnCount).fill(0);
        const columnGap = getColumnGap(columnCount);
        const columnWidth = getColumnWidth(columnCount, gridEl);

        images.forEach((item, i) => {
            const target = pickShortestColumn(columns, heights);
            const figure = createGalleryItem(item, indexOffset + i);
            columns[target].appendChild(figure);
            heights[target] += columnWidth * aspects[i] + columnGap;
        });
    }

    async function renderMasonry(gridEl, images, indexOffset) {
        if (!images.length) {
            gridEl.innerHTML = '';
            return;
        }

        const columnCount = getColumnCount(gridEl.clientWidth || window.innerWidth);
        const aspects = await Promise.all(images.map((item) => loadAspect(item.src)));

        gridEl.innerHTML = '';
        gridEl.classList.add('masonry-layout');
        const columns = createColumns(gridEl, columnCount);
        distributeImages(columns, images, columnCount, aspects, gridEl, indexOffset);

        masonryState.set(gridEl, { images, indexOffset, columnCount });
    }

    async function rerenderAllMasonry() {
        const grids = roomsRoot.querySelectorAll('.fl-masonry');
        for (const grid of grids) {
            const state = masonryState.get(grid);
            if (!state) continue;
            const nextCount = getColumnCount(grid.clientWidth || window.innerWidth);
            if (nextCount === state.columnCount) continue;
            await renderMasonry(grid, state.images, state.indexOffset);
        }
    }

    /* ─── Sticky nav ─── */

    function buildStickyNav(sections) {
        if (!navRoot) return;

        const inner = document.createElement('div');
        inner.className = 'fl-room-nav__inner';

        const topBtn = document.createElement('button');
        topBtn.type = 'button';
        topBtn.className = 'fl-room-nav__top';
        topBtn.setAttribute('aria-label', 'Back to top');
        topBtn.innerHTML =
            '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
            '<path fill="currentColor" d="M8 3.2 3.6 7.6a.75.75 0 0 0 1.06 1.06L7.25 6.07V13a.75.75 0 0 0 1.5 0V6.07l2.59 2.59a.75.75 0 1 0 1.06-1.06L8 3.2z"/>' +
            '</svg>';
        topBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        inner.appendChild(topBtn);

        navRoot.innerHTML = '';
        navRoot.classList.toggle('fl-room-nav--dropdown', isProductLayout);

        if (isProductLayout) {
            const jump = document.createElement('details');
            jump.className = 'fl-room-nav__jump';

            const summary = document.createElement('summary');
            summary.className = 'fl-room-nav__jump-summary';
            summary.setAttribute('aria-label', 'Jump to product');
            const current = document.createElement('span');
            current.className = 'fl-room-nav__jump-current';
            current.id = 'fl-room-nav-current';
            current.textContent = 'Browse products';
            summary.appendChild(current);

            const panel = document.createElement('div');
            panel.className = 'fl-room-nav__jump-panel';
            panel.setAttribute('role', 'list');

            sections.forEach((entry) => {
                const a = document.createElement('a');
                a.className = 'fl-room-nav__link';
                a.href = '#' + entry.id;
                a.textContent = entry.title;
                a.dataset.roomTarget = entry.id;
                a.setAttribute('role', 'listitem');
                panel.appendChild(a);
            });

            jump.appendChild(summary);
            jump.appendChild(panel);
            inner.appendChild(jump);

            panel.addEventListener('click', (e) => {
                const link = e.target.closest('.fl-room-nav__link');
                if (!link) return;
                jump.open = false;
            });
        } else {
            const list = document.createElement('ul');
            list.className = 'fl-room-nav__list';
            list.setAttribute('role', 'list');

            sections.forEach((room) => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.className = 'fl-room-nav__link';
                a.href = '#' + room.id;
                a.textContent = room.title;
                a.dataset.roomTarget = room.id;
                li.appendChild(a);
                list.appendChild(li);
            });

            inner.appendChild(list);
        }

        navRoot.appendChild(inner);
        navRoot.hidden = false;
    }

    const FLOATING_PRODUCT_MENU_HAMBURGER =
        '<svg class="fl-hub-menu__glyph-burger" viewBox="0 0 16 16" width="17" height="17" focusable="false" aria-hidden="true">' +
        '<path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" d="M3.25 4.75h9.5M3.25 8h9.5M3.25 11.25h9.5"/>' +
        '</svg>';

    function ensureFloatingProductMenu(products) {
        if (config.floatingProductMenu !== true) return;
        if (config.seriesHub === true) return;
        if (!products || !products.length) return;
        if (document.getElementById('fl-product-menu')) return;

        let productMenuJump = null;

        const closeProductMenu = () => {
            if (productMenuJump) productMenuJump.open = false;
        };

        const scrollToProduct = (productId) => {
            closeProductMenu();
            window.requestAnimationFrame(() => {
                const el = document.getElementById(productId);
                if (!el) return;
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                const nextHash = '#' + productId;
                if (location.hash !== nextHash) {
                    history.pushState({ flScroll: productId }, '', nextHash);
                }
            });
        };

        const scrollToPageSection = (selector) => {
            closeProductMenu();
            window.requestAnimationFrame(() => {
                const el = document.querySelector(selector);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        };

        const menu = document.createElement('nav');
        menu.id = 'fl-product-menu';
        menu.className = 'fl-hub-menu fl-product-menu is-hub';
        menu.setAttribute('aria-label', 'First Look menu');

        const inner = document.createElement('div');
        inner.className = 'fl-hub-menu__inner';

        productMenuJump = document.createElement('details');
        productMenuJump.className = 'fl-hub-menu__jump';

        const jumpSummary = document.createElement('summary');
        jumpSummary.className = 'fl-hub-menu__jump-summary';
        jumpSummary.setAttribute('aria-label', 'Menu');
        jumpSummary.innerHTML =
            '<span class="fl-hub-menu__glyph" aria-hidden="true">' +
            FLOATING_PRODUCT_MENU_HAMBURGER +
            '</span>';

        const panel = document.createElement('div');
        panel.className = 'fl-hub-menu__jump-panel';
        panel.setAttribute('role', 'list');

        const appendMenuDivider = () => {
            const divider = document.createElement('div');
            divider.className = 'fl-hub-menu__divider';
            divider.setAttribute('role', 'presentation');
            panel.appendChild(divider);
        };

        const sectionHeadingTitle = (product) => {
            if (!product || product.sectionHeading == null) return '';
            if (typeof product.sectionHeading === 'string') {
                return product.sectionHeading.trim();
            }
            if (typeof product.sectionHeading === 'object') {
                return typeof product.sectionHeading.title === 'string'
                    ? product.sectionHeading.title.trim()
                    : '';
            }
            return '';
        };

        products.forEach((product) => {
            if (!product || !product.id) return;
            const sectionTitle = sectionHeadingTitle(product);
            if (sectionTitle) {
                if (panel.childElementCount) appendMenuDivider();
                if (product.menu === false) {
                    const sectionBtn = document.createElement('button');
                    sectionBtn.type = 'button';
                    sectionBtn.className = 'fl-hub-menu__link fl-hub-menu__link--section';
                    sectionBtn.textContent = sectionTitle;
                    sectionBtn.setAttribute('data-product-id', product.id);
                    sectionBtn.setAttribute('role', 'listitem');
                    sectionBtn.addEventListener('click', () => scrollToProduct(product.id));
                    panel.appendChild(sectionBtn);
                } else {
                    const sectionLabel = document.createElement('p');
                    sectionLabel.className = 'fl-hub-menu__section';
                    sectionLabel.textContent = sectionTitle;
                    sectionLabel.setAttribute('role', 'presentation');
                    panel.appendChild(sectionLabel);
                }
            }
            if (product.menu === false) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'fl-hub-menu__link';
            const menuTitle =
                typeof product.menuTitle === 'string' && product.menuTitle.trim()
                    ? product.menuTitle.trim()
                    : product.title || product.id;
            btn.textContent = menuTitle;
            btn.setAttribute('data-product-id', product.id);
            btn.setAttribute('role', 'listitem');
            btn.addEventListener('click', () => scrollToProduct(product.id));
            panel.appendChild(btn);
        });

        appendMenuDivider();

        const hasSummarySection = products.some((product) => {
            if (!product || !product.title) return false;
            if (product.card === true || product.variant === 'card') return false;
            if (product.summary === false) return false;
            return true;
        });
        if (hasSummarySection) {
            const summaryBtn = document.createElement('button');
            summaryBtn.type = 'button';
            summaryBtn.className = 'fl-hub-menu__link';
            summaryBtn.textContent = 'Summary';
            summaryBtn.setAttribute('role', 'listitem');
            summaryBtn.addEventListener('click', () => scrollToPageSection('.fl-summary'));
            panel.appendChild(summaryBtn);
        }

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'fl-hub-menu__link fl-hub-menu__link--section';
        nextBtn.textContent = 'NEXT STEPS';
        nextBtn.setAttribute('role', 'listitem');
        nextBtn.addEventListener('click', () => scrollToPageSection('.fl-next'));

        panel.appendChild(nextBtn);

        productMenuJump.appendChild(jumpSummary);
        productMenuJump.appendChild(panel);
        inner.appendChild(productMenuJump);
        menu.appendChild(inner);

        document.addEventListener('click', (e) => {
            if (!productMenuJump.open) return;
            if (productMenuJump.contains(e.target)) return;
            productMenuJump.open = false;
        });

        const anchor =
            document.querySelector('.fl-page--products .fl-intro') ||
            document.querySelector('.fl-page--products .fl-header');
        if (anchor && anchor.parentNode) {
            anchor.insertAdjacentElement('afterend', menu);
        }
    }

    function setupActiveNav() {
        const links = navRoot ? Array.from(navRoot.querySelectorAll('.fl-room-nav__link')) : [];
        if (!links.length) return;

        const sections = getNavSections()
            .map((entry) => document.getElementById(entry.id))
            .filter(Boolean);
        if (!sections.length) return;

        let activeId = null;
        let lockUntil = 0;

        const jumpCurrent = navRoot ? navRoot.querySelector('.fl-room-nav__jump-current') : null;
        const navSections = getNavSections();

        const setBrowsePlaceholder = () => {
            if (!isProductLayout || !jumpCurrent) return;
            if (activeId === '__browse__') return;
            activeId = '__browse__';
            links.forEach((link) => link.classList.remove('is-active'));
            jumpCurrent.textContent = 'Browse products';
        };

        const setActive = (id) => {
            if (!id || id === activeId) return;
            activeId = id;
            links.forEach((link) => {
                const isActive = link.dataset.roomTarget === id;
                link.classList.toggle('is-active', isActive);
                if (
                    isActive &&
                    !isProductLayout &&
                    typeof link.scrollIntoView === 'function'
                ) {
                    link.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
                }
            });

            if (jumpCurrent) {
                const entry = navSections.find((item) => item.id === id);
                jumpCurrent.textContent = entry ? entry.title : '';
            }
        };

        const updateFromScroll = () => {
            if (Date.now() < lockUntil) return;

            const offset = (navRoot ? navRoot.getBoundingClientRect().height : 0) + 8;
            let current = sections[0].id;

            for (const section of sections) {
                if (section.getBoundingClientRect().top <= offset) {
                    current = section.id;
                }
            }

            const nearBottom =
                window.innerHeight + window.scrollY >=
                document.documentElement.scrollHeight - 48;
            if (nearBottom) {
                current = sections[sections.length - 1].id;
            }

            if (isProductLayout && jumpCurrent && sections[0].getBoundingClientRect().top > offset + 24) {
                setBrowsePlaceholder();
                return;
            }

            setActive(current);
        };

        links.forEach((link) => {
            link.addEventListener('click', () => {
                const id = link.dataset.roomTarget;
                if (!id) return;
                setActive(id);
                // Keep the clicked tab active while smooth scroll settles.
                lockUntil = Date.now() + 900;
            });
        });

        window.addEventListener('scroll', updateFromScroll, { passive: true });
        window.addEventListener('resize', updateFromScroll, { passive: true });
        updateFromScroll();
    }

    /* ─── Collapsible rooms ─── */

    function setupCollapse(sectionEl, toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const collapsed = sectionEl.classList.toggle('is-collapsed');
            toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });
    }

    /* ─── Scroll photo hint (config.scrollPhotoHint) ─── */

    let photoHintEl = null;
    let photoHintObserver = null;
    let photoHintUnlocked = false;
    /* In-memory only (no local/session storage): survives series changes, resets on full page reload */
    let photoHintDismissedThisLoad = false;

    function isScrollPhotoHintDismissed() {
        return photoHintDismissedThisLoad;
    }

    function dismissScrollPhotoHint() {
        if (config.scrollPhotoHint !== true) return;
        if (photoHintDismissedThisLoad) return;
        photoHintDismissedThisLoad = true;
        teardownScrollPhotoHint(true);
    }

    function showScrollPhotoHint() {
        if (!photoHintEl || !photoHintUnlocked) return;
        photoHintEl.classList.add('is-visible');
    }

    function teardownScrollPhotoHint(removeEl) {
        if (photoHintObserver) {
            photoHintObserver.disconnect();
            photoHintObserver = null;
        }
        photoHintUnlocked = false;
        if (photoHintEl) {
            photoHintEl.classList.remove('is-visible');
            if (removeEl) {
                photoHintEl.remove();
                photoHintEl = null;
            }
        }
    }

    function setupScrollPhotoHint(root) {
        if (config.scrollPhotoHint !== true) return;
        if (isScrollPhotoHintDismissed()) {
            teardownScrollPhotoHint(true);
            return;
        }

        teardownScrollPhotoHint(false);

        if (!photoHintEl) {
            photoHintEl = document.createElement('div');
            photoHintEl.id = 'fl-photo-hint';
            photoHintEl.className = 'fl-photo-hint';
            photoHintEl.setAttribute('role', 'status');

            photoHintEl.textContent = 'Tap any photo for full view';
            document.body.appendChild(photoHintEl);
        }

        photoHintUnlocked = false;

        const target = root
            ? root.querySelector('.fl-carousel') || root.querySelector('.fl-gallery__item')
            : null;
        if (!target) {
            return;
        }

        photoHintObserver = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (!entry || !entry.isIntersecting) return;
                photoHintUnlocked = true;
                if (photoHintObserver) {
                    photoHintObserver.disconnect();
                    photoHintObserver = null;
                }
                showScrollPhotoHint();
            },
            {
                root: null,
                threshold: 0.08,
                rootMargin: '0px 0px -18% 0px'
            }
        );
        photoHintObserver.observe(target);
    }

    /* ─── Lightbox ─── */

    let lightboxEl = null;
    let lightboxImg = null;
    let lightboxVideo = null;
    let lightboxCaption = null;
    let lightboxPrevBtn = null;
    let lightboxNextBtn = null;
    let allImages = [];
    let lightboxIndex = 0;

    function ensureLightbox() {
        lightboxEl = document.createElement('div');
        lightboxEl.className = 'fl-lightbox';
        lightboxEl.setAttribute('role', 'dialog');
        lightboxEl.setAttribute('aria-modal', 'true');
        lightboxEl.setAttribute('aria-label', 'Image preview');
        lightboxEl.hidden = true;

        lightboxEl.innerHTML =
            '<button type="button" class="fl-lightbox__close" aria-label="Close">&times;</button>' +
            '<button type="button" class="fl-lightbox__nav fl-lightbox__nav--prev" aria-label="Previous image">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
            '<path fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>' +
            '</svg></button>' +
            '<button type="button" class="fl-lightbox__nav fl-lightbox__nav--next" aria-label="Next image">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
            '<path fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/>' +
            '</svg></button>' +
            '<figure class="fl-lightbox__figure">' +
            '<img class="fl-lightbox__img" alt="">' +
            '<video class="fl-lightbox__video" controls playsinline></video>' +
            '<figcaption class="fl-lightbox__caption"></figcaption>' +
            '</figure>';

        document.body.appendChild(lightboxEl);
        lightboxImg = lightboxEl.querySelector('.fl-lightbox__img');
        lightboxVideo = lightboxEl.querySelector('.fl-lightbox__video');
        lightboxCaption = lightboxEl.querySelector('.fl-lightbox__caption');
        lightboxPrevBtn = lightboxEl.querySelector('.fl-lightbox__nav--prev');
        lightboxNextBtn = lightboxEl.querySelector('.fl-lightbox__nav--next');

        lightboxEl.querySelector('.fl-lightbox__close').addEventListener('click', closeLightbox);
        lightboxPrevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stepLightbox(-1);
        });
        lightboxNextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stepLightbox(1);
        });
        lightboxEl.addEventListener('click', (e) => {
            if (e.target === lightboxEl) closeLightbox();
        });
    }

    function galleryIndexesFor(index) {
        const current = allImages[index];
        if (!current) return [];
        const group = current.gallery || null;
        if (group) {
            return allImages
                .map((item, i) => (item.gallery === group ? i : -1))
                .filter((i) => i >= 0);
        }
        return allImages.map((_, i) => i);
    }

    function pauseLightboxVideo() {
        if (!lightboxVideo) return;
        lightboxVideo.pause();
        lightboxVideo.removeAttribute('src');
        lightboxVideo.load();
        lightboxVideo.hidden = true;
    }

    function showLightboxItem(index) {
        if (!allImages.length || !lightboxEl) return;
        const len = allImages.length;
        lightboxIndex = ((index % len) + len) % len;
        const item = allImages[lightboxIndex];
        const isVideo = item.media === 'video';

        if (isVideo) {
            lightboxImg.hidden = true;
            lightboxImg.removeAttribute('src');
            lightboxVideo.hidden = false;
            lightboxVideo.muted = false;
            lightboxVideo.src = item.src;
            lightboxVideo.load();
            lightboxVideo.play().catch(() => {});
        } else {
            pauseLightboxVideo();
            lightboxImg.hidden = false;
            lightboxImg.src = item.src;
            lightboxImg.alt = item.alt || item.caption || '';
        }

        const captionText = item.caption || item.alt || '';
        if (item.captionHtml) {
            lightboxCaption.innerHTML = item.captionHtml;
            lightboxCaption.hidden = false;
        } else {
            lightboxCaption.textContent = captionText;
            lightboxCaption.hidden = !captionText;
        }

        const multi = galleryIndexesFor(lightboxIndex).length > 1;
        lightboxPrevBtn.hidden = !multi;
        lightboxNextBtn.hidden = !multi;
    }

    function openLightbox(index) {
        if (!lightboxEl || !allImages.length) return;
        dismissScrollPhotoHint();
        showLightboxItem(index);
        lightboxEl.hidden = false;
        void lightboxEl.offsetWidth;
        lightboxEl.classList.add('is-open');
        document.body.classList.add('fl-lightbox-open');
    }

    function stepLightbox(delta) {
        if (!lightboxEl || !lightboxEl.classList.contains('is-open')) return;
        const group = galleryIndexesFor(lightboxIndex);
        if (group.length < 2) return;
        const pos = group.indexOf(lightboxIndex);
        const nextPos = ((pos + delta) % group.length + group.length) % group.length;
        showLightboxItem(group[nextPos]);
    }

    function closeLightbox() {
        if (!lightboxEl) return;
        lightboxEl.classList.remove('is-open');
        document.body.classList.remove('fl-lightbox-open');
        pauseLightboxVideo();
        window.setTimeout(() => {
            if (!lightboxEl.classList.contains('is-open')) {
                lightboxEl.hidden = true;
                lightboxImg.removeAttribute('src');
                lightboxImg.hidden = false;
            }
        }, 250);
    }

    function setupLightboxClicks() {
        const clickRoot = document.querySelector('.fl-page') || document;
        clickRoot.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-lightbox-index]');
            if (!btn) return;
            const index = Number(btn.dataset.lightboxIndex);
            if (!Number.isNaN(index)) openLightbox(index);
        });

        document.addEventListener('keydown', (e) => {
            if (lightboxEl && lightboxEl.classList.contains('is-open')) {
                if (e.key === 'Escape') closeLightbox();
                if (e.key === 'ArrowLeft') stepLightbox(-1);
                if (e.key === 'ArrowRight') stepLightbox(1);
                return;
            }

            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('.fl-quote__row[data-lightbox-index]');
            if (!row || e.target !== row) return;
            e.preventDefault();
            const index = Number(row.dataset.lightboxIndex);
            if (!Number.isNaN(index)) openLightbox(index);
        });
    }

    function buildQuoteSection() {
        const quote = config.quote;
        if (!quote || !quoteRoot) return;

        quoteRoot.innerHTML = '';

        const section = document.createElement('section');
        section.className = 'fl-room fl-quote';
        section.id = quote.id || 'master-bedroom';

        const heading = document.createElement('h2');
        heading.className = 'fl-room__title fl-quote__title';
        heading.textContent = quote.title || 'Master Bedroom';
        section.appendChild(heading);

        if (quote.intro) {
            const intro = document.createElement('p');
            intro.className = 'fl-room__intro';
            intro.textContent = quote.intro;
            section.appendChild(intro);
        }

        if (quote.hero && quote.hero.src) {
            const heroIndex = allImages.length;
            allImages.push({
                src: quote.hero.src,
                alt: quote.hero.alt || '',
                caption: quote.hero.caption || '',
                captionHtml: quote.hero.captionHtml || '',
                gallery: 'quote-hero'
            });

            const hero = document.createElement('figure');
            hero.className = 'fl-quote__hero';
            const heroBtn = document.createElement('button');
            heroBtn.type = 'button';
            heroBtn.className = 'fl-quote__hero-btn';
            heroBtn.dataset.lightboxIndex = String(heroIndex);
            heroBtn.setAttribute('aria-label', quote.hero.alt || 'View reference image larger');
            const heroImg = document.createElement('img');
            heroImg.src = quote.hero.src;
            heroImg.alt = quote.hero.alt || '';
            heroImg.loading = 'eager';
            heroImg.decoding = 'async';
            heroBtn.appendChild(heroImg);
            hero.appendChild(heroBtn);
            if (quote.hero.caption) {
                const cap = document.createElement('figcaption');
                cap.className = 'fl-quote__hero-caption';
                cap.textContent = quote.hero.caption;
                hero.appendChild(cap);
            }
            section.appendChild(hero);
        }

        const items = Array.isArray(quote.items) ? quote.items : [];
        if (items.length) {
            const titleBlock = document.createElement('div');
            titleBlock.className = 'fl-quote__list-titleblock';

            const listTitle = document.createElement('h3');
            listTitle.className = 'fl-quote__list-title';
            listTitle.textContent = quote.listTitle || 'Price List';
            titleBlock.appendChild(listTitle);

            if (quote.photoTip) {
                const tip = document.createElement('p');
                tip.className = 'fl-quote__photo-tip';
                tip.innerHTML =
                    '<span class="fl-quote__photo-tip-icon" aria-hidden="true">' +
                    '<svg viewBox="0 0 24 24" width="15" height="15" focusable="false">' +
                    '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M8.5 11.5V7.75a1.75 1.75 0 0 1 3.5 0V11"/>' +
                    '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M12 11V6.75a1.75 1.75 0 0 1 3.5 0V11"/>' +
                    '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M15.5 11V8.25a1.75 1.75 0 0 1 3.5 0V14.5c0 2.9-2.35 5.25-5.25 5.25h-1.1c-1.7 0-3.3-.8-4.3-2.15L6 14.5"/>' +
                    '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M8.5 11.5V16"/>' +
                    '</svg></span>' +
                    '<span>' + escapeHtml(quote.photoTip) + '</span>';
                titleBlock.appendChild(tip);
            }

            section.appendChild(titleBlock);

            const list = document.createElement('div');
            list.className = 'fl-quote__list';
            list.setAttribute('role', 'list');

            const head = document.createElement('div');
            head.className = 'fl-quote__list-head';
            head.innerHTML =
                '<span class="fl-quote__col-item">Item</span>' +
                '<span class="fl-quote__col-desc">Description</span>' +
                '<span class="fl-quote__col-qty">Qty</span>' +
                '<span class="fl-quote__col-price">Price (USD)</span>';
            list.appendChild(head);

            items.forEach((item) => {
                const imageList = Array.isArray(item.images) && item.images.length
                    ? item.images.map((entry) => (
                        typeof entry === 'string'
                            ? { src: entry }
                            : { src: entry.src, caption: entry.caption || '' }
                    )).filter((entry) => entry.src)
                    : [{ src: item.src, caption: '' }];

                const firstIndex = allImages.length;
                imageList.forEach((imageEntry, imageIndex) => {
                    const isSecondary = imageIndex > 0;
                    const counterHtml = imageList.length > 1
                        ? '<span class="fl-lightbox__counter">' + (imageIndex + 1) + ' / ' + imageList.length + '</span>'
                        : '';
                    const bodyHtml = isSecondary
                        ? (imageEntry.caption
                            ? '<span class="fl-lightbox__caption-body">' + escapeHtml(imageEntry.caption) + '</span>'
                            : '')
                        : '<span class="fl-lightbox__caption-body">' + escapeHtml(item.summary) + '</span>';
                    const captionHtml =
                        '<span class="fl-lightbox__caption-title">' + escapeHtml(item.label) + '</span>' +
                        bodyHtml +
                        '<span class="fl-lightbox__meta">Qty ' + escapeHtml(String(item.qty)) +
                        ' · ' + escapeHtml(item.priceLabel) + '</span>' +
                        counterHtml;

                    allImages.push({
                        src: imageEntry.src,
                        alt: item.label + (imageEntry.caption ? ' — ' + imageEntry.caption : ''),
                        caption: item.label + ' — Qty ' + item.qty + ' · ' + item.priceLabel,
                        captionHtml: captionHtml,
                        gallery: 'quote-items'
                    });
                });

                const row = document.createElement('article');
                row.className = 'fl-quote__row';
                row.setAttribute('role', 'listitem');
                row.dataset.lightboxIndex = String(firstIndex);
                row.tabIndex = 0;
                row.title = 'Tap to enlarge' + (imageList.length > 1 ? ' (' + imageList.length + ' photos)' : '');

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'fl-quote__thumb-btn';
                btn.tabIndex = -1;
                btn.setAttribute('aria-hidden', 'true');
                const img = document.createElement('img');
                img.src = item.src || imageList[0].src;
                img.alt = item.label;
                img.loading = 'lazy';
                img.decoding = 'async';
                btn.appendChild(img);

                if (imageList.length > 1) {
                    const badge = document.createElement('span');
                    badge.className = 'fl-quote__thumb-count';
                    badge.textContent = String(imageList.length);
                    badge.setAttribute('aria-hidden', 'true');
                    btn.appendChild(badge);
                }

                const desc = document.createElement('div');
                desc.className = 'fl-quote__desc';
                desc.innerHTML =
                    '<p class="fl-quote__label">' + escapeHtml(item.label) + '</p>' +
                    '<p class="fl-quote__summary">' + escapeHtml(item.summary) + '</p>' +
                    '<p class="fl-quote__dims">' + escapeHtml(item.dims) + '</p>';

                const qty = document.createElement('p');
                qty.className = 'fl-quote__cell-qty';
                qty.innerHTML = '<span class="fl-quote__mobile-label">Quantity:</span> ' + escapeHtml(String(item.qty));

                const price = document.createElement('p');
                price.className = 'fl-quote__cell-price';
                price.innerHTML = '<span class="fl-quote__mobile-label">Price:</span> ' + escapeHtml(item.priceLabel);

                row.appendChild(btn);
                row.appendChild(desc);
                row.appendChild(qty);
                row.appendChild(price);
                list.appendChild(row);
            });

            if (quote.totalLabel) {
                const total = document.createElement('div');
                total.className = 'fl-quote__total';
                total.innerHTML =
                    '<span class="fl-quote__total-label">' + escapeHtml(quote.totalHeading || 'Room total') + '</span>' +
                    '<span class="fl-quote__total-price">' + escapeHtml(quote.totalLabel) + '</span>';
                list.appendChild(total);
            }

            section.appendChild(list);
        }

        const footnotes = [];
        if (quote.priceNoteHtml || quote.priceNote) {
            footnotes.push(quote.priceNoteHtml || escapeHtml(quote.priceNote));
        }
        if (quote.dimsNoteHtml || quote.dimsNote) {
            footnotes.push(quote.dimsNoteHtml || escapeHtml(quote.dimsNote));
        }
        if (footnotes.length) {
            const notes = document.createElement('div');
            notes.className = 'fl-quote__footnotes';
            footnotes.forEach((html) => {
                const note = document.createElement('p');
                note.className = 'fl-quote__price-note';
                note.innerHTML = html;
                notes.appendChild(note);
            });
            section.appendChild(notes);
        }

        quoteRoot.appendChild(section);
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ─── Product layout (carousels) ─── */

    const CAROUSEL_ARROW =
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
        '<path fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/>' +
        '</svg>';

    function pauseVideosIn(root) {
        if (!root) return;
        root.querySelectorAll('video').forEach((video) => {
            video.pause();
        });
    }

    function formatVideoTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const m = Math.floor(total / 60);
        const s = String(total % 60).padStart(2, '0');
        return m + ':' + s;
    }

    /* Paint a preview frame when no poster image is set (preload=metadata alone stays black). */
    function primeVideoPreviewFrame(video) {
        if (video.getAttribute('poster')) return;

        let primed = false;
        const prime = () => {
            if (primed || video.getAttribute('poster')) return;
            if (!Number.isFinite(video.duration) || video.duration <= 0) return;
            primed = true;
            const target = Math.min(0.12, Math.max(0.04, video.duration * 0.02));
            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                if (!video.paused && !video.ended) return;
                /* Leave a tiny offset so the decoded frame stays visible. */
            };
            video.addEventListener('seeked', onSeeked);
            try {
                video.currentTime = target;
            } catch (e) {
                primed = false;
            }
        };

        if (video.readyState >= 1) prime();
        else video.addEventListener('loadedmetadata', prime, { once: true });
    }

    function setupCustomVideoPlayer(wrap, video, lightboxIndex) {
        wrap.classList.add('is-paused');
        video.muted = false;
        primeVideoPreviewFrame(video);

        const playOverlay = document.createElement('button');
        playOverlay.type = 'button';
        playOverlay.className = 'fl-video__play';
        playOverlay.setAttribute('aria-label', 'Play video');
        playOverlay.innerHTML =
            '<span class="fl-video__play-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" width="28" height="28" focusable="false">' +
            '<path fill="currentColor" d="M8.2 5.4v13.2c0 .7.75 1.1 1.35.7l10.1-6.6a.85.85 0 0 0 0-1.4L9.55 4.7a.85.85 0 0 0-1.35.7z"/>' +
            '</svg></span>';

        const bar = document.createElement('div');
        bar.className = 'fl-video__bar';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'fl-video__toggle';
        toggleBtn.setAttribute('aria-label', 'Play');
        toggleBtn.innerHTML =
            '<svg class="fl-video__icon-play" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
            '<path fill="currentColor" d="M8.2 5.4v13.2c0 .7.75 1.1 1.35.7l10.1-6.6a.85.85 0 0 0 0-1.4L9.55 4.7a.85.85 0 0 0-1.35.7z"/>' +
            '</svg>' +
            '<svg class="fl-video__icon-pause" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" hidden>' +
            '<path fill="currentColor" d="M7.5 5.5h3.2v13H7.5zm5.8 0h3.2v13h-3.2z"/>' +
            '</svg>';

        const progress = document.createElement('input');
        progress.type = 'range';
        progress.className = 'fl-video__progress';
        progress.min = '0';
        progress.max = '1000';
        progress.value = '0';
        progress.step = '1';
        progress.setAttribute('aria-label', 'Seek video');

        const timeEl = document.createElement('span');
        timeEl.className = 'fl-video__time';
        timeEl.textContent = '0:00';

        const muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'fl-video__mute';
        muteBtn.setAttribute('aria-label', 'Mute');
        muteBtn.innerHTML =
            '<svg class="fl-video__icon-vol" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
            '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M4.5 9.5v5h3.2L12 18.5V5.5L7.7 9.5H4.5z"/>' +
            '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M15.2 9.2a3.4 3.4 0 0 1 0 5.6"/>' +
            '</svg>' +
            '<svg class="fl-video__icon-muted" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" hidden>' +
            '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M4.5 9.5v5h3.2L12 18.5V5.5L7.7 9.5H4.5z"/>' +
            '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M16 9.5l4 5m0-5l-4 5"/>' +
            '</svg>';

        const expand = document.createElement('button');
        expand.type = 'button';
        expand.className = 'fl-carousel__fullscreen';
        expand.dataset.lightboxIndex = String(lightboxIndex);
        expand.setAttribute('aria-label', 'View video full screen');
        expand.innerHTML =
            '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
            '<path fill="none" stroke="currentColor" stroke-width="1.75" d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>' +
            '</svg>';

        bar.appendChild(toggleBtn);
        bar.appendChild(progress);
        bar.appendChild(timeEl);
        bar.appendChild(muteBtn);
        bar.appendChild(expand);

        wrap.appendChild(playOverlay);
        wrap.appendChild(bar);

        let seeking = false;

        const syncPlayingUi = () => {
            const playing = !video.paused && !video.ended;
            wrap.classList.toggle('is-playing', playing);
            wrap.classList.toggle('is-paused', !playing);
            playOverlay.hidden = playing;
            toggleBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            const playIcon = toggleBtn.querySelector('.fl-video__icon-play');
            const pauseIcon = toggleBtn.querySelector('.fl-video__icon-pause');
            if (playIcon) playIcon.hidden = playing;
            if (pauseIcon) pauseIcon.hidden = !playing;
        };

        const syncMuteUi = () => {
            const muted = video.muted || video.volume === 0;
            muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
            const volIcon = muteBtn.querySelector('.fl-video__icon-vol');
            const mutedIcon = muteBtn.querySelector('.fl-video__icon-muted');
            if (volIcon) volIcon.hidden = muted;
            if (mutedIcon) mutedIcon.hidden = !muted;
        };

        const syncProgress = () => {
            if (seeking) return;
            const duration = video.duration || 0;
            const current = video.currentTime || 0;
            progress.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
            timeEl.textContent =
                formatVideoTime(current) + (duration ? ' / ' + formatVideoTime(duration) : '');
        };

        const play = () => {
            const result = video.play();
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        };

        const pause = () => {
            video.pause();
        };

        playOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
            play();
        });

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (video.paused || video.ended) play();
            else pause();
        });

        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            video.muted = !video.muted;
            syncMuteUi();
        });

        progress.addEventListener('pointerdown', () => {
            seeking = true;
        });
        progress.addEventListener('pointerup', () => {
            seeking = false;
        });
        progress.addEventListener('input', () => {
            const duration = video.duration || 0;
            if (!duration) return;
            video.currentTime = (Number(progress.value) / 1000) * duration;
            syncProgress();
        });

        video.addEventListener('play', syncPlayingUi);
        video.addEventListener('pause', syncPlayingUi);
        video.addEventListener('ended', () => {
            syncPlayingUi();
            syncProgress();
        });
        video.addEventListener('timeupdate', syncProgress);
        video.addEventListener('loadedmetadata', syncProgress);
        video.addEventListener('volumechange', syncMuteUi);

        video.addEventListener('click', () => {
            if (video.paused || video.ended) play();
            else pause();
        });

        syncPlayingUi();
        syncMuteUi();
        syncProgress();
    }

    function registerMediaItem(item, mediaType, galleryKey, productTitle) {
        const entry = {
            src: item.src,
            alt: item.alt || productTitle,
            caption: item.caption || '',
            media: mediaType,
            gallery: galleryKey
        };
        allImages.push(entry);
        return allImages.length - 1;
    }

    function buildVideoStack(label, items, galleryKey, productTitle) {
        const block = document.createElement('div');
        block.className = 'fl-video-stack';

        if (label) {
            const heading = document.createElement('p');
            heading.className = 'fl-carousel__label';
            heading.textContent = label;
            block.appendChild(heading);
        }

        const list = document.createElement('div');
        list.className = 'fl-video-stack__list';

        items.forEach((item) => {
            const globalIndex = registerMediaItem(item, 'video', galleryKey, productTitle);
            const figure = document.createElement('figure');
            figure.className = 'fl-video-stack__item';

            const wrap = document.createElement('div');
            wrap.className = 'fl-carousel__video-wrap';

            const video = document.createElement('video');
            video.className = 'fl-carousel__video';
            video.src = item.src;
            video.controls = false;
            video.playsInline = true;
            video.preload = 'metadata';
            video.setAttribute('aria-label', item.alt || item.caption || productTitle);
            wrap.appendChild(video);
            setupCustomVideoPlayer(wrap, video, globalIndex);
            figure.appendChild(wrap);

            const note = typeof item.caption === 'string' ? item.caption.trim() : '';
            if (note) {
                const caption = document.createElement('figcaption');
                caption.className = 'fl-diagram__caption';
                caption.textContent = note;
                figure.appendChild(caption);
            }

            list.appendChild(figure);
        });

        block.appendChild(list);
        return block;
    }

    /* Static figures under the photo carousel (e.g. size/config diagrams). */
    function buildDiagramStack(label, items, galleryKey, productTitle) {
        const block = document.createElement('div');
        block.className = 'fl-diagram-stack';

        if (label) {
            const heading = document.createElement('p');
            heading.className = 'fl-carousel__label';
            heading.textContent = label;
            block.appendChild(heading);
        }

        const list = document.createElement('div');
        list.className = 'fl-diagram-stack__list';

        items.forEach((item) => {
            const globalIndex = registerMediaItem(item, 'image', galleryKey, productTitle);
            const figure = document.createElement('figure');
            figure.className = 'fl-diagram';

            const btn = document.createElement('button');
            btn.type = 'button';
            /* fit: 'cover' → fill like photo carousel; default keeps padding for line diagrams */
            const fillFrame = item.fit === 'cover' || item.fill === true;
            btn.className = fillFrame ? 'fl-diagram__open fl-diagram__open--fill' : 'fl-diagram__open';
            btn.dataset.lightboxIndex = String(globalIndex);
            btn.setAttribute(
                'aria-label',
                'View larger: ' + (item.alt || item.caption || productTitle)
            );

            const img = document.createElement('img');
            img.src = item.src;
            img.alt = item.alt || item.caption || productTitle;
            img.loading = 'lazy';
            img.decoding = 'async';
            btn.appendChild(img);
            figure.appendChild(btn);

            const note = item.caption || item.note;
            if (note) {
                const caption = document.createElement('figcaption');
                caption.className = 'fl-diagram__caption';
                caption.textContent = note;
                figure.appendChild(caption);
            }

            list.appendChild(figure);
        });

        block.appendChild(list);
        return block;
    }

    function buildCarousel(label, items, galleryKey, productTitle) {
        const block = document.createElement('div');
        block.className = 'fl-carousel';

        if (label) {
            const heading = document.createElement('p');
            heading.className = 'fl-carousel__label';
            heading.textContent = label;
            block.appendChild(heading);
        }

        const viewport = document.createElement('div');
        viewport.className = 'fl-carousel__viewport';
        viewport.tabIndex = 0;

        const track = document.createElement('div');
        track.className = 'fl-carousel__track';

        const slideCount = items.length;

        items.forEach((item) => {
            const slide = document.createElement('div');
            slide.className = 'fl-carousel__slide';
            slide.setAttribute('role', 'group');
            slide.setAttribute('aria-roledescription', 'slide');

            const globalIndex = registerMediaItem(item, 'image', galleryKey, productTitle);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'fl-carousel__open';
            btn.dataset.lightboxIndex = String(globalIndex);
            btn.setAttribute(
                'aria-label',
                'View larger: ' + (item.alt || item.caption || productTitle)
            );

            const img = document.createElement('img');
            img.src = item.src;
            img.alt = item.alt || item.caption || productTitle;
            img.loading = 'lazy';
            img.decoding = 'async';
            btn.appendChild(img);
            slide.appendChild(btn);
            track.appendChild(slide);
        });

        viewport.appendChild(track);

        let prev = null;
        let next = null;
        let dots = null;

        /* Single-image carousels: no arrows or dots */
        if (slideCount > 1) {
            prev = document.createElement('button');
            prev.type = 'button';
            prev.className = 'fl-carousel__arrow fl-carousel__arrow--prev';
            prev.setAttribute('aria-label', 'Previous photo');
            prev.innerHTML = CAROUSEL_ARROW;

            next = document.createElement('button');
            next.type = 'button';
            next.className = 'fl-carousel__arrow fl-carousel__arrow--next';
            next.setAttribute('aria-label', 'Next photo');
            next.innerHTML = CAROUSEL_ARROW;

            viewport.appendChild(prev);
            viewport.appendChild(next);
        }

        block.appendChild(viewport);

        const captions = items.map((item) =>
            typeof item.caption === 'string' ? item.caption.trim() : ''
        );
        let captionEl = null;
        if (captions.some(Boolean)) {
            captionEl = document.createElement('p');
            captionEl.className = 'fl-diagram__caption';
        }

        if (slideCount > 1) {
            dots = document.createElement('div');
            dots.className = 'fl-carousel__dots';
            dots.setAttribute('role', 'tablist');
            dots.setAttribute('aria-label', (label || 'Photos') + ' pagination');

            for (let i = 0; i < slideCount; i++) {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = 'fl-carousel__dot';
                dot.setAttribute('role', 'tab');
                dot.setAttribute('aria-label', 'Go to photo ' + (i + 1));
                dot.dataset.slideIndex = String(i);
                dots.appendChild(dot);
            }
            block.appendChild(dots);
        }

        if (captionEl) block.appendChild(captionEl);

        setupCarousel(block, {
            prev,
            next,
            dots,
            track,
            viewport,
            slideCount,
            captionEl,
            captions
        });
        return block;
    }

    function setupCarousel(root, parts) {
        let index = 0;
        let resizeTimer = null;

        const slideOffsetPx = () => {
            const width = parts.viewport.clientWidth;
            return index * (width || 0);
        };

        const update = () => {
            parts.track.style.transform = 'translate3d(-' + slideOffsetPx() + 'px, 0, 0)';
            const slides = parts.track.querySelectorAll('.fl-carousel__slide');
            slides.forEach((slide, i) => {
                const active = i === index;
                slide.setAttribute('aria-hidden', active ? 'false' : 'true');
                if (!active) {
                    pauseVideosIn(slide);
                }
            });

            if (parts.dots) {
                const dotButtons = parts.dots.querySelectorAll('.fl-carousel__dot');
                dotButtons.forEach((dot, i) => {
                    dot.classList.toggle('is-active', i === index);
                    dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
                });
            }

            if (parts.prev) parts.prev.disabled = index <= 0;
            if (parts.next) parts.next.disabled = index >= parts.slideCount - 1;

            if (parts.captionEl) {
                const text =
                    parts.captions && parts.captions[index] ? parts.captions[index] : '';
                parts.captionEl.textContent = text;
                parts.captionEl.hidden = !text;
            }
        };

        const goTo = (nextIndex) => {
            const clamped = Math.max(0, Math.min(parts.slideCount - 1, nextIndex));
            if (clamped === index) return;
            pauseVideosIn(parts.track);
            index = clamped;
            update();
        };

        if (parts.prev) parts.prev.addEventListener('click', () => goTo(index - 1));
        if (parts.next) parts.next.addEventListener('click', () => goTo(index + 1));

        if (parts.dots) {
            parts.dots.addEventListener('click', (e) => {
                const dot = e.target.closest('.fl-carousel__dot');
                if (!dot) return;
                goTo(Number(dot.dataset.slideIndex));
            });
        }

        if (parts.slideCount > 1) {
            root.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    goTo(index - 1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    goTo(index + 1);
                }
            });

            /* Horizontal swipe on the viewport (phones / tablets) */
            let touchStartX = null;
            let touchStartY = null;
            let suppressClickUntil = 0;
            const SWIPE_MIN_PX = 48;

            parts.viewport.addEventListener(
                'touchstart',
                (e) => {
                    if (e.touches.length !== 1) return;
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                },
                { passive: true }
            );

            const endTouchSwipe = (clientX, clientY) => {
                if (touchStartX == null) return;
                const dx = clientX - touchStartX;
                const dy = clientY - (touchStartY || 0);
                touchStartX = null;
                touchStartY = null;
                if (Math.abs(dx) < SWIPE_MIN_PX) return;
                if (Math.abs(dx) <= Math.abs(dy)) return;
                suppressClickUntil = Date.now() + 400;
                if (dx < 0) goTo(index + 1);
                else goTo(index - 1);
            };

            parts.viewport.addEventListener(
                'touchend',
                (e) => {
                    if (!e.changedTouches.length) return;
                    endTouchSwipe(
                        e.changedTouches[0].clientX,
                        e.changedTouches[0].clientY
                    );
                },
                { passive: true }
            );

            parts.viewport.addEventListener(
                'touchcancel',
                () => {
                    touchStartX = null;
                    touchStartY = null;
                },
                { passive: true }
            );

            parts.viewport.addEventListener(
                'click',
                (e) => {
                    if (Date.now() < suppressClickUntil) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                },
                true
            );
        }

        window.addEventListener('resize', () => {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(update, 150);
        });

        update();
    }

    const UNITS_STORAGE_KEY = 'fl-firstlook-units';
    const CURRENCY_STORAGE_KEY = 'fl-firstlook-currency';
    let activeUnits = 'metric';
    let activeCurrencyKey = 'USD';

    function getSecondaryCurrency() {
        const secondary = config.secondaryCurrency || {};
        const code = String(secondary.code || 'EUR').toUpperCase();
        const symbol = secondary.symbol || code;
        const rate = Number(secondary.rmbPerUnit);
        return {
            key: code,
            code: code,
            symbol: symbol,
            rmbPerUnit: Number.isFinite(rate) && rate > 0 ? rate : 7.1
        };
    }

    function getCurrencyOptions() {
        const usdRate = Number(config.rmbPerUsd);
        const secondary = getSecondaryCurrency();
        return {
            USD: {
                key: 'USD',
                code: 'USD',
                symbol: '$',
                rmbPerUnit: Number.isFinite(usdRate) && usdRate > 0 ? usdRate : 6.6
            },
            [secondary.key]: secondary
        };
    }

    function parsePriceRmb(product) {
        if (typeof product.priceRmb === 'number' && Number.isFinite(product.priceRmb)) {
            return product.priceRmb;
        }
        if (typeof product.price === 'number' && Number.isFinite(product.price)) {
            return product.price;
        }
        if (typeof product.price === 'string') {
            const digits = product.price.replace(/[^\d.]/g, '');
            const n = Number(digits);
            return Number.isFinite(n) ? n : null;
        }
        return null;
    }

    function normalizeSizeEntry(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const w = Number(raw.w);
        const d = Number(raw.d);
        const h = Number(raw.h);
        if (![w, d, h].every((n) => Number.isFinite(n))) return null;
        const entry = { w: w, d: d, h: h };
        const label = typeof raw.label === 'string' ? raw.label.trim() : '';
        if (label) entry.label = label;
        return entry;
    }

    /* sizeCm: { w,d,h } or [{ label?, w,d,h }, ...] — returns entries[] or null */
    function parseSizeCm(product) {
        if (Array.isArray(product.sizeCm)) {
            const entries = product.sizeCm.map(normalizeSizeEntry).filter(Boolean);
            return entries.length ? entries : null;
        }
        if (product.sizeCm && typeof product.sizeCm === 'object') {
            const entry = normalizeSizeEntry(product.sizeCm);
            return entry ? [entry] : null;
        }
        if (typeof product.size === 'string') {
            const nums = product.size.match(/(\d+(?:\.\d+)?)/g);
            if (nums && nums.length >= 3) {
                return [{ w: Number(nums[0]), d: Number(nums[1]), h: Number(nums[2]) }];
            }
        }
        return null;
    }

    function formatMoney(amount) {
        return Math.round(amount).toLocaleString('en-US');
    }

    /* Default client pricing UI: no RMB; inspired-brand MSRP follows currency toggle.
       Opt out with FIRST_LOOK_CONFIG.pricingUi = 'legacy' (old primary · RMB layout). */
    function useInspiredRefPricing() {
        return config.pricingUi !== 'legacy';
    }

    /* Ambiguous $ currencies get a country prefix; unique symbols (€, £) stay as-is. */
    const DOLLAR_CURRENCY_LABELS = {
        USD: 'US$',
        SGD: 'S$',
        AUD: 'A$',
        CAD: 'C$',
        NZD: 'NZ$',
        HKD: 'HK$',
        TWD: 'NT$'
    };

    function formatCurrencyAmount(amount, currency) {
        const n = formatMoney(amount);
        if (useInspiredRefPricing() && DOLLAR_CURRENCY_LABELS[currency.code]) {
            return DOLLAR_CURRENCY_LABELS[currency.code] + n;
        }
        return (currency.symbol || currency.code) + n;
    }

    function formatPrimaryAmount(rmb, currency) {
        return formatCurrencyAmount(rmb / currency.rmbPerUnit, currency);
    }

    function formatPriceHtml(rmb, currencyKey, msrpUsd) {
        const options = getCurrencyOptions();
        const currency = options[currencyKey] || options.USD;
        const primary =
            '<span class="fl-price__primary">' +
            escapeHtml(formatPrimaryAmount(rmb, currency)) +
            '</span>';
        if (useInspiredRefPricing()) {
            /* Client price · ~~inspired-brand MSRP~~*  (classic e-commerce pair) */
            if (typeof msrpUsd === 'number' && Number.isFinite(msrpUsd) && msrpUsd > 0) {
                const msrpText = formatCurrencyAmount(
                    convertMsrpUsdToCurrency(msrpUsd, currencyKey),
                    currency
                );
                return (
                    primary +
                    '<span class="fl-price__sep" aria-hidden="true"> · </span>' +
                    '<span class="fl-price__msrp">' +
                    escapeHtml(msrpText) +
                    '<sup class="fl-price__msrp-star" aria-hidden="true">*</sup>' +
                    '</span>'
                );
            }
            return primary;
        }
        return (
            primary +
            '<span class="fl-price__sep" aria-hidden="true"> · </span>' +
            '<span class="fl-price__rmb">RMB ' + formatMoney(rmb) + '</span>'
        );
    }

    function convertMsrpUsdToCurrency(msrpUsd, currencyKey) {
        const options = getCurrencyOptions();
        const currency = options[currencyKey] || options.USD;
        if (currency.code === 'USD') return msrpUsd;
        const usd = options.USD;
        return msrpUsd * (usd.rmbPerUnit / currency.rmbPerUnit);
    }

    function formatMsrpAmountText(msrpUsd, currencyKey) {
        const options = getCurrencyOptions();
        const currency = options[currencyKey] || options.USD;
        if (useInspiredRefPricing()) {
            return formatCurrencyAmount(convertMsrpUsdToCurrency(msrpUsd, currencyKey), currency);
        }
        return '$' + formatMoney(msrpUsd);
    }

    function msrpLabelText() {
        return useInspiredRefPricing() ? 'Inspired-brand MSRP' : 'Original MSRP';
    }

    function formatFxNote(currencyKey) {
        const options = getCurrencyOptions();
        const currency = options[currencyKey] || options.USD;
        const rateLabel = Number(currency.rmbPerUnit.toFixed(2)).toString();
        return '1 ' + currency.code + ' ≈ ' + rateLabel + ' RMB';
    }

    function cmToFeetInches(cm) {
        const totalIn = cm / 2.54;
        let feet = Math.floor(totalIn / 12);
        let inches = Math.round(totalIn % 12);
        if (inches === 12) {
            feet += 1;
            inches = 0;
        }
        if (feet > 0 && inches > 0) return feet + '\u2032' + inches + '\u2033';
        if (feet > 0) return feet + '\u2032';
        return inches + '\u2033';
    }

    function formatSizeDims(sizeCm, units) {
        if (units === 'imperial') {
            return (
                'W ' + cmToFeetInches(sizeCm.w) +
                ' × D ' + cmToFeetInches(sizeCm.d) +
                ' × H ' + cmToFeetInches(sizeCm.h)
            );
        }
        const fmt = (n) => {
            const rounded = Math.round(n * 10) / 10;
            return Number.isInteger(rounded) ? String(rounded) : String(rounded);
        };
        return 'W ' + fmt(sizeCm.w) + ' cm × D ' + fmt(sizeCm.d) + ' cm × H ' + fmt(sizeCm.h) + ' cm';
    }

    function formatSizeText(sizeCmOrEntries, units) {
        const entries = Array.isArray(sizeCmOrEntries) ? sizeCmOrEntries : [sizeCmOrEntries];
        const lines = entries.filter(Boolean).map((entry) => {
            const dims = formatSizeDims(entry, units);
            return entry.label ? entry.label + ': ' + dims : dims;
        });
        return lines.join('\n');
    }

    function readStoredUnits() {
        try {
            const stored = window.localStorage.getItem(UNITS_STORAGE_KEY);
            if (stored === 'imperial' || stored === 'metric') return stored;
        } catch (e) {
            /* ignore */
        }
        return config.defaultUnits === 'imperial' ? 'imperial' : 'metric';
    }

    function readStoredCurrency() {
        const options = getCurrencyOptions();
        try {
            const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
            if (stored && options[stored]) return stored;
        } catch (e) {
            /* ignore */
        }
        const preferred = String(config.defaultCurrency || 'USD').toUpperCase();
        return options[preferred] ? preferred : 'USD';
    }

    function persistUnits(units) {
        try {
            window.localStorage.setItem(UNITS_STORAGE_KEY, units);
        } catch (e) {
            /* ignore */
        }
    }

    function persistCurrency(currencyKey) {
        try {
            window.localStorage.setItem(CURRENCY_STORAGE_KEY, currencyKey);
        } catch (e) {
            /* ignore */
        }
    }

    function applyUnitsToPage(units) {
        activeUnits = units;
        document.querySelectorAll('[data-size-cm]').forEach((el) => {
            try {
                const sizeCm = JSON.parse(el.getAttribute('data-size-cm'));
                el.textContent = formatSizeText(sizeCm, units);
            } catch (e) {
                /* ignore bad payload */
            }
        });
        document.querySelectorAll('.fl-prefs__btn[data-units]').forEach((btn) => {
            const on = btn.getAttribute('data-units') === units;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function applyCurrencyToPage(currencyKey) {
        const options = getCurrencyOptions();
        activeCurrencyKey = options[currencyKey] ? currencyKey : 'USD';

        document.querySelectorAll('[data-price-rmb]').forEach((el) => {
            const rmb = Number(el.getAttribute('data-price-rmb'));
            if (!Number.isFinite(rmb)) return;
            const rawMsrp = el.getAttribute('data-msrp-usd');
            const msrpUsd = rawMsrp != null ? Number(rawMsrp) : null;
            el.innerHTML = formatPriceHtml(
                rmb,
                activeCurrencyKey,
                Number.isFinite(msrpUsd) && msrpUsd > 0 ? msrpUsd : null
            );
        });

        /* Legacy footnote amount spans only (not price cells that also carry data-msrp-usd). */
        document.querySelectorAll('.fl-product__msrp-amount[data-msrp-usd]').forEach((el) => {
            const msrpUsd = Number(el.getAttribute('data-msrp-usd'));
            if (!Number.isFinite(msrpUsd) || msrpUsd <= 0) return;
            el.textContent = formatMsrpAmountText(msrpUsd, activeCurrencyKey);
        });

        document.querySelectorAll('.fl-prefs__btn[data-currency]').forEach((btn) => {
            const on = btn.getAttribute('data-currency') === activeCurrencyKey;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        document.querySelectorAll('.fl-prefs__fx').forEach((el) => {
            el.textContent = formatFxNote(activeCurrencyKey);
        });
    }

    function buildPrefsBar(options) {
        const secondary = getSecondaryCurrency();
        const bar = document.createElement('div');
        bar.className = 'fl-prefs';

        let html = '<div class="fl-prefs__toggles">';
        if (options.showCurrency) {
            html +=
                '<div class="fl-prefs__group">' +
                '<p class="fl-prefs__label">Currency</p>' +
                '<div class="fl-prefs__toggle" role="group" aria-label="Display currency">' +
                '<button type="button" class="fl-prefs__btn" data-currency="USD" aria-pressed="true">USD</button>' +
                '<button type="button" class="fl-prefs__btn" data-currency="' +
                escapeHtml(secondary.key) +
                '" aria-pressed="false">' +
                escapeHtml(secondary.code) +
                '</button>' +
                '</div></div>';
        }
        if (options.showUnits) {
            html +=
                '<div class="fl-prefs__group">' +
                '<p class="fl-prefs__label">Size</p>' +
                '<div class="fl-prefs__toggle" role="group" aria-label="Size units">' +
                '<button type="button" class="fl-prefs__btn" data-units="metric" aria-pressed="true">cm</button>' +
                '<button type="button" class="fl-prefs__btn" data-units="imperial" aria-pressed="false">ft·in</button>' +
                '</div></div>';
        }
        html += '</div>';
        if (options.showCurrency) {
            html += '<p class="fl-prefs__fx" aria-live="polite"></p>';
        }
        bar.innerHTML = html;

        bar.addEventListener('click', (e) => {
            const btn = e.target.closest('.fl-prefs__btn');
            if (!btn) return;
            if (btn.hasAttribute('data-units')) {
                const units = btn.getAttribute('data-units');
                if (units !== 'metric' && units !== 'imperial') return;
                persistUnits(units);
                applyUnitsToPage(units);
                return;
            }
            if (btn.hasAttribute('data-currency')) {
                const currencyKey = btn.getAttribute('data-currency');
                const currencyOptions = getCurrencyOptions();
                if (!currencyOptions[currencyKey]) return;
                persistCurrency(currencyKey);
                applyCurrencyToPage(currencyKey);
            }
        });

        return bar;
    }

    function parseMsrpUsd(product) {
        if (typeof product.msrpUsd === 'number' && Number.isFinite(product.msrpUsd) && product.msrpUsd > 0) {
            return product.msrpUsd;
        }
        if (typeof product.msrpUsd === 'string') {
            const digits = product.msrpUsd.replace(/[^\d.]/g, '');
            const n = Number(digits);
            return Number.isFinite(n) && n > 0 ? n : null;
        }
        return null;
    }

    function appendProductMeta(parent, product) {
        const priceRmb = parsePriceRmb(product);
        const sizeCm = parseSizeCm(product);
        const msrpUsd = parseMsrpUsd(product);
        const hasLegacyPrice = Boolean(product.price);
        const hasLegacySize = Boolean(product.size);
        if (priceRmb == null && !hasLegacyPrice && !(sizeCm && sizeCm.length) && !hasLegacySize && msrpUsd == null) {
            return;
        }

        const meta = document.createElement('dl');
        meta.className = 'fl-product__meta';

        if (sizeCm && sizeCm.length) {
            const row = document.createElement('div');
            row.className = 'fl-product__meta-row fl-product__meta-row--size';
            const value = document.createElement('dd');
            value.className = 'fl-product__meta-value';
            if (sizeCm.length > 1) value.classList.add('fl-product__meta-value--sizes');
            value.setAttribute('data-size-cm', JSON.stringify(sizeCm));
            value.textContent = formatSizeText(sizeCm, activeUnits);
            row.innerHTML = '<dt class="fl-product__meta-label">Size</dt>';
            row.appendChild(value);
            meta.appendChild(row);
        } else if (hasLegacySize) {
            const row = document.createElement('div');
            row.className = 'fl-product__meta-row fl-product__meta-row--size';
            row.innerHTML =
                '<dt class="fl-product__meta-label">Size</dt>' +
                '<dd class="fl-product__meta-value">' + escapeHtml(product.size) + '</dd>';
            meta.appendChild(row);
        }

        if (priceRmb != null) {
            const row = document.createElement('div');
            row.className = 'fl-product__meta-row fl-product__meta-row--price';
            const value = document.createElement('dd');
            value.className = 'fl-product__meta-value fl-product__meta-value--price';
            value.setAttribute('data-price-rmb', String(priceRmb));
            if (useInspiredRefPricing() && msrpUsd != null) {
                value.setAttribute('data-msrp-usd', String(msrpUsd));
            }
            value.innerHTML = formatPriceHtml(
                priceRmb,
                activeCurrencyKey,
                useInspiredRefPricing() ? msrpUsd : null
            );
            row.innerHTML = '<dt class="fl-product__meta-label">Price</dt>';
            row.appendChild(value);
            meta.appendChild(row);
        } else if (hasLegacyPrice) {
            const row = document.createElement('div');
            row.className = 'fl-product__meta-row fl-product__meta-row--price';
            row.innerHTML =
                '<dt class="fl-product__meta-label">Price</dt>' +
                '<dd class="fl-product__meta-value">' + escapeHtml(product.price) + '</dd>';
            meta.appendChild(row);
        }

        if (meta.childElementCount) parent.appendChild(meta);

        if (msrpUsd != null) {
            const inspiredRef = useInspiredRefPricing();
            const note = document.createElement('p');
            note.className =
                'fl-product__msrp-footnote' +
                (inspiredRef ? ' fl-product__msrp-footnote--ref' : '');

            if (inspiredRef) {
                /* Quiet footnote: * Inspired-brand MSRP — Source (amount lives on PRICE line). */
                note.appendChild(document.createTextNode('* ' + msrpLabelText()));
            } else {
                const amount = document.createElement('span');
                amount.className = 'fl-product__msrp-amount';
                amount.setAttribute('data-msrp-usd', String(msrpUsd));
                amount.textContent = formatMsrpAmountText(msrpUsd, activeCurrencyKey);
                note.appendChild(document.createTextNode('* ' + msrpLabelText() + ' '));
                note.appendChild(amount);
            }

            const source =
                typeof product.msrpSource === 'string' ? product.msrpSource.trim() : '';
            const url = typeof product.msrpUrl === 'string' ? product.msrpUrl.trim() : '';
            if (source || url) {
                note.appendChild(document.createTextNode(' — '));
                if (url) {
                    const link = document.createElement('a');
                    link.className = 'fl-product__msrp-link';
                    link.href = url;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = source || 'Source';
                    link.insertAdjacentHTML(
                        'beforeend',
                        '<svg class="fl-product__ext-icon" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">' +
                            '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6.5 3.5H3.75A1.25 1.25 0 0 0 2.5 4.75v7.5c0 .69.56 1.25 1.25 1.25h7.5c.69 0 1.25-.56 1.25-1.25V9.5M9.5 2.5h4v4M13.5 2.5L7.5 8.5"/>' +
                            '</svg>'
                    );
                    note.appendChild(link);
                } else {
                    note.appendChild(document.createTextNode(source));
                }
            }
            const msrpNote =
                typeof product.msrpNote === 'string' ? product.msrpNote.trim() : '';
            if (msrpNote) {
                note.appendChild(document.createTextNode('. '));
                /* Optional **bold** markers in msrpNote for emphasis */
                msrpNote.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
                    if (!part) return;
                    if (part.length >= 4 && part.startsWith('**') && part.endsWith('**')) {
                        const strong = document.createElement('strong');
                        strong.textContent = part.slice(2, -2);
                        note.appendChild(strong);
                    } else {
                        note.appendChild(document.createTextNode(part));
                    }
                });
            }
            parent.appendChild(note);
        }
    }

    function slugifySeriesLabel(label) {
        return String(label || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function collectProductSeries(products) {
        const series = [];
        const byId = new Map();
        products.forEach((product) => {
            const title =
                typeof product.category === 'string' ? product.category.trim() : '';
            if (!title) return;
            const id = slugifySeriesLabel(title);
            if (!id) return;
            let entry = byId.get(id);
            if (!entry) {
                entry = { id: id, title: title, products: [] };
                byId.set(id, entry);
                series.push(entry);
            }
            entry.products.push(product);
        });
        return series;
    }

    function productCoverSrc(product) {
        if (!product) return '';
        const images = Array.isArray(product.images) ? product.images : [];
        for (let i = 0; i < images.length; i++) {
            if (images[i] && images[i].src) return images[i].src;
        }
        return '';
    }

    function createProductSection(product) {
        const section = document.createElement('section');
        const asCard = product.card === true || product.variant === 'card';
        section.className = asCard ? 'fl-product fl-room fl-product--card' : 'fl-product fl-room';
        section.id = product.id;

        const title = document.createElement('h2');
        title.className = 'fl-room__title fl-product__title';
        title.textContent = product.title;
        section.appendChild(title);

        const mediaWrap = document.createElement('div');
        mediaWrap.className = 'fl-product__media';

        const videos = Array.isArray(product.videos) ? product.videos.filter((v) => v && v.src) : [];
        const images = Array.isArray(product.images) ? product.images.filter((v) => v && v.src) : [];
        const diagrams = Array.isArray(product.diagrams)
            ? product.diagrams.filter((v) => v && v.src)
            : [];

        const hasBothMedia = videos.length > 0 && images.length > 0;
        if (videos.length) {
            mediaWrap.appendChild(
                buildVideoStack(
                    hasBothMedia ? (videos.length > 1 ? 'Videos' : 'Video') : '',
                    videos,
                    product.id + '-video',
                    product.title
                )
            );
        }
        if (images.length) {
            mediaWrap.appendChild(
                buildCarousel(
                    hasBothMedia ? 'Photos' : '',
                    images,
                    product.id + '-photos',
                    product.title
                )
            );
        }
        if (diagrams.length) {
            const diagramsLabelRaw =
                typeof product.diagramsLabel === 'string' ? product.diagramsLabel.trim() : '';
            const diagramsLabel = diagramsLabelRaw || 'Suggested configuration';
            mediaWrap.appendChild(
                buildDiagramStack(
                    diagramsLabel,
                    diagrams,
                    product.id + '-diagrams',
                    product.title
                )
            );
        }

        if (mediaWrap.childElementCount) {
            section.appendChild(mediaWrap);
        }

        const hasMeta =
            parsePriceRmb(product) != null ||
            Boolean(product.price) ||
            Boolean(parseSizeCm(product) || product.size) ||
            parseMsrpUsd(product) != null;
        const hasDesc = Boolean(product.description);
        if (hasDesc || hasMeta) {
            const details = document.createElement('div');
            details.className = 'fl-product__details';
            if (hasDesc) {
                const desc = document.createElement('div');
                desc.className = 'fl-product__description';
                /* Trusted proposal config may include light markup (e.g. <strong>, <em>, <p>). */
                desc.innerHTML = product.description;
                details.appendChild(desc);
            }
            if (hasMeta) {
                appendProductMeta(details, product);
            }
            section.appendChild(details);
        }

        return section;
    }

    function appendPrefsIfNeeded(parent, products) {
        const hasSizedProduct = products.some((product) => parseSizeCm(product));
        const hasPricedProduct = products.some((product) => parsePriceRmb(product) != null);
        if (!hasSizedProduct && !hasPricedProduct) return;
        parent.appendChild(
            buildPrefsBar({
                showUnits: hasSizedProduct,
                showCurrency: hasPricedProduct
            })
        );
        applyUnitsToPage(activeUnits);
        applyCurrencyToPage(activeCurrencyKey);
    }

    function placeProductSummary(summary) {
        if (!summary) return;
        const existing = document.querySelector('.fl-page--products .fl-summary');
        if (existing) existing.remove();
        const sourcing = document.querySelector('.fl-page--products .fl-sourcing');
        if (sourcing && sourcing.parentNode) {
            sourcing.after(summary);
        } else if (roomsRoot) {
            roomsRoot.appendChild(summary);
        }
        applyCurrencyToPage(activeCurrencyKey);
    }

    function setSeriesHubChrome(isHub) {
        const page = document.querySelector('.fl-page--products');
        if (page) {
            page.classList.toggle('is-series-hub', isHub);
            page.classList.toggle('is-series-detail', !isHub);
        }
        const summary = document.querySelector('.fl-page--products .fl-summary');
        if (summary) {
            summary.hidden = !isHub;
        }
        // Series detail = products + sourcing note only (no proposal chrome).
        const hideOnDetail = document.querySelectorAll(
            '.fl-page--products .fl-header, .fl-page--products .fl-intro, .fl-page--products .fl-next, .fl-page--products .fl-about, .fl-page--products .fl-footer'
        );
        hideOnDetail.forEach((el) => {
            el.hidden = !isHub;
        });
    }

    function buildSeriesHub(products) {
        const seriesList = collectProductSeries(products);
        if (!seriesList.length) {
            buildProductsFlat(products);
            return;
        }

        const page = document.querySelector('.fl-page--products');
        if (page) page.classList.add('fl-page--series-hub');

        let activeSeriesId = null;
        let pendingProductId = null;

        let hubMenuJump = null;

        function syncSeriesHubMenu(isHub, seriesId) {
            const menu = document.getElementById('fl-hub-menu');
            if (!menu) return;
            menu.classList.toggle('is-hub', isHub);
            menu.classList.toggle('is-series-detail', !isHub);
            const back = menu.querySelector('.fl-hub-menu__back');
            if (back) {
                back.hidden = isHub;
                back.setAttribute('aria-hidden', isHub ? 'true' : 'false');
            }
            menu.querySelectorAll('.fl-hub-menu__link[data-series-id]').forEach((btn) => {
                btn.classList.toggle(
                    'is-active',
                    !isHub && btn.getAttribute('data-series-id') === seriesId
                );
            });
        }

        function goToHubSection(selector) {
            if (hubMenuJump) hubMenuJump.open = false;
            const wasInSeries = activeSeriesId !== null;
            if (wasInSeries) {
                showHub(true);
            }
            const run = () => {
                const el = document.querySelector(selector);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            };
            if (wasInSeries) {
                window.requestAnimationFrame(() => window.setTimeout(run, 80));
            } else {
                run();
            }
        }

        function ensureSeriesHubMenu() {
            if (config.seriesHubMenu !== true) return;
            if (document.getElementById('fl-hub-menu')) return;

            const menu = document.createElement('nav');
            menu.id = 'fl-hub-menu';
            menu.className = 'fl-hub-menu is-hub';
            menu.setAttribute('aria-label', 'First Look menu');

            const inner = document.createElement('div');
            inner.className = 'fl-hub-menu__inner';

            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'fl-series-back fl-hub-menu__back';
            back.hidden = true;
            back.innerHTML =
                '<span class="fl-series-back__arrow" aria-hidden="true">←</span> Back to all series';
            back.addEventListener('click', () => showHub(true));

            hubMenuJump = document.createElement('details');
            hubMenuJump.className = 'fl-hub-menu__jump';

            const jumpSummary = document.createElement('summary');
            jumpSummary.className = 'fl-hub-menu__jump-summary';
            jumpSummary.setAttribute('aria-label', 'Menu');
            jumpSummary.innerHTML =
                '<span class="fl-hub-menu__glyph" aria-hidden="true">' +
                '<svg class="fl-hub-menu__glyph-grid" viewBox="0 0 16 16" width="17" height="17" focusable="false">' +
                '<rect x="2.25" y="2.25" width="4.75" height="4.75" rx="0.35" fill="currentColor"/>' +
                '<rect x="9" y="2.25" width="4.75" height="4.75" rx="0.35" fill="currentColor"/>' +
                '<rect x="2.25" y="9" width="4.75" height="4.75" rx="0.35" fill="currentColor"/>' +
                '<rect x="9" y="9" width="4.75" height="4.75" rx="0.35" fill="currentColor"/>' +
                '</svg></span>' +
                '<span class="fl-hub-menu__label">Menu</span>';

            const panel = document.createElement('div');
            panel.className = 'fl-hub-menu__jump-panel';
            panel.setAttribute('role', 'list');

            seriesList.forEach((series) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'fl-hub-menu__link';
                btn.textContent = series.title;
                btn.setAttribute('data-series-id', series.id);
                btn.setAttribute('role', 'listitem');
                btn.addEventListener('click', () => {
                    hubMenuJump.open = false;
                    showSeries(series.id, null, true);
                });
                panel.appendChild(btn);
            });

            const divider = document.createElement('div');
            divider.className = 'fl-hub-menu__divider';
            divider.setAttribute('role', 'presentation');
            panel.appendChild(divider);

            const summaryBtn = document.createElement('button');
            summaryBtn.type = 'button';
            summaryBtn.className = 'fl-hub-menu__link';
            summaryBtn.textContent = 'Summary';
            summaryBtn.setAttribute('role', 'listitem');
            summaryBtn.addEventListener('click', () => goToHubSection('.fl-summary'));

            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'fl-hub-menu__link';
            nextBtn.textContent = 'Next steps';
            nextBtn.setAttribute('role', 'listitem');
            nextBtn.addEventListener('click', () => goToHubSection('.fl-next'));

            panel.appendChild(summaryBtn);
            panel.appendChild(nextBtn);

            hubMenuJump.appendChild(jumpSummary);
            hubMenuJump.appendChild(panel);

            inner.appendChild(back);
            inner.appendChild(hubMenuJump);
            menu.appendChild(inner);

            document.addEventListener('click', (e) => {
                if (!hubMenuJump || !hubMenuJump.open) return;
                if (hubMenuJump.contains(e.target)) return;
                hubMenuJump.open = false;
            });

            const anchor =
                document.querySelector('.fl-page--products .fl-intro') ||
                document.querySelector('.fl-page--products .fl-header');
            if (anchor && anchor.parentNode) {
                anchor.insertAdjacentElement('afterend', menu);
            }
        }

        ensureSeriesHubMenu();

        function showHub(updateHash) {
            activeSeriesId = null;
            pendingProductId = null;
            roomsRoot.innerHTML = '';
            allImages = [];

            const hub = document.createElement('section');
            hub.className = 'fl-hub';
            hub.setAttribute('aria-label', 'Series');

            const hubIntro = document.createElement('div');
            hubIntro.className = 'fl-hub__intro';
            hubIntro.innerHTML =
                '<p class="fl-hub__intro-lead">Tap on a series to begin</p>' +
                '<p class="fl-hub__intro-sub">View product information, photos/videos and pricing</p>';
            hub.appendChild(hubIntro);

            const list = document.createElement('div');
            list.className = 'fl-hub__list';

            seriesList.forEach((series) => {
                const cover = productCoverSrc(series.products[0]);
                const extrasCount = series.products.filter(
                    (product) => product && (product.card === true || product.variant === 'card')
                ).length;
                const mainCount = series.products.length - extrasCount;
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'fl-hub__card';
                card.setAttribute('data-series-id', series.id);

                if (cover) {
                    const img = document.createElement('img');
                    img.className = 'fl-hub__image';
                    img.src = cover;
                    img.alt = '';
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    card.appendChild(img);
                }

                const overlay = document.createElement('span');
                overlay.className = 'fl-hub__overlay';
                const name = document.createElement('span');
                name.className = 'fl-hub__name';
                name.textContent = series.title;
                const meta = document.createElement('span');
                meta.className = 'fl-hub__meta';
                const metaCount = document.createElement('span');
                metaCount.className = 'fl-hub__count';
                if (extrasCount > 0) {
                    metaCount.textContent =
                        mainCount +
                        (mainCount === 1 ? ' piece' : ' pieces') +
                        ', ' +
                        extrasCount +
                        (extrasCount === 1 ? ' extra' : ' extras');
                } else {
                    metaCount.textContent =
                        mainCount === 1 ? '1 piece' : mainCount + ' pieces';
                }
                const metaArrow = document.createElement('span');
                metaArrow.className = 'fl-hub__arrow';
                metaArrow.setAttribute('aria-hidden', 'true');
                metaArrow.innerHTML =
                    '<svg viewBox="0 0 16 16" width="14" height="14" focusable="false">' +
                    '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M3.5 8h9m0 0L9 4.5M12.5 8L9 11.5"/>' +
                    '</svg>';
                meta.appendChild(metaCount);
                meta.appendChild(metaArrow);
                overlay.appendChild(name);
                overlay.appendChild(meta);
                card.appendChild(overlay);

                card.addEventListener('click', () => showSeries(series.id, null, true));
                list.appendChild(card);
            });

            hub.appendChild(list);
            roomsRoot.appendChild(hub);
            setSeriesHubChrome(true);
            syncSeriesHubMenu(true, null);
            teardownScrollPhotoHint(false);

            if (updateHash !== false) {
                const nextHash = '#hub';
                if (location.hash !== nextHash) {
                    history.pushState({ flView: 'hub' }, '', nextHash);
                }
            }
        }

        function showSeries(seriesId, productId, updateHash) {
            const series = seriesList.find((item) => item.id === seriesId);
            if (!series) {
                showHub(true);
                return;
            }

            activeSeriesId = seriesId;
            pendingProductId = productId || null;
            roomsRoot.innerHTML = '';
            allImages = [];

            if (config.seriesHubMenu !== true) {
                const toolbar = document.createElement('div');
                toolbar.className = 'fl-series-toolbar';

                const back = document.createElement('button');
                back.type = 'button';
                back.className = 'fl-series-back';
                back.innerHTML =
                    '<span class="fl-series-back__arrow" aria-hidden="true">←</span> Back to all series';
                back.addEventListener('click', () => showHub(true));
                toolbar.appendChild(back);
                roomsRoot.appendChild(toolbar);
            }

            const heading = document.createElement('header');
            heading.className = 'fl-category fl-category--series';
            const headingText = document.createElement('h2');
            headingText.className = 'fl-category__title';
            headingText.textContent = series.title;
            heading.appendChild(headingText);
            roomsRoot.appendChild(heading);

            appendPrefsIfNeeded(roomsRoot, series.products);
            appendSeriesNoteIfNeeded(roomsRoot, series.title);
            series.products.forEach((product) => {
                appendSectionHeadingIfNeeded(roomsRoot, product);
                roomsRoot.appendChild(createProductSection(product));
            });

            setSeriesHubChrome(false);
            syncSeriesHubMenu(false, seriesId);
            ensureLightbox();
            setupLightboxClicks();
            window.requestAnimationFrame(() => setupScrollPhotoHint(roomsRoot));

            if (updateHash !== false) {
                const nextHash = productId ? '#' + productId : '#series/' + seriesId;
                if (location.hash !== nextHash) {
                    history.pushState(
                        { flView: 'series', seriesId: seriesId, productId: productId || null },
                        '',
                        nextHash
                    );
                }
            }

            if (productId) {
                window.requestAnimationFrame(() => {
                    const el = document.getElementById(productId);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        function routeFromHash() {
            const raw = String(location.hash || '').replace(/^#/, '');
            if (!raw || raw === 'hub') {
                showHub(false);
                return;
            }
            if (raw.indexOf('series/') === 0) {
                showSeries(raw.slice(7), null, false);
                return;
            }
            const product = products.find((item) => item.id === raw);
            if (product && product.category) {
                showSeries(slugifySeriesLabel(product.category), product.id, false);
                return;
            }
            showHub(false);
        }

        placeProductSummary(
            buildProductSummary(products, {
                showThumbnails: true,
                onProductNavigate: function (product) {
                    const seriesId = slugifySeriesLabel(product.category);
                    showSeries(seriesId, product.id, true);
                }
            })
        );
        window.addEventListener('hashchange', routeFromHash);
        window.addEventListener('popstate', routeFromHash);
        routeFromHash();
    }

    function buildProductsFlat(products) {
        if (config.floatingProductMenu === true) {
            ensureFloatingProductMenu(products);
        } else if (shouldShowStickyNav(products.length)) {
            buildStickyNav(products);
        }

        appendPrefsIfNeeded(roomsRoot, products);

        let lastCategory = null;
        products.forEach((product) => {
            const category =
                typeof product.category === 'string' ? product.category.trim() : '';
            if (category && category !== lastCategory) {
                roomsRoot.appendChild(buildCategoryHeading(category));
                lastCategory = category;
            }
            appendSectionHeadingIfNeeded(roomsRoot, product);
            roomsRoot.appendChild(createProductSection(product));
        });

        placeProductSummary(buildProductSummary(products));
        window.requestAnimationFrame(() => setupScrollPhotoHint(roomsRoot));
    }

    function buildProducts() {
        if (!roomsRoot) return;

        const products = config.products;
        roomsRoot.innerHTML = '';
        allImages = [];
        activeUnits = readStoredUnits();
        activeCurrencyKey = readStoredCurrency();

        if (config.seriesHub === true) {
            buildSeriesHub(products);
            return;
        }

        buildProductsFlat(products);
    }

    function buildCategoryHeading(label, modifier, subtitle) {
        const heading = document.createElement('header');
        const mods = [];
        if (modifier) mods.push('fl-category--' + modifier);
        if (subtitle) mods.push('fl-category--with-subtitle');
        heading.className = mods.length
            ? 'fl-category ' + mods.join(' ')
            : 'fl-category';
        heading.setAttribute('aria-label', subtitle ? label + '. ' + subtitle : label);
        const text = document.createElement('h2');
        text.className = 'fl-category__title';
        text.textContent = label;
        heading.appendChild(text);
        if (subtitle) {
            const sub = document.createElement('p');
            sub.className = 'fl-category__subtitle';
            sub.textContent = subtitle;
            heading.appendChild(sub);
        }
        return heading;
    }

    /* Optional mid-list divider: product.sectionHeading = string | { title, subtitle }. */
    function appendSectionHeadingIfNeeded(parent, product) {
        if (!parent || product.sectionHeading == null) return;
        let title = '';
        let subtitle = '';
        if (typeof product.sectionHeading === 'string') {
            title = product.sectionHeading.trim();
        } else if (typeof product.sectionHeading === 'object') {
            title =
                typeof product.sectionHeading.title === 'string'
                    ? product.sectionHeading.title.trim()
                    : '';
            subtitle =
                typeof product.sectionHeading.subtitle === 'string'
                    ? product.sectionHeading.subtitle.trim()
                    : '';
        }
        if (!title) return;
        parent.appendChild(buildCategoryHeading(title, 'section', subtitle || undefined));
    }

    /* Optional series-top note: config.seriesNotes['Category Title'] = string | { title?, body }. */
    function appendSeriesNoteIfNeeded(parent, seriesTitle) {
        if (!parent || !seriesTitle) return;
        const notes = config.seriesNotes;
        if (!notes || typeof notes !== 'object') return;
        const entry = notes[seriesTitle];
        if (!entry) return;

        let title = '';
        let body = '';
        if (typeof entry === 'string') {
            body = entry.trim();
        } else if (entry && typeof entry === 'object') {
            title = typeof entry.title === 'string' ? entry.title.trim() : '';
            body =
                typeof entry.body === 'string'
                    ? entry.body.trim()
                    : typeof entry.html === 'string'
                      ? entry.html.trim()
                      : '';
        }
        if (!title && !body) return;

        const note = document.createElement('aside');
        note.className = 'fl-series-note';
        note.setAttribute('aria-label', title || 'About this series');

        if (title) {
            const heading = document.createElement('p');
            heading.className = 'fl-series-note__title';
            heading.innerHTML =
                '<span class="fl-series-note__mark" aria-hidden="true">!</span>' +
                '<span class="fl-series-note__title-text">' +
                escapeHtml(title) +
                '</span>';
            note.appendChild(heading);
        }
        if (body) {
            const content = document.createElement('div');
            content.className = 'fl-series-note__body';
            /* Trusted proposal config may include light markup (e.g. <strong>, <p>). */
            content.innerHTML = body;
            note.appendChild(content);
        }
        parent.appendChild(note);
    }

    function buildProductSummary(products, options) {
        const opts = options || {};
        /* Card / photo-only extras stay out of Summary (see them inside their series). */
        const rows = products
            .map((product) => {
                if (!product || !product.title) return null;
                if (product.card === true || product.variant === 'card') return null;
                if (product.summary === false) return null;
                const priceRmb = parsePriceRmb(product);
                return { product: product, priceRmb: priceRmb };
            })
            .filter(Boolean);

        if (!rows.length) return null;

        const section = document.createElement('section');
        section.className = 'fl-summary';
        section.setAttribute('aria-labelledby', 'fl-summary-title');

        const title = document.createElement('h2');
        title.id = 'fl-summary-title';
        title.className = 'fl-summary__title';
        title.textContent = 'Summary';
        section.appendChild(title);

        const list = document.createElement('div');
        list.className = 'fl-summary__list';
        list.setAttribute('role', 'list');

        let totalRmb = 0;
        let pricedCount = 0;
        let lastSummaryCategory = null;

        const jumpArrow =
            '<span class="fl-summary__jump" aria-hidden="true">' +
            '<svg viewBox="0 0 16 16" width="14" height="14" focusable="false">' +
            '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M8 12.5V3.5m0 0L4.5 7M8 3.5L11.5 7"/>' +
            '</svg></span>';

        function firstExtraInCategory(category) {
            if (!category) return null;
            for (let i = 0; i < products.length; i++) {
                const item = products[i];
                if (!item || !(item.card === true || item.variant === 'card')) continue;
                const itemCategory =
                    typeof item.category === 'string' ? item.category.trim() : '';
                if (itemCategory === category) return item;
            }
            return null;
        }

        function appendExtrasLinkRow(category) {
            const extra = firstExtraInCategory(category);
            if (!extra) return;

            let label = 'View suggested extra options';
            const heading = extra.sectionHeading;
            if (heading && typeof heading === 'object' && typeof heading.title === 'string') {
                const headingTitle = heading.title.trim();
                if (headingTitle) label = 'View suggested ' + headingTitle.toLowerCase();
            } else if (/chair/i.test(category)) {
                label = 'View suggested extra chair options';
            }

            const row = document.createElement('a');
            row.className = 'fl-summary__row fl-summary__row--link';
            row.href = '#' + extra.id;
            row.setAttribute('role', 'listitem');
            row.setAttribute('aria-label', label);
            if (typeof opts.onProductNavigate === 'function') {
                row.addEventListener('click', (event) => {
                    event.preventDefault();
                    opts.onProductNavigate(extra);
                });
            }

            const name = document.createElement('span');
            name.className = 'fl-summary__name fl-summary__name--link';
            name.textContent = label;

            row.appendChild(name);
            row.insertAdjacentHTML('beforeend', jumpArrow);
            list.appendChild(row);
        }

        rows.forEach(({ product, priceRmb }) => {
            const category =
                typeof product.category === 'string' ? product.category.trim() : '';
            if (category && category !== lastSummaryCategory) {
                if (lastSummaryCategory) appendExtrasLinkRow(lastSummaryCategory);
                const catRow = document.createElement('div');
                catRow.className = 'fl-summary__category';
                catRow.setAttribute('role', 'presentation');
                catRow.textContent = category;
                list.appendChild(catRow);
                lastSummaryCategory = category;
            }

            const row = document.createElement('a');
            row.className = 'fl-summary__row';
            if (opts.showThumbnails) row.classList.add('fl-summary__row--thumb');
            row.href = '#' + product.id;
            row.setAttribute('role', 'listitem');
            row.setAttribute('aria-label', 'View ' + product.title);
            if (typeof opts.onProductNavigate === 'function') {
                row.addEventListener('click', (event) => {
                    event.preventDefault();
                    opts.onProductNavigate(product);
                });
            }

            if (opts.showThumbnails) {
                const thumbWrap = document.createElement('span');
                thumbWrap.className = 'fl-summary__thumb';
                thumbWrap.setAttribute('aria-hidden', 'true');
                const cover = productCoverSrc(product);
                if (cover) {
                    const img = document.createElement('img');
                    img.src = cover;
                    img.alt = '';
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    thumbWrap.appendChild(img);
                }
                row.appendChild(thumbWrap);
            }

            const name = document.createElement('span');
            name.className = 'fl-summary__name';
            name.textContent = product.title;

            const price = document.createElement('span');
            price.className = 'fl-summary__price';
            if (priceRmb != null) {
                price.setAttribute('data-price-rmb', String(priceRmb));
                price.innerHTML = formatPriceHtml(priceRmb, activeCurrencyKey);
                totalRmb += priceRmb;
                pricedCount += 1;
            } else if (product.price) {
                price.textContent = product.price;
            } else {
                price.textContent = '—';
            }

            row.appendChild(name);
            row.appendChild(price);
            row.insertAdjacentHTML('beforeend', jumpArrow);
            list.appendChild(row);
        });

        if (lastSummaryCategory) appendExtrasLinkRow(lastSummaryCategory);

        section.appendChild(list);

        const showTotal = config.summaryTotal !== false && pricedCount > 1;
        const footnoteText =
            config.summaryFootnote === false || config.summaryFootnote === null
                ? ''
                : typeof config.summaryFootnote === 'string' && config.summaryFootnote.trim()
                  ? config.summaryFootnote.trim()
                  : showTotal
                    ? 'Prices are based on the specs shown. Final pricing is subject to confirmation of options, materials, and finishes.'
                    : '';
        const footnoteId = footnoteText ? 'fl-summary-footnote' : '';

        if (showTotal) {
            const totalRow = document.createElement('div');
            totalRow.className = 'fl-summary__row fl-summary__row--total';
            totalRow.setAttribute('role', 'listitem');
            if (footnoteId) totalRow.setAttribute('aria-describedby', footnoteId);

            const totalLabel = document.createElement('span');
            totalLabel.className = 'fl-summary__name fl-summary__name--total';
            totalLabel.textContent = 'Total';
            if (footnoteText) {
                const star = document.createElement('sup');
                star.className = 'fl-summary__asterisk';
                star.setAttribute('aria-hidden', 'true');
                star.textContent = '*';
                totalLabel.appendChild(star);
            }

            const totalPrice = document.createElement('span');
            totalPrice.className = 'fl-summary__price';
            totalPrice.setAttribute('data-price-rmb', String(totalRmb));
            totalPrice.innerHTML = formatPriceHtml(totalRmb, activeCurrencyKey);

            totalRow.appendChild(totalLabel);
            totalRow.appendChild(totalPrice);
            list.appendChild(totalRow);
        }

        if (footnoteText) {
            const note = document.createElement('p');
            note.id = footnoteId;
            note.className = 'fl-summary__footnote';
            note.textContent = (showTotal ? '* ' : '') + footnoteText;
            section.appendChild(note);
        }

        return section;
    }

    /* ─── Build page ─── */

    async function build() {
        allImages = [];

        if (isProductLayout) {
            buildProducts();
            buildQuoteSection();
            ensureLightbox();
            setupLightboxClicks();
            setupActiveNav();
            return;
        }

        const rooms = config.rooms;
        if (shouldShowStickyNav(rooms.length)) {
            buildStickyNav(rooms);
        }

        if (roomsRoot) {
            roomsRoot.innerHTML = '';
        }

        let indexOffset = 0;

        for (const room of rooms) {
            if (!roomsRoot) break;
            const section = document.createElement('section');
            section.className = 'fl-room';
            section.id = room.id;

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'fl-room__toggle';
            toggle.setAttribute('aria-expanded', 'true');
            toggle.setAttribute('aria-controls', room.id + '-body');

            const title = document.createElement('h2');
            title.className = 'fl-room__title';
            title.textContent = room.title;

            const chevron = document.createElement('span');
            chevron.className = 'fl-room__chevron';
            chevron.setAttribute('aria-hidden', 'true');
            chevron.innerHTML =
                '<svg viewBox="0 0 24 24" width="22" height="22" focusable="false">' +
                '<path fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/>' +
                '</svg>';

            toggle.appendChild(title);
            toggle.appendChild(chevron);
            section.appendChild(toggle);

            const images = Array.isArray(room.images) ? room.images : [];

            const body = document.createElement('div');
            body.className = 'fl-room__body';
            body.id = room.id + '-body';

            const brochures = Array.isArray(room.brochures)
                ? room.brochures
                : room.brochure
                    ? [room.brochure]
                    : [];
            const primaryBrochure = brochures[0] || null;

            if (room.intro) {
                const intro = document.createElement('p');
                intro.className = 'fl-room__intro';

                if (primaryBrochure && primaryBrochure.href) {
                    const label = primaryBrochure.label || 'factory brochure';
                    const parts = String(room.intro).split('{{brochure}}');
                    if (parts.length === 2) {
                        intro.appendChild(document.createTextNode(parts[0]));
                        const link = document.createElement('a');
                        link.href = primaryBrochure.href;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        link.textContent = label;
                        intro.appendChild(link);
                        intro.appendChild(document.createTextNode(parts[1]));
                    } else {
                        intro.textContent = room.intro;
                    }
                } else {
                    intro.textContent = room.intro;
                }

                body.appendChild(intro);
            }

            const grid = document.createElement('div');
            grid.className = 'fl-masonry masonry-layout';
            body.appendChild(grid);

            const ctaBrochures = brochures.filter((item) => item && item.href && item.cta);
            if (ctaBrochures.length) {
                const list = document.createElement('div');
                list.className = 'fl-room__brochures';

                for (const item of ctaBrochures) {
                    const cta = document.createElement('a');
                    cta.className = 'fl-room__brochure';
                    cta.href = item.href;
                    cta.target = '_blank';
                    cta.rel = 'noopener noreferrer';

                    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    icon.setAttribute('class', 'fl-room__brochure-icon');
                    icon.setAttribute('viewBox', '0 0 24 24');
                    icon.setAttribute('width', '26');
                    icon.setAttribute('height', '26');
                    icon.setAttribute('aria-hidden', 'true');
                    icon.setAttribute('focusable', 'false');
                    icon.innerHTML =
                        '<path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm1 7V3.5L18.5 9H15zM8.5 12h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1 0-1.5zm0 3.25h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1 0-1.5zm0 3.25h4.5a.75.75 0 0 1 0 1.5H8.5a.75.75 0 0 1 0-1.5z"/>';

                    const text = document.createElement('span');
                    text.textContent = item.cta;

                    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    arrow.setAttribute('class', 'fl-room__brochure-arrow');
                    arrow.setAttribute('viewBox', '0 0 24 24');
                    arrow.setAttribute('width', '16');
                    arrow.setAttribute('height', '16');
                    arrow.setAttribute('aria-hidden', 'true');
                    arrow.setAttribute('focusable', 'false');
                    arrow.innerHTML =
                        '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 17L17 7M9 7h8v8"/>';

                    cta.appendChild(icon);
                    cta.appendChild(text);
                    cta.appendChild(arrow);
                    list.appendChild(cta);
                }

                body.appendChild(list);
            }

            section.appendChild(body);

            roomsRoot.appendChild(section);
            setupCollapse(section, toggle);

            allImages.push(...images);
            await renderMasonry(grid, images, indexOffset);
            indexOffset += images.length;
        }

        buildQuoteSection();
        ensureLightbox();
        setupLightboxClicks();
        setupActiveNav();
        window.requestAnimationFrame(() => setupScrollPhotoHint(roomsRoot));

        window.addEventListener('resize', () => {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
                rerenderAllMasonry();
            }, 180);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
