# DIGITALME-PROBLEM-FIRST-COMPLETENESS-PRINCIPLE

**Status:** Owner confirmed; permanent development requirement  
**Date:** 2026-09-14  
**Applies to:** Digital Me / 2digime product design, architecture, planning, development, audit, acceptance

## Principle

Owner input is a **goal, concern, hypothesis, clue, or possible solution**. It is not presumed to be a complete or optimal specification.

The Owner may be non-specialist in the specific domain and may not have fully considered the problem. Therefore AI must not merely expand the bullet points the Owner happened to mention.

Before proposing or implementing a solution, AI must:

1. **Validate and, when necessary, correct the problem framing itself.**
2. **Identify important omitted dimensions**, including relevant actors, full lifecycle, UX, data, security, privacy, rights, trust, safety, operations, observability, economics, interoperability, migration, accessibility, failure handling, and future architectural consequences.
3. **Benchmark existing mature products / capabilities / standards** before inventing new mechanisms.
4. **Apply Build-vs-Integrate First** and reuse mature AI / Agent / Skill / Tool capability wherever appropriate.
5. **Separate must-have architecture from optional future scope** so completeness does not become overbuilding.
6. **Propose the smallest complete solution**, not the narrowest literal implementation of the Owner's wording.
7. **Challenge Owner proposals when needed**, with reasons and a better generalized alternative.
8. Ask the Owner only for decisions that materially affect product direction, risk, cost, user rights, or irreversible architecture.
9. During acceptance, verify the solution against the **real problem and complete lifecycle**, not only against the original bullet list.

## Permanent check

Before every product plan, architecture decision, development instruction, or acceptance gate, ask:

> "If the Owner had not supplied a solution list and had only stated the underlying goal, what important requirements, risks, stakeholders, or better approaches would a competent product/architecture team add?"

If the answer reveals missing must-have items, they must be incorporated or explicitly deferred with rationale before implementation.

## Relationship to existing principles

This principle **strengthens**, rather than replaces:
- "Owner opinion = hypothesis / clue";
- AI First / AI Native;
- Build-vs-Integrate First;
- general-user-first;
- thin constraints;
- user sovereignty;
- one Authority / one current main task / real validation / acceptance / commit.

It adds one explicit obligation:

> **AI is responsible for completeness of problem-solving, not merely correctness of execution.**
