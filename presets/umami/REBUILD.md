# The umami rebuild

`yarn rebuild:summary --write` writes this page from the dump before the rebuild and the dump after it. The pipeline
writes it again and fails when the two differ, so a change to the recordings merges only with this page beside it.

## Drupal

- Core 11.4.6 to 11.4.11
- Removed graphql, graphql_compose, typed_data
- Updated simple_oauth 6.1.1 to 6.1.4

## Index

- en: removed `graphql_server--graphql_server`
- es: removed `graphql_server--graphql_server`

## Resources

| Type | en | es |
| --- | --- | --- |
| `graphql_server--graphql_server` | gone, was 1 | gone, was 1 |
| `user--user` | 13 to 13: 1 added, 1 removed, 2 changed (`display_name`, `name`, `mail`, `roles`) | 13 to 13: 1 added, 1 removed, 2 changed (`display_name`, `name`, `mail`, `roles`) |
| `user_role--user_role` | 5 to 5: 1 changed (`dependencies`, `permissions`) | 5 to 5: 1 changed (`dependencies`, `permissions`) |

Each entity is named by its internal id, so one that kept its name under another id reads as a change.

- `user--user`, en: added 10 (editor). removed 13 (reader). changed 11 (author) from 11 (editor), 12 (reader) from 12 (author)
- `user_role--user_role`, en: changed anonymous (Anonymous user) from anonymous (Anonymous user)

## Recorded routes

- 7 of 389 answer with the same status and a different body: `GET /en/jsonapi/decoupled/settings`, `GET /en/jsonapi/views/who_s_new/block_1`, `GET /en/jsonapi/views/who_s_new/default`, `GET /es/jsonapi/decoupled/settings`, `GET /es/jsonapi/views/who_s_new/block_1`, `GET /es/jsonapi/views/who_s_new/default`, `GET /jsonapi`

## Visitor access

- en: what a visitor may read changed for `graphql_server--graphql_server`
- es: what a visitor may read changed for `graphql_server--graphql_server`

## Oracle reads

- 5 of 146 answer with the same status and a different body: `GET /en/jsonapi/decoupled/settings`, `GET /es/jsonapi`, `GET /es/jsonapi/decoupled/settings`, `GET /jsonapi`, `GET en/jsonapi`

## Oracle writes, by status

No change.
