let globalSitesData = [];

document.addEventListener('DOMContentLoaded', () => {
    // Event Listeners for controls
    document.getElementById('search-input').addEventListener('input', renderHighlights);
    document.getElementById('color-filter').addEventListener('change', renderHighlights);
    document.getElementById('domain-filter').addEventListener('change', renderHighlights);
    
    document.getElementById('btn-clear-all').addEventListener('click', () => {
        if (confirm("Are you sure you want to delete ALL highlights from ALL websites? This cannot be undone.")) {
            chrome.storage.local.clear(() => {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "CLEAR_ALL" });
                });
                loadDataFromStorage();
            });
        }
    });

    loadDataFromStorage();
});

function loadDataFromStorage() {
    chrome.storage.local.get(null, (items) => {
        const keys = Object.keys(items);
        const contentKeys = keys.filter(key => key !== 'user_settings');

        globalSitesData = [];
        const uniqueDomains = new Set(); // To track hostnames for the dropdown

        contentKeys.forEach(url => {
            let highlights = items[url];
            if (!Array.isArray(highlights) || highlights.length === 0) return;

            // Extract Hostname
            try {
                const urlObj = new URL(url);
                uniqueDomains.add(urlObj.hostname);
            } catch(e) {
                uniqueDomains.add(url); // fallback if URL is weird
            }

            highlights.sort((a, b) => {
                const timeA = parseInt((a.id || "").substring(0, 13)) || 0;
                const timeB = parseInt((b.id || "").substring(0, 13)) || 0;
                return timeB - timeA; 
            });

            const newestHighlightTime = parseInt((highlights[0].id || "").substring(0, 13)) || 0;
            globalSitesData.push({ url, highlights, newestHighlightTime });
        });

        globalSitesData.sort((a, b) => b.newestHighlightTime - a.newestHighlightTime);
        
        populateDomainDropdown(uniqueDomains);
        renderHighlights();
    });
}

function populateDomainDropdown(domainsSet) {
    const dropdown = document.getElementById('domain-filter');
    // Keep "All Websites", clear the rest
    dropdown.innerHTML = '<option value="all">All Websites</option>';
    
    const sortedDomains = Array.from(domainsSet).sort();
    sortedDomains.forEach(domain => {
        const opt = document.createElement('option');
        opt.value = domain;
        opt.textContent = domain;
        dropdown.appendChild(opt);
    });
}

function renderHighlights() {
    const container = document.getElementById('container');
    container.innerHTML = ''; 

    const searchQuery = document.getElementById('search-input').value.toLowerCase();
    const colorFilter = document.getElementById('color-filter').value;
    const domainFilter = document.getElementById('domain-filter').value;

    let filteredSitesData = globalSitesData.filter(site => {
        // 1. Filter by Domain FIRST
        if (domainFilter === 'all') return true;
        try {
            return new URL(site.url).hostname === domainFilter;
        } catch(e) {
            return site.url === domainFilter;
        }
    }).map(site => {
        // 2. Filter highlights by Text and Color
        let filteredHighlights = site.highlights.filter(h => {
            let textMatches = (h.text || '').toLowerCase().includes(searchQuery) ||
                              (h.note || '').toLowerCase().includes(searchQuery);
            
            let itemColor = h.color || '#ffeb3b';
            let colorMatches = colorFilter === 'all' || itemColor.toLowerCase() === colorFilter.toLowerCase();

            return textMatches && colorMatches;
        });
        
        return { ...site, highlights: filteredHighlights };
    }).filter(site => site.highlights.length > 0); 

    if (filteredSitesData.length === 0) {
        if (globalSitesData.length === 0) {
            container.innerHTML = '<div class="no-data">No highlights found yet.<br>Go highlight some text!</div>';
        } else {
            container.innerHTML = '<div class="no-data">No results match your search or filters.</div>';
        }
        return;
    }

    filteredSitesData.forEach(site => {
        const { url, highlights } = site;
        const card = document.createElement('div');
        card.className = 'site-card';
        const headerDiv = document.createElement('div');
        headerDiv.className = 'site-header';

        const link = document.createElement('a');
        link.href = url;
        link.className = 'site-url';
        // Clean SVG Link Icon instead of emoji
        link.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"></path></svg>`;
        const urlSpan = document.createElement('span');
        urlSpan.style.marginLeft = '5px';
        urlSpan.textContent = url;
        link.appendChild(urlSpan);
        link.target = "_blank";
        headerDiv.appendChild(link);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'site-actions';

        const btnWord = document.createElement('button');
        btnWord.className = 'btn-action btn-word';
        btnWord.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="white"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/></svg> Word';
        btnWord.onclick = () => exportPageToWord(highlights, url);

        const btnPdf = document.createElement('button');
        btnPdf.className = 'btn-action btn-pdf';
        btnPdf.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> PDF';
        btnPdf.onclick = () => printPageForPDF(highlights, url);

        const btnDeleteSite = document.createElement('button');
        btnDeleteSite.className = 'btn-action btn-delete-site';
        btnDeleteSite.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Delete';
        btnDeleteSite.onclick = () => deleteSite(url);

        actionsDiv.appendChild(btnWord);
        actionsDiv.appendChild(btnPdf);
        actionsDiv.appendChild(btnDeleteSite);
        headerDiv.appendChild(actionsDiv);
        card.appendChild(headerDiv);

        highlights.forEach(h => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'highlight-item';
            
            const baseColor = h.color || '#ffeb3b';
            itemDiv.style.borderLeftColor = baseColor;
            itemDiv.style.backgroundColor = adjustColor(baseColor);

            const btnDelItem = document.createElement('button');
            btnDelItem.className = 'btn-delete-item';
            btnDelItem.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M6 18L18 6M6 6l12 12"></path></svg>';
            btnDelItem.title = "Delete highlight";
            btnDelItem.onclick = () => deleteHighlight(url, h.id);
            itemDiv.appendChild(btnDelItem);

            if (h.text) {
                const textP = document.createElement('p');
                textP.className = 'highlight-text';
                textP.textContent = h.text;
                itemDiv.appendChild(textP);
            }
            if (h.note) {
                const noteDiv = document.createElement('div');
                noteDiv.className = 'highlight-note';
                const noteLabel = document.createElement('strong');
                noteLabel.textContent = 'Note:';
                noteDiv.appendChild(noteLabel);
                noteDiv.appendChild(document.createTextNode(' ' + h.note));
                itemDiv.appendChild(noteDiv);
            }
            if (h.drawing) {
                const img = document.createElement('img');
                img.src = h.drawing;
                img.className = 'highlight-drawing';
                itemDiv.appendChild(img);
            }
            card.appendChild(itemDiv);
        });

        container.appendChild(card);
    });
}

function deleteSite(url) {
    if (confirm("Delete all highlights saved from this webpage?")) {
        chrome.storage.local.remove(url, loadDataFromStorage);
    }
}

function deleteHighlight(url, highlightId) {
    chrome.storage.local.get([url], (result) => {
        let highlights = result[url] || [];
        highlights = highlights.filter(h => h.id !== highlightId);
        if (highlights.length === 0) {
            chrome.storage.local.remove(url, loadDataFromStorage);
        } else {
            chrome.storage.local.set({ [url]: highlights }, loadDataFromStorage);
        }
    });
}

function exportPageToWord(highlights, url) {
    let boundary = "----=_NextPart_Boundary_" + Date.now();
    let mhtml = `MIME-Version: 1.0\nContent-Type: multipart/related; boundary="${boundary}"\n\n`;
    mhtml += `--${boundary}\nContent-Type: text/html; charset="utf-8"\nContent-Transfer-Encoding: 8bit\n\n`;
    mhtml += `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>\n`;
    mhtml += `<head><meta charset='utf-8'><title>Highlights</title></head>\n<body>\n`;
    mhtml += `<h2 style="color:#2b579a; font-family:sans-serif;">Highlights Report</h2>\n`;
    mhtml += `<p style="font-family:sans-serif; color:#666;"><strong>Source:</strong> <a href="${url}">${url}</a></p>\n`;
    mhtml += `<p style="font-family:sans-serif; color:#666;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>\n<hr/>\n`;

    let imageParts = "";
    let imageIndex = 0;

    highlights.forEach((h) => {
        mhtml += `<div style="margin-bottom: 20px; font-family:sans-serif;">\n`;
        mhtml += `<p style="background-color:${h.color || '#ffeb3b'}; padding:8px; border-radius:4px; font-size:14px;">${escapeHtml(h.text || '')}</p>\n`;

        if (h.note) {
            mhtml += `<div style="margin-left:20px; padding:10px; border:1px solid #ddd; background:#f9f9f9; border-radius:4px;">\n`;
            mhtml += `<strong>Note:</strong><br/>${escapeHtml(h.note).replace(/\n/g, '<br>')}\n</div>\n`;
        }

        if (h.drawing) {
            imageIndex++;
            let imageCid = `img_cid_${imageIndex}`;
            mhtml += `<div style="margin-left:20px; margin-top:10px;">\n`;
            mhtml += `<img src="cid:${imageCid}" style="max-width:400px; border:1px solid #ccc;">\n</div>\n`;

            let parts = h.drawing.split(',');
            let mimeType = parts[0].match(/:(.*?);/)[1];
            let base64Data = parts[1];

            imageParts += `--${boundary}\nContent-Type: ${mimeType}\nContent-Transfer-Encoding: base64\nContent-ID: <${imageCid}>\n\n`;
            let formattedBase64 = base64Data.replace(/(.{76})/g, "$1\n");
            imageParts += `${formattedBase64}\n\n`;
        }
        mhtml += `</div><hr style="border:0; border-top:1px dashed #ccc; margin: 20px 0;"/>\n`;
    });

    mhtml += `</body>\n</html>\n\n` + imageParts + `--${boundary}--\n`;

    const blob = new Blob([mhtml], { type: 'application/msword' });
    const downloadUrl = URL.createObjectURL(blob);
    const fileDownload = document.createElement("a");
    fileDownload.href = downloadUrl;
    fileDownload.download = 'highlights_report.doc';
    fileDownload.click();
    URL.revokeObjectURL(downloadUrl);
}

function printPageForPDF(highlights, url) {
    let oldFrame = document.getElementById('pdf-hidden-frame');
    if (oldFrame) oldFrame.remove();

    const iframe = document.createElement('iframe');
    iframe.id = 'pdf-hidden-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    let contentHtml = `
        <html>
        <head>
            <title>Highlights Report</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #333; }
                h1 { color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
                .meta { color: #6b7280; font-size: 14px; margin-bottom: 30px; }
                .item { margin-bottom: 30px; break-inside: avoid; }
                .text { 
                    font-size: 16px; 
                    line-height: 1.6; 
                    padding: 10px 15px; 
                    border-radius: 6px; 
                    margin-bottom: 10px;
                    border: 1px solid rgba(0,0,0,0.05);
                }
                .note { 
                    margin-left: 20px; 
                    padding: 12px; 
                    background: #f3f4f6; 
                    border-left: 4px solid #6b7280; 
                    font-size: 14px;
                    border-radius: 0 4px 4px 0;
                }
                .drawing { margin-left: 20px; margin-top: 10px; }
                img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; }
            </style>
        </head>
        <body>
            <h1>Highlights Report</h1>
            <div class="meta">
                <strong>Source:</strong> ${url}<br>
                <strong>Date:</strong> ${new Date().toLocaleDateString()}
            </div>
    `;

    highlights.forEach(h => {
        contentHtml += `
            <div class="item">
                <div class="text" style="background-color:${h.color || '#ffeb3b'}">
                    ${escapeHtml(h.text || '')}
                </div>
        `;
        if (h.note) {
            contentHtml += `<div class="note"><strong>Note:</strong><br>${escapeHtml(h.note).replace(/\n/g, '<br>')}</div>`;
        }
        if (h.drawing) {
            contentHtml += `<div class="drawing"><img src="${h.drawing}"></div>`;
        }
        contentHtml += `</div>`; 
    });

    contentHtml += `</body></html>`;

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(contentHtml);
    doc.close();

    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 500);
}

function adjustColor(color) {
    if (color.startsWith('#') && color.length === 7) return color + '20';
    return '#fffbeb';
}

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}