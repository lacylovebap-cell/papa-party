import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const browserAvailable=fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')&&fs.existsSync('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');

test('status feedback stays above stacked modal dialogs at mobile and desktop widths',{skip:browserAvailable?false:'Run ops/check-overlay-feedback.mjs in the configured browser verification environment'},async()=>{
 const {checkOverlayFeedback}=await import('../ops/check-overlay-feedback.mjs');
 const results=await checkOverlayFeedback();
 assert.equal(results.length,4);
 assert.ok(results.every(result=>result.passed));
});
