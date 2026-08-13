# FIX-23 CTO Gate — PASSED (product chain)

- verdict: `revision_completion_gate_fix_23_cto_passed`
- finishedAt: 2026-08-13T03:15:11.927Z
- ownerAccepted: false
- thirdOwnerRuntime: not_started
- black-window violations: 0 (first_exec + revision_exec)
- focused regression: pass=75 fail=0 exitCode=0
- full suite: exitCode=1 pass=533 fail=22 skip=1（历史失败保留；见 runtime-report）

## Product chain

plan v1 → NL v2 (jobs=0) → confirm → first Codex (user_selected nongit) → Artifact v1 + CTO5
→ consult (jobs 不变) → Owner「改成 done」→ Job2 `succeeded`
→ 同一 Artifact ID，headVersionId 变化，versions 1→2，note=Owner 原文
→ 文件=`done` → 新五项 CTO（与首次不同）→ ownerDecision=undecided
→ 重启：非失败 UI、两 Job、版本链、最新 CTO

## False-positive eliminated

旧闸门用「已有 headVersionId」放行。本闸门要求 headVersionId 变化且 versions 严格增加，且第二 Job `status=succeeded`。

## Full suite

历史失败保留（含 `software-development-task-ux` 3 项、coding onboarding、document-capability-none、corrective-18 #8 与 FIX-22 路由语义冲突）。
触及文件的聚焦回归 75/0；D11-A 意图评测单独复跑 falseExecution=0。
