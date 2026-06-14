#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, 'sample-project');
const nm = path.join(base, 'node_modules');

const packages = {
  root: {
    name: 'sample-project',
    version: '1.0.0',
    license: 'MIT',
    dependencies: {
      'express': '^4.17.1',
      'lodash': '4.17.20',
      'axios': '^0.21.1',
      'moment': '^2.29.1',
      'dotenv': '^10.0.0',
      'jsonwebtoken': '^8.5.1',
      'mongoose': '^5.13.0',
      'cors': '^2.8.5',
      'helmet': '^4.6.0',
      'morgan': '^1.10.0',
      'chalk': '^4.1.1',
      'commander': '^8.0.0',
      'ws': '^7.4.0',
      'node-fetch': '^2.6.1',
      'minimist': '^1.2.5'
    }
  },
  'express': {
    name: 'express', version: '4.17.1', license: 'MIT',
    dependencies: {
      'accepts': '~1.3.7', 'array-flatten': '1.1.1', 'body-parser': '1.19.0',
      'content-disposition': '0.5.3', 'content-type': '~1.0.4', 'cookie': '0.4.0',
      'cookie-signature': '1.0.6', 'debug': '2.6.9', 'depd': '~1.1.2',
      'encodeurl': '~1.0.2', 'escape-html': '~1.0.3', 'etag': '~1.8.1',
      'finalhandler': '~1.1.2', 'fresh': '0.5.2', 'merge-descriptors': '1.0.1',
      'methods': '~1.1.2', 'on-finished': '~2.3.0', 'parseurl': '~1.3.3',
      'path-to-regexp': '0.1.7', 'proxy-addr': '~2.0.5', 'qs': '6.7.0',
      'range-parser': '~1.2.1', 'safe-buffer': '5.1.2', 'send': '0.17.1',
      'serve-static': '1.14.1', 'setprototypeof': '1.1.1', 'statuses': '~1.5.0',
      'type-is': '~1.6.18', 'utils-merge': '1.0.1', 'vary': '~1.1.2'
    }
  },
  'accepts': { name: 'accepts', version: '1.3.8', license: 'MIT', dependencies: { 'mime-types': '~2.1.34', 'negotiator': '0.6.3' } },
  'mime-types': { name: 'mime-types', version: '2.1.35', license: 'MIT', dependencies: { 'mime-db': '1.52.0' } },
  'mime-db': { name: 'mime-db', version: '1.52.0', license: 'MIT', dependencies: {} },
  'negotiator': { name: 'negotiator', version: '0.6.3', license: 'MIT', dependencies: {} },
  'array-flatten': { name: 'array-flatten', version: '1.1.1', license: 'MIT', dependencies: {} },
  'body-parser': { name: 'body-parser', version: '1.19.0', license: 'MIT', dependencies: { 'bytes': '3.1.0', 'content-type': '~1.0.4', 'debug': '2.6.9', 'depd': '~1.1.2', 'http-errors': '1.7.2', 'iconv-lite': '0.4.24', 'on-finished': '~2.3.0', 'qs': '6.7.0', 'raw-body': '2.4.0', 'type-is': '~1.6.17' } },
  'content-disposition': { name: 'content-disposition', version: '0.5.3', license: 'MIT', dependencies: { 'safe-buffer': '5.1.2' } },
  'content-type': { name: 'content-type', version: '1.0.4', license: 'MIT', dependencies: {} },
  'cookie': { name: 'cookie', version: '0.4.0', license: 'MIT', dependencies: {} },
  'cookie-signature': { name: 'cookie-signature', version: '1.0.6', license: 'MIT', dependencies: {} },
  'debug': { name: 'debug', version: '2.6.9', license: 'MIT', dependencies: { 'ms': '2.0.0' } },
  'ms': { name: 'ms', version: '2.0.0', license: 'MIT', dependencies: {} },
  'depd': { name: 'depd', version: '1.1.2', license: 'MIT', dependencies: {} },
  'encodeurl': { name: 'encodeurl', version: '1.0.2', license: 'MIT', dependencies: {} },
  'escape-html': { name: 'escape-html', version: '1.0.3', license: 'MIT', dependencies: {} },
  'etag': { name: 'etag', version: '1.8.1', license: 'MIT', dependencies: {} },
  'finalhandler': { name: 'finalhandler', version: '1.1.2', license: 'MIT', dependencies: { 'debug': '2.6.9', 'encodeurl': '~1.0.2', 'escape-html': '~1.0.3', 'on-finished': '~2.3.0', 'parseurl': '~1.3.3', 'statuses': '~1.5.0', 'unpipe': '~1.0.0' } },
  'fresh': { name: 'fresh', version: '0.5.2', license: 'MIT', dependencies: {} },
  'merge-descriptors': { name: 'merge-descriptors', version: '1.0.1', license: 'MIT', dependencies: {} },
  'methods': { name: 'methods', version: '1.1.2', license: 'MIT', dependencies: {} },
  'on-finished': { name: 'on-finished', version: '2.3.0', license: 'MIT', dependencies: { 'ee-first': '1.1.1' } },
  'ee-first': { name: 'ee-first', version: '1.1.1', license: 'MIT', dependencies: {} },
  'parseurl': { name: 'parseurl', version: '1.3.3', license: 'MIT', dependencies: {} },
  'path-to-regexp': { name: 'path-to-regexp', version: '0.1.7', license: 'MIT', dependencies: {} },
  'proxy-addr': { name: 'proxy-addr', version: '2.0.7', license: 'MIT', dependencies: { 'forwarded': '0.2.0', 'ipaddr.js': '1.9.1' } },
  'forwarded': { name: 'forwarded', version: '0.2.0', license: 'MIT', dependencies: {} },
  'ipaddr.js': { name: 'ipaddr.js', version: '1.9.1', license: 'MIT', dependencies: {} },
  'qs': { name: 'qs', version: '6.7.0', license: 'BSD-3-Clause', dependencies: {} },
  'range-parser': { name: 'range-parser', version: '1.2.1', license: 'MIT', dependencies: {} },
  'safe-buffer': { name: 'safe-buffer', version: '5.1.2', license: 'MIT', dependencies: {} },
  'send': { name: 'send', version: '0.17.1', license: 'MIT', dependencies: { 'debug': '2.6.9', 'depd': '~1.1.2', 'destroy': '~1.0.4', 'encodeurl': '~1.0.2', 'escape-html': '~1.0.3', 'etag': '~1.8.1', 'fresh': '0.5.2', 'http-errors': '~1.7.2', 'mime': '1.6.0', 'ms': '2.1.1', 'on-finished': '~2.3.0', 'range-parser': '~1.2.1', 'statuses': '~1.5.0' } },
  'destroy': { name: 'destroy', version: '1.0.4', license: 'MIT', dependencies: {} },
  'http-errors': { name: 'http-errors', version: '1.7.2', license: 'MIT', dependencies: { 'depd': '~1.1.2', 'inherits': '2.0.3', 'setprototypeof': '1.1.1', 'statuses': '>= 1.5.0 < 2', 'toidentifier': '1.0.0' } },
  'inherits': { name: 'inherits', version: '2.0.3', license: 'ISC', dependencies: {} },
  'mime': { name: 'mime', version: '1.6.0', license: 'MIT', dependencies: {} },
  'ms2': { name: 'ms', version: '2.1.1', license: 'MIT', dependencies: {} },
  'serve-static': { name: 'serve-static', version: '1.14.1', license: 'MIT', dependencies: { 'encodeurl': '~1.0.2', 'escape-html': '~1.0.3', 'parseurl': '~1.3.3', 'send': '0.17.1' } },
  'setprototypeof': { name: 'setprototypeof', version: '1.1.1', license: 'ISC', dependencies: {} },
  'statuses': { name: 'statuses', version: '1.5.0', license: 'MIT', dependencies: {} },
  'type-is': { name: 'type-is', version: '1.6.18', license: 'MIT', dependencies: { 'media-typer': '0.3.0', 'mime-types': '~2.1.24' } },
  'media-typer': { name: 'media-typer', version: '0.3.0', license: 'MIT', dependencies: {} },
  'utils-merge': { name: 'utils-merge', version: '1.0.1', license: 'MIT', dependencies: {} },
  'vary': { name: 'vary', version: '1.1.2', license: 'MIT', dependencies: {} },
  'unpipe': { name: 'unpipe', version: '1.0.0', license: 'MIT', dependencies: {} },
  'toidentifier': { name: 'toidentifier', version: '1.0.0', license: 'MIT', dependencies: {} },
  'bytes': { name: 'bytes', version: '3.1.0', license: 'MIT', dependencies: {} },
  'iconv-lite': { name: 'iconv-lite', version: '0.4.24', license: 'MIT', dependencies: { 'safer-buffer': '>= 2.1.2 < 3' } },
  'safer-buffer': { name: 'safer-buffer', version: '2.1.2', license: 'MIT', dependencies: {} },
  'raw-body': { name: 'raw-body', version: '2.4.0', license: 'MIT', dependencies: { 'bytes': '3.1.0', 'http-errors': '1.7.2', 'iconv-lite': '0.4.24', 'unpipe': '1.0.0' } },

  'lodash': { name: 'lodash', version: '4.17.20', license: 'MIT', dependencies: {} },

  'axios': {
    name: 'axios', version: '0.21.1', license: 'MIT',
    dependencies: { 'follow-redirects': '^1.10.0' }
  },
  'follow-redirects': { name: 'follow-redirects', version: '1.14.1', license: 'MIT', dependencies: {} },

  'moment': { name: 'moment', version: '2.29.1', license: 'MIT', dependencies: {} },

  'dotenv': { name: 'dotenv', version: '10.0.0', license: 'BSD-2-Clause', dependencies: {} },

  'jsonwebtoken': {
    name: 'jsonwebtoken', version: '8.5.1', license: 'MIT',
    dependencies: { 'jws': '^3.2.2', 'lodash': '^4.17.20', 'ms': '^2.1.1', 'semver': '^5.6.0' }
  },
  'jws': { name: 'jws', version: '3.2.2', license: 'MIT', dependencies: { 'jwa': '^1.4.1', 'safe-buffer': '^5.0.1' } },
  'jwa': { name: 'jwa', version: '1.4.1', license: 'MIT', dependencies: { 'buffer-equal-constant-time': '1.0.1', 'ecdsa-sig-formatter': '1.0.11', 'safe-buffer': '^5.0.1' } },
  'buffer-equal-constant-time': { name: 'buffer-equal-constant-time', version: '1.0.1', license: 'BSD-3-Clause', dependencies: {} },
  'ecdsa-sig-formatter': { name: 'ecdsa-sig-formatter', version: '1.0.11', license: 'Apache-2.0', dependencies: { 'safe-buffer': '^5.0.1' } },
  'semver': { name: 'semver', version: '5.7.1', license: 'ISC', dependencies: {} },

  'mongoose': {
    name: 'mongoose', version: '5.13.0', license: 'MIT',
    dependencies: {
      'bson': '^1.1.4', 'kareem': '2.3.2', 'mongodb': '3.6.8',
      'mpath': '0.8.3', 'mquery': '3.2.5', 'ms': '2.1.2',
      'regexp-clone': '1.0.0', 'safe-buffer': '5.2.1', 'sift': '13.5.2',
      'sliced': '1.0.1'
    }
  },
  'bson': { name: 'bson', version: '1.1.6', license: 'Apache-2.0', dependencies: {} },
  'kareem': { name: 'kareem', version: '2.3.2', license: 'Apache-2.0', dependencies: {} },
  'mongodb': { name: 'mongodb', version: '3.6.8', license: 'Apache-2.0', dependencies: { 'bson': '^1.1.4', 'denque': '^1.4.1', 'optional-require': '^1.0.3', 'safe-buffer': '^5.1.2' } },
  'denque': { name: 'denque', version: '1.5.0', license: 'Apache-2.0', dependencies: {} },
  'optional-require': { name: 'optional-require', version: '1.0.3', license: 'Apache-2.0', dependencies: {} },
  'mpath': { name: 'mpath', version: '0.8.3', license: 'MIT', dependencies: {} },
  'mquery': { name: 'mquery', version: '3.2.5', license: 'MIT', dependencies: { 'debug': '3.1.0', 'regexp-clone': '1.0.0', 'safe-buffer': '5.1.2', 'sliced': '1.0.1' } },
  'regexp-clone': { name: 'regexp-clone', version: '1.0.0', license: 'MIT', dependencies: {} },
  'safe-buffer2': { name: 'safe-buffer', version: '5.2.1', license: 'MIT', dependencies: {} },
  'sift': { name: 'sift', version: '13.5.2', license: 'MIT', dependencies: {} },
  'sliced': { name: 'sliced', version: '1.0.1', license: 'MIT', dependencies: {} },
  'debug2': { name: 'debug', version: '3.1.0', license: 'MIT', dependencies: { 'ms': '2.0.0' } },
  'ms3': { name: 'ms', version: '2.1.2', license: 'MIT', dependencies: {} },

  'cors': {
    name: 'cors', version: '2.8.5', license: 'MIT',
    dependencies: { 'object-assign': '^4', 'vary': '^1' }
  },
  'object-assign': { name: 'object-assign', version: '4.1.1', license: 'MIT', dependencies: {} },

  'helmet': {
    name: 'helmet', version: '4.6.0', license: 'MIT',
    dependencies: {}
  },

  'morgan': {
    name: 'morgan', version: '1.10.0', license: 'MIT',
    dependencies: { 'basic-auth': '~2.0.1', 'debug': '2.6.9', 'depd': '~2.0.0', 'on-finished': '~2.3.0', 'on-headers': '~1.0.2' }
  },
  'basic-auth': { name: 'basic-auth', version: '2.0.1', license: 'MIT', dependencies: { 'safe-buffer': '5.1.2' } },
  'depd2': { name: 'depd', version: '2.0.0', license: 'MIT', dependencies: {} },
  'on-headers': { name: 'on-headers', version: '1.0.2', license: 'MIT', dependencies: {} },

  'chalk': {
    name: 'chalk', version: '4.1.1', license: 'MIT',
    dependencies: { 'ansi-styles': '^4.1.0', 'supports-color': '^7.1.0' }
  },
  'ansi-styles': { name: 'ansi-styles', version: '4.3.0', license: 'MIT', dependencies: { 'color-convert': '^2.0.1' } },
  'color-convert': { name: 'color-convert', version: '2.0.1', license: 'MIT', dependencies: { 'color-name': '~1.1.4' } },
  'color-name': { name: 'color-name', version: '1.1.4', license: 'MIT', dependencies: {} },
  'supports-color': { name: 'supports-color', version: '7.2.0', license: 'MIT', dependencies: { 'has-flag': '^4.0.0' } },
  'has-flag': { name: 'has-flag', version: '4.0.0', license: 'MIT', dependencies: {} },

  'commander': { name: 'commander', version: '8.0.0', license: 'MIT', dependencies: {} },

  'ws': { name: 'ws', version: '7.4.0', license: 'MIT', dependencies: {} },

  'node-fetch': { name: 'node-fetch', version: '2.6.1', license: 'MIT', dependencies: { 'whatwg-url': '^5.0.0' } },
  'whatwg-url': { name: 'whatwg-url', version: '5.0.0', license: 'MIT', dependencies: { 'tr46': '~0.0.3', 'webidl-conversions': '^3.0.0' } },
  'tr46': { name: 'tr46', version: '0.0.3', license: 'MIT', dependencies: {} },
  'webidl-conversions': { name: 'webidl-conversions', version: '3.0.1', license: 'BSD-2-Clause', dependencies: {} },

  'minimist': { name: 'minimist', version: '1.2.5', license: 'MIT', dependencies: {} }
};

function mkdir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writePkg(dir, data) {
  mkdir(dir);
  const pkgData = {
    name: data.name,
    version: data.version,
    license: data.license,
    main: 'index.js'
  };
  if (data.dependencies && Object.keys(data.dependencies).length > 0) {
    pkgData.dependencies = data.dependencies;
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgData, null, 2));
  const indexContent = `// ${data.name} v${data.version}\nmodule.exports = {};\n`;
  fs.writeFileSync(path.join(dir, 'index.js'), indexContent);
  const fillerSize = Math.floor(Math.random() * 5000) + 500;
  const fillerContent = 'x'.repeat(fillerSize);
  fs.writeFileSync(path.join(dir, 'lib.js'), fillerContent);
}

mkdir(base);
writePkg(base, packages.root);

const topLevel = [
  'express', 'lodash', 'axios', 'moment', 'dotenv', 'jsonwebtoken', 'mongoose',
  'cors', 'helmet', 'morgan', 'chalk', 'commander', 'ws', 'node-fetch', 'minimist'
];

for (const name of topLevel) {
  const data = packages[name];
  if (data) writePkg(path.join(nm, name), data);
}

const nested = [
  'accepts', 'array-flatten', 'body-parser', 'content-disposition', 'content-type',
  'cookie', 'cookie-signature', 'debug', 'depd', 'encodeurl', 'escape-html', 'etag',
  'finalhandler', 'fresh', 'merge-descriptors', 'methods', 'on-finished', 'parseurl',
  'path-to-regexp', 'proxy-addr', 'qs', 'range-parser', 'safe-buffer', 'send',
  'serve-static', 'setprototypeof', 'statuses', 'type-is', 'utils-merge', 'vary',
  'follow-redirects', 'jws', 'semver', 'bson', 'kareem', 'mongodb', 'mpath', 'mquery',
  'regexp-clone', 'sift', 'sliced', 'object-assign', 'basic-auth', 'on-headers',
  'ansi-styles', 'supports-color', 'commander', 'whatwg-url', 'mime-types', 'negotiator',
  'mime-db', 'bytes', 'iconv-lite', 'raw-body', 'destroy', 'http-errors', 'inherits',
  'mime', 'forwarded', 'ipaddr.js', 'media-typer', 'unpipe', 'toidentifier',
  'safer-buffer', 'jwa', 'buffer-equal-constant-time', 'ecdsa-sig-formatter',
  'denque', 'optional-require', 'has-flag', 'color-convert', 'color-name',
  'tr46', 'webidl-conversions', 'ee-first'
];

for (const name of nested) {
  let data = packages[name];
  if (!data) {
    for (const k of Object.keys(packages)) {
      if (packages[k].name === name) { data = packages[k]; break; }
    }
  }
  if (data) writePkg(path.join(nm, name), data);
}

const msDirs = [
  { dir: path.join(nm, 'debug', 'node_modules', 'ms'), version: '2.0.0' },
  { dir: path.join(nm, 'send', 'node_modules', 'ms'), version: '2.1.1' },
  { dir: path.join(nm, 'mongoose', 'node_modules', 'ms'), version: '2.1.2' },
  { dir: path.join(nm, 'mquery', 'node_modules', 'debug', 'node_modules', 'ms'), version: '2.0.0' }
];

for (const m of msDirs) {
  writePkg(m.dir, { name: 'ms', version: m.version, license: 'MIT', dependencies: {} });
}

const sbDirs = [
  { dir: path.join(nm, 'mongoose', 'node_modules', 'safe-buffer'), version: '5.2.1' }
];
for (const s of sbDirs) {
  writePkg(s.dir, { name: 'safe-buffer', version: s.version, license: 'MIT', dependencies: {} });
}

const debugDirs = [
  { dir: path.join(nm, 'mquery', 'node_modules', 'debug'), version: '3.1.0', deps: { 'ms': '2.0.0' } },
  { dir: path.join(nm, 'morgan', 'node_modules', 'depd'), version: '2.0.0', deps: {} }
];
for (const d of debugDirs) {
  const name = path.basename(d.dir);
  writePkg(d.dir, { name, version: d.version, license: 'MIT', dependencies: d.deps });
}

mkdir(path.join(nm, 'lodash', 'node_modules'));
fs.writeFileSync(path.join(nm, 'lodash', 'README.md'), 'Lodash README with lots of content. '.repeat(500));

mkdir(path.join(nm, 'mongoose', 'lib'));
for (let i = 0; i < 20; i++) {
  fs.writeFileSync(path.join(nm, 'mongoose', 'lib', `schema_${i}.js`), '// large mongoose schema file\n' + 'x'.repeat(10000));
}

mkdir(path.join(nm, 'moment', 'locale'));
const locales = ['en', 'zh-cn', 'zh-tw', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar', 'hi', 'nl', 'pl', 'sv', 'tr', 'vi', 'th', 'id'];
for (const loc of locales) {
  fs.writeFileSync(path.join(nm, 'moment', 'locale', `${loc}.js`), `// moment locale ${loc}\n` + 'x'.repeat(5000));
}

mkdir(path.join(nm, 'mongodb', 'lib'));
for (let i = 0; i < 15; i++) {
  fs.writeFileSync(path.join(nm, 'mongodb', 'lib', `collection_${i}.js`), '// mongodb collection\n' + 'x'.repeat(8000));
}

console.log('✅ Sample project created at:', base);
console.log('   node_modules packages:', topLevel.length + nested.length);
