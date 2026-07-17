# Pre-Completion Verification Checklist

Before considering your work complete, verify the following:

- [ ] **Product requirements respected**: Does this match `PRODUCT.md`?
- [ ] **Architecture respected**: Does this match `ARCHITECTURE.md` without introducing unauthorized dependencies?
- [ ] **Security preserved**: Are the boundaries maintained per `ENGINEERING.md`?
- [ ] **Maintainability**: Is the code simple and readable?
- [ ] **Documentation synchronized**: Are inline docs and implementation notes accurate?
- [ ] **No duplicated logic**: Are you reusing existing utilities from `packages/shared`?
- [ ] **No unnecessary dependencies**: Did you avoid adding new NPM packages unless absolutely necessary?
- [ ] **Specification still correct**: If you found a flaw in the Blueprint, did you create a Change Proposal instead of silently working around it?
