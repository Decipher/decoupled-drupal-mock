# The umami rebuild

`yarn rebuild:summary --write` writes this page from the dump before the rebuild and the dump after it. The pipeline
writes it again and fails when the two differ, so a change to the recordings merges only with this page beside it.

## Drupal

No change.

## Index

No change.

## Resources

No change.

## Recorded routes

- 4 of 389 answer with the same status and a different body: `GET /en/jsonapi/views/who_s_new/block_1`, `GET /en/jsonapi/views/who_s_new/default`, `GET /es/jsonapi/views/who_s_new/block_1`, `GET /es/jsonapi/views/who_s_new/default`

## Visitor access

- en: what a visitor may read changed for `user--user`
- es: what a visitor may read changed for `user--user`

## Filter paths

- Recorded for 35 types, where the dump had no record

## Oracle reads

- 16 added: `GET /en/jsonapi/block/block?filter%5Bnope.x%5D=x`, `GET /en/jsonapi/node/article?filter%5Baaa%5D=y&filter%5Buid.mail%5D=x`, `GET /en/jsonapi/node/article?filter%5Bfield_tags.entity%3Ataxonomy_term.name%5D=Dairy`, `GET /en/jsonapi/node/article?filter%5Bpath.alias%5D=x`, `GET /en/jsonapi/node/article?filter%5Bpath.nope%5D=x`, `GET /en/jsonapi/node/article?filter%5Btitle.value%5D=x`, `GET /en/jsonapi/node/article?filter%5Buid%5D=x`, `GET /en/jsonapi/node/article?filter%5Buid.id.x%5D=x` and 8 more

## Oracle writes, by status

No change.
