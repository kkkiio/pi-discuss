# pi-arch-mode development recipes

# Format all source files
fmt:
    npx @biomejs/biome format --write .

# Lint, format check, and type-check (CI-safe, no writes)
check:
    npx @biomejs/biome check .
    npx tsc --noEmit

# Run fast e2e tests (no LLM needed)
# Set DEEPSEEK_API_KEY in env to also run conversation tests
test:
    node --test tests/arch-flow.test.ts
