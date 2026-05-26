# Release Flow

Use this process when preparing a public update.

## 1. Local Checks

Run:

```bash
node --check app.js
git diff --check
```

Then review `RELEASE_CHECKLIST.md`.

## 2. Local Preview

Open `index.html` in a browser and check:

- Desktop front page
- Mobile front page
- Data overview
- Rankings
- Reward lookup
- Announcements
- Lottery results
- Anonymous questions
- Admin overview

## 3. Commit

Create a commit with a clear message.

Example:

```bash
git add .
git commit -m "Add versioning and release documentation"
```

## 4. Push

Push only after local checks pass.

```bash
git push origin main
```

## 5. Netlify Deploy

After push, wait for Netlify to deploy the latest `main` branch.

Check:

- Deploy status is successful.
- Public URL loads.
- Supabase data reads correctly.
- Main user flows work.

## 6. Post-release Check

After deployment, verify:

- Version label is correct.
- Latest changelog entry matches the release.
- No obvious layout issues on mobile.
- Admin login still works.
- No missing database migration notes.
