document.addEventListener('DOMContentLoaded', () => {
    
    // 1. باز کردن صفحه لیست هایلایت‌ها
    document.getElementById('btn-list').addEventListener('click', () => {
        chrome.tabs.create({ url: 'highlights.html' });
    });

    // 2. پاک کردن هایلایت‌های سایت فعلی
    document.getElementById('btn-clear-site').addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;

        // حذف از حافظه (Storage)
        // نکته: کلید ذخیره‌سازی، آدرس URL صفحه است.
        const url = tab.url;
        
        // چون URL ممکن است کمی فرق داشته باشد (مثلا #hash)، بهتر است از کانتنت اسکریپت بخواهیم URL دقیق را بدهد
        // اما برای سادگی اینجا فرض می‌کنیم tab.url همان کلید است یا از پترن مچینگ استفاده می‌کنیم.
        
        chrome.storage.local.remove(url, () => {
            // ارسال پیام به صفحه برای حذف بصری هایلایت‌ها
            chrome.tabs.sendMessage(tab.id, { action: "CLEAR_PAGE" });
            window.close();
        });
    });

    // 3. پاک کردن تمام اطلاعات (Reset Factory)
    document.getElementById('btn-clear-all').addEventListener('click', () => {
        if (confirm("Are you sure you want to delete ALL highlights from ALL websites? This cannot be undone.")) {
            chrome.storage.local.clear(() => {
                // ارسال پیام به تب فعال برای پاکسازی لحظه‌ای
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, { action: "CLEAR_ALL" });
                    }
                });
                alert("All data cleared.");
                window.close();
            });
        }
    });
});