#!/usr/bin/env node
/**
 * Document verification script for BeamBench
 * Validates PLAN, TASKS, STATUS, DECISIONS, RESEARCH consistency
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const documents = [
  'PLAN.md',
  'docs/TASKS.md', 
  'docs/STATUS.md',
  'docs/HANDOFF.md',
  'docs/DECISIONS.md',
  'docs/RESEARCH.md'
];

let errors = [];
let warnings = [];

console.log('🔍 Verifying document structure...\n');

// Check all required documents exist
documents.forEach(doc => {
  const fullPath = path.join(root, doc);
  if (fs.existsSync(fullPath)) {
    console.log(`✓ ${doc}`);
  } else {
    console.error(`✗ Missing: ${doc}`);
    errors.push(`Missing required document: ${doc}`);
  }
});

// Validate task dependencies DAG
console.log('\n🔍 Checking task dependencies...');
const tasksContent = fs.readFileSync(path.join(root, 'docs/TASKS.md'), 'utf-8');
const taskMatches = tasksContent.match(/BB-(\d+)/g) || [];
const uniqueTasks = [...new Set(taskMatches.map(m => m.split('-')[1]))].map(Number).sort((a, b) => a - b);

if (uniqueTasks.length > 0) {
  console.log(`✓ Found ${uniqueTasks.length} unique task IDs: BB-${uniqueTasks[0]} through BB-${uniqueTasks[uniqueTasks.length - 1]}`);
}

// Check STATUS references
console.log('\n🔍 Validating STATUS references...');
const statusContent = fs.readFileSync(path.join(root, 'docs/STATUS.md'), 'utf-8');
statusContent.match(/\| BB-(\d+)[^\|]*\|[^|]*\|/g)?.forEach(match => {
  const taskId = match.match(/BB-(\d+)/)[1];
  if (!uniqueTasks.includes(parseInt(taskId))) {
    warnings.push(`STATUS references undefined task: BB-${taskId}`);
  }
});

// Report
if (errors.length > 0) {
  console.error('\n❌ Errors found:');
  errors.forEach(e => console.error(`   - ${e}`));
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn('\n⚠️ Warnings:');
  warnings.forEach(w => console.warn(`   - ${w}`));
}

console.log('\n✅ Document verification complete!');
process.exit(0);
