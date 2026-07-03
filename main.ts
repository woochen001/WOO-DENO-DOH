// main.ts

// 默认上游服务器列表
const DEFAULT_UPSTREAMS = [
  "https://1.1.1.1/dns-query",
  "https://dns.google/dns-query",
  "https://dns.quad9.net/dns-query"
];

// 默认 DNS 查询路径
const DEFAULT_PATH = "/dns-query";

// 初始化 Deno KV 数据库（用于持久化保存用户配置）
const kv = await Deno.openKv();

// 本地内存配置缓存，用于优化并发解析时的性能
let cachedUpstreams = DEFAULT_UPSTREAMS;
let cachedPath = DEFAULT_PATH;

// 从 KV 初始化加载配置到内存缓存
try {
  const upstreamsEntry = await kv.get<string[]>(["upstreams"]);
  if (upstreamsEntry.value) {
    cachedUpstreams = upstreamsEntry.value;
  }
  const pathEntry = await kv.get<string>(["query_path"]);
  if (pathEntry.value) {
    cachedPath = pathEntry.value;
  }
} catch (_err) {
  // 忽略初始化异常，使用默认值
}

const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Deno DNS & DoH 配置面板</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; background-color: #f8fafc; color: #1e293b; }
        h1 { text-align: center; color: #0f172a; margin-bottom: 5px; }
        .subtitle { text-align: center; color: #64748b; margin-bottom: 30px; font-size: 14px; }
        .card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); margin-bottom: 20px; border: 1px solid #e2e8f0; }
        .card h3 { margin-top: 0; color: #334155; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 13px; color: #475569; }
        input, select, button { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-size: 15px; }
        button { background-color: #2563eb; color: white; border: none; cursor: pointer; font-weight: 600; transition: background 0.2s; }
        button:hover { background-color: #1d4ed8; }
        .code-block { background: #f8fafc; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px; border: 1px solid #e2e8f0; word-break: break-all; color: #0f172a; }
        
        /* 配置列表样式 */
        .upstream-item { display: flex; gap: 10px; margin-bottom: 8px; }
        .btn-danger { background-color: #ef4444; width: auto; padding: 10px 15px; }
        .btn-danger:hover { background-color: #dc2626; }
        .btn-secondary { background-color: #64748b; margin-top: 10px; }
        .btn-secondary:hover { background-color: #475569; }

        .flex-container { display: flex; gap: 15px; }
        .flex-child { flex: 1; }
        .badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
        .badge-success { background: #dcfce7; color: #15803d; }
        .badge-fail { background: #fee2e2; color: #b91c1c; }
        pre { background: #0f172a; color: #f8fafc; padding: 15px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 13px; margin-top: 10px; }
    </style>
</head>
<body>
    <h1>Deno DNS & DoH 助手</h1>
    <div class="subtitle">支持多上游并发竞速解析</div>
    
    <!-- 1. 服务信息 -->
    <div class="card">
        <h3>1. 你的专属 DoH 地址</h3>
        <div class="code-block" id="doh-url">加载中...</div>
    </div>

    <!-- 2. DNS 配置面板 -->
    <div class="card">
        <h3>2. 配置 DNS 服务参数</h3>
        
        <div class="form-group">
            <label for="custom-path">自定义 DNS 查询路径 (以 / 开头)</label>
            <input type="text" id="custom-path" placeholder="例如 /dns-query 或 /my-private-dns">
        </div>

        <label style="margin-top: 20px;">配置上游 DNS 服务器</label>
        <p style="font-size: 13px; color: #64748b; margin-top: -5px;">当有解析请求时，Deno 会同时向以下所有服务器发起请求，采用最快返回的结果：</p>
        
        <div id="upstream-list">
            <!-- 动态生成列表 -->
        </div>
        
        <button class="btn-secondary" onclick="addUpstreamInput('')">+ 添加新上游</button>
        <button style="margin-top: 15px; background-color: #10b981;" onclick="saveConfig()">保存配置面板</button>
    </div>

    <!-- 3. 联通性测试面板 -->
    <div class="card">
        <h3>3. 联通性测试面板</h3>
        <div class="flex-container">
            <div class="flex-child form-group">
                <label for="test-domain">测试域名（支持直接粘贴 URL）</label>
                <input type="text" id="test-domain" value="supabase.com" placeholder="输入域名，例如 google.com">
            </div>
            <div class="flex-child form-group">
                <label for="test-type">记录类型</label>
                <select id="test-type">
                    <option value="1">A (IPv4)</option>
                    <option value="28">AAAA (IPv6)</option>
                </select>
            </div>
        </div>
        <button onclick="testDoH()">执行 DoH 协议测试</button>
        
        <div id="test-result-area" style="display: none; margin-top: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: bold; font-size: 14px;">测试状态：</span>
                <span id="test-status"></span>
            </div>
            <pre id="test-output">等待测试...</pre>
        </div>
    </div>

    <script>
        // 获取并展示已保存的配置
        async function loadConfig() {
            const res = await fetch('/api/config');
            const data = await res.json();
            
            const currentPath = data.path || '/dns-query';
            document.getElementById('custom-path').value = currentPath;
            document.getElementById('doh-url').textContent = window.location.origin + currentPath;

            const listContainer = document.getElementById('upstream-list');
            listContainer.innerHTML = '';
            
            if (data.upstreams && data.upstreams.length > 0) {
                data.upstreams.forEach(url => addUpstreamInput(url));
            } else {
                addUpstreamInput('');
            }
        }

        function addUpstreamInput(value) {
            const container = document.getElementById('upstream-list');
            const div = document.createElement('div');
            div.className = 'upstream-item';
            div.innerHTML = \`
                <input type="text" class="upstream-url" value="\${value}" placeholder="输入标准 DoH 地址，例如 https://1.1.1.1/dns-query">
                <button class="btn-danger" onclick="this.parentElement.remove()">删除</button>
            \`;
            container.appendChild(div);
        }

        async function saveConfig() {
            const pathValue = document.getElementById('custom-path').value.trim();
            const inputs = document.querySelectorAll('.upstream-url');
            const upstreams = Array.from(inputs).map(i => i.value.trim()).filter(v => v !== '');

            if (!pathValue.startsWith('/')) {
                alert("DNS 查询路径必须以 '/' 开头！");
                return;
            }

            if (pathValue === '/' || pathValue === '/api' || pathValue.startsWith('/api/')) {
                alert("路径冲突！不能将查询路径设置为根目录或 /api。");
                return;
            }

            if (upstreams.length === 0) {
                alert("至少需要保留一个上游服务器！");
                return;
            }

            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ upstreams, path: pathValue })
            });

            if (res.ok) {
                alert("配置已成功保存！");
                loadConfig();
            } else {
                alert("保存失败");
            }
        }

        // 提取输入中的纯域名（过滤 http://, path, port 等）
        function cleanDomainInput(input) {
            let clean = input.trim();
            if (clean.includes("://")) {
                try {
                    clean = new URL(clean).hostname;
                } catch {
                    clean = clean.split("://")[1];
                }
            }
            clean = clean.split('/')[0];
            clean = clean.split('?')[0];
            clean = clean.split(':')[0]; 
            return clean;
        }

        // DNS-over-HTTPS 二进制包构造与解析
        function buildDnsQuery(domain, qtype) {
            const domainParts = domain.split('.');
            let length = 12;
            for (const part of domainParts) length += 1 + part.length;
            length += 5;

            const buffer = new Uint8Array(length);
            const view = new DataView(buffer.buffer);

            view.setUint16(0, 0x1234); 
            view.setUint16(2, 0x0100); 
            view.setUint16(4, 1);      

            let offset = 12;
            for (const part of domainParts) {
                buffer[offset++] = part.length;
                for (let i = 0; i < part.length; i++) buffer[offset++] = part.charCodeAt(i);
            }
            buffer[offset++] = 0; 
            view.setUint16(offset, qtype);     
            view.setUint16(offset + 2, 1);    
            return buffer;
        }

        function parseDnsResponse(buffer, qtype) {
            const view = new DataView(buffer.buffer);
            const flags = view.getUint16(2);
            const qdcount = view.getUint16(4);
            const ancount = view.getUint16(6);
            if ((flags & 0x000F) !== 0) return "DNS解析失败 (RCODE = " + (flags & 0x000F) + ")";
            if (ancount === 0) return "无记录";

            let offset = 12;
            for (let i = 0; i < qdcount; i++) {
                while (buffer[offset] !== 0) {
                    if ((buffer[offset] & 0xC0) === 0xC0) { offset += 2; break; }
                    else offset += 1 + buffer[offset];
                }
                if (buffer[offset] === 0) offset++;
                offset += 4;
            }

            const ips = [];
            for (let i = 0; i < ancount; i++) {
                if ((buffer[offset] & 0xC0) === 0xC0) offset += 2;
                else {
                    while (buffer[offset] !== 0) offset += 1 + buffer[offset];
                    offset++;
                }
                const type = view.getUint16(offset);
                const rdlength = view.getUint16(offset + 8);
                offset += 10;

                if (type === 1 && rdlength === 4) {
                    ips.push(Array.from(buffer.subarray(offset, offset + 4)).join('.'));
                } else if (type === 28 && rdlength === 16) {
                    const hex = [];
                    for (let j = 0; j < 16; j += 2) hex.push(view.getUint16(offset + j).toString(16));
                    ips.push(hex.join(':'));
                }
                offset += rdlength;
            }
            return ips.length > 0 ? ips.join('\\n') : "未提取到直接IP";
        }

        async function testDoH() {
            const rawInput = document.getElementById('test-domain').value;
            const domain = cleanDomainInput(rawInput);
            
            if (!domain) {
                alert("请输入有效的域名！");
                return;
            }

            const qtype = parseInt(document.getElementById('test-type').value);
            const resultArea = document.getElementById('test-result-area');
            const statusBadge = document.getElementById('test-status');
            const outputEl = document.getElementById('test-output');

            resultArea.style.display = 'block';
            statusBadge.className = 'badge';
            statusBadge.textContent = '测试中...';

            // 动态读取当前配置路径
            const customPath = document.getElementById('custom-path').value.trim();

            const queryPacket = buildDnsQuery(domain, qtype);
            try {
                const response = await fetch(customPath, {
                    method: 'POST',
                    headers: { 'content-type': 'application/dns-message' },
                    body: queryPacket
                });

                if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
                const resBuffer = new Uint8Array(await response.arrayBuffer());
                const parsed = parseDnsResponse(resBuffer, qtype);
                
                if (parsed.startsWith("DNS解析失败")) {
                    statusBadge.className = 'badge badge-fail';
                    statusBadge.textContent = '异常';
                } else {
                    statusBadge.className = 'badge badge-success';
                    statusBadge.textContent = '正常';
                }
                outputEl.textContent = "解析域名: " + domain + "\\n\\n结果:\\n" + parsed;
            } catch (err) {
                statusBadge.className = 'badge badge-fail';
                statusBadge.textContent = '异常';
                outputEl.textContent = err.message;
            }
        }

        // 初始化加载配置
        loadConfig();
    </script>
</body>
</html>
`;

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 1. 获取当前的所有配置项
  if (url.pathname === "/api/config" && req.method === "GET") {
    return new Response(JSON.stringify({
      upstreams: cachedUpstreams,
      path: cachedPath
    }), {
      headers: { "content-type": "application/json" },
    });
  }

  // 2. 保存新的配置项（包含上游服务器与自定义路径）
  if (url.pathname === "/api/config" && req.method === "POST") {
    try {
      const { upstreams, path } = await req.json();
      if (
        Array.isArray(upstreams) && 
        upstreams.length > 0 && 
        typeof path === "string" && 
        path.startsWith("/") &&
        path !== "/" &&
        !path.startsWith("/api")
      ) {
        // 保存到持久化 KV 数据库
        await kv.set(["upstreams"], upstreams);
        await kv.set(["query_path"], path);

        // 同步更新内存缓存以保证快速响应
        cachedUpstreams = upstreams;
        cachedPath = path;

        return new Response(JSON.stringify({ success: true }), {
          headers: { "content-type": "application/json" },
        });
      }
    } catch (_err) { /* ignore */ }
    return new Response("Invalid config", { status: 400 });
  }

  // 3. 匹配自定义的 DNS 查询路径
  if (url.pathname.startsWith(cachedPath)) {
    let bodyBuffer: ArrayBuffer | null = null;
    if (req.method === "POST") {
      bodyBuffer = await req.arrayBuffer();
    }

    // 过滤并保留客户端发来的关键头部信息
    const clientHeaders = new Headers();
    const contentType = req.headers.get("content-type");
    const accept = req.headers.get("accept");
    
    if (contentType) clientHeaders.set("content-type", contentType);
    if (accept) clientHeaders.set("accept", accept);

    // 将请求分发给所有配置的上游，使用 Promise.any 获取最快返回的结果
    const fetchPromises = cachedUpstreams.map(async (upstreamUrl) => {
      const targetUrl = new URL(upstreamUrl);
      
      // 合并客户端请求中携带的查询参数
      for (const [key, value] of url.searchParams) {
        targetUrl.searchParams.set(key, value);
      }

      const requestOptions: RequestInit = {
        method: req.method,
        headers: clientHeaders,
        redirect: "follow",
      };

      // 只有 POST 请求时才附加 body
      if (req.method === "POST" && bodyBuffer) {
        requestOptions.body = bodyBuffer;
      }

      const response = await fetch(targetUrl.toString(), requestOptions);

      if (!response.ok) {
        throw new Error(`Upstream ${targetUrl.host} returned error status: ${response.status}`);
      }
      return response;
    });

    try {
      const fastestResponse = await Promise.any(fetchPromises);
      
      return new Response(fastestResponse.body, {
        status: fastestResponse.status,
        headers: {
          "content-type": fastestResponse.headers.get("content-type") || "application/dns-message",
          "cache-control": fastestResponse.headers.get("cache-control") || "max-age=30",
        },
      });
    } catch (_err) {
      return new Response("All upstreams failed", { status: 502 });
    }
  }

  // 4. 默认返回配置面板网页
  return new Response(htmlContent, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});
