# GitHub automation

## Purpose
Keep account-free checks for the Linux port and AWS trial scripts. Workflows must never launch paid resources or join a meeting.

## Run / test
From the repository root: `npm run check`, `node --test aws/launch-test.test.js`, `git diff --check`.

## Debug
Read the failed GitHub Actions step log. Browser and audio checks run on Ubuntu ARM64 with synthetic local media.

## Landmines
Keep credentials and meeting media out of workflow artifacts and logs. Never treat runner-only results as receiver-verified evidence.

## Last updated
2026-10-02
