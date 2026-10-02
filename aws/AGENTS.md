# AWS trial files

## Purpose
Prepare a bounded EC2 trial of the Linux bot. This directory owns the launch script, its instance stop guard, and the scoped policy example.

## Run / test
From the repository root: `bash -n aws/launch-test.sh aws/user-data.sh`, `node --test aws/launch-test.test.js`, `git diff --check`.

## Debug
The launch script prints its plan and AWS dry-run result. Inspect the instance state in the EC2 console after any paid launch; do not log account identifiers or keys.

## Landmines
Never launch a billable instance as part of an offline check. A stopped instance retains EBS charges, and a dry run must report AWS denials instead of claiming success.

## Last updated
2026-10-02
