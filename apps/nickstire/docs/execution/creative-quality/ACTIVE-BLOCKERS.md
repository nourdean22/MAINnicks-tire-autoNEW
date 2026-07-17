# Active blockers / operator-owed

| Blocker | Blocks | Operator action |
|---|---|---|
| Drive consent not yet granted | M3 live path, M4 archive leg | After M3 deploys: (1) in GCP console, add `https://nickstire.org/api/oauth/drive/callback` to the OAuth client's Authorized redirect URIs (same client as admin login); (2) `curl -H "Authorization: Bearer $ADMIN_API_KEY" https://nickstire.org/api/admin/drive-vault/start` → open the returned authUrl → approve. `drive.file` scope only — the vault can touch nothing but files it creates |
| Render credits authorization | M4 trajectory | Say the word when M2/M3 are deployed |
| Listening pass | Audio naturalness scores | Play `reel-30008` once; the measured dead-air finding stands regardless |
| S3 decision (optional) | Runtime permanence layer | Registry+vault work without it; S3_BUCKET would upgrade runtime URLs from ephemeral to durable |
| 0088 DDL tap | Registry live in prod | Authorize `pnpm exec tsx scripts/apply-0088-media-registry.mts` when M2 ships |
