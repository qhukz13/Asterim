# Code Review Order

When reviewing code (yours or others), evaluate in this exact order:

1. **Product**: Does this solve the problem as defined in the Blueprint?
2. **Architecture**: Does this respect the subsystem boundaries and 5-Level Authority Model?
3. **Code Quality**: Is it maintainable, simple, and tested?
4. **Security**: Are we exposing local paths, tokens, or executing arbitrary code unsafely?
5. **Performance**: Does this impact the Golden Loop latency?
6. **Documentation**: Is the intent clear?

**CRITICAL RULE**: Never approve code that contradicts the Blueprint.
