#!/usr/bin/env node
/**
 * Batch download upstream BeamBench source files
 */
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

const SHA = '47686d611b7b11121cfaf7be0583aee6ac34e9b0';
const BASE_URL = `https://raw.githubusercontent.com/visuphy/BeamBench/${SHA}`;

const files = [
  'main.js',
  'optics.js',
  'propagation.js',
  'elements.js',
  'sources.js',
  'state.js',
  'beam-frame.js',
  'gizmo-ui.js',
  'ribbon.js',
  'ruler.js',
  'polarization.js'
];

const destDir = path.resolve('src/upstream');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

let downloaded = 0;
let failed = 0;

files.forEach(filename => {
  const url = `${BASE_URL}/${filename}`;
  const filePath = path.join(destDir, filename);
  
  console.log(`Downloading ${filename}...`);
  
  const client = url.startsWith('https') ? https : http;
  
  client.get(url, (res) => {
    if (res.statusCode === 200) {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        fs.writeFileSync(filePath, data, 'utf8');
        const lines = data.split('\n').length;
        console.log(`✓ ${filename}: ${lines} lines (${(data.length / 1024).toFixed(1)} KB)`);
        downloaded++;
        
        if (downloaded + failed === files.length) {
          console.log(`\nSummary: ${downloaded} downloaded, ${failed} failed`);
        }
      });
    } else {
      console.error(`✗ ${filename}: HTTP ${res.statusCode}`);
      failed++;
      if (downloaded + failed === files.length) {
        console.log(`\nSummary: ${downloaded} downloaded, ${failed} failed`);
      }
    }
  }).on('error', (err) => {
    console.error(`✗ ${filename}: ${err.message}`);
    failed++;
    if (downloaded + failed === files.length) {
      console.log(`\nSummary: ${downloaded} downloaded, ${failed} failed`);
    }
  });
});
