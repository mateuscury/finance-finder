# Finance Finder

# QA Checkpoint Addendum

> Paste this section into any project's `.claude/CLAUDE.md` to enforce quality gates.

---

## 🔍 Quality Assurance Checkpoints

### BEFORE Implementing Any Feature

1. **Read** `specs/SPEC.md` - locate the specific user story
2. **List** all acceptance criteria for that story
3. **Confirm** with user: "I'll implement [story]. Acceptance criteria: [list]. Correct?"
4. **Only proceed** after confirmation

If `specs/SPEC.md` doesn't exist, prompt user to create it using the `/qa-templates` skill or SPEC_TEMPLATE.md.

### AFTER Implementing

Run quality gate in sequence:

1. **Spec Fidelity** (always): Run `/qa-spec-fidelity`, verify against original spec
2. **Code Quality** (always): Run `/qa-code-quality`, check standards

### BEFORE Commit/PR

Additional gates:

3. **Maintainability**: Run `/qa-maintainability`, verify 3-month readability

### FOR User-Facing Features

4. **UX Quality**: Run `/qa-ux`, test against `specs/PERSONAS.md`

### WHEN User Says "Full QA" or "Audit"

Run all 5 gates in sequence:
1. qa-spec-fidelity
2. qa-code-quality
3. qa-utility
4. qa-maintainability
5. qa-ux (if PERSONAS.md exists)

Produce combined report.

---

## 🚨 Drift Prevention Rules

**STOP and check spec** when you find yourself:
- Saying "While I'm here, I'll also..."
- Adding features not explicitly in acceptance criteria
- Making assumptions about what users "probably want"
- Building flexibility "for future use"

**ASK user** before:
- Adding anything not in spec
- Changing accepted implementation approach
- Removing functionality (even if it seems redundant)

---

## 📁 Expected Project Structure

```
project/
├── .claude/
│   └── CLAUDE.md          # (this file)
├── specs/
│   ├── SPEC.md            # Living specification (from template)
│   ├── PERSONAS.md        # User personas (from template)
│   └── CHANGELOG.md       # Spec changes over time
├── src/                   # Source code
└── tests/                 # Test files
```

---

## 🔗 Skill Invocations

All skills are invoked via slash commands. The skill system resolves paths automatically.

| Skill | Command | Purpose |
|-------|---------|---------|
| Spec Fidelity | `/qa-spec-fidelity` | Verify implementation matches spec |
| Code Quality | `/qa-code-quality` | Check internal code standards |
| Utility | `/qa-utility` | Test functionality works |
| Maintainability | `/qa-maintainability` | Ensure long-term readability |
| UX | `/qa-ux` | Validate user experience |
| All Skills | `/qa-all` | Run comprehensive QA pass |
| Templates | `/qa-templates` | Get project setup templates |
