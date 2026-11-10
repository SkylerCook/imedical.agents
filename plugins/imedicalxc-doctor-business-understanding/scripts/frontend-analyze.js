const fs = require('fs');
const path = require('path');
const glob = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

// ====================== CLI 参数解析 ======================
function parseCliArgs() {
    const args = process.argv.slice(2);
    let projectRoot = __dirname;
    let outputDir = null;
    let workName = 'analysis';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--outputDir' && i + 1 < args.length) outputDir = args[++i];
        else if (args[i] === '--name' && i + 1 < args.length) workName = args[++i];
        else if (!args[i].startsWith('--')) projectRoot = args[i];
    }
    // If no outputDir specified, create default under project root's docs/
    if (!outputDir) {
        outputDir = path.join(projectRoot, 'docs', 'imedicalxc-doctor-business-understanding', 'phase2-frontend-trace');
    }
    return { projectRoot, outputDir, workName };
}

// ====================== 时间戳生成 ======================
function getTimestamp() {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

// ====================== 模块1：HTML页面JS加载分析 ======================
function analyzeAllHtmlEntry(projectRoot) {
    const htmlFiles = glob.sync(path.join(projectRoot, '**/*.html').replace(/\\/g, '/'), {
        ignore: ['node_modules/**', 'dist/**', 'build/**']
    });
    const fullReport = [];

    for (const htmlPath of htmlFiles) {
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const $ = require('cheerio').load(htmlContent);
        const pageReport = {
            pagePath: htmlPath,
            externalJs: [],
            inlineScript: [],
            moduleScript: [],
            deferScript: [],
            asyncScript: [],
            inlineDomEvent: [],
            dynamicImportPaths: []
        };

        $('script').each((_, el) => {
            const src = $(el).attr('src');
            const type = $(el).attr('type') || 'text/javascript';
            const defer = !!$(el).attr('defer');
            const async = !!$(el).attr('async');
            const code = $(el).html()?.trim() || '';

            if (src) {
                const jsItem = { src, type, defer, async };
                pageReport.externalJs.push(jsItem);
                if (type === 'module') pageReport.moduleScript.push(jsItem);
                if (defer) pageReport.deferScript.push(jsItem);
                if (async) pageReport.asyncScript.push(jsItem);
            } else if (code) {
                pageReport.inlineScript.push({ codePreview: code.slice(0, 500) });
                const importMatch = code.match(/import\(["'](.+?)["']\)/g);
                if (importMatch) {
                    importMatch.forEach(m => {
                        const p = m.match(/["'](.+?)["']/)[1];
                        pageReport.dynamicImportPaths.push(p);
                    });
                }
            }
        });

        $('[onclick],[onchange],[oninput],[onsubmit],[onblur]').each((_, el) => {
            const attrs = el.attribs;
            const eventObj = {};
            Object.keys(attrs).forEach(k => {
                if (k.startsWith('on')) eventObj[k] = attrs[k];
            });
            pageReport.inlineDomEvent.push({
                domTag: el.tagName,
                events: eventObj,
                htmlSnippet: $(el).toString().slice(0, 200)
            });
        });

        fullReport.push(pageReport);
    }

    return fullReport;
}

// ====================== 模块2：JS AST 函数调用链分析 ======================
function analyzeJsCallChain(projectRoot) {
    const jsFiles = glob.sync(path.join(projectRoot, '**/*.{js,ts,jsx,tsx}').replace(/\\/g, '/'), {
        ignore: ['node_modules/**', 'dist/**', 'build/**']
    });
    const callGraph = {
        funcDefine: {},
        funcCall: {},
        apiRequest: []
    };

    for (const jsPath of jsFiles) {
        const code = fs.readFileSync(jsPath, 'utf8');
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['typescript', 'jsx']
            });
            let funcStack = [];
            let currentFunc = null;

            traverse(ast, {
                FunctionDeclaration(path) {
                    const name = path.node.id?.name;
                    if (!name) return;
                    callGraph.funcDefine[name] = jsPath;
                    currentFunc = name;
                },
                ArrowFunctionExpression(path) {
                    const parent = path.parentPath;
                    if (t.isVariableDeclarator(parent)) {
                        const name = parent.id.name;
                        callGraph.funcDefine[name] = jsPath;
                        currentFunc = name;
                    }
                },
                CallExpression(path) {
                    if (!currentFunc) return;
                    let callName = null;
                    if (t.isIdentifier(path.node.callee)) callName = path.node.callee.name;
                    if (t.isMemberExpression(path.node.callee)) callName = path.node.callee.property?.name;
                    if (!callName) return;

                    if (!callGraph.funcCall[currentFunc]) callGraph.funcCall[currentFunc] = [];
                    if (!callGraph.funcCall[currentFunc].includes(callName)) {
                        callGraph.funcCall[currentFunc].push(callName);
                    }

                    const reqKeywords = ['fetch','axios','request','httpGet','httpPost','$ipost','$iget','$.post','$.ajax','$.get'];
                    if (reqKeywords.includes(callName)) {
                        callGraph.apiRequest.push({
                            file: jsPath,
                            caller: currentFunc,
                            callMethod: callName,
                            args: JSON.stringify(path.node.arguments.slice(0, 2))
                        });
                    }
                }
            });
        } catch (err) {
            console.warn(`解析跳过 ${jsPath}:`, err.message);
        }
    }

    return callGraph;
}

// ====================== 总入口：一键执行全工程分析 ======================
function runFullFrontendAnalysis(root, outDir, name) {
    const projectRoot = root || __dirname;
    const outputDir = outDir || path.join(projectRoot, 'docs', 'imedicalxc-doctor-business-understanding', 'phase2-frontend-trace');
    const workName = name || 'analysis';
    const ts = getTimestamp();

    console.log('===== 开始全前端工程静态源码分析 =====');
    console.log('分析目录:', projectRoot);
    console.log('输出目录:', outputDir);

    const htmlReport = analyzeAllHtmlEntry(projectRoot);
    const callGraph = analyzeJsCallChain(projectRoot);

    ensureDir(outputDir);
    const htmlOutPath = path.join(outputDir, ts + '_' + workName + '_html-js-load-report.json');
    fs.writeFileSync(htmlOutPath, JSON.stringify(htmlReport, null, 2), 'utf8');
    console.log('HTML分析报告已生成:', htmlOutPath);

    const jsOutPath = path.join(outputDir, ts + '_' + workName + '_js-call-graph.json');
    fs.writeFileSync(jsOutPath, JSON.stringify(callGraph, null, 2), 'utf8');
    console.log('JS调用链图谱已生成:', jsOutPath);

    console.log('===== 分析全部完成 =====');
    return { htmlReport, callGraph };
}

// 程序启动入口
const cli = parseCliArgs();
runFullFrontendAnalysis(cli.projectRoot, cli.outputDir, cli.workName);
module.exports = { runFullFrontendAnalysis };



