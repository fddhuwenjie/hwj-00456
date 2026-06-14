#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============== 参数解析 ==============
const COMMANDS = ['diff', 'lockfile', 'why', 'policy', 'suggest', 'slim'];

function parseArgs(argv) {
  const args = { command: null, projectPath: null, depth: Infinity, security: false, licenses: false, html: null, dot: null, json: null, ignore: [], packageName: null, policyAction: null, pkgJsonOld: null, pkgJsonNew: null };
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
  if (positional.length > 0 && COMMANDS.includes(positional[0])) {
    args.command = positional.shift();
  }
  if (args.command === 'diff') {
    if (positional.length >= 2) { args.pkgJsonOld = positional[0]; args.pkgJsonNew = positional[1]; }
  } else if (args.command === 'why') {
    if (positional.length >= 1) { args.packageName = positional[0]; }
    if (positional.length >= 2) { args.projectPath = positional[1]; }
  } else if (args.command === 'policy') {
    if (positional.length >= 1) { args.policyAction = positional[0]; }
    if (positional.length >= 2) { args.projectPath = positional[1]; }
  } else {
    if (positional.length > 0) args.projectPath = positional[0];
  }
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

// ============== diff 命令：对比两个 package.json ==============
function cmdDiff(oldPath, newPath) {
  if (!oldPath || !newPath) {
    console.error('用法: node depanalyze.js diff <old-package.json> <new-package.json>');
    process.exit(1);
  }
  const resolvedOld = path.resolve(oldPath);
  const resolvedNew = path.resolve(newPath);
  if (!fs.existsSync(resolvedOld)) { console.error('文件不存在:', resolvedOld); process.exit(1); }
  if (!fs.existsSync(resolvedNew)) { console.error('文件不存在:', resolvedNew); process.exit(1); }

  const oldPkg = JSON.parse(fs.readFileSync(resolvedOld, 'utf-8'));
  const newPkg = JSON.parse(fs.readFileSync(resolvedNew, 'utf-8'));

  const oldDeps = Object.assign({}, oldPkg.dependencies || {}, oldPkg.devDependencies || {});
  const newDeps = Object.assign({}, newPkg.dependencies || {}, newPkg.devDependencies || {});
  const allNames = new Set([...Object.keys(oldDeps), ...Object.keys(newDeps)]);

  const added = [];
  const removed = [];
  const upgraded = [];
  const downgraded = [];
  const changed = [];

  for (const name of allNames) {
    const inOld = name in oldDeps;
    const inNew = name in newDeps;
    if (inOld && !inNew) {
      removed.push({ name, version: oldDeps[name] });
    } else if (!inOld && inNew) {
      added.push({ name, version: newDeps[name] });
    } else {
      const oldVer = oldDeps[name];
      const newVer = newDeps[name];
      if (oldVer !== newVer) {
        const oldClean = oldVer.replace(/^[\^~>=<]+/, '');
        const newClean = newVer.replace(/^[\^~>=<]+/, '');
        const cmp = compareVersions(oldClean, newClean);
        if (cmp < 0) {
          upgraded.push({ name, oldVersion: oldVer, newVersion: newVer });
        } else if (cmp > 0) {
          downgraded.push({ name, oldVersion: oldVer, newVersion: newVer });
        } else {
          changed.push({ name, oldVersion: oldVer, newVersion: newVer });
        }
      }
    }
  }

  console.log('\n📋 依赖变更对比报告');
  console.log(`   旧文件: ${resolvedOld}`);
  console.log(`   新文件: ${resolvedNew}\n`);

  if (added.length > 0) {
    console.log(`🟢 新增依赖 (${added.length}):`);
    for (const p of added) console.log(`   + ${p.name}: ${p.version}`);
    console.log('');
  }
  if (removed.length > 0) {
    console.log(`🔴 删除依赖 (${removed.length}):`);
    for (const p of removed) console.log(`   - ${p.name}: ${p.version}`);
    console.log('');
  }
  if (upgraded.length > 0) {
    console.log(`⬆️  升级依赖 (${upgraded.length}):`);
    for (const p of upgraded) console.log(`   ↑ ${p.name}: ${p.oldVersion} → ${p.newVersion}`);
    console.log('');
  }
  if (downgraded.length > 0) {
    console.log(`⬇️  降级依赖 (${downgraded.length}):`);
    for (const p of downgraded) console.log(`   ↓ ${p.name}: ${p.oldVersion} → ${p.newVersion}`);
    console.log('');
  }
  if (changed.length > 0) {
    console.log(`🔄 版本范围变更 (${changed.length}):`);
    for (const p of changed) console.log(`   ~ ${p.name}: ${p.oldVersion} → ${p.newVersion}`);
    console.log('');
  }

  const totalChanges = added.length + removed.length + upgraded.length + downgraded.length + changed.length;
  if (totalChanges === 0) {
    console.log('✅ 未检测到依赖变更');
  } else {
    console.log(`📊 汇总: 新增 ${added.length} | 删除 ${removed.length} | 升级 ${upgraded.length} | 降级 ${downgraded.length} | 范围变更 ${changed.length}`);
  }
}

// ============== lockfile 命令：解析 package-lock.json ==============
function cmdLockfile(projectPath) {
  const resolved = path.resolve(projectPath || '.');
  const lockPath = path.join(resolved, 'package-lock.json');
  const pkgPath = path.join(resolved, 'package.json');

  if (!fs.existsSync(lockPath)) {
    console.error('未找到 package-lock.json:', lockPath);
    process.exit(1);
  }
  if (!fs.existsSync(pkgPath)) {
    console.error('未找到 package.json:', pkgPath);
    process.exit(1);
  }

  const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const lockfileVersion = lockData.lockfileVersion || 1;

  console.log('\n🔒 锁文件分析报告');
  console.log(`   路径: ${lockPath}`);
  console.log(`   锁文件版本: v${lockfileVersion}\n`);

  const lockedPackages = {};
  if (lockfileVersion >= 2 && lockData.packages) {
    for (const [pkgPath, info] of Object.entries(lockData.packages)) {
      if (pkgPath === '') continue;
      const name = pkgPath.startsWith('node_modules/') ? pkgPath.replace('node_modules/', '') : pkgPath;
      lockedPackages[name] = {
        version: info.version,
        resolved: info.resolved || null,
        integrity: info.integrity || null,
        dev: info.dev || false
      };
    }
  } else if (lockData.dependencies) {
    function flattenLockDeps(deps, prefix) {
      for (const [name, info] of Object.entries(deps)) {
        const key = prefix ? prefix + '/' + name : name;
        lockedPackages[key] = {
          version: info.version,
          resolved: info.resolved || null,
          integrity: info.integrity || null
        };
        if (info.dependencies) {
          flattenLockDeps(info.dependencies, key + '/node_modules');
        }
      }
    }
    flattenLockDeps(lockData.dependencies, '');
  }

  const lockedNames = Object.keys(lockedPackages);
  console.log(`📦 锁定包数量: ${lockedNames.length}\n`);

  const directDeps = Object.assign({}, pkgData.dependencies || {}, pkgData.devDependencies || {});
  const mismatches = [];

  console.log('🔍 对比 lockfile 与 package.json 版本范围一致性:\n');
  for (const [name, range] of Object.entries(directDeps)) {
    const locked = lockedPackages[name];
    if (!locked) {
      console.log(`   ⚠️  ${name}: 在 package.json 中声明但 lock 文件中未找到`);
      mismatches.push({ name, type: 'missing_in_lock', range, lockedVersion: null });
      continue;
    }
    const isExact = !range.startsWith('^') && !range.startsWith('~') && !range.startsWith('>') && !range.startsWith('<') && !range.includes(' - ') && !range.includes('||');
    if (isExact) {
      if (range !== locked.version) {
        console.log(`   ❌ ${name}: package.json=${range}, lockfile=${locked.version} (精确版本不匹配)`);
        mismatches.push({ name, type: 'version_mismatch', range, lockedVersion: locked.version });
      }
    } else {
      if (!versionInRange(locked.version, range)) {
        console.log(`   ❌ ${name}: package.json=${range}, lockfile=${locked.version} (锁定版本不在 semver 范围内)`);
        mismatches.push({ name, type: 'out_of_range', range, lockedVersion: locked.version });
      }
    }
  }

  if (mismatches.length === 0) {
    console.log('   ✅ 所有直接依赖的锁定版本与 package.json 范围一致');
  } else {
    console.log(`\n   ⚠️  发现 ${mismatches.length} 个不一致项，可能存在手动修改 lock 文件的情况`);
  }

  console.log('\n📋 锁定版本详情 (直接依赖):');
  for (const [name, range] of Object.entries(directDeps)) {
    const locked = lockedPackages[name];
    if (locked) {
      console.log(`   ${name}: ${range} → ${locked.version} ${locked.resolved ? '(' + locked.resolved + ')' : ''}`);
    }
  }
}

// ============== why 命令：解释包为什么存在 ==============
function cmdWhy(packageName, projectPath) {
  if (!packageName) {
    console.error('用法: node depanalyze.js why <package-name> [project-path]');
    process.exit(1);
  }
  const resolved = path.resolve(projectPath || '.');
  console.log(`\n🔍 分析 ${packageName} 为什么出现在依赖树中...\n`);

  const { tree } = buildDependencyTree(resolved);
  const paths = [];

  function findPaths(node, currentPath) {
    const newPath = [...currentPath, node.name + (node.version ? '@' + node.version : '')];
    if (node.name === packageName) {
      paths.push(newPath);
    }
    for (const child of Object.values(node.children)) {
      findPaths(child, newPath);
    }
  }
  findPaths(tree, []);

  if (paths.length === 0) {
    console.log(`   未找到包 "${packageName}" 在依赖树中`);
    return;
  }

  const uniqueVersions = new Set();
  for (const p of paths) {
    const last = p[p.length - 1];
    uniqueVersions.add(last);
  }

  console.log(`   找到 ${paths.length} 条引用路径，涉及 ${uniqueVersions.size} 个版本:\n`);

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    console.log(`   路径 ${i + 1}:`);
    console.log('   ' + p.join(' → '));
    console.log('');
  }

  const directPaths = paths.filter(p => p.length === 2);
  const transitivePaths = paths.filter(p => p.length > 2);
  if (directPaths.length > 0) {
    console.log(`   📌 ${packageName} 是直接依赖 (被 ${directPaths.length} 条路径直接引用)`);
  }
  if (transitivePaths.length > 0) {
    const parentSet = new Set();
    for (const p of transitivePaths) {
      if (p.length >= 3) parentSet.add(p[1]);
    }
    console.log(`   🔗 ${packageName} 是间接依赖，被以下包引入:`);
    for (const parent of parentSet) {
      const count = transitivePaths.filter(p => p[1] === parent).length;
      console.log(`     - ${parent} (${count} 条路径)`);
    }
  }
}

// ============== 简易 YAML 解析器 ==============
function parseSimpleYAML(text) {
  const result = {};
  let currentKey = null;
  let currentArray = null;
  let currentIndent = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);
    const content = trimmed.trimStart();

    if (indent === 0 && content.endsWith(':')) {
      currentKey = content.slice(0, -1);
      result[currentKey] = null;
      currentArray = null;
      currentIndent = 0;
    } else if (currentKey && indent > 0 && content.startsWith('- ')) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(content.slice(2).replace(/^["']|["']$/g, ''));
      currentArray = result[currentKey];
      currentIndent = indent;
    } else if (currentKey && indent > 0 && currentArray && content.startsWith('- ')) {
      currentArray.push(content.slice(2).replace(/^["']|["']$/g, ''));
    } else if (indent === 0 && content.includes(':')) {
      const colonIdx = content.indexOf(':');
      const key = content.slice(0, colonIdx);
      let val = content.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      result[key] = val === '' ? null : (isNaN(Number(val)) ? val : Number(val));
      currentKey = key;
      currentArray = null;
    }
  }
  return result;
}

// ============== policy 命令：依赖策略与合规检查 ==============
function cmdPolicy(action, projectPath) {
  if (!action || (action !== 'check' && action !== 'init')) {
    console.error('用法: node depanalyze.js policy <check|init> [project-path]');
    process.exit(1);
  }
  const resolved = path.resolve(projectPath || '.');

  if (action === 'init') {
    const policyPath = path.join(resolved, '.depolicy.yaml');
    if (fs.existsSync(policyPath)) {
      console.log('⚠️  .depolicy.yaml 已存在:', policyPath);
      return;
    }
    const template = `# 依赖策略配置文件
# 用于定义项目依赖规则，运行 policy check 进行合规检查

# 禁止使用的包列表
blacklist:
  - "eval-requires"

# 允许的许可证列表（留空则不检查）
allowed-licenses:
  - "MIT"
  - "ISC"
  - "BSD-2-Clause"
  - "BSD-3-Clause"
  - "Apache-2.0"

# 依赖数量上限
max-deps: 200

# 嵌套深度上限
max-depth: 10

# 要求所有直接依赖锁定精确版本（禁止 ^ ~ 范围）
no-range: false
`;
    fs.writeFileSync(policyPath, template);
    console.log('✅ 已生成策略模板文件:', policyPath);
    return;
  }

  const policyPath = path.join(resolved, '.depolicy.yaml');
  if (!fs.existsSync(policyPath)) {
    console.error('未找到策略文件 .depolicy.yaml，请先运行: node depanalyze.js policy init');
    process.exit(1);
  }

  const policyText = fs.readFileSync(policyPath, 'utf-8');
  const policy = parseSimpleYAML(policyText);

  console.log('\n🛡️  依赖策略合规检查');
  console.log(`   策略文件: ${policyPath}\n`);

  const { tree, allPackages } = buildDependencyTree(resolved);
  const violations = [];

  if (policy.blacklist && Array.isArray(policy.blacklist)) {
    const seen = new Set();
    for (const pkg of allPackages) {
      if (policy.blacklist.includes(pkg.name) && !seen.has(pkg.name)) {
        seen.add(pkg.name);
        violations.push({
          rule: 'blacklist',
          severity: 'critical',
          package: pkg.name,
          version: pkg.version,
          message: `黑名单包: ${pkg.name} 被禁止使用`
        });
      }
    }
  }

  if (policy['allowed-licenses'] && Array.isArray(policy['allowed-licenses'])) {
    const allowed = policy['allowed-licenses'].map(l => l.toUpperCase());
    const seen = new Set();
    for (const pkg of allPackages) {
      const key = pkg.name + '@' + pkg.version;
      if (seen.has(key)) continue;
      seen.add(key);
      let lic = pkg.license || 'UNKNOWN';
      if (typeof lic === 'object') lic = lic.type || JSON.stringify(lic);
      if (Array.isArray(lic)) lic = lic.map(l => typeof l === 'object' ? l.type : l).join(' OR ');
      lic = String(lic);
      const licUpper = lic.toUpperCase();
      const isAllowed = allowed.some(a => licUpper.includes(a));
      if (!isAllowed && lic !== 'UNKNOWN') {
        violations.push({
          rule: 'allowed-licenses',
          severity: 'high',
          package: pkg.name,
          version: pkg.version,
          message: `许可证不合规: ${pkg.name}@${pkg.version} 使用 ${lic}，不在允许列表中`
        });
      }
    }
  }

  if (policy['max-deps']) {
    const uniqueCount = new Set(allPackages.map(p => p.name)).size;
    if (uniqueCount > policy['max-deps']) {
      violations.push({
        rule: 'max-deps',
        severity: 'medium',
        package: null,
        version: null,
        message: `依赖数量超限: 当前 ${uniqueCount} 个，上限 ${policy['max-deps']}`
      });
    }
  }

  if (policy['max-depth']) {
    let maxFound = 0;
    function measureDepth(node, depth) {
      if (depth > maxFound) maxFound = depth;
      for (const child of Object.values(node.children)) {
        measureDepth(child, depth + 1);
      }
    }
    measureDepth(tree, 0);
    if (maxFound > policy['max-depth']) {
      violations.push({
        rule: 'max-depth',
        severity: 'medium',
        package: null,
        version: null,
        message: `嵌套深度超限: 当前最大 ${maxFound} 层，上限 ${policy['max-depth']}`
      });
    }
  }

  if (policy['no-range'] === true || policy['no-range'] === 'true') {
    const pkgPath = path.join(resolved, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = Object.assign({}, pkgData.dependencies || {}, pkgData.devDependencies || {});
      for (const [name, range] of Object.entries(allDeps)) {
        if (range.startsWith('^') || range.startsWith('~') || range.startsWith('>') || range.startsWith('<')) {
          violations.push({
            rule: 'no-range',
            severity: 'low',
            package: name,
            version: range,
            message: `版本范围违规: ${name} 使用 "${range}"，应使用精确版本号`
          });
        }
      }
    }
  }

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  violations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  if (violations.length === 0) {
    console.log('✅ 所有策略检查通过，未发现违规项');
  } else {
    console.log(`❌ 发现 ${violations.length} 个违规项:\n`);
    const grouped = {};
    for (const v of violations) {
      if (!grouped[v.rule]) grouped[v.rule] = [];
      grouped[v.rule].push(v);
    }
    for (const [rule, items] of Object.entries(grouped)) {
      const sev = items[0].severity.toUpperCase();
      console.log(`   [${sev}] 规则: ${rule} (${items.length} 项违规)`);
      for (const v of items) {
        console.log(`     - ${v.message}`);
      }
      console.log('');
    }
  }
}

// ============== suggest 命令：包替换建议 ==============
function cmdSuggest(projectPath) {
  const resolved = path.resolve(projectPath || '.');
  const kbPath = path.join(__dirname, 'replacements.json');
  if (!fs.existsSync(kbPath)) {
    console.error('未找到替换知识库: replacements.json');
    process.exit(1);
  }
  const knowledgeBase = JSON.parse(fs.readFileSync(kbPath, 'utf-8'));

  const pkgPath = path.join(resolved, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('未找到 package.json:', pkgPath);
    process.exit(1);
  }
  const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const allDeps = Object.assign({}, pkgData.dependencies || {}, pkgData.devDependencies || {});

  console.log('\n💡 包替换建议\n');

  let hasSuggestions = false;
  for (const [name, range] of Object.entries(allDeps)) {
    const entry = knowledgeBase.find(kb => kb.package === name);
    if (!entry) continue;
    hasSuggestions = true;
    console.log(`   📦 ${name}@${range}`);
    console.log(`      替代方案: ${entry.replacement}`);
    console.log(`      节省体积: ${entry.sizeSavings}`);
    console.log(`      兼容性评分: ${entry.compatibilityScore}/10`);
    console.log(`      说明: ${entry.description}`);
    if (entry.migrationNotes) {
      console.log(`      迁移提示: ${entry.migrationNotes}`);
    }
    console.log('');
  }

  if (!hasSuggestions) {
    console.log('   ✅ 未发现可替换的包（当前依赖均无更优替代方案）');
  }
}

// ============== slim 命令：依赖瘦身分析 ==============
function cmdSlim(projectPath) {
  const resolved = path.resolve(projectPath || '.');
  const pkgPath = path.join(resolved, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('未找到 package.json:', pkgPath);
    process.exit(1);
  }

  const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const directDeps = Object.keys(Object.assign({}, pkgData.dependencies || {}, pkgData.devDependencies || {}));

  const kbPath = path.join(__dirname, 'replacements.json');
  let knowledgeBase = [];
  if (fs.existsSync(kbPath)) {
    knowledgeBase = JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
  }

  const importMap = {};
  for (const dep of directDeps) {
    importMap[dep] = new Set();
  }

  function scanFile(filePath) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch (e) { return; }

    const requirePattern = /(?:require\(\s*['"]([^'"]+)['"]\s*\))/g;
    const importPattern = /(?:import\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"])/g;
    const destructureRequirePattern = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
    const assignRequirePattern = /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
    const varDestructurePattern = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(\w+)/g;

    const varToDep = {};

    let match;
    while ((match = assignRequirePattern.exec(content)) !== null) {
      const varName = match[1];
      const mod = match[2];
      const depName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
      if (importMap[depName]) {
        varToDep[varName] = depName;
        const subPath = mod.includes('/') ? mod.substring(depName.length + 1) : null;
        if (subPath) importMap[depName].add(subPath);
        else importMap[depName].add('*');
      }
    }

    while ((match = requirePattern.exec(content)) !== null) {
      const mod = match[1];
      const depName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
      if (importMap[depName]) {
        const subPath = mod.includes('/') ? mod.substring(depName.length + 1) : null;
        if (subPath) importMap[depName].add(subPath);
        else importMap[depName].add('*');
      }
    }

    while ((match = destructureRequirePattern.exec(content)) !== null) {
      const namedImports = match[1];
      const mod = match[2];
      const depName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
      if (importMap[depName]) {
        const fns = namedImports.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        for (const fn of fns) importMap[depName].add('fn:' + fn);
      }
    }

    while ((match = varDestructurePattern.exec(content)) !== null) {
      const namedImports = match[1];
      const varName = match[2];
      const depName = varToDep[varName];
      if (depName && importMap[depName]) {
        const fns = namedImports.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        for (const fn of fns) importMap[depName].add('fn:' + fn);
      }
    }

    while ((match = importPattern.exec(content)) !== null) {
      let mod = match[4] || match[1] || match[2];
      let namedImports = match[3];
      if (!mod) continue;
      const depName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
      if (importMap[depName]) {
        const subPath = mod.includes('/') ? mod.substring(depName.length + 1) : null;
        if (namedImports) {
          const fns = namedImports.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
          for (const fn of fns) importMap[depName].add('fn:' + fn);
        }
        if (subPath) importMap[depName].add(subPath);
        else if (!namedImports) importMap[depName].add('*');
      }
    }
  }

  function scanDir(dir, depth) {
    if (depth > 10) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === 'coverage') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && /\.(js|ts|jsx|tsx|mjs|cjs)$/.test(entry.name)) {
        scanFile(fullPath);
      } else if (entry.isDirectory()) {
        scanDir(fullPath, depth + 1);
      }
    }
  }

  console.log('\n🏋️ 依赖瘦身分析\n');
  console.log('   扫描项目源码中的 import/require 语句...');
  scanDir(resolved, 0);

  const slimCandidates = [];

  for (const [dep, imports] of Object.entries(importMap)) {
    const importList = Array.from(imports);
    if (importList.length === 0) continue;

    const kbEntry = knowledgeBase.find(kb => kb.package === dep);
    const hasSubpathImport = importList.some(imp => imp !== '*' && !imp.startsWith('fn:'));

    const namedFns = importList.filter(imp => imp.startsWith('fn:')).map(imp => imp.slice(3));
    const hasFullImport = importList.includes('*');

    if (hasFullImport && namedFns.length > 0 && namedFns.length <= 5) {
      slimCandidates.push({
        package: dep,
        type: 'partial_import',
        usedFunctions: namedFns,
        suggestion: namedFns.map(fn => {
          const subpath = kbEntry && kbEntry.subpaths && kbEntry.subpaths[fn];
          return subpath ? `${dep}/${subpath}` : `${dep}/${fn}`;
        }),
        importCount: importList.length
      });
    } else if (hasFullImport && namedFns.length > 5) {
      slimCandidates.push({
        package: dep,
        type: 'many_imports',
        usedFunctions: namedFns.slice(0, 10),
        suggestion: [`继续使用 ${dep} 整包导入（使用了 ${namedFns.length} 个函数）`],
        importCount: importList.length
      });
    } else if (hasSubpathImport) {
      slimCandidates.push({
        package: dep,
        type: 'subpath_import',
        usedFunctions: namedFns,
        subpaths: importList.filter(imp => imp !== '*' && !imp.startsWith('fn:')),
        suggestion: importList.filter(imp => imp !== '*' && !imp.startsWith('fn:')).map(sp => `${dep}/${sp}`),
        importCount: importList.length
      });
    }
  }

  if (slimCandidates.length === 0) {
    console.log('   ✅ 未发现可瘦身的依赖项');
    return;
  }

  console.log('\n   以下依赖建议改用按需引入或子路径导入:\n');
  for (const candidate of slimCandidates) {
    console.log(`   📦 ${candidate.package}`);
    if (candidate.type === 'partial_import') {
      console.log(`      问题: 整包导入但仅使用 ${candidate.usedFunctions.length} 个函数`);
      console.log(`      使用: ${candidate.usedFunctions.join(', ')}`);
      console.log(`      建议: 改用子路径导入 → ${candidate.suggestion.join(', ')}`);
    } else if (candidate.type === 'subpath_import') {
      console.log(`      已使用子路径: ${candidate.subpaths.join(', ')}`);
      console.log(`      建议: 确认按需引入路径 → ${candidate.suggestion.join(', ')}`);
    } else if (candidate.type === 'many_imports') {
      console.log(`      使用了 ${candidate.usedFunctions.length} 个函数，整包导入合理`);
      console.log(`      部分函数: ${candidate.usedFunctions.join(', ')}${candidate.usedFunctions.length < candidate.importCount ? '...' : ''}`);
    }
    console.log('');
  }

  const replacementSuggestions = [];
  for (const [dep, imports] of Object.entries(importMap)) {
    const kbEntry = knowledgeBase.find(kb => kb.package === dep);
    if (kbEntry) {
      replacementSuggestions.push({
        package: dep,
        replacement: kbEntry.replacement,
        sizeSavings: kbEntry.sizeSavings,
        compatibilityScore: kbEntry.compatibilityScore
      });
    }
  }

  if (replacementSuggestions.length > 0) {
    console.log('   💡 替代包建议 (更轻量的替代方案):\n');
    for (const s of replacementSuggestions) {
      console.log(`   ${s.package} → ${s.replacement}`);
      console.log(`      节省: ${s.sizeSavings} | 兼容性: ${s.compatibilityScore}/10`);
    }
    console.log('');
  }
}

// ============== 主流程 ==============
async function main() {
  const args = parseArgs(process.argv);

  if (args.command === 'diff') {
    cmdDiff(args.pkgJsonOld, args.pkgJsonNew);
    return;
  }
  if (args.command === 'lockfile') {
    cmdLockfile(args.projectPath || '.');
    return;
  }
  if (args.command === 'why') {
    cmdWhy(args.packageName, args.projectPath || '.');
    return;
  }
  if (args.command === 'policy') {
    cmdPolicy(args.policyAction, args.projectPath || '.');
    return;
  }
  if (args.command === 'suggest') {
    cmdSuggest(args.projectPath || '.');
    return;
  }
  if (args.command === 'slim') {
    cmdSlim(args.projectPath || '.');
    return;
  }

  if (!args.projectPath) {
    console.log('用法: node depanalyze.js <command|project-path> [options]');
    console.log('\n命令:');
    console.log('  diff <old.json> <new.json>         对比两个 package.json 的依赖变更');
    console.log('  lockfile [project-path]             解析 package-lock.json 检查版本一致性');
    console.log('  why <package> [project-path]        解释包为什么出现在依赖树中');
    console.log('  policy <check|init> [project-path]  依赖策略合规检查');
    console.log('  suggest [project-path]              包替换建议');
    console.log('  slim [project-path]                 依赖瘦身分析');
    console.log('\n分析模式 (传入项目路径):');
    console.log('  node depanalyze.js /path/to/project [--depth N] [--security] [--licenses] [--html report.html] [--dot graph.dot] [--json result.json] [--ignore pkg1,pkg2]');
    console.log('\n示例:');
    console.log('  node depanalyze.js ./sample-project --depth 3 --security --licenses --html report.html');
    console.log('  node depanalyze.js diff old-package.json new-package.json');
    console.log('  node depanalyze.js why express ./sample-project');
    console.log('  node depanalyze.js policy check ./sample-project');
    console.log('  node depanalyze.js policy init ./sample-project');
    console.log('  node depanalyze.js suggest ./sample-project');
    console.log('  node depanalyze.js slim ./sample-project');
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
