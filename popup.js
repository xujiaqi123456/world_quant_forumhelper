document.addEventListener('DOMContentLoaded', function() {
    
    // --- 新增：关闭按钮逻辑 ---
    const closeBtn = document.getElementById('closeWindowBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.close(); // 关闭当前窗口
        });
    }

    // --- 1. 获取页面元素 ---
    const startBtn = document.getElementById('startBtn');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const toggleConfig = document.getElementById('toggleConfig');
    const configBody = document.getElementById('configBody');
    const statusDiv = document.getElementById('status');
    const arrow = document.getElementById('arrow');

    // 简易加密/解密 (Base64)
    const encrypt = (text) => { try { return btoa(text); } catch (e) { return text; } };
    const decrypt = (text) => { try { return atob(text); } catch (e) { return text; } };

    // --- 2. 绑定 UI 点击事件 ---
    
    // 折叠/展开配置面板
    if (toggleConfig && configBody) {
        toggleConfig.addEventListener('click', () => {
            const isHidden = configBody.style.display === 'none' || configBody.style.display === '';
            configBody.style.display = isHidden ? 'block' : 'none';
            if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
        });
    }

    // --- 3. 权限检查与初始化 ---
    if (!chrome.storage || !chrome.storage.local) {
        statusDiv.innerText = "❌ 严重错误：无法访问存储权限！\n请检查 manifest.json 是否添加了 'storage'，并重新加载插件。";
        // 即使没有权限，我们也不 return，让界面至少能动，但在保存时拦截
    } else {
        // 自动回显：打开插件时读取已保存的配置
        chrome.storage.local.get(['aiApiUrl', 'aiApiKey', 'aiModel', 'aiPrompt'], (result) => {
            if (chrome.runtime.lastError) return;
            if (result.aiApiUrl) document.getElementById('aiApiUrl').value = result.aiApiUrl;
            if (result.aiApiKey) document.getElementById('aiApiKey').value = decrypt(result.aiApiKey);
            if (result.aiModel) document.getElementById('aiModel').value = result.aiModel;
            if (result.aiPrompt) document.getElementById('aiPrompt').value = result.aiPrompt;
        });
    }

    // --- 4. 保存配置按钮逻辑 ---
    if (saveConfigBtn) {
        saveConfigBtn.addEventListener('click', () => {
            if (!chrome.storage || !chrome.storage.local) {
                alert("无法保存：缺少 storage 权限。请在 manifest.json 中添加权限并刷新插件。");
                return;
            }

            const config = {
                aiApiUrl: document.getElementById('aiApiUrl').value.trim(),
                aiApiKey: encrypt(document.getElementById('aiApiKey').value.trim()),
                aiModel: document.getElementById('aiModel').value.trim(),
                aiPrompt: document.getElementById('aiPrompt').value
            };

            chrome.storage.local.set(config, () => {
                if (chrome.runtime.lastError) {
                    statusDiv.innerText = "❌ 保存失败: " + chrome.runtime.lastError.message;
                } else {
                    const originalText = saveConfigBtn.innerText;
                    saveConfigBtn.innerText = "✅ 已保存!";
                    saveConfigBtn.style.backgroundColor = "#28a745"; 
                    setTimeout(() => {
                        saveConfigBtn.innerText = originalText;
                        saveConfigBtn.style.backgroundColor = ""; 
                    }, 1500);
                }
            });
        });
    }

    // --- 5. 开始运行逻辑 ---
    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            const inputUrl = document.getElementById('urlInput').value.trim();
            const modeInput = document.querySelector('input[name="mode"]:checked');
            const mode = modeInput ? modeInput.value : 'json';

            if (!inputUrl) { statusDiv.textContent = "请输入有效的 URL"; return; }

            // URL 基础处理
            let baseUrl;
            try {
                const urlObj = new URL(inputUrl);
                baseUrl = `${urlObj.origin}${urlObj.pathname}`;
            } catch (e) {
                statusDiv.textContent = "URL 格式错误"; return;
            }

            // 步骤A: 程序
            statusDiv.textContent = "正在初始化程序...";
            let scrapedData = null;
            try {
                scrapedData = await runScraper(baseUrl, (msg) => statusDiv.textContent = msg);
            } catch (err) {
                console.error(err);
                statusDiv.textContent = "摘取中断: " + err.message;
                return;
            }

            if (!scrapedData) return;

            // 步骤B: 处理结果
            if (mode === 'json') {
                statusDiv.textContent = `摘取完成，正在导出 JSON...`;
                downloadFile(JSON.stringify(scrapedData, null, 2), 'wq_data.json', 'application/json');
            } else if (mode === 'ai') {
                statusDiv.textContent = `摘取完成，正在连接 AI 分析...`;
                await runAnalysis(scrapedData, statusDiv, decrypt);
            }
        });
    }
});

// --- 核心功能函数 ---

async function runScraper(baseUrl, updateStatus) {
    let currentPage = 1;
    let hasMore = true;
    let allComments = [];
    let postContent = null;
    const stopText = "成为第一个写评论的人";
    const maxPages = 50; 

    while (hasMore) {
        updateStatus(`正在摘取第 ${currentPage} 页... (已收集 ${allComments.length} 条评论)`);
        
        try {
            const fetchUrl = `${baseUrl}?page=${currentPage}`;
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error("HTTP " + response.status);
            
            const htmlText = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, "text/html");

            if (!postContent) {
                const contentEl = doc.querySelector('.post-content');
                if (contentEl) postContent = contentEl.innerText.trim();
            }

            // 检查停止标志
            const callouts = doc.querySelectorAll('.comment-callout');
            let foundStop = false;
            callouts.forEach(el => {
                if (el.innerText.includes(stopText)) foundStop = true;
            });

            if (foundStop) { hasMore = false; break; }

            // 提取评论
            const commentsEl = doc.querySelectorAll('.comment');
            if (commentsEl.length === 0) {
                if(currentPage > 1) hasMore = false;
            } else {
                commentsEl.forEach(c => {
                    const author = c.querySelector('.comment-author')?.innerText.trim() || "Unknown";
                    const body = c.querySelector('.comment-body')?.innerText.trim() || "";
                    const time = c.querySelector('.comment-meta time')?.getAttribute('datetime') || "";
                    allComments.push({ author, time, body });
                });
            }

            currentPage++;
            if (currentPage > maxPages) break;
            
            await new Promise(r => setTimeout(r, 500)); 

        } catch(e) {
            console.error("Page load error:", e);
            hasMore = false; 
        }
    }

    return {
        url: baseUrl,
        post_title_content: postContent,
        comments: allComments
    };
}

async function runAnalysis(data, statusDiv, decryptFn) {
    // 检查配置
    if (!chrome.storage || !chrome.storage.local) {
        statusDiv.textContent = "错误: 缺少存储权限，无法读取 API 配置。";
        return;
    }

    const config = await new Promise(resolve => {
        chrome.storage.local.get(['aiApiUrl', 'aiApiKey', 'aiModel', 'aiPrompt'], resolve);
    });
    
    // 简单的校验
    if (!config.aiApiUrl || !config.aiApiKey) {
        statusDiv.textContent = "错误: 请先点击配置面板，填写 API 信息并保存。";
        return;
    }
    
    // 自动补全 URL (针对小白用户的优化)
    let apiUrl = config.aiApiUrl.trim();
    // 如果用户填的是 OpenAI 官方或类似的域名且没有带具体路径，尝试提示或根据情况判断
    // 但最稳妥的是在报错时提示。

    const apiKey = decryptFn(config.aiApiKey);
    const model = config.aiModel || "gpt-3.5-turbo";
    const prompt = config.aiPrompt || "请总结";

    // 构建 Prompt
    let contentString = `主要内容:\n${data.post_title_content}\n\n用户评论:\n`;
    data.comments.forEach((c, index) => {
        contentString += `${index+1}. [${c.author}]: ${c.body}\n`;
    });

    // 截断保护
    const maxLength = 25000; 
    if (contentString.length > maxLength) {
        contentString = contentString.substring(0, maxLength) + "\n... (内容过长已自动截断)";
    }

    statusDiv.textContent = "正在等待 AI 响应 (可能需要 15-30 秒)...";

    try {
        const payload = {
            model: model,
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: contentString }
            ],
            temperature: 0.7
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            
            // --- 针对 404 做详细提示 ---
            if (response.status === 404) {
                 throw new Error("404 路径错误：API 地址填写不完整！\n请检查地址结尾是否包含 '/v1/chat/completions'");
            }
            if (response.status === 401) {
                 throw new Error("401 认证失败：API Key 无效或过期");
            }

            throw new Error(`API 请求失败: ${response.status} - ${errText.substring(0, 100)}`);
        }

        const resJson = await response.json();
        // 兼容 OpenAI 响应
        const analysisResult = resJson.choices?.[0]?.message?.content || JSON.stringify(resJson);

        statusDiv.textContent = "分析成功！正在下载报告...";
        
        const fileContent = `# WQ 论坛智能分析报告\n\n**数据源**: ${data.url}\n**时间**: ${new Date().toLocaleString()}\n\n---\n\n${analysisResult}`;
        downloadFile(fileContent, 'WQ_Analysis_Report.md', 'text/markdown; charset=utf-8');

    } catch (e) {
        console.error(e);
        statusDiv.innerText = "⚠️ " + e.message; // 使用 innerText 支持换行显示
    }
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob(["\uFEFF" + content], {type : mimeType});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}