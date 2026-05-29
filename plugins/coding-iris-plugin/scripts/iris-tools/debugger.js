// 自动化测试脚本 - Node.js 版本
// 用法:
//   交互模式: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js
//   命令行模式: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --token <token> --class <ClassName> --method <MethodName> [--params <JSON>]
//   示例: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --token abc123 --class DHCDoc.Util.Date --method GetDateInfo
//         node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class DHCDoc.Util.Date --method GetDateInfo --params 'UserId=12175&ForceQuery=0'
//         node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class DHCDoc.Util.Date --method GetDateInfo --path DHCDoc.Util.Broker.cls

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function findWorkspaceRoot() {
    let dir = __dirname;
    while (true) {
        if (path.basename(dir).toLowerCase() === '.agents') {
            return path.dirname(dir);
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return process.cwd();
        }
        dir = parent;
    }
}

// 加载 config/project-env.json 配置
function loadConfig() {
    const configPath = path.join(findWorkspaceRoot(), '.agents', 'config', 'project-env.json');
    if (!fs.existsSync(configPath)) {
        console.error('\x1b[31m%s\x1b[0m', `错误: 未找到配置文件 ${configPath}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--token') {
            result.hasToken = true;
            if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                result.token = args[++i];
            } else {
                result.token = '';
            }
        }
        else if (args[i] === '--class' && i + 1 < args.length) result.className = args[++i];
        else if (args[i] === '--method' && i + 1 < args.length) result.methodName = args[++i];
        else if (args[i] === '--params' && i + 1 < args.length) result.params = args[++i];
        else if (args[i] === '--url' && i + 1 < args.length) result.serverUrl = args[++i];
    }
    return result;
}

function ask(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

async function main() {
    const envConfig = loadConfig();
    const irisConfig = envConfig.iris || {};
    const hostname = irisConfig.host;
    const port = parseInt(irisConfig.port, 10) || 2443;
    const isHttps = (irisConfig.scheme || 'https') === 'https';

    if (!hostname) {
        console.error('\x1b[31m%s\x1b[0m', '错误: 配置中缺少 host');
        process.exit(1);
    }

    const cliArgs = parseArgs();

    // 处理 serverUrl: 用户传入则拼接 /imedical/web/，否则用默认值
    let serverUrl = '/imedical/web/csp/websys.Broker.cls';
    if (cliArgs.serverUrl) {
        serverUrl = '/imedical/web/' + cliArgs.serverUrl;
    }
    let token, className, methodName, extraParams = {};

    if (cliArgs.className && cliArgs.methodName) {
        // 命令行模式
        token = cliArgs.hasToken ? (cliArgs.token || '') : '';
        className = cliArgs.className;
        methodName = cliArgs.methodName;
        if (cliArgs.params) {
            const pairs = cliArgs.params.split('&');
            for (const pair of pairs) {
                const [key, ...rest] = pair.split('=');
                if (key) extraParams[key.trim()] = rest.join('=').trim();
            }
        }
    } else {
        // 交互模式
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        token = await ask(rl, '请输入 Token: ');
        className = await ask(rl, '请输入 ClassName (如 DHCDoc.EPMI.SERV.PatMerge): ');
        if (!className) {
            console.error('\x1b[31m%s\x1b[0m', '错误: ClassName 不能为空');
            process.exit(1);
        }
        methodName = await ask(rl, '请输入 MethodName (如 getPatMergeList): ');
        if (!methodName) {
            console.error('\x1b[31m%s\x1b[0m', '错误: MethodName 不能为空');
            process.exit(1);
        }
        const pathInput = await ask(rl, `请输入 serverUrl (直接回车使用默认): `);
        if (pathInput) {
            serverUrl = '/imedical/web/' + pathInput;
        }
        const paramsStr = await ask(rl, '请输入额外参数 (格式: key1=value1&key2=value2，无参数直接回车): ');
        if (paramsStr) {
            const pairs = paramsStr.split('&');
            for (const pair of pairs) {
                const [key, ...rest] = pair.split('=');
                if (key) extraParams[key.trim()] = rest.join('=').trim();
            }
        }
        rl.close();
    }

    // 构建请求体 (URL-encoded 表单格式)
    const formParams = new URLSearchParams();
    formParams.append('ClassName', className);
    formParams.append('MethodName', methodName);
    for (const [key, value] of Object.entries(extraParams)) {
        formParams.append(key, value);
    }
    const requestBody = formParams.toString();

    const config = {
        hostname,
        port,
        path: serverUrl,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'MW_TIME_STAMP': Date.now().toString(),
            'MW_TOKEN': token,
            'REQUEST_PAGE': 'dhcdoc.load.module.com.csp',
            'RESPONSE_JSON': '1',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
            "cookie": "CSPWSERVERID=FDCPNzHu; CSPSESSIONID-SP-80-UP-=000000000000mz3vMxrA4rxK2rxu$dhPg8kETBw$qs0xvXO3w_",
        }
    };

    console.log('\x1b[36m%s\x1b[0m', `\n发送请求到: ${isHttps ? 'https' : 'http'}://${hostname}:${port}${serverUrl}`);
    console.log('\x1b[36m%s\x1b[0m', `ClassName: ${className}`);
    console.log('\x1b[36m%s\x1b[0m', `MethodName: ${methodName}`);
    console.log('\x1b[36m%s\x1b[0m', `请求体: ${requestBody}`);
    console.log('');

    const requester = isHttps ? https : http;

    const req = requester.request(config, (res) => {
        let data = '';

        console.log('\x1b[32m%s\x1b[0m', `响应状态码: ${res.statusCode}`);
        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            try {
                const jsonObj = JSON.parse(data);
                console.log('\x1b[33m%s\x1b[0m', '响应内容 (JSON):');
                console.log(JSON.stringify(jsonObj, null, 2));
            } catch (e) {
                console.log('\x1b[33m%s\x1b[0m', '响应内容 (Raw):');
                console.log(data);
            }

            if (res.statusCode === 200) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        });
    });

    req.on('error', (error) => {
        console.error('\x1b[31m%s\x1b[0m', `错误: ${error.message}`);
        if (error.code) {
            console.error('\x1b[31m%s\x1b[0m', `错误代码: ${error.code}`);
        }
        process.exit(1);
    });

    req.write(requestBody);
    req.end();
}

main();
