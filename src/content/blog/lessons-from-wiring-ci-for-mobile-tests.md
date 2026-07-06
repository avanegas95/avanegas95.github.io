---
title: "Lessons from wiring CI for mobile tests"
description: "Practical takeaways from getting Appium suites running in a pipeline — flakiness, artifacts, and what to fix first."
pubDate: 2026-05-12
tags: ["automation", "ci-cd"]
featured: true
cover:
  src: "/images/blog-placeholder.jpg"
  alt: "Placeholder cover — CI pipeline and mobile test automation"
---

Moving mobile tests from "works on my machine" to a CI pipeline taught me more about **reliability** than any single test case. These are the patterns that stuck — framed generically so they apply beyond one stack.

## Problem

Local runs were green. CI was a coin flip. Failures were hard to diagnose because logs lived on an agent that disappeared after the job.

## What I tried

1. **Treat the pipeline as a product** — version the test runner image, pin dependencies, and document emulator/simulator assumptions in the README, not in Slack.
2. **Collect artifacts on failure** — screenshots, page source, and device logs turned intermittent failures into actionable bugs instead of "CI is flaky."

![Placeholder inline image — example of an artifact screenshot in a post](/images/blog-placeholder.jpg)
3. **Split fast checks from slow suites** — smoke tests on every PR; full regression on a schedule or before release.

## What worked

- **Explicit waits over fixed sleeps** — every `sleep(5)` in CI is a future 3 a.m. page.
- **One device profile per job** — mixing OS versions in the same matrix without isolating failures wastes time.
- **Retry only at the infrastructure layer** — retrying assertions hides product bugs; retrying a stuck emulator boot is fair game.

## Takeaway

CI for mobile is less about Appium syntax and more about **observability and repeatability**. Fix the pipeline until a failure tells you *what* broke; then fix the test.

When I syndicate engineering posts elsewhere, the canonical version will always point back here.
