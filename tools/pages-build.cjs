'use strict';
// Explicit build: commits made with GITHUB_TOKEN do not automatically rebuild legacy Pages.
const { execFileSync } = require('node:child_process');
const repository = process.env.GITHUB_REPOSITORY;
if (repository !== 'worldofasterion/worldofasterion.github.io') throw new Error('Unexpected production repository');
const expected = process.env.BUILD_SHA || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
function api(args) { return JSON.parse(execFileSync('gh',['api',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']})); }
(async () => {
  api(['--method','POST',`repos/${repository}/pages/builds`]);
  for (let i=0;i<30;i++) {
    await new Promise(resolve => setTimeout(resolve,10000));
    const build = api([`repos/${repository}/pages/builds/latest`]);
    if (build.commit === expected && build.status === 'built') {
      const response = await fetch('https://worldofasterion.github.io/data/social-cloud.js?commit=' + expected,{signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error('Pages build passed but public data did not load');
      const live = await response.text();
      const local = require('node:fs').readFileSync('data/social-cloud.js','utf8');
      if (live.trim() !== local.trim()) throw new Error('Public data does not yet match the deployed revision');
      console.log('Verified GitHub Pages build and public data: ' + expected); return;
    }
    if (build.commit === expected && build.status === 'errored') throw new Error('Pages build failed');
  }
  throw new Error('Pages deployment did not finish within five minutes');
})().catch(() => { console.error('Could not verify the production Pages build; inspect the build in GitHub.'); process.exitCode = 1; });
