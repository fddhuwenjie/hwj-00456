#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============== 参数解析 ==============
function parseArgs(argv) {
  const args = { projectPath: null, depth: Infinity, security: false, licenses: false, html: null, dot: null, json: null, ignore: [] };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--depth' && i + 1 < argv.length) { args.depth = parseInt(argv[++i], 10); }
    else if (arg === '--security') { args.security = true; }
    else if (arg === '--licenses') { args.licenses = true; }
    else if (arg === '--html' && i + 1 < argv.length) { args.html = argv[++i]; }
    else if (arg === '--dot' && i + 1 < argv.length) { args.dot = argv[++i]; }
    else if (arg === '--json' && i + 1 < argv.length) { args.json = argv[++i]; }
    else if (arg === '--ignore' && i + 1 < argv.length) { args.ignore = argv[++i].split(','); }
    else if (!arg.startsWith('--')) { positional.push(arg); }
  }
  if (positional.length > 0) args.projectPath = positional[0];
  return args;
}

// ============== 工具函数 ==============
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function semverToNum(v) {
  const m = String(v).replace(/^[\^~>=<]/, '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function compareVersions(a, b) {
  const va = semverToNum(a), vb = semverToNum(b);
  for (let i = 0; i < 3; i++) {
    if (va[i] > vb[i]) return 1;
    if (va[i] < vb[i]) return -1;
  }
  return 0;
}

function versionInRange(version, range) {
  const v = semverToNum(version);
  if (range.includes(' - ')) {
    const [lo, hi] = range.split(' - ').map(s => semverToNum(s.trim()));
    return compareVersions(v, lo) >= 0 && compareVersions(v, hi) <= 0;
  }
  if (range.startsWith('>=')) {
    const r = semverToNum(range.slice(2));
    return compareVersions(v, r) >= 0;
  }
  if (range.startsWith('<=')) {
    const r = semverToNum(range.slice(2));
    return compareVersions(v, r) <= 0;
  }
  if (range.startsWith('>')) {
    const r = semverToNum(range.slice(1));
    return compareVersions(v, r) > 0;
  }
  if (range.startsWith('<')) {
    const r = semverToNum(range.slice(1));
    return compareVersions(v, r) < 0;
  }
  if (range.startsWith('^') || range.startsWith('~')) {
    const r = semverToNum(range.slice(1));
    return v[0] === r[0] && v[1] >= r[1];
  }
  return compareVersions(v, semverToNum(range)) === 0;
}

function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function getDirSize(dirPath, cache = new Map()) {
  if (cache.has(dirPath)) return cache.get(dirPath);
  let total = 0;
  try {
    const stats = fs.statSync(dirPath);
    if (stats.isFile()) { total = stats.size; }
    else if (stats.isDirectory()) {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        total += getDirSize(path.join(dirPath, entry), cache);
      }
      total += stats.size;
    }
  } catch (e) {}
  cache.set(dirPath, total);
  return total;
}

// ============== 依赖树构建 ==============
function buildDependencyTree(projectPath, ignoreList = []) {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('Error: package.json not found at', pkgPath);
    process.exit(1);
  }
  const rootPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const nmPath = path.join(projectPath, 'node_modules');

  const tree = {
    name: rootPkg.name || 'root',
    version: rootPkg.version || '0.0.0',
    path: projectPath,
    children: {},
    size: 0,
    license: rootPkg.license || null,
    isRoot: true
  };

  const visited = new Set();
  const allPackages = [];
  const versionConflicts = new Map();

  function shouldIgnore(name) {
    return ignoreList.some(ig => name === ig || name.startsWith(ig + '/'));
  }

  function readPackage(pkgDir) {
    const p = path.join(pkgDir, 'package.json');
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return null; }
    }
    return null;
  }

  function resolveDep(depName, fromPath) {
    let current = fromPath;
    while (true) {
      const candidate = path.join(current, 'node_modules', depName);
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    const topLevel = path.join(nmPath, depName);
    if (fs.existsSync(topLevel)) return topLevel;
    return null;
  }

  function processNode(node, depsObj, ancestorPaths) {
    if (!depsObj) return;
    for (const [depName, depRange] of Object.entries(depsObj)) {
      if (shouldIgnore(depName)) continue;
      const depDir = resolveDep(depName, node.path);
      if (!depDir) continue;
      const depPkg = readPackage(depDir);
      if (!depPkg) continue;

      const depVersion = depPkg.version || '0.0.0';
      const realPath = fs.realpathSync(depDir);
      const nodeKey = depName + '@' + depVersion + '::' + realPath;

      const child = {
        name: depName,
        version: depVersion,
        path: depDir,
        realPath: realPath,
        children: {},
        size: 0,
        license: depPkg.license || (depPkg.licenses ? depPkg.licenses.map(l => l.type || l).join(',') : 'UNKNOWN'),
        dependencies: depPkg.dependencies || {}
      };
      child.size = getDirSize(depDir);
      node.children[depName] = child;
      allPackages.push(child);

      if (!versionConflicts.has(depName)) versionConflicts.set(depName, new Map());
      const versionMap = versionConflicts.get(depName);
      if (!versionMap.has(depVersion)) versionMap.set(depVersion, []);
      versionMap.get(depVersion).push(depDir);

      if (!visited.has(nodeKey)) {
        visited.add(nodeKey);
        processNode(child, depPkg.dependencies, ancestorPaths + '/' + depName);
      }
    }
  }

  const allDeps = Object.assign({}, rootPkg.dependencies || {}, rootPkg.devDependencies || {});
  processNode(tree, allDeps, '');
  tree.size = fs.existsSync(nmPath) ? getDirSize(nmPath) : 0;

  const conflicts = [];
  for (const [name, versions] of versionConflicts.entries()) {
    if (versions.size > 1) {
      conflicts.push({
        name,
        versions: Array.from(versions.entries()).map(([v, paths]) => ({ version: v, paths }))
      });
    }
  }

  return { tree, allPackages, versionConflicts: conflicts };
}

// ============== 树形显示 ==============
function printTree(node, depth, maxDepth, prefix = '', isLast = true) {
  if (depth > maxDepth) return;
  const connector = depth === 0 ? '' : (isLast ? '└── ' : '├── ');
  const sizeStr = node.size ? ` (${formatSize(node.size)})` : '';
  const verStr = node.version ? `@${node.version}` : '';
  console.log(prefix + connector + node.name + verStr + sizeStr);
  const children = Object.values(node.children);
  const newPrefix = prefix + (depth === 0 ? '' : (isLast ? '    ' : '│   '));
  children.forEach((child, i) => {
    printTree(child, depth + 1, maxDepth, newPrefix, i === children.length - 1);
  });
}

// ============== 体积分析 ==============
function analyzeSizes(allPackages, rootTree) {
  const uniquePkgs = new Map();
  for (const pkg of allPackages) {
    const key = pkg.name + '@' + pkg.version;
    if (!uniquePkgs.has(key)) {
      uniquePkgs.set(key, { name: pkg.name, version: pkg.version, size: pkg.size, paths: [pkg.path] });
    } else {
      uniquePkgs.get(key).paths.push(pkg.path);
    }
  }

  const sizeList = Array.from(uniquePkgs.values()).sort((a, b) => b.size - a.size);
  const top20 = sizeList.slice(0, 20);

  const ownerMap = new Map();
  function collectOwners(node, owners) {
    for (const child of Object.values(node.children)) {
      const key = child.name + '@' + child.version;
      if (!ownerMap.has(key)) ownerMap.set(key, new Set());
      ownerMap.get(key).add(node.isRoot ? 'ROOT' : (node.name + '@' + node.version));
      collectOwners(child, owners);
    }
  }
  collectOwners(rootTree, new Set());

  const exclusiveSavings = [];
  for (const pkg of sizeList) {
    const key = pkg.name + '@' + pkg.version;
    const owners = ownerMap.get(key) || new Set();
    if (owners.size <= 1) {
      exclusiveSavings.push({ ...pkg, exclusiveSize: pkg.size, owners: Array.from(owners) });
    }
  }

  return {
    totalSize: rootTree.size,
    top20,
    exclusiveSavings: exclusiveSavings.sort((a, b) => b.exclusiveSize - a.exclusiveSize).slice(0, 20)
  };
}

// ============== 过时检测 ==============
async function checkOutdated(allPackages) {
  const unique = new Map();
  for (const pkg of allPackages) {
    if (!unique.has(pkg.name)) unique.set(pkg.name, pkg.version);
  }
  const results = [];
  for (const [name, current] of unique.entries()) {
    try {
      const data = await httpGetJSON(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
      const latest = data['dist-tags'] && data['dist-tags'].latest;
      if (!latest) continue;
      let level = null;
      const cur = semverToNum(current), lat = semverToNum(latest);
      if (compareVersions(cur, lat) < 0) {
        if (cur[0] !== lat[0]) level = 'major';
        else if (cur[1] !== lat[1]) level = 'minor';
        else if (cur[2] !== lat[2]) level = 'patch';
      }
      results.push({ name, current, latest, level });
    } catch (e) {
      results.push({ name, current, latest: null, level: null, error: true });
    }
  }
  return results;
}

// ============== 安全扫描 ==============
function loadVulnerabilities() {
  const vulnPath = path.join(__dirname, 'vulnerabilities.json');
  if (fs.existsSync(vulnPath)) {
    return JSON.parse(fs.readFileSync(vulnPath, 'utf-8'));
  }
  return [];
}

function scanSecurity(allPackages, vulnerabilities) {
  const findings = [];
  const seen = new Set();
  for (const pkg of allPackages) {
    for (const vuln of vulnerabilities) {
      if (pkg.name === vuln.package && versionInRange(pkg.version, vuln.affectedVersions)) {
        const key = pkg.name + '@' + pkg.version + '::' + vuln.cve;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            package: pkg.name,
            version: pkg.version,
            path: pkg.path,
            severity: vuln.severity,
            cve: vuln.cve,
            description: vuln.description,
            fixVersion: vuln.fixVersion
          });
        }
      }
    }
  }
  return findings.sort((a, b) => {
    const sev = { critical: 4, high: 3, medium: 2, low: 1 };
    return (sev[b.severity] || 0) - (sev[a.severity] || 0);
  });
}

// ============== 许可证审计 ==============
function auditLicenses(allPackages) {
  const INFECTIOUS = ['GPL', 'LGPL', 'AGPL', 'GPL-2.0', 'GPL-3.0', 'LGPL-2.0', 'LGPL-3.0', 'AGPL-3.0'];
  const licenseMap = new Map();
  const warnings = [];
  const seen = new Set();

  for (const pkg of allPackages) {
    const key = pkg.name + '@' + pkg.version;
    if (seen.has(key)) continue;
    seen.add(key);
    let lic = pkg.license || 'UNKNOWN';
    if (typeof lic === 'object') {
      lic = lic.type || JSON.stringify(lic);
    }
    if (Array.isArray(lic)) {
      lic = lic.map(l => typeof l === 'object' ? l.type : l).join(' OR ');
    }
    lic = String(lic);
    if (!licenseMap.has(lic)) licenseMap.set(lic, []);
    licenseMap.get(lic).push({ name: pkg.name, version: pkg.version });

    const isInfectious = INFECTIOUS.some(i => lic.toUpperCase().includes(i));
    if (isInfectious) {
      warnings.push({ name: pkg.name, version: pkg.version, license: lic });
    }
  }

  const summary = [];
  for (const [license, pkgs] of licenseMap.entries()) {
    summary.push({ license, count: pkgs.length, packages: pkgs });
  }
  summary.sort((a, b) => b.count - a.count);

  return { summary, warnings };
}

// ============== DOT 图输出 ==============
function generateDot(rootTree) {
  const lines = ['digraph dependencies {'];
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, style="rounded,filled", fillcolor="#e8f4fd"];');
  const nodes = new Set();
  const edges = new Set();

  function walk(node, parentLabel) {
    const label = node.name + '@' + node.version;
    if (!nodes.has(label)) {
      nodes.add(label);
      const safeLabel = label.replace(/"/g, '\\"');
      lines.push(`  "${safeLabel}" [label="${safeLabel}"];`);
    }
    if (parentLabel) {
      const edgeKey = parentLabel + ' -> ' + label;
      if (!edges.has(edgeKey)) {
        edges.add(edgeKey);
        lines.push(`  "${parentLabel.replace(/"/g, '\\"')}" -> "${label.replace(/"/g, '\\"')}";`);
      }
    }
    for (const child of Object.values(node.children)) {
      walk(child, label);
    }
  }
  walk(rootTree, null);
  lines.push('}');
  return lines.join('\n');
}

// ============== HTML 报告 ==============
function generateHTML(results) {
  const { project, tree, sizeAnalysis, outdated, security, licenses, versionConflicts } = results;
  const licenseData = (licenses && licenses.summary) || [];
  const sizeData = (sizeAnalysis && sizeAnalysis.top20) || [];
  const totalPkgs = new Set((results.allPackages || []).map(p => p.name + '@' + p.version)).size;

  const licenseColors = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4', '#FF5722', '#795548'];
  const licensePieData = licenseData.map((l, i) => ({
    label: l.license, value: l.count, color: licenseColors[i % licenseColors.length]
  }));
  const sizePieData = sizeData.slice(0, 10).map((s, i) => ({
    label: s.name, value: s.size, color: licenseColors[i % licenseColors.length]
  }));

  function pieToSVG(data, cx, cy, r) {
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#eee"/>`;
    let startAngle = -Math.PI / 2;
    let paths = '';
    for (const d of data) {
      const angle = (d.value / total) * Math.PI * 2;
      const endAngle = startAngle + angle;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const large = angle > Math.PI ? 1 : 0;
      paths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${d.color}" stroke="#fff" stroke-width="1"/>`;
      startAngle = endAngle;
    }
    return paths;
  }

  const licenseSVG = pieToSVG(licensePieData, 120, 120, 100);
  const sizeSVG = pieToSVG(sizePieData, 120, 120, 100);

  function legendHTML(data) {
    return data.map(d => `
      <div style="display:flex;align-items:center;margin:4px 0;">
        <div style="width:14px;height:14px;background:${d.color};margin-right:6px;border-radius:2px;"></div>
        <span style="font-size:12px;">${d.label} (${d.label.includes('@') ? formatSize(d.value) : d.value})</span>
      </div>
    `).join('');
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>依赖分析报告 - ${project}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; background: #f5f7fa; color: #333; }
  h1 { margin: 0 0 8px; }
  .subtitle { color: #666; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
  .card h2 { margin-top: 0; border-bottom: 2px solid #2196F3; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
  th { background: #fafafa; }
  tr:hover { background: #f9fbff; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .major { background: #ffebee; color: #c62828; }
  .minor { background: #fff3e0; color: #e65100; }
  .patch { background: #e8f5e9; color: #2e7d32; }
  .critical { background: #ff1744; color: #fff; }
  .high { background: #ff6d00; color: #fff; }
  .medium { background: #ffc107; color: #000; }
  .low { background: #4caf50; color: #fff; }
  .warning-row { background: #fff8e1; }
  .pie-container { display: flex; align-items: flex-start; gap: 20px; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .stat { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 16px; border-radius: 8px; }
  .stat .val { font-size: 28px; font-weight: 700; }
  .stat .lbl { font-size: 12px; opacity: 0.9; margin-top: 4px; }
  .tree { font-family: 'SF Mono', Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
  <h1>📦 项目依赖分析报告</h1>
  <div class="subtitle">项目路径: ${project} | 生成时间: ${new Date().toLocaleString()}</div>

  <div class="stat-grid">
    <div class="stat"><div class="val">${totalPkgs}</div><div class="lbl">唯一依赖包</div></div>
    <div class="stat" style="background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);"><div class="val">${formatSize(sizeAnalysis.totalSize)}</div><div class="lbl">node_modules 总大小</div></div>
    <div class="stat" style="background:linear-gradient(135deg,#4facfe 0%,#00f2fe 100%);"><div class="val">${(versionConflicts || []).length}</div><div class="lbl">版本冲突</div></div>
    <div class="stat" style="background:linear-gradient(135deg,#43e97b 0%,#38f9d7 100%);"><div class="val">${(security || []).length}</div><div class="lbl">已知漏洞</div></div>
  </div>

  ${sizeAnalysis ? `
  <div class="card">
    <h2>📊 体积分析 TOP 20</h2>
    <table>
      <tr><th>#</th><th>包名</th><th>版本</th><th>大小</th></tr>
      ${sizeAnalysis.top20.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.version}</td><td><strong>${formatSize(p.size)}</strong></td></tr>`).join('')}
    </table>
  </div>` : ''}

  ${outdated ? `
  <div class="card">
    <h2>🔄 过时依赖检测</h2>
    <table>
      <tr><th>包名</th><th>当前版本</th><th>最新版本</th><th>升级类型</th><th>建议</th></tr>
      ${outdated.filter(o => o.level).map(o => `
        <tr>
          <td>${o.name}</td><td>${o.current}</td><td>${o.latest}</td>
          <td><span class="badge ${o.level}">${o.level}</span></td>
          <td>建议升级到 ${o.latest}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="color:#888;text-align:center;">所有依赖均为最新版本</td></tr>'}
    </table>
  </div>` : ''}

  ${security ? `
  <div class="card">
    <h2>🛡️ 安全扫描报告</h2>
    <table>
      <tr><th>严重度</th><th>CVE</th><th>包名</th><th>版本</th><th>描述</th><th>修复版本</th></tr>
      ${security.length > 0 ? security.map(v => `
        <tr class="warning-row">
          <td><span class="badge ${v.severity}">${v.severity}</span></td>
          <td><code>${v.cve}</code></td>
          <td>${v.package}</td><td>${v.version}</td>
          <td>${v.description}</td><td>${v.fixVersion}</td>
        </tr>`).join('') : '<tr><td colspan="6" style="color:#2e7d32;text-align:center;">✅ 未发现已知漏洞</td></tr>'}
    </table>
  </div>` : ''}

  ${licenses ? `
  <div class="card">
    <h2>📜 许可证审计</h2>
    <div class="pie-container">
      <svg width="240" height="240">${licenseSVG}</svg>
      <div>${legendHTML(licensePieData)}</div>
    </div>
    ${licenses.warnings.length > 0 ? `
      <h3 style="color:#e65100;">⚠️ 传染性许可证警告</h3>
      <table>
        <tr><th>包名</th><th>版本</th><th>许可证</th></tr>
        ${licenses.warnings.map(w => `<tr class="warning-row"><td>${w.name}</td><td>${w.version}</td><td><strong>${w.license}</strong></td></tr>`).join('')}
      </table>` : ''}
    <h3>许可证汇总</h3>
    <table>
      <tr><th>许可证</th><th>使用数量</th><th>包列表</th></tr>
      ${licenses.summary.map(s => `<tr><td><strong>${s.license}</strong></td><td>${s.count}</td><td>${s.packages.map(p => p.name + '@' + p.version).join(', ')}</td></tr>`).join('')}
    </table>
  </div>` : ''}

  <div class="card">
    <h2>📊 体积分布饼图 (TOP 10)</h2>
    <div class="pie-container">
      <svg width="240" height="240">${sizeSVG}</svg>
      <div>${legendHTML(sizePieData)}</div>
    </div>
  </div>

  ${versionConflicts && versionConflicts.length > 0 ? `
  <div class="card">
    <h2>⚠️ 版本冲突</h2>
    <table>
      <tr><th>包名</th><th>版本与路径</th></tr>
      ${versionConflicts.map(c => `
        <tr>
          <td><strong>${c.name}</strong></td>
          <td>${c.versions.map(v => `<div><code>${v.version}</code>: ${v.paths.join('; ')}</div>`).join('')}</td>
        </tr>`).join('')}
    </table>
  </div>` : ''}

  <div class="card">
    <h2>🌲 依赖树</h2>
    <div class="tree">${treeHTML(tree, 3)}</div>
  </div>
</body>
</html>`;
}

function treeHTML(node, maxDepth, depth = 0) {
  if (depth > maxDepth) return '';
  const ver = node.version ? `@${node.version}` : '';
  const size = node.size ? ` (${formatSize(node.size)})` : '';
  let html = `${'  '.repeat(depth)}${depth > 0 ? '├─ ' : ''}<strong>${node.name}</strong>${ver}${size}\n`;
  if (depth < maxDepth) {
    for (const child of Object.values(node.children)) {
      html += treeHTML(child, maxDepth, depth + 1);
    }
  }
  return html;
}

// ============== 主流程 ==============
async function main() {
  const args = parseArgs(process.argv);
  if (!args.projectPath) {
    console.log('用法: node depanalyze.js /path/to/project [--depth N] [--security] [--licenses] [--html report.html] [--dot graph.dot] [--json result.json] [--ignore pkg1,pkg2]');
    console.log('\n示例:');
    console.log('  node depanalyze.js ./sample-project --depth 3 --security --licenses --html report.html');
    process.exit(1);
  }

  const projectPath = path.resolve(args.projectPath);
  console.log(`\n🔍 正在分析项目: ${projectPath}\n`);

  console.log('📦 构建依赖树...');
  const { tree, allPackages, versionConflicts } = buildDependencyTree(projectPath, args.ignore);
  const uniqueCount = new Set(allPackages.map(p => p.name + '@' + p.version)).size;
  console.log(`   解析到 ${allPackages.length} 个依赖节点 (${uniqueCount} 个唯一包)\n`);

  console.log('🌲 依赖树结构:');
  printTree(tree, 0, args.depth);
  console.log('');

  if (versionConflicts.length > 0) {
    console.log('⚠️  版本冲突检测:');
    for (const c of versionConflicts) {
      console.log(`   ${c.name}:`);
      for (const v of c.versions) {
        console.log(`     - ${v.version}: ${v.paths.join(', ')}`);
      }
    }
    console.log('');
  }

  console.log('📊 体积分析...');
  const sizeAnalysis = analyzeSizes(allPackages, tree);
  console.log(`   node_modules 总大小: ${formatSize(sizeAnalysis.totalSize)}`);
  console.log('\n   TOP 20 体积最大的包:');
  sizeAnalysis.top20.forEach((p, i) => {
    console.log(`   ${String(i + 1).padStart(2)}. ${p.name}@${p.version} - ${formatSize(p.size)}`);
  });
  if (sizeAnalysis.exclusiveSavings.length > 0) {
    console.log('\n   可移除独占依赖节省空间 (TOP 20):');
    sizeAnalysis.exclusiveSavings.slice(0, 20).forEach((p, i) => {
      console.log(`   ${String(i + 1).padStart(2)}. ${p.name}@${p.version} - ${formatSize(p.exclusiveSize)} (所有者: ${p.owners.join(', ')})`);
    });
  }
  console.log('');

  let outdated = null;
  console.log('🔄 检查过时依赖 (查询 npm registry)...');
  try {
    outdated = await checkOutdated(allPackages);
    const major = outdated.filter(o => o.level === 'major').length;
    const minor = outdated.filter(o => o.level === 'minor').length;
    const patch = outdated.filter(o => o.level === 'patch').length;
    console.log(`   major升级: ${major}, minor升级: ${minor}, patch升级: ${patch}`);
    for (const o of outdated) {
      if (o.level) {
        const lvlTag = o.level === 'major' ? '[MAJOR]' : o.level === 'minor' ? '[MINOR]' : '[PATCH]';
        console.log(`   ${lvlTag} ${o.name}: ${o.current} → ${o.latest}`);
      }
    }
  } catch (e) {
    console.log('   网络检测失败,跳度过时检查');
  }
  console.log('');

  let security = null;
  if (args.security) {
    console.log('🛡️  安全扫描...');
    const vulnerabilities = loadVulnerabilities();
    security = scanSecurity(allPackages, vulnerabilities);
    if (security.length === 0) {
      console.log('   ✅ 未发现已知漏洞');
    } else {
      console.log(`   发现 ${security.length} 个漏洞:`);
      for (const v of security) {
        const sev = v.severity.toUpperCase();
        console.log(`   [${sev}] ${v.package}@${v.version} (${v.cve})`);
        console.log(`     描述: ${v.description}`);
        console.log(`     建议: 升级到 ${v.fixVersion}`);
      }
    }
    console.log('');
  }

  let licenses = null;
  if (args.licenses) {
    console.log('📜 许可证审计...');
    licenses = auditLicenses(allPackages);
    console.log(`   共发现 ${licenses.summary.length} 种许可证:`);
    for (const s of licenses.summary) {
      console.log(`   - ${s.license}: ${s.count} 个包`);
    }
    if (licenses.warnings.length > 0) {
      console.log(`\n   ⚠️  发现 ${licenses.warnings.length} 个传染性许可证:`);
      for (const w of licenses.warnings) {
        console.log(`     - ${w.name}@${w.version}: ${w.license}`);
      }
    }
    console.log('');
  }

  if (args.dot) {
    console.log(`📝 生成 DOT 图: ${args.dot}`);
    fs.writeFileSync(args.dot, generateDot(tree));
  }

  if (args.html) {
    console.log(`📄 生成 HTML 报告: ${args.html}`);
    const html = generateHTML({
      project: projectPath,
      tree, allPackages, sizeAnalysis, outdated, security, licenses, versionConflicts
    });
    fs.writeFileSync(args.html, html);
  }

  if (args.json) {
    console.log(`💾 导出 JSON 结果: ${args.json}`);
    const jsonOut = {
      project: projectPath,
      generatedAt: new Date().toISOString(),
      totalSize: sizeAnalysis.totalSize,
      uniquePackageCount: uniqueCount,
      versionConflicts,
      sizeAnalysis,
      outdated: outdated || [],
      security: security || [],
      licenses: licenses || { summary: [], warnings: [] },
      dependencyTree: tree
    };
    fs.writeFileSync(args.json, JSON.stringify(jsonOut, null, 2));
  }

  console.log('\n✅ 分析完成!');
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  console.error(err.stack);
  process.exit(1);
});
