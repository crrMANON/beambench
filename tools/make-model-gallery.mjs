import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const evidence = resolve(process.argv[2] || 'artifacts/detailed-models-20261024');
const audit = JSON.parse(readFileSync(join(evidence, 'model-audit.json'), 'utf8'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const sections = audit.cases.map(({ id, type }) => {
  const figures = [['original', '原版'], ['detailed', '精细版对照'], ['front', '精细版正面'], ['back', '精细版背面'], ['side', '精细版侧面']]
    .map(([view, label]) => {
      const file = `${id}-${view}.png`;
      if (!existsSync(join(evidence, 'gallery', file))) throw new Error(`Missing gallery image: ${file}`);
      return `<figure><a href="${escape(file)}"><img loading="lazy" src="${escape(file)}" alt="${escape(id)} ${label}"></a><figcaption>${label}</figcaption></figure>`;
    }).join('');
  return `<section><h2>${escape(id)} <small>${escape(type)}</small></h2><div class="images">${figures}</div></section>`;
}).join('\n');
writeFileSync(join(evidence, 'gallery/index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BeamBench 全类模型对照图册</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#161b22;color:#e6edf3;margin:24px}h1{font-size:25px}h2{font-size:19px}small{font-weight:400;color:#9da7b3}section{border-top:1px solid #39424d;margin-top:24px}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}figure{margin:0}img{width:100%;max-height:340px;object-fit:contain;background:#2f343b}figcaption{text-align:center;color:#bac3cd}a{color:#79c0ff}</style>
<h1>BeamBench 全类模型对照图册</h1><p>${audit.cases.length}个样本，包含全部10种光具类型、参数变体和两类光源；每个样本均带公共底座与立柱。点击图片可查看原尺寸。</p><p>光具的原版/精细版对照采用同一相机操作；光源对照采用各自内容适配的侧视图。精细版正面指工作面或出光面。场景、照明和界面均沿用原版。</p>
${sections}<p><a href="../../../docs/DETAILED_MODELS.md">模型说明</a></p></html>`);
console.log(`Gallery: ${join(evidence, 'gallery/index.html')} (${audit.cases.length} cases)`);
