# Vanity Studio Workshop

Clothing, accessories and new sprites for items, NPCs, bosses and projectiles, made by players in
[Vanity Studio](https://steamcommunity.com/app/1281930), a tModLoader mod.

You don't need to visit this page: open the studio in game and press the globe button to browse
everything here, add it to your designs and wear it. Publishing works from the same place.

## How it's organised

```
index.json                      what the game loads: every item, newest first (built automatically)
config.json                     where the game sends new uploads (the relay address)
items/<steam id>/<item id>/
    design.vsd                  the design itself
    thumb.png                   preview shown on the card
    meta.json                   name, description, what it is, what it's a rework of
authors/<steam id>/
    author.json                 Steam nickname
    avatar.png                  Steam avatar
assets/description/             icons used in the Steam Workshop description
relay/                          the small upload service (see relay/README.md)
scripts/build_index.py          rebuilds and checks index.json
```

Every creator gets their own folder, named after their Steam id, and every creation its own folder inside it.

## Publishing

In the studio: open a design, press the cloud button, give it a name and an optional short description.
Your Steam nickname and avatar go on the card. New uploads are reviewed before they appear.

## Taking something down

Open an issue, or if you run this repository, delete the item's folder. `index.json` is rebuilt by
the *Build index* action on every push.

## Licence

Each creation belongs to the person who made it. Uploading here means you agree it can be shared
through Vanity Studio. Reworks of Terraria or mod sprites stay subject to their original owners.
