# Queueless

A smart public-service queue platform, built for hackathon problem P03. The demo preset is a Hospital OPD.
Monorepo layout: `apps/mobile` (Expo patient app), `apps/web` (Next.js admin, counter and TV display), `supabase/` (self-hosted, trimmed).

## Git rules (mandatory)

- Commit after EVERY small working step: one logical change per commit. Never batch.
- Push to `origin main` right after every commit.
- The author is set in the local git config. Do not change it.
- Every commit message ends with these trailers, exactly:

```
Co-authored-by: Raghav <315327454+Raghav2477@users.noreply.github.com>
Co-authored-by: Satyam Singh <323049544+singhsatyam3829@users.noreply.github.com>
```

- Use conventional commit subjects: `feat:`, `fix:`, `chore:`, `docs:`, `test:`.
- No AI attribution. No "Generated with" line, and no Claude or Anthropic co-author.
- Never commit secrets. `.env*` files are gitignored; commit only `.env.example` with placeholders.

## Judge notes

After each feature, append a short plain-English note to `docs/JUDGE_NOTES.md`: what was built, how it works, and why that approach was chosen.
