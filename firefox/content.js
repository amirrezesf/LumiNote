let paletteContainer = null;
let actionMenu = null;
let notePopup = null;
let drawingModal = null;
let lightbox = null;
let canvas = null;
let ctx = null;

// State Variables
let currentHoveredId = null; 
let activeNoteTargetId = null;         
let actionMenuHideTimeout = null;
let tempSelectedColor = null;
let savedCustomColor = null;

// Drawing State
let isDrawing = false;
let currentBrushColor = '#000000';
let currentBrushSize = 3;
let currentTool = 'pen'; 
let tempDrawingImage = null; // Base64 for preview
let tempDrawingStrokes = []; // Vector data for editing
let currentStroke = null; // Currently being drawn stroke

const PRESET_COLORS = ['#ffeb3b', '#a5d6a7', '#81d4fa', '#f48fb1', '#ffcc80'];
const PAGE_INCREMENT = 400;

function isExtensionValid() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
}

function init() {
    loadSettings(); 
    createElements();
    createDrawingModal(); 
    createLightbox(); 
    setupEventListeners();
    setTimeout(loadHighlights, 500); 
}

function loadSettings() {
    if (!isExtensionValid()) return;
    chrome.storage.local.get(['user_settings'], (result) => {
        if (result.user_settings && result.user_settings.lastCustomColor) {
            savedCustomColor = result.user_settings.lastCustomColor;
            updateLastCustomButton();
        }
    });
}

// =================================================================
//  CORE LOGIC: PATH GENERATION
// =================================================================

function getDomPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    const stack = [];
    while (el.parentNode != null) {
        let sibCount = 0;
        let sibIndex = 0;
        for (let i = 0; i < el.parentNode.childNodes.length; i++) {
            const sib = el.parentNode.childNodes[i];
            if (sib.nodeName === el.nodeName) {
                if (sib === el) sibIndex = sibCount;
                sibCount++;
            }
        }
        let nodeName = el.nodeName.toLowerCase();
        if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) { 
            stack.unshift(nodeName + '#' + el.id);
        } else if (sibCount > 1) {
            stack.unshift(nodeName + ':nth-of-type(' + (sibIndex + 1) + ')');
        } else {
            stack.unshift(nodeName);
        }
        el = el.parentNode;
    }
    return stack.join(' > ');
}

function getTextNodeIndex(container, targetNode) {
    let index = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    while(walker.nextNode()) {
        if(walker.currentNode === targetNode) return index;
        index++;
    }
    return 0;
}

function getTextNodeByPath(path, textIndex) {
    try {
        const element = document.querySelector(path);
        if (!element) return null;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let currentIndex = 0;
        while(walker.nextNode()) {
            if(currentIndex === textIndex) return walker.currentNode;
            currentIndex++;
        }
    } catch(e) { }
    return null;
}

// =================================================================
//  CORE LOGIC: HIGHLIGHTING
// =================================================================

function performHighlight(color) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    // FIX: Capture the full, unified text BEFORE the DOM gets split up
    const selectedText = selection.toString().trim();

    const range = selection.getRangeAt(0);
    const highlightId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    
    const startContainerEl = range.startContainer.nodeType === Node.TEXT_NODE 
        ? range.startContainer.parentNode : range.startContainer;
    const endContainerEl = range.endContainer.nodeType === Node.TEXT_NODE 
        ? range.endContainer.parentNode : range.endContainer;

    const meta = {
        id: highlightId,
        text: selectedText, // FIX: Save the single string of text
        color: color,
        startPath: getDomPath(startContainerEl),
        startTextIndex: range.startContainer.nodeType === Node.TEXT_NODE ? getTextNodeIndex(startContainerEl, range.startContainer) : 0,
        startOffset: range.startOffset,
        endPath: getDomPath(endContainerEl),
        endTextIndex: range.endContainer.nodeType === Node.TEXT_NODE ? getTextNodeIndex(endContainerEl, range.endContainer) : 0,
        endOffset: range.endOffset,
        note: "",
        drawing: null, // Stores Base64 (for preview)
        strokes: []    // Stores Vector Data (for editing)
    };

    cleanupOverlaps(range);
    wrapRange(range, color, highlightId);
    consolidateHighlights();
    saveHighlightToStorage(meta);
    selection.removeAllRanges();
}

function wrapRange(range, color, id, note = "", hasContent = false) {
    try {
        const textNodes = [];
        const walker = document.createTreeWalker(
            range.commonAncestorContainer, 
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            },
            false
        );

        while(walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }

        if (textNodes.length === 0 && range.startContainer.nodeType === Node.TEXT_NODE) {
            textNodes.push(range.startContainer);
        }

        textNodes.forEach((node) => {
            const subRange = document.createRange();
            subRange.selectNodeContents(node);

            if (node === range.startContainer) subRange.setStart(node, range.startOffset);
            if (node === range.endContainer) subRange.setEnd(node, range.endOffset);

            if (subRange.toString().length > 0) {
                const span = document.createElement('span');
                span.className = 'my-saved-highlight';
                span.style.cssText = `background-color: ${color || '#ffeb3b'} !important;`; 
                span.dataset.highlightId = id;
                span.dataset.note = note;
                if(hasContent) span.setAttribute('data-has-note', 'true');

                try {
                    subRange.surroundContents(span);
                } catch(e) { }
            }
        });
    } catch(e) { console.error(e); }
}

function consolidateHighlights() {
    const spans = Array.from(document.querySelectorAll('.my-saved-highlight'));
    if (spans.length < 2) return;

    spans.sort((a, b) => {
        return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    for (let i = 0; i < spans.length - 1; i++) {
        const current = spans[i];
        const next = spans[i + 1];

        if (current.dataset.highlightId === next.dataset.highlightId) continue;

        const checkRange = document.createRange();
        checkRange.setStartAfter(current);
        checkRange.setEndBefore(next);

        const textBetween = checkRange.toString();
        
        if (textBetween.length === 0) {
            const masterId = current.dataset.highlightId;
            const targetId = next.dataset.highlightId;
            
            const batch = document.querySelectorAll(`.my-saved-highlight[data-highlight-id="${targetId}"]`);
            batch.forEach(el => el.dataset.highlightId = masterId);
        }
    }
}

function restoreHighlight(item) {
    try {
        const startNode = getTextNodeByPath(item.startPath, item.startTextIndex);
        const endNode = getTextNodeByPath(item.endPath, item.endTextIndex);

        if (!startNode || !endNode) return;

        const range = document.createRange();
        range.setStart(startNode, item.startOffset);
        range.setEnd(endNode, item.endOffset);

        const hasContent = (item.note && item.note.length > 0) || !!item.drawing;
        
        if (startNode.parentNode.classList.contains('my-saved-highlight') && 
            startNode.parentNode.dataset.highlightId === item.id) return;

        wrapRange(range, item.color, item.id, item.note, hasContent);

    } catch(e) {
        console.error("Restore failed:", e);
    }
}

// =================================================================
//  STORAGE
// =================================================================

function saveHighlightToStorage(meta) {
    const url = window.location.href;
    chrome.storage.local.get([url], (result) => {
        let highlights = result[url] || [];
        highlights.push(meta);
        chrome.storage.local.set({ [url]: highlights });
    });
}

function loadHighlights() {
    if (!isExtensionValid()) return;
    const url = window.location.href;
    chrome.storage.local.get([url], (result) => {
        const highlights = result[url];
        if (highlights && highlights.length > 0) {
            window.getSelection().removeAllRanges();
            highlights.forEach(item => restoreHighlight(item));
            consolidateHighlights();
            window.getSelection().removeAllRanges();
        }
    });
}

function updateStorageData(id, noteText, drawingData, strokesData) {
    const url = window.location.href;
    chrome.storage.local.get([url], (result) => {
        let highlights = result[url] || [];
        const target = highlights.find(h => h.id === id);
        if (target) {
            target.note = noteText;
            target.drawing = drawingData; // Image for preview
            target.strokes = strokesData; // Vector data for editing
            chrome.storage.local.set({ [url]: highlights });
        }
    });
}

function cleanupOverlaps(range) {
    const allHighlights = document.querySelectorAll('.my-saved-highlight');
    allHighlights.forEach(span => {
        if (range.intersectsNode(span)) { 
            const idToRemove = span.dataset.highlightId;
            removeHighlightGroup(idToRemove);
        }
    });
}

function removeHighlightGroup(id) {
    if(!id) return;
    const spans = document.querySelectorAll(`.my-saved-highlight[data-highlight-id="${id}"]`);
    spans.forEach(span => {
        const parent = span.parentNode;
        while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
        parent.normalize();
    });

    const url = window.location.href;
    chrome.storage.local.get([url], (result) => {
        let highlights = result[url] || [];
        highlights = highlights.filter(h => h.id !== id);
        chrome.storage.local.set({ [url]: highlights });
    });
}

// =================================================================
//  UI & EVENTS
// =================================================================

function createElements() {
    // 1. Palette
    paletteContainer = document.createElement('div');
    paletteContainer.id = 'my-highlight-palette';
    PRESET_COLORS.forEach(color => {
        const btn = document.createElement('div');
        btn.className = 'color-btn';
        btn.style.backgroundColor = color;
        btn.addEventListener('mousedown', (e) => { 
            e.preventDefault(); e.stopPropagation();
            performHighlight(color);
            hideElement(paletteContainer);
        });
        paletteContainer.appendChild(btn);
    });
    const divider = document.createElement('div');
    divider.className = 'palette-divider';
    paletteContainer.appendChild(divider);
    lastCustomBtn = document.createElement('div');
    lastCustomBtn.className = 'color-btn';
    lastCustomBtn.style.display = 'none'; 
    lastCustomBtn.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:0.5;"><svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:#000"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg></div>';
    lastCustomBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (savedCustomColor) {
            performHighlight(savedCustomColor);
            hideElement(paletteContainer);
        }
    });
    paletteContainer.appendChild(lastCustomBtn);
    customColorTrigger = document.createElement('div');
    customColorTrigger.className = 'color-btn';
    customColorTrigger.id = 'custom-color-trigger';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.id = 'custom-color-input';
    colorInput.addEventListener('input', (e) => {
        tempSelectedColor = e.target.value;
        customColorTrigger.style.background = tempSelectedColor;
        confirmBtn.style.display = 'flex';
    });
    colorInput.addEventListener('click', (e) => e.stopPropagation());
    customColorTrigger.appendChild(colorInput);
    paletteContainer.appendChild(customColorTrigger);
    confirmBtn = document.createElement('button');
    confirmBtn.id = 'confirm-color-btn';
    confirmBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tempSelectedColor) {
            performHighlight(tempSelectedColor);
            saveCustomColorSetting(tempSelectedColor); 
            hideElement(paletteContainer);
        }
    });
    paletteContainer.appendChild(confirmBtn);
    document.body.appendChild(paletteContainer);

    // 2. Action Menu
    actionMenu = document.createElement('div');
    actionMenu.id = 'my-action-menu';
    const noteBtn = document.createElement('button');
    noteBtn.className = 'action-btn';
    noteBtn.id = 'btn-note';
    noteBtn.title = "Note & Drawing";
    noteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    noteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if(isExtensionValid()) openNotePopup();
    });
    actionMenu.appendChild(noteBtn);
    const delBtn = document.createElement('button');
    delBtn.className = 'action-btn';
    delBtn.id = 'btn-delete';
    delBtn.title = "Remove Highlight";
    delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentHoveredId) {
            removeHighlightGroup(currentHoveredId);
            hideElement(actionMenu);
            currentHoveredId = null;
        }
    });
    actionMenu.appendChild(delBtn);
    document.body.appendChild(actionMenu);
    actionMenu.addEventListener('mouseenter', () => clearTimeout(actionMenuHideTimeout));

    // 3. Note Popup
    notePopup = document.createElement('div');
    notePopup.id = 'my-note-popup';
    notePopup.innerHTML = `
        <div class="note-preview-area" title="Click to view full size">
            <img id="note-drawing-preview" alt="Handwriting Preview">
            <button id="btn-remove-drawing">Remove Drawing</button>
        </div>
        <textarea placeholder="Write a note..."></textarea>
        <div class="note-actions">
            <div class="note-left-actions">
                <button class="note-btn-cancel" id="note-cancel-delete-btn">Cancel</button>
                <button id="btn-open-drawing" title="Add/Edit Drawing">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                </button>
            </div>
            <button class="note-btn-save">Save</button>
        </div>
    `;
    notePopup.querySelector('#note-drawing-preview').addEventListener('click', (e) => {
        e.stopPropagation();
        if (tempDrawingImage) openLightbox(tempDrawingImage);
    });
    const cancelDeleteBtn = notePopup.querySelector('#note-cancel-delete-btn');
    cancelDeleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cancelDeleteBtn.textContent === "Delete") {
            if(isExtensionValid()) deleteNote();
        } else {
            hideElement(notePopup);
            activeNoteTargetId = null;
            tempDrawingImage = null; 
            tempDrawingStrokes = [];
        }
    });
    notePopup.querySelector('.note-btn-save').addEventListener('click', (e) => {
        e.stopPropagation();
        if(isExtensionValid()) saveNote();
    });
    notePopup.querySelector('#btn-open-drawing').addEventListener('click', (e) => {
        e.stopPropagation();
        openDrawingModal();
    });
    notePopup.querySelector('#btn-remove-drawing').addEventListener('click', (e) => {
        e.stopPropagation();
        tempDrawingImage = null;
        tempDrawingStrokes = [];
        updateNotePopupPreview();
    });
    notePopup.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(notePopup);
}

// 4. Lightbox
function createLightbox() {
    lightbox = document.createElement('div');
    lightbox.id = 'my-lightbox';
    lightbox.innerHTML = `
        <button id="btn-close-lightbox">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
        </button>
        <div class="lightbox-content">
            <img id="lightbox-img" src="">
        </div>
    `;
    lightbox.querySelector('#btn-close-lightbox').addEventListener('click', (e) => {
        e.stopPropagation();
        lightbox.style.display = 'none';
    });
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) lightbox.style.display = 'none';
    });
    lightbox.querySelector('.lightbox-content').addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(lightbox);
}

function openLightbox(imgData) {
    const img = lightbox.querySelector('#lightbox-img');
    img.src = imgData;
    lightbox.style.display = 'flex';
}

// 5. Drawing Modal (With Editable Logic)
function createDrawingModal() {
    drawingModal = document.createElement('div');
    drawingModal.id = 'my-drawing-modal';
    drawingModal.innerHTML = `
        <div class="drawing-modal-content">
            <div class="drawing-header">
                <h3>Handwriting & Draw</h3>
                <div class="drawing-header-actions">
                    <button class="drawing-btn btn-danger" id="draw-clear">Clear All</button>
                    <button class="drawing-btn btn-secondary" id="draw-cancel">Cancel</button>
                    <button class="drawing-btn btn-primary" id="draw-save">Done</button>
                </div>
            </div>
            <div class="drawing-canvas-area" id="canvas-wrapper">
                <canvas id="the-canvas"></canvas>
                <button id="btn-add-page">+ Add Page</button>
            </div>
            <div class="drawing-toolbar">
                <div class="tool-circle active" data-color="#000000" style="background: #000000;"></div>
                <div class="tool-circle" data-color="#ef4444" style="background: #ef4444;"></div>
                <div class="tool-circle" data-color="#3b82f6" style="background: #3b82f6;"></div>
                <div class="tool-circle" data-color="#22c55e" style="background: #22c55e;"></div>
                <div style="width:1px; height:24px; background:#e5e7eb; margin:0 8px;"></div>
                <button class="tool-action-btn active" id="tool-pen">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>
                    Pen
                </button>
                <button class="tool-action-btn" id="tool-eraser">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 20Z"></path><path d="M17 17L7 7"></path></svg>
                    Eraser
                </button>
                <button class="tool-action-btn" id="tool-stroke-eraser">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
                    Stroke Eraser
                </button>
            </div>
        </div>
    `;
    drawingModal.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    document.body.appendChild(drawingModal);
    canvas = drawingModal.querySelector('#the-canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // Handlers
    drawingModal.querySelector('#btn-add-page').addEventListener('click', (e) => { e.stopPropagation(); resizeCanvasHeight(); });
    drawingModal.querySelector('#draw-cancel').addEventListener('click', (e) => { e.stopPropagation(); drawingModal.style.display = 'none'; isDrawing = false; });
    drawingModal.querySelector('#draw-clear').addEventListener('click', (e) => { 
        e.stopPropagation(); 
        tempDrawingStrokes = []; // Clear vector data
        redrawCanvas(tempDrawingStrokes); // Clear visual
    });
    drawingModal.querySelector('#draw-save').addEventListener('click', (e) => { 
        e.stopPropagation(); 
        tempDrawingImage = canvas.toDataURL('image/png'); // Save snapshot for preview
        // tempDrawingStrokes is already updated via mouse events
        updateNotePopupPreview(); 
        drawingModal.style.display = 'none'; 
        isDrawing = false; 
    });

    const colorCircles = drawingModal.querySelectorAll('.tool-circle');
    colorCircles.forEach(circle => {
        circle.addEventListener('click', () => {
            colorCircles.forEach(c => c.classList.remove('active'));
            circle.classList.add('active');
            currentBrushColor = circle.dataset.color;
            if(currentTool === 'eraser' || currentTool === 'eraser-stroke') {
                currentTool = 'pen';
                drawingModal.querySelector('#tool-pen').classList.add('active');
                drawingModal.querySelector('#tool-eraser').classList.remove('active');
                drawingModal.querySelector('#tool-stroke-eraser').classList.remove('active');
            }
        });
    });
    const penBtn = drawingModal.querySelector('#tool-pen');
    const eraserBtn = drawingModal.querySelector('#tool-eraser');
    const strokeEraserBtn = drawingModal.querySelector('#tool-stroke-eraser');
    const allToolBtns = [penBtn, eraserBtn, strokeEraserBtn];
    penBtn.addEventListener('click', () => { currentTool = 'pen'; penBtn.classList.add('active'); eraserBtn.classList.remove('active'); strokeEraserBtn.classList.remove('active'); canvas.style.cursor = 'crosshair'; });
    eraserBtn.addEventListener('click', () => { currentTool = 'eraser'; eraserBtn.classList.add('active'); penBtn.classList.remove('active'); strokeEraserBtn.classList.remove('active'); canvas.style.cursor = 'none'; });
    strokeEraserBtn.addEventListener('click', () => { currentTool = 'eraser-stroke'; strokeEraserBtn.classList.add('active'); penBtn.classList.remove('active'); eraserBtn.classList.remove('active'); canvas.style.cursor = 'none'; });
    
    setupCanvasEvents();
}

function resizeCanvasHeight() {
    canvas.height += PAGE_INCREMENT;
    redrawCanvas(tempDrawingStrokes);
}

function redrawCanvas(strokes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokes.forEach(stroke => {
        ctx.beginPath();
        if (stroke.tool === 'pen') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.width || 3;
        } else {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 20;
        }

        if (stroke.points.length === 1) {
            // Single click = draw a dot as a filled circle
            const p = stroke.points[0];
            const radius = (stroke.tool === 'pen') ? (stroke.width || 3) : 10;
            if (stroke.tool === 'pen') {
                ctx.fillStyle = stroke.color;
            }
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();
        } else if (stroke.points.length > 1) {
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
        }
    });
}

function setupCanvasEvents() {
    const ERASER_RADIUS = 10;
    const STROKE_ERASER_RADIUS = 18;

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    function drawEraserCursor(x, y, radius) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    function updateCursor(x, y) {
        const radius = currentTool === 'eraser' ? ERASER_RADIUS : STROKE_ERASER_RADIUS;
        redrawCanvas(tempDrawingStrokes);
        drawEraserCursor(x, y, radius);
    }

    function strokeHitTest(stroke, x, y, radius) {
        return stroke.points.some(p => {
            const dx = p.x - x;
            const dy = p.y - y;
            return Math.sqrt(dx * dx + dy * dy) <= radius;
        });
    }

    const start = (e) => {
        if (e.target !== canvas) return;
        isDrawing = true;
        const pos = getPos(e);

        if (currentTool === 'eraser-stroke') {
            tempDrawingStrokes = tempDrawingStrokes.filter(s => !strokeHitTest(s, pos.x, pos.y, STROKE_ERASER_RADIUS));
            updateCursor(pos.x, pos.y);
            return;
        }

        currentStroke = {
            tool: currentTool,
            color: currentBrushColor,
            width: 3,
            points: [{ x: pos.x, y: pos.y }]
        };

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (currentTool === 'pen') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = currentBrushColor;
            ctx.lineWidth = 3;
        } else {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = ERASER_RADIUS * 2;
        }
    };

    const move = (e) => {
        if (e.target !== canvas) return;
        e.preventDefault();
        const pos = getPos(e);

        if (currentTool === 'eraser' || currentTool === 'eraser-stroke') {
            if (isDrawing && currentTool === 'eraser-stroke') {
                const before = tempDrawingStrokes.length;
                tempDrawingStrokes = tempDrawingStrokes.filter(s => !strokeHitTest(s, pos.x, pos.y, STROKE_ERASER_RADIUS));
                if (tempDrawingStrokes.length !== before) {
                    updateCursor(pos.x, pos.y);
                    return;
                }
            }
            // Always redraw cursor when hovering with eraser tools
            updateCursor(pos.x, pos.y);
            return;
        }

        if (!isDrawing) return;
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        if (currentStroke) currentStroke.points.push({ x: pos.x, y: pos.y });
    };

    const end = (e) => {
        if (isDrawing && currentStroke) {
            if (currentStroke.points.length === 1) {
                const p = currentStroke.points[0];
                const radius = currentTool === 'pen' ? (currentStroke.width || 3) : ERASER_RADIUS;
                ctx.beginPath();
                if (currentTool === 'pen') {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.fillStyle = currentBrushColor;
                } else {
                    ctx.globalCompositeOperation = 'destination-out';
                }
                ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
            tempDrawingStrokes.push(currentStroke);
            currentStroke = null;
        }
        isDrawing = false;
        ctx.closePath();
    };

    const leave = (e) => {
        end(e);
        // Clear the eraser cursor when mouse leaves canvas
        if (currentTool === 'eraser' || currentTool === 'eraser-stroke') {
            redrawCanvas(tempDrawingStrokes);
        }
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', leave);
    canvas.addEventListener('touchstart', start);
    canvas.addEventListener('touchmove', move);
    canvas.addEventListener('touchend', end);
}

function openDrawingModal() {
    drawingModal.style.display = 'flex';
    const wrapper = drawingModal.querySelector('#canvas-wrapper');
    const initialWidth = wrapper.clientWidth - 40;
    const initialHeight = wrapper.clientHeight - 80; 
    
    // Set basic dimensions
    if (canvas.width !== initialWidth) canvas.width = initialWidth;
    if (canvas.height < initialHeight) canvas.height = initialHeight;

    // Load Existing Strokes
    if (tempDrawingStrokes && tempDrawingStrokes.length > 0) {
        // Find max height needed for existing strokes
        let maxY = 0;
        tempDrawingStrokes.forEach(s => {
            s.points.forEach(p => { if(p.y > maxY) maxY = p.y; });
        });
        if (maxY > canvas.height) canvas.height = maxY + 100;

        redrawCanvas(tempDrawingStrokes);
    } else {
        // Legacy support: if only image exists but no strokes (old save), load image
        if (tempDrawingImage) {
             const img = new Image();
             img.onload = () => {
                 ctx.clearRect(0, 0, canvas.width, canvas.height);
                 ctx.drawImage(img, 0, 0);
                 // Note: We cannot "edit" legacy images vector-style, only draw on top.
                 // So tempDrawingStrokes remains empty/new.
             };
             img.src = tempDrawingImage;
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
}

function updateNotePopupPreview() {
    const previewArea = notePopup.querySelector('.note-preview-area');
    const img = notePopup.querySelector('#note-drawing-preview');
    if (tempDrawingImage) {
        previewArea.style.display = 'block';
        img.src = tempDrawingImage;
    } else {
        previewArea.style.display = 'none';
        img.src = '';
    }
}

function openNotePopup() {
    if (!currentHoveredId) return;
    activeNoteTargetId = currentHoveredId;
    hideElement(actionMenu); 
    const sampleSpan = document.querySelector(`.my-saved-highlight[data-highlight-id="${currentHoveredId}"]`);
    const currentNote = sampleSpan ? (sampleSpan.dataset.note || "") : "";
    const textarea = notePopup.querySelector('textarea');
    textarea.value = currentNote;
    
    // Reset Temps
    tempDrawingImage = null;
    tempDrawingStrokes = [];

    getHighlightData(currentHoveredId).then(data => {
        if (data) {
            if (data.drawing) tempDrawingImage = data.drawing;
            if (data.strokes) tempDrawingStrokes = data.strokes;
        }
        updateNotePopupPreview();
        updateNotePopupButtons(currentNote, tempDrawingImage);
    });
    updateNotePopupButtons(currentNote, null);
    if (sampleSpan) {
        const rect = sampleSpan.getBoundingClientRect();
        showElementAboveRect(notePopup, rect);
    }
    textarea.focus();
}

function updateNotePopupButtons(noteText, drawingData) {
    const cancelDeleteBtn = notePopup.querySelector('#note-cancel-delete-btn');
    if ((noteText && noteText.trim().length > 0) || drawingData) {
        cancelDeleteBtn.textContent = "Delete";
        cancelDeleteBtn.style.backgroundColor = "#d32f2f"; 
    } else {
        cancelDeleteBtn.textContent = "Cancel";
        cancelDeleteBtn.style.backgroundColor = "#f44336";
    }
}

function getHighlightData(id) {
    return new Promise(resolve => {
        const url = window.location.href;
        chrome.storage.local.get([url], (result) => {
            const highlights = result[url] || [];
            const target = highlights.find(h => h.id === id);
            resolve(target);
        });
    });
}

function deleteNote() {
    if (!activeNoteTargetId) return;
    updateNoteDOM(activeNoteTargetId, "", false);
    updateStorageData(activeNoteTargetId, "", null, []);
    hideElement(notePopup);
    activeNoteTargetId = null;
    tempDrawingImage = null;
    tempDrawingStrokes = [];
}

function saveNote() {
    if (!activeNoteTargetId) return;
    const textarea = notePopup.querySelector('textarea');
    const newNote = textarea.value.trim();
    const hasContent = newNote.length > 0 || !!tempDrawingImage;
    updateNoteDOM(activeNoteTargetId, newNote, hasContent);
    updateStorageData(activeNoteTargetId, newNote, tempDrawingImage, tempDrawingStrokes);
    hideElement(notePopup);
    activeNoteTargetId = null;
    tempDrawingImage = null;
    tempDrawingStrokes = [];
}

function updateNoteDOM(id, noteText, hasContent) {
    const spans = document.querySelectorAll(`.my-saved-highlight[data-highlight-id="${id}"]`);
    spans.forEach(span => {
        span.dataset.note = noteText;
        if (hasContent) span.setAttribute('data-has-note', 'true');
        else span.removeAttribute('data-has-note');
    });
}

function setupEventListeners() {
    document.addEventListener('mouseup', (e) => {
        if (!isExtensionValid()) return;
        if (paletteContainer.contains(e.target) || actionMenu.contains(e.target) || notePopup.contains(e.target) || (drawingModal && drawingModal.contains(e.target)) || (lightbox && lightbox.contains(e.target))) return;
        setTimeout(() => {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || selection.toString().trim().length === 0) {
                hideElement(paletteContainer);
                return;
            }
            resetPaletteState();
            try {
                const range = selection.getRangeAt(0);
                showElementAboveRect(paletteContainer, range.getBoundingClientRect());
            } catch (err) { hideElement(paletteContainer); }
        }, 10);
    });
    // Use mousemove to track position and check if we're over a highlight or the menu
    document.addEventListener('mousemove', (e) => {
        if (!isExtensionValid()) return;

        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (!target) return;

        const highlight = target.closest('.my-saved-highlight');
        const onMenu = actionMenu.contains(target) || target === actionMenu;
        const onNote = notePopup.contains(target);

        if (highlight) {
            clearTimeout(actionMenuHideTimeout);
            const groupId = highlight.dataset.highlightId;
            if (currentHoveredId !== groupId || actionMenu.style.display === 'none') {
                currentHoveredId = groupId;
                const hasNoteAttr = highlight.getAttribute('data-has-note') === 'true';
                const noteBtn = actionMenu.querySelector('#btn-note');
                if (hasNoteAttr) noteBtn.classList.add('has-note-active');
                else noteBtn.classList.remove('has-note-active');
                showElementAboveRect(actionMenu, highlight.getBoundingClientRect());
            }
        } else if (onMenu || onNote) {
            clearTimeout(actionMenuHideTimeout);
        } else {
            clearTimeout(actionMenuHideTimeout);
            actionMenuHideTimeout = setTimeout(() => {
                hideElement(actionMenu);
                currentHoveredId = null;
            }, 300);
        }
    });
    document.addEventListener('mousedown', (e) => {
        if (drawingModal && drawingModal.style.display !== 'none' && drawingModal.contains(e.target)) return;
        if (lightbox && lightbox.style.display !== 'none' && lightbox.contains(e.target)) return;
        if (paletteContainer && !paletteContainer.contains(e.target)) hideElement(paletteContainer);
        if (notePopup && !notePopup.contains(e.target) && notePopup.style.display !== 'none') {
            hideElement(notePopup);
            activeNoteTargetId = null;
        }
    });
}

function showElementAboveRect(element, rect) {
    if (!element) return;
    element.style.display = 'flex';
    element.style.visibility = 'hidden';
    const elHeight = element.offsetHeight;
    const elWidth = element.offsetWidth;
    const gap = element === actionMenu ? 4 : 12;
    const top = rect.top + window.scrollY - elHeight - gap;
    const left = rect.left + window.scrollX + (rect.width / 2) - (elWidth / 2);
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
    element.style.visibility = 'visible';
}

function showActionMenuAtMouse(mouseX, mouseY) {
    if (!actionMenu) return;
    actionMenu.style.display = 'flex';
    actionMenu.style.visibility = 'hidden';
    const btnHeight = actionMenu.offsetHeight;
    const btnWidth = actionMenu.offsetWidth;
    let top = mouseY + window.scrollY - btnHeight - 15;
    let left = mouseX + window.scrollX - (btnWidth / 2);
    actionMenu.style.top = `${top}px`;
    actionMenu.style.left = `${left}px`;
    actionMenu.style.visibility = 'visible';
}

function hideElement(element) { if (element) element.style.display = 'none'; }
function resetPaletteState() { confirmBtn.style.display = 'none'; customColorTrigger.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)'; tempSelectedColor = null; }
function updateLastCustomButton() { if (savedCustomColor && lastCustomBtn) { lastCustomBtn.style.backgroundColor = savedCustomColor; lastCustomBtn.style.display = 'block'; } }
function saveCustomColorSetting(color) { savedCustomColor = color; updateLastCustomButton(); chrome.storage.local.set({ user_settings: { lastCustomColor: color } }); }

init();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "CLEAR_PAGE" || request.action === "CLEAR_ALL") {
        // ۱. حذف تمام اسپن‌های هایلایت از DOM
        const highlights = document.querySelectorAll('.my-saved-highlight');
        highlights.forEach(span => {
            const parent = span.parentNode;
            // برگرداندن متن به حالت عادی (Unwrap)
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
            parent.normalize(); // چسباندن مجدد نودهای متنی
        });

        // ۲. ریست کردن متغیرهای داخلی
        currentHoveredId = null;
        activeNoteTargetId = null;
        console.log("Highlights cleared via popup.");
    }
});