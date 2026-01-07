chrome.action.onClicked.addListener(() => {
    // 创建一个独立的窗口
    chrome.windows.create({
        url: "popup.html",
        type: "popup", // 这种类型没有地址栏，看起来像个工具窗口
        width: 380,    // 稍微宽一点
        height: 650    // 高一点，方便看日志
    });
});