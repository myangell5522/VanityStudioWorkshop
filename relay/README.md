# Relay

The game can read the Workshop straight from this repository, but publishing needs write access,
and a GitHub token can never be put inside the mod (anyone could pull it out). This small
Cloudflare Worker keeps the token on Cloudflare's side: the game sends it a submission, the worker
checks it and turns it into a pull request (or a direct commit, if you allow that).

The free Cloudflare plan is plenty: 100,000 requests a day.

## Set it up (about 5 minutes)

1. **Make a GitHub token** at <https://github.com/settings/personal-access-tokens/new>
   - Repository access: *Only select repositories* → `VanityStudioWorkshop`
   - Permissions: **Contents: Read and write**, **Pull requests: Read and write**
   - Copy the token.

2. **Deploy the worker** (needs [Node.js](https://nodejs.org)):

   ```
   cd relay
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN      # paste the token
   npx wrangler deploy
   ```

   Wrangler prints the address, something like `https://vanity-studio-relay.<you>.workers.dev`.
   Opening it in a browser should say *"Vanity Studio Workshop relay is running."*

3. **Tell the mod where it is**: put that address into `config.json` at the root of this repository
   and push:

   ```json
   { "relay": "https://vanity-studio-relay.<you>.workers.dev" }
   ```

   Every copy of the mod reads `config.json` when the Workshop opens, so nobody has to update the mod.

## Moderation

`AUTO_PUBLISH` in `wrangler.toml`:

- `"false"` (default): each upload becomes a pull request with the thumbnail in its description.
  Merge it to publish; close it to reject. The *Check submission* action validates the files first.
- `"true"`: brand-new items go to `main` straight away. Updates to an existing item always come as
  a pull request, because nothing proves the sender is the person who made the original.

To take something down later, delete its `items/<steam id>/<item id>/` folder; the index rebuilds itself.

Optional rate limit: uncomment the `kv_namespaces` block in `wrangler.toml` (instructions inside)
to allow at most 10 uploads per IP per hour.
