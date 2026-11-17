(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const canvas = $('qr');
    if (!canvas || typeof QRCode === 'undefined') return;

    const PRESETS = [
        { name: 'Classic', fg: '#111111', bg: '#ffffff' },
        { name: 'Violet', fg: '#4b2fd6', bg: '#f4f1ff' },
        { name: 'Ocean', fg: '#0b4f71', bg: '#e8f6fb' },
        { name: 'Forest', fg: '#14532d', bg: '#effaf2' },
        { name: 'Sunset', fg: '#9a3412', bg: '#fff4e8' },
        { name: 'Night', fg: '#f5f5f5', bg: '#111827' },
    ];
    const ECC_HINT = { L: 'recovers 7%', M: 'recovers 15%', Q: 'recovers 25%', H: 'recovers 30%' };
    const SETTINGS_KEY = 'qr-settings-v1';

    const DEFAULTS = { fg: '#111111', bg: '#ffffff', style: 'square', ecc: 'M', margin: 2, size: 1024 };
    const state = { type: 'url', ...DEFAULTS };
    try {
        Object.assign(state, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
    } catch (e) {}
    const saveSettings = () => {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state)); } catch (e) {}
    };

    // ---------- payload ----------
    const val = (id) => $(id).value.trim();
    const wifiEscape = (s) => s.replace(/([\\;,:"])/g, '\\$1');

    function payload() {
        switch (state.type) {
            case 'url': {
                const u = val('f-url');
                if (!u) return '';
                return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
            }
            case 'text':
                return $('f-text').value;
            case 'wifi': {
                const ssid = $('f-ssid').value;
                if (!ssid) return '';
                const sec = $('f-sec').value;
                const pass = sec === 'nopass' ? '' : `P:${wifiEscape($('f-pass').value)};`;
                return `WIFI:T:${sec};S:${wifiEscape(ssid)};${pass}${$('f-hidden').checked ? 'H:true;' : ''};`;
            }
            case 'email': {
                const to = val('f-email');
                if (!to) return '';
                const q = new URLSearchParams();
                if (val('f-subject')) q.set('subject', val('f-subject'));
                if ($('f-body').value.trim()) q.set('body', $('f-body').value);
                const qs = q.toString().replace(/\+/g, '%20');
                return `mailto:${to}${qs ? '?' + qs : ''}`;
            }
            case 'phone': {
                const p = val('f-phone').replace(/[^\d+]/g, '');
                return p ? 'tel:' + p : '';
            }
            case 'sms': {
                const p = val('f-sms-to').replace(/[^\d+]/g, '');
                if (!p) return '';
                const body = $('f-sms-body').value.trim();
                return `SMSTO:${p}${body ? ':' + body : ''}`;
            }
        }
        return '';
    }

    // ---------- matrix ----------
    const scratch = document.createElement('div');
    function buildMatrix(text, ecc) {
        scratch.textContent = '';
        const q = new QRCode(scratch, { text: '', width: 8, height: 8, correctLevel: QRCode.CorrectLevel[ecc] });
        q.makeCode(text);
        const m = q._oQRCode;
        const n = m.getModuleCount();
        const cells = [];
        for (let r = 0; r < n; r++) {
            const row = [];
            for (let c = 0; c < n; c++) row.push(m.isDark(r, c));
            cells.push(row);
        }
        return { n, cells, version: (n - 17) / 4 };
    }

    // ---------- logo ----------
    const LOGO_MIN_BOX = 5;
    const LOGO_MAX_VERSION = 10;
    const LOGO_MAX_BYTES = 5 * 1024 * 1024;
    let logo = null;
    const eccNow = () => (logo ? 'H' : state.ecc);

    function logoBox(n) {
        let k = Math.floor(n * 0.22);
        if (k % 2 === 0) k -= 1;
        return { k, start: (n - k) / 2 };
    }

    function logoProblem(M) {
        if (M.version > LOGO_MAX_VERSION) return 'Content is too long for a logo. Shorten it or remove the logo.';
        if (logoBox(M.n).k < LOGO_MIN_BOX) return 'Content is too short for a logo. Add more text or remove the logo.';
        return '';
    }

    const inLogoBox = (M, r, c) => {
        const b = M.box;
        return !!b && r >= b.start && r < b.start + b.k && c >= b.start && c < b.start + b.k;
    };

    function logoRect(M, unit, off) {
        const pad = 0.8;
        const side = (M.box.k - pad * 2) * unit;
        const scale = Math.min(side / logo.w, side / logo.h);
        const w = logo.w * scale;
        const h = logo.h * scale;
        const center = off + (M.box.start + M.box.k / 2) * unit;
        return { x: center - w / 2, y: center - h / 2, w, h };
    }

    function logoFrame(M, unit, off) {
        const inset = 0.2;
        const x = off + (M.box.start + inset) * unit;
        return { x, y: x, s: (M.box.k - inset * 2) * unit, r: 1.2 * unit, lw: 0.16 * unit };
    }

    function loadLogo(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    const nw = img.naturalWidth || 256;
                    const nh = img.naturalHeight || 256;
                    const scale = Math.min(1, 512 / Math.max(nw, nh));
                    const c = document.createElement('canvas');
                    c.width = Math.max(1, Math.round(nw * scale));
                    c.height = Math.max(1, Math.round(nh * scale));
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    resolve({ source: c, url: c.toDataURL('image/png'), w: c.width, h: c.height, name: file.name });
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    const inFinder = (n, r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    const finderOrigins = (n) => [[0, 0], [0, n - 7], [n - 7, 0]];

    // ---------- canvas ----------
    function roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function draw(target, M, px) {
        const ctx = target.getContext('2d');
        target.width = px;
        target.height = px;
        const total = M.n + state.margin * 2;
        const cell = px / total;
        const off = state.margin * cell;
        ctx.fillStyle = state.bg;
        ctx.fillRect(0, 0, px, px);
        ctx.fillStyle = state.fg;

        ctx.beginPath();
        for (let r = 0; r < M.n; r++) {
            for (let c = 0; c < M.n; c++) {
                if (!M.cells[r][c] || inLogoBox(M, r, c) || (state.style !== 'square' && inFinder(M.n, r, c))) continue;
                const x = off + c * cell;
                const y = off + r * cell;
                if (state.style === 'dots') {
                    ctx.moveTo(x + cell * 0.92, y + cell / 2);
                    ctx.arc(x + cell / 2, y + cell / 2, cell * 0.42, 0, Math.PI * 2);
                } else if (state.style === 'rounded') {
                    roundRect(ctx, x + cell * 0.04, y + cell * 0.04, cell * 0.92, cell * 0.92, cell * 0.32);
                } else {
                    ctx.rect(x, y, cell + 0.5, cell + 0.5);
                }
            }
        }
        ctx.fill();

        if (state.style !== 'square') {
            for (const [r0, c0] of finderOrigins(M.n)) {
                const x = off + c0 * cell;
                const y = off + r0 * cell;
                ctx.beginPath();
                roundRect(ctx, x, y, cell * 7, cell * 7, cell * 2);
                roundRect(ctx, x + cell, y + cell, cell * 5, cell * 5, cell * 1.3);
                ctx.fill('evenodd');
                ctx.beginPath();
                roundRect(ctx, x + cell * 2, y + cell * 2, cell * 3, cell * 3, cell * 0.9);
                ctx.fill();
            }
        }

        if (M.box && logo) {
            const f = logoFrame(M, cell, off);
            ctx.beginPath();
            roundRect(ctx, f.x, f.y, f.s, f.s, f.r);
            ctx.fillStyle = state.bg;
            ctx.fill();
            ctx.strokeStyle = state.fg;
            ctx.lineWidth = f.lw;
            ctx.stroke();
            const p = logoRect(M, cell, off);
            ctx.drawImage(logo.source, p.x, p.y, p.w, p.h);
        }
    }

    // ---------- svg ----------
    function rrPath(x, y, w, h, r) {
        const f = (v) => +v.toFixed(3);
        return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
    }

    function toSvg(M) {
        const total = M.n + state.margin * 2;
        const m = state.margin;
        let d = '';
        for (let r = 0; r < M.n; r++) {
            for (let c = 0; c < M.n; c++) {
                if (!M.cells[r][c] || inLogoBox(M, r, c) || (state.style !== 'square' && inFinder(M.n, r, c))) continue;
                const x = m + c;
                const y = m + r;
                if (state.style === 'dots') d += `M${x + 0.08} ${y + 0.5}a0.42 0.42 0 1 0 0.84 0a0.42 0.42 0 1 0 -0.84 0Z`;
                else if (state.style === 'rounded') d += rrPath(x + 0.04, y + 0.04, 0.92, 0.92, 0.32);
                else d += `M${x} ${y}h1v1h-1Z`;
            }
        }
        let finders = '';
        if (state.style !== 'square') {
            for (const [r0, c0] of finderOrigins(M.n)) {
                const x = m + c0;
                const y = m + r0;
                finders += `<path fill-rule="evenodd" d="${rrPath(x, y, 7, 7, 2)}${rrPath(x + 1, y + 1, 5, 5, 1.3)}"/>`;
                finders += `<path d="${rrPath(x + 2, y + 2, 3, 3, 0.9)}"/>`;
            }
        }
        let image = '';
        if (M.box && logo) {
            const p = logoRect(M, 1, m);
            const fr = logoFrame(M, 1, m);
            const f = (v) => +v.toFixed(3);
            image = `<rect x="${f(fr.x)}" y="${f(fr.y)}" width="${f(fr.s)}" height="${f(fr.s)}" rx="${f(fr.r)}" fill="${state.bg}" stroke="${state.fg}" stroke-width="${f(fr.lw)}"/>`;
            image += `<image href="${logo.url}" x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}" preserveAspectRatio="xMidYMid meet"/>`;
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="1024" height="1024" shape-rendering="${state.style === 'square' ? 'crispEdges' : 'geometricPrecision'}"><rect width="100%" height="100%" fill="${state.bg}"/><g fill="${state.fg}"><path d="${d}"/>${finders}</g>${image}</svg>`;
    }

    // ---------- contrast ----------
    function luminance(hex) {
        const n = parseInt(hex.slice(1), 16);
        const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }

    function contrastWarning() {
        const a = luminance(state.fg);
        const b = luminance(state.bg);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < 3) return 'Low contrast between colors. Phones may fail to scan this code.';
        if (a > b) return 'Light dots on a dark background. Some older scanners cannot read inverted codes.';
        return '';
    }

    // ---------- render ----------
    let matrix = null;
    let lastText = '';
    const empty = $('empty');
    const meta = $('meta');
    const warn = $('warn');
    const actionBtns = ['dl-png', 'dl-svg', 'copy'].map($);

    function render() {
        const text = payload();
        lastText = text;
        matrix = null;
        let problem = '';
        if (text) {
            try {
                matrix = buildMatrix(text, eccNow());
            } catch (e) {
                matrix = null;
            }
            if (matrix && logo) {
                problem = logoProblem(matrix);
                if (problem) matrix = null;
                else matrix.box = logoBox(matrix.n);
            }
        }
        const ok = !!matrix;
        canvas.hidden = !ok;
        empty.hidden = ok;
        actionBtns.forEach((b) => (b.disabled = !ok));
        const tooMuch = logo ? 'Too much content for a QR code with a logo. Shorten it or remove the logo.' : 'Too much content for one QR code. Shorten it or lower error correction.';
        $('empty-text').textContent = text ? problem || tooMuch : 'Fill in the form to see your QR code';
        if (!ok) {
            meta.textContent = '';
            warn.hidden = true;
            return;
        }
        draw(canvas, matrix, 640);
        meta.textContent = `Version ${matrix.version} · ${matrix.n}×${matrix.n} modules · ${text.length} characters`;
        const w = contrastWarning();
        warn.textContent = w;
        warn.hidden = !w;
    }

    let timer;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(render, 120);
    };

    // ---------- controls ----------
    const tabs = document.querySelectorAll('[role="tab"][data-type]');
    function setType(type) {
        state.type = type;
        tabs.forEach((t) => {
            const on = t.dataset.type === type;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
        });
        document.querySelectorAll('.pane').forEach((p) => (p.hidden = p.dataset.pane !== type));
    }
    tabs.forEach((t, i) => {
        t.addEventListener('click', () => {
            setType(t.dataset.type);
            saveSettings();
            render();
            const first = document.querySelector(`.pane[data-pane="${t.dataset.type}"] input, .pane[data-pane="${t.dataset.type}"] textarea`);
            if (first) first.focus();
        });
        t.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            next.focus();
            next.click();
        });
    });

    document.querySelectorAll('.pane input, .pane textarea, .pane select').forEach((el) => {
        el.addEventListener('input', schedule);
        el.addEventListener('change', schedule);
    });

    const segSyncs = [];
    function bindSeg(id, key, cast) {
        const box = $(id);
        const current = () => (key === 'ecc' ? eccNow() : state[key]);
        const sync = () =>
            box.querySelectorAll('button').forEach((b) => {
                b.setAttribute('aria-checked', String(String(current()) === b.dataset.v));
                if (key === 'ecc') b.disabled = !!logo;
            });
        box.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b || b.disabled) return;
            state[key] = cast ? cast(b.dataset.v) : b.dataset.v;
            sync();
            saveSettings();
            if (key === 'ecc') $('ecc-hint').textContent = ECC_HINT[eccNow()];
            if (key !== 'size') render();
        });
        segSyncs.push(sync);
        sync();
    }
    bindSeg('f-style', 'style');
    bindSeg('f-ecc', 'ecc');
    bindSeg('f-size', 'size', Number);
    $('ecc-hint').textContent = ECC_HINT[state.ecc];

    const marginInput = $('f-margin');
    marginInput.value = state.margin;
    $('margin-val').textContent = state.margin + ' modules';
    marginInput.addEventListener('input', () => {
        state.margin = Number(marginInput.value);
        $('margin-val').textContent = state.margin + ' modules';
        saveSettings();
        render();
    });

    const isHex = (s) => /^#[0-9a-f]{6}$/i.test(s);
    function setColor(key, value) {
        state[key] = value.toLowerCase();
        $('f-' + key).value = state[key];
        $('f-' + key + '-hex').value = state[key];
        syncPresets();
        saveSettings();
        render();
    }
    ['fg', 'bg'].forEach((key) => {
        $('f-' + key).addEventListener('input', (e) => setColor(key, e.target.value));
        $('f-' + key + '-hex').addEventListener('input', (e) => {
            let v = e.target.value.trim();
            if (v && v[0] !== '#') v = '#' + v;
            if (isHex(v)) setColor(key, v);
        });
    });

    const presetBox = $('presets');
    PRESETS.forEach((p) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'preset';
        b.title = p.name;
        b.setAttribute('aria-label', p.name + ' colors');
        b.style.setProperty('--fg', p.fg);
        b.style.setProperty('--bg', p.bg);
        b.addEventListener('click', () => {
            state.fg = p.fg;
            setColor('bg', p.bg);
            setColor('fg', p.fg);
        });
        presetBox.append(b);
    });
    function syncPresets() {
        presetBox.querySelectorAll('.preset').forEach((b, i) => {
            b.setAttribute('aria-pressed', String(PRESETS[i].fg === state.fg && PRESETS[i].bg === state.bg));
        });
    }

    const logoInput = $('f-logo');
    function refreshLogoUi() {
        $('logo-name').textContent = logo ? logo.name : '';
        $('logo-pick').textContent = logo ? 'Change' : 'Upload';
        $('logo-remove').hidden = !logo;
        $('logo-hint').textContent = logo ? 'level H is locked on' : 'uses level H';
        segSyncs.forEach((sync) => sync());
        $('ecc-hint').textContent = ECC_HINT[eccNow()];
    }

    $('logo-pick').addEventListener('click', () => logoInput.click());
    $('logo-remove').addEventListener('click', () => {
        logo = null;
        logoInput.value = '';
        refreshLogoUi();
        render();
    });
    logoInput.addEventListener('change', async () => {
        const file = logoInput.files[0];
        logoInput.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) return toast('Please choose an image file.');
        if (file.size > LOGO_MAX_BYTES) return toast('Image is too large. Max 5 MB.');
        try {
            logo = await loadLogo(file);
        } catch (e) {
            return toast('Could not read this image.');
        }
        refreshLogoUi();
        render();
    });

    $('reset').addEventListener('click', () => {
        Object.assign(state, DEFAULTS);
        logo = null;
        refreshLogoUi();
        marginInput.value = state.margin;
        $('margin-val').textContent = state.margin + ' modules';
        setColor('bg', state.bg);
        setColor('fg', state.fg);
        toast('Settings reset');
    });

    // ---------- export ----------
    const toast = (msg) => {
        const el = $('toast');
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(toast.t);
        toast.t = setTimeout(() => (el.hidden = true), 2600);
    };

    function fileBase() {
        const slug = lastText.replace(/^[a-z]+:(\/\/)?/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        return 'qr-' + (slug || 'code');
    }

    function saveBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    function pngBlob() {
        const c = document.createElement('canvas');
        draw(c, matrix, state.size);
        return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    }

    $('dl-png').addEventListener('click', async () => {
        if (!matrix) return;
        saveBlob(await pngBlob(), fileBase() + '.png');
        toast('PNG downloaded');
    });

    $('dl-svg').addEventListener('click', () => {
        if (!matrix) return;
        saveBlob(new Blob([toSvg(matrix)], { type: 'image/svg+xml' }), fileBase() + '.svg');
        toast('SVG downloaded');
    });

    $('copy').addEventListener('click', async () => {
        if (!matrix) return;
        try {
            if (!navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
            toast('Image copied to clipboard');
        } catch (e) {
            toast('Copy is not supported here. Use Download instead.');
        }
    });

    // ---------- boot ----------
    setType(state.type);
    setColor('bg', state.bg);
    setColor('fg', state.fg);
    render();
})();
