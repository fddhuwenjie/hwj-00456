# depanalyze.js 架构文档

## 一、系统架构概览

### 1.1 整体设计模式：单文件多功能模块

`depanalyze.js` 采用 **单文件多功能模块** 设计模式，整个工具在单个 JavaScript 文件中实现，无需额外的模块拆分。这种设计适合 CLI 工具，具有部署简单、依赖清晰的特点。

文件内部按功能划分为多个独立的代码段，通过注释分隔：
- **参数解析层**：`parseArgs()` 函数负责解析命令行参数
- **工具函数层**：`formatSize()`、`semverToNum()`、`compareVersions()`、`versionInRange()`、`httpGetJSON()`、`getDirSize()` 等通用工具
- **核心业务层**：`buildDependencyTree()`、`analyzeSizes()`、`checkOutdated()`、`scanSecurity()`、`auditLicenses()` 等核心分析函数
- **输出格式化层**：`printTree()`、`generateDot()`、`generateHTML()`、`treeHTML()` 等输出函数
- **命令处理层**：`cmdDiff()`、`cmdLockfile()`、`cmdWhy()`、`cmdPolicy()`、`cmdSuggest()`、`cmdSlim()` 六个命令处理器
- **主流程控制**：`main()` 函数作为入口，负责流程编排

### 1.2 命令行参数解析与分发机制

#### 参数解析：`parseArgs()` [L11-L40](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L11-L40)

参数解析采用 **双轮扫描** 策略：
1. 第一轮扫描所有参数，区分位置参数（positional）和选项参数（--开头）
2. 第二轮根据第一个位置参数是否属于 `COMMANDS` 数组（`['diff', 'lockfile', 'why', 'policy', 'suggest', 'slim']`）来决定是命令模式还是分析模式

#### 命令分发：`main()` [L1308-L1489](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L1308-L1489)

主函数采用 **if-else 级联路由** 机制：
```javascript
if (args.command === 'diff') {
  cmdDiff(args.pkgJsonOld, args.pkgJsonNew);
  return;
}
if (args.command === 'lockfile') {
  cmdLockfile(args.projectPath || '.');
  return;
}
// ... 其他命令
// 若无命令则进入默认分析模式
```

### 1.3 完整默认分析流程

一次完整的默认分析流程（传入项目路径）经过以下核心函数调用：

```
main() [L1308]
  ├─> parseArgs(process.argv) [L1309]
  │    解析命令行参数，确定为分析模式
  │
  ├─> buildDependencyTree(projectPath, ignore) [L1362]
  │    ├─> 读取 package.json
  │    ├─> resolveDep() [L160] 解析依赖路径（向上查找node_modules）
  │    ├─> processNode() [L176] 递归处理每个节点
  │    │    └─> getDirSize() [L106] 计算目录体积
  │    └─> 返回 { tree, allPackages, versionConflicts }
  │
  ├─> printTree(tree, 0, depth) [L1367]
  │    递归打印树形结构
  │
  ├─> analyzeSizes(allPackages, tree) [L1382]
  │    分析体积分布、TOP20、独占依赖
  │
  ├─> checkOutdated(allPackages) [L1399]
  │    └─> httpGetJSON() [L94] 查询 npm registry
  │
  ├─> scanSecurity(allPackages, vulnerabilities) [L1419] (可选)
  │    └─> loadVulnerabilities() [L316] 加载 vulnerabilities.json
  │
  ├─> auditLicenses(allPackages) [L1437] (可选)
  │    许可证审计与传染性检测
  │
  ├─> generateDot(tree) [L1453] (可选)
  │    生成 Graphviz DOT 格式
  │
  ├─> generateHTML(results) [L1458] (可选)
  │    └─> pieToSVG() [L435] 生成 SVG 饼图
  │
  └─> 导出 JSON 结果 [L1467] (可选)
```

---

## 二、依赖树构建算法

### 2.1 `buildDependencyTree()` 递归遍历策略 [L125-L230](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L125-L230)

#### 核心数据结构：
```javascript
const tree = {
  name, version, path, children: {}, size, license, isRoot
};
```

#### 递归遍历流程：

1. **初始化**：读取项目根目录的 `package.json`，创建根节点
2. **依赖解析**：`resolveDep(depName, fromPath)` [L160-L174] 实现 Node.js 模块解析算法
   - 从当前路径向上逐级查找 `node_modules/<depName>`
   - 直到文件系统根目录，最后尝试顶级 `node_modules`
3. **节点处理**：`processNode(node, depsObj, ancestorPaths)` [L176-L213]
   - 遍历依赖对象的每个键值对
   - 跳过 `ignoreList` 中的包
   - 读取子包的 `package.json`
   - **循环检测**：使用 `visited = new Set()` 存储 `nodeKey = name@version::realPath`
   - 若未访问过则标记并递归处理子依赖

#### 嵌套 node_modules 处理：
通过 `fs.realpathSync(depDir)` 获取真实路径，结合向上查找机制，自动处理嵌套的 `node_modules` 目录（如 `a/node_modules/b/node_modules/c`）。

#### 版本冲突收集：
```javascript
const versionConflicts = new Map(); // name -> Map<version, path[]>
```
每个包的每个版本出现的路径都会被记录，最终筛选出 `versions.size > 1` 的包作为冲突项。

### 2.2 唯一包计数 vs 总节点数

| 指标 | 计算方式 | 含义 |
|------|----------|------|
| 总节点数 | `allPackages.length` | 依赖树中所有节点的数量（包括重复出现的同一包） |
| 唯一包数 | `new Set(allPackages.map(p => p.name + '@' + p.version)).size` | 按 `name@version` 去重后的数量 |

**区别**：如果 `ms@2.0.0` 在依赖树中出现了 3 次，总节点数 +3，但唯一包数只 +1。

### 2.3 `getDirSize()` 递归文件遍历逻辑 [L106-L122](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L106-L122)

```javascript
function getDirSize(dirPath, cache = new Map()) {
  if (cache.has(dirPath)) return cache.get(dirPath);
  let total = 0;
  const stats = fs.statSync(dirPath);
  if (stats.isFile()) {
    total = stats.size;
  } else if (stats.isDirectory()) {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      total += getDirSize(path.join(dirPath, entry), cache);
    }
    total += stats.size; // 目录本身的大小
  }
  cache.set(dirPath, total);
  return total;
}
```

**关键特性**：
- **缓存机制**：使用 `Map` 缓存已计算目录的大小，避免重复计算
- **深度优先**：先递归计算所有子目录和文件，再累加
- **目录大小**：包含目录条目本身占用的磁盘空间

---

## 三、安全扫描与许可证匹配

### 3.1 漏洞匹配的版本范围比较算法

**自实现 semver 解析**，不依赖任何第三方库，核心函数：

| 函数 | 位置 | 功能 |
|------|------|------|
| `semverToNum(v)` | [L50-L54](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L50-L54) | 将版本字符串转换为 `[major, minor, patch]` 数字数组 |
| `compareVersions(a, b)` | [L56-L63](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L56-L63) | 比较两个版本，返回 -1/0/1 |
| `versionInRange(version, range)` | [L65-L92](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L65-L92) | 判断版本是否在范围内 |

**支持的范围格式**：
1. **精确版本**：`1.2.3` → 完全匹配
2. **连字符范围**：`1.0.0 - 2.0.0` → 闭区间
3. **比较运算符**：`>=1.0.0`、`<=2.0.0`、`>1.0.0`、`<2.0.0`
4. **Caret/Tilde**：`^1.0.0`、`~1.0.0` → 简化处理为 `major 相同且 minor >= 指定`

### 3.2 许可证提取的数据源与多格式处理

**数据源**：从 `package.json` 的 `license` 字段读取 [L196](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L196)

**多格式处理**（在 `auditLicenses()` [L364-L369](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L364-L369) 中）：

```javascript
let lic = pkg.license || 'UNKNOWN';
if (typeof lic === 'object') {
  lic = lic.type || JSON.stringify(lic);
}
if (Array.isArray(lic)) {
  lic = lic.map(l => typeof l === 'object' ? l.type : l).join(' OR ');
}
lic = String(lic);
```

支持的格式：
1. **字符串**：`"MIT"` → 直接使用
2. **对象**：`{ "type": "MIT", "url": "..." }` → 取 `type` 字段
3. **数组**：`["MIT", "Apache-2.0"]` → 用 `" OR "` 连接
4. **对象数组**：`[{type: "MIT"}, {type: "Apache"}]` → 提取每个 `type` 后连接
5. **缺失**：使用 `"UNKNOWN"`

### 3.3 传染性许可证判定规则 [L354-L378](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L354-L378)

```javascript
const INFECTIOUS = ['GPL', 'LGPL', 'AGPL', 'GPL-2.0', 'GPL-3.0', 
                    'LGPL-2.0', 'LGPL-3.0', 'AGPL-3.0'];
const isInfectious = INFECTIOUS.some(i => lic.toUpperCase().includes(i));
```

**判定逻辑**：
- 将许可证字符串转为大写
- 使用 `includes()` 检查是否包含任何传染性许可证关键词
- 采用 **子串匹配** 而非精确匹配，确保 `GPL-3.0-only` 等变体也能被识别

---

## 四、新增功能模块分析

### 4.1 `diff` 命令：对比两个 package.json [L609-L694](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L609-L694)

**实现原理**：
1. 读取两个 `package.json` 文件
2. 合并 `dependencies` 和 `devDependencies`
3. 创建包名并集 `allNames = new Set([...oldDeps, ...newDeps])`
4. 遍历并分类：
   - 新增：在新文件有、旧文件无
   - 删除：在旧文件有、新文件无
   - 升级/降级：使用 `compareVersions()` 比较版本号
   - 范围变更：版本号相同但范围符号不同（如 `^1.0.0` → `~1.0.0`）

### 4.2 `lockfile` 命令：解析 package-lock.json [L696-L789](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L696-L789)

**实现原理**：
1. 支持 lockfile v1 和 v2 两种格式
   - **v2+**：直接读取 `packages` 字段，键为路径
   - **v1**：递归扁平化 `dependencies` 树，保留嵌套路径信息
2. 对比 `package.json` 中的版本范围与 lock 文件的锁定版本
3. 使用 `versionInRange()` 验证锁定版本是否在声明范围内

### 4.3 `why` 命令：解释包为什么存在 [L791-L850](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L791-L850)

**路径搜索算法：DFS（深度优先搜索）**

```javascript
function findPaths(node, currentPath) {
  const newPath = [...currentPath, node.name + '@' + node.version];
  if (node.name === packageName) {
    paths.push(newPath); // 找到目标，记录路径
  }
  for (const child of Object.values(node.children)) {
    findPaths(child, newPath); // 递归深入（DFS）
  }
}
```

**算法特点**：
- 采用 **先序遍历**，访问节点时先检查是否为目标
- 不使用 `visited` 去重，确保找到所有可能的路径
- 路径记录完整的祖先链，便于展示依赖传递关系

### 4.4 `policy` 命令：依赖策略合规检查 [L890-L1062](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L890-L1062)

#### 简易 YAML 解析器：`parseSimpleYAML()` [L853-L888](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L853-L888)

自实现的轻量级 YAML 解析器，支持：
- 键值对：`key: value`
- 数组：`key:\n  - item1\n  - item2`
- 注释：`# comment`
- 字符串去引号、数字自动转换

#### 规则匹配引擎：

```javascript
// 1. 加载配置
const policy = parseSimpleYAML(policyText);

// 2. 构建依赖树
const { tree, allPackages } = buildDependencyTree(resolved);

// 3. 逐条执行规则
if (policy.blacklist) { /* 检查黑名单 */ }
if (policy['allowed-licenses']) { /* 检查许可证白名单 */ }
if (policy['max-deps']) { /* 检查依赖数量上限 */ }
if (policy['max-depth']) { /* 检查嵌套深度 */ }
if (policy['no-range']) { /* 检查精确版本 */ }
```

**支持的规则**：
| 规则 | 描述 | 严重度 |
|------|------|--------|
| `blacklist` | 禁止使用的包列表 | critical |
| `allowed-licenses` | 许可证白名单 | high |
| `max-deps` | 依赖数量上限 | medium |
| `max-depth` | 嵌套深度上限 | medium |
| `no-range` | 要求精确版本号 | low |

### 4.5 `suggest` 命令：包替换建议 [L1064-L1103](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L1064-L1103)

**实现原理**：
1. 读取 `replacements.json` 知识库
2. 遍历项目的直接依赖
3. 在知识库中查找匹配项
4. 输出替代方案、体积节省、兼容性评分、迁移提示

知识库结构见 [replacements.json](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/replacements.json)。

### 4.6 `slim` 命令：依赖瘦身分析 [L1105-L1305](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L1105-L1305)

**代码扫描支持三种导入模式**：

#### 模式 1：`require()` 调用
```javascript
const requirePattern = /(?:require\(\s*['"]([^'"]+)['"]\s*\))/g;
const assignRequirePattern = /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
```

#### 模式 2：`import` 语句
```javascript
const importPattern = /(?:import\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]
                      |import\s+['"]([^'"]+)['"]
                      |import\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"])/g;
```

#### 模式 3：解构赋值
```javascript
const destructureRequirePattern = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
const varDestructurePattern = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(\w+)/g;
```

**扫描流程**：
1. 递归扫描 `.js/.ts/.jsx/.tsx/.mjs/.cjs` 文件
2. 跳过 `node_modules`、`.git`、`dist`、`build`、`coverage` 目录
3. 使用正则匹配提取导入信息
4. 记录 `importMap[depName] = Set<usage>`，usage 可能是：
   - `*`：整包导入
   - `fn:xxx`：命名导入的函数
   - `sub/path`：子路径导入
5. 分析优化建议：
   - 整包导入但只用少量函数 → 建议子路径导入
   - 已有子路径导入 → 确认路径正确性
   - 匹配知识库 → 提供更轻量替代方案

---

## 五、数据流与输出格式

### 5.1 数据结构转换流程

```
原始文件系统
    │
    ▼
buildDependencyTree() ──> tree (嵌套对象)
    │                    allPackages (扁平数组)
    │                    versionConflicts (冲突信息)
    │
    ├───────────────────────────────────────────┐
    │                                           │
    ▼                                           ▼
printTree() ──> 控制台文本树            analyzeSizes() ──> sizeAnalysis
                                                  │
                                                  ├─> top20 (体积排序)
                                                  └─> exclusiveSavings (独占依赖)
    │
    ├───────────────────────────────────────────┐
    │                                           │
    ▼                                           ▼
generateDot() ──> DOT 图字符串          generateHTML() ──> HTML 报告
                                                  │
                                                  ├─> pieToSVG() ──> SVG 饼图
                                                  └─> treeHTML() ──> HTML 树
    │
    ▼
JSON 导出 ──> 完整结构化数据
```

### 5.2 HTML 报告中 SVG 饼图生成算法 [L435-L452](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js#L435-L452)

```javascript
function pieToSVG(data, cx, cy, r) {
  const total = data.reduce((s, d) => s + d.value, 0);
  let startAngle = -Math.PI / 2; // 从 12 点钟方向开始
  let paths = '';
  
  for (const d of data) {
    // 1. 计算扇形角度
    const angle = (d.value / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    
    // 2. 计算起点和终点坐标
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    
    // 3. 判断是否为大弧（>180度）
    const large = angle > Math.PI ? 1 : 0;
    
    // 4. 生成 SVG path
    paths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" 
             fill="${d.color}" stroke="#fff" stroke-width="1"/>`;
    
    startAngle = endAngle;
  }
  return paths;
}
```

**SVG Path 命令解析**：
- `M cx,cy`：移动到圆心
- `L x1,y1`：画直线到扇形起点
- `A r,r 0 large 1 x2,y2`：画圆弧到扇形终点
  - `r,r`：x/y 半径
  - `0`：x 轴旋转角度
  - `large`：大弧标志（1 表示 >180°）
  - `1`：扫掠方向（1 表示顺时针）
- `Z`：闭合路径

### 5.3 输出格式汇总

| 格式 | 生成函数 | 特点 |
|------|----------|------|
| 控制台文本 | `printTree()` | 树形结构，带连线符号（├──、└──） |
| DOT 图 | `generateDot()` | Graphviz 格式，可渲染为图片 |
| HTML 报告 | `generateHTML()` | 包含统计卡片、表格、SVG 饼图 |
| JSON | 直接序列化 | 完整结构化数据，便于程序处理 |

---

## 六、核心文件清单

| 文件 | 作用 |
|------|------|
| [depanalyze.js](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/depanalyze.js) | 主程序，包含所有分析逻辑 |
| [vulnerabilities.json](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/vulnerabilities.json) | 漏洞知识库，CVE 数据 |
| [replacements.json](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/replacements.json) | 包替换建议知识库 |
| [setup-sample.js](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/setup-sample.js) | 示例项目生成脚本 |
| [sample-project/.depolicy.yaml](file:///Users/huwenjie/项目/胡文杰题目汇总/项目/hwj-00456/sample-project/.depolicy.yaml) | 依赖策略配置模板 |
