# The drupal-cms rebuild

`yarn rebuild:summary --write` writes this page from the dump before the rebuild and the dump after it. The pipeline
writes it again and fails when the two differ, so a change to the recordings merges only with this page beside it.

## Drupal

- No build before this one. Core 11.4.12, profile drupal_cms_starter
- Added automatic_updates 4.1.0, autosave_form 1.12.0, canvas 1.12.0, canvas_translate 1.0.0-beta1, checklistapi 2.1.7, coffee 2.0.1, config_language_lock 1.0.2, consumers 1.24.0 and 56 more

## Index

- en: added `action--action`, `asset_library--asset_library`, `base_field_override--base_field_override`, `block--block`, `brand_kit--brand_kit`, `canvas_page--canvas_page`, `color--color`, `component--component` and 69 more

## Resources

| Type | en |
| --- | --- |
| `asset_library--asset_library` | new, 1 |
| `block--block` | new, 14 |
| `brand_kit--brand_kit` | new, 1 |
| `canvas_page--canvas_page` | new, 3 |
| `component--component` | new, 67 |
| `content_template--content_template` | new, 1 |
| `crop_type--crop_type` | new, 1 |
| `dashboard--dashboard` | new, 1 |
| `date_format--date_format` | new, 11 |
| `easy_email--default` | new, 1 |
| `easy_email_override--easy_email_override` | new, 10 |
| `easy_email_type--easy_email_type` | new, 10 |
| `eca--eca` | new, 12 |
| `editor--editor` | new, 4 |
| `entity_ce_display--entity_ce_display` | new, 1 |
| `entity_form_display--entity_form_display` | new, 14 |
| `entity_form_mode--entity_form_mode` | new, 2 |
| `entity_view_display--entity_view_display` | new, 64 |
| `entity_view_mode--entity_view_mode` | new, 45 |
| `field_config--field_config` | new, 16 |
| `field_storage_config--field_storage_config` | new, 16 |
| `file--file` | new, 2 |
| `filter_format--filter_format` | new, 5 |
| `folder--folder` | new, 16 |
| `image_style--image_style` | new, 64 |
| `js_component--js_component` | new, 4 |
| `klaro_app--klaro_app` | new, 29 |
| `klaro_purpose--klaro_purpose` | new, 7 |
| `linkit_profile--linkit_profile` | new, 1 |
| `media_type--media_type` | new, 5 |
| `menu--menu` | new, 8 |
| `menu_link_content--menu_link_content` | new, 11 |
| `metatag_defaults--metatag_defaults` | new, 4 |
| `node--note` | new, 1 |
| `node--page` | new, 2 |
| `node_type--node_type` | new, 2 |
| `page_variant--page_variant` | new, 1 |
| `path_alias--path_alias` | new, 7 |
| `pathauto_pattern--pathauto_pattern` | new, 2 |
| `responsive_image_style--responsive_image_style` | new, 29 |
| `simple_sitemap--simple_sitemap` | new, 2 |
| `simple_sitemap_type--simple_sitemap_type` | new, 2 |
| `symfony_mailer_lite_transport--symfony_mailer_lite_transport` | new, 1 |
| `taxonomy_vocabulary--taxonomy_vocabulary` | new, 1 |
| `user--user` | new, 4 |
| `user_role--user_role` | new, 4 |
| `view--view` | new, 17 |
| `workflow--workflow` | new, 1 |

## Recorded routes

- 60 added: `GET /canvas/api/v0/site-data`, `GET /canvas/content-api/entity?id=1&type=canvas_page`, `GET /canvas/content-api/entity?id=1&type=node`, `GET /canvas/content-api/entity?id=2&type=canvas_page`, `GET /canvas/content-api/entity?id=2&type=node`, `GET /canvas/content-api/entity?id=3&type=canvas_page`, `GET /canvas/content-api/entity?id=3&type=node`, `GET /canvas/content-api?requestUri=%2F` and 52 more

## Visitor access

- en: what a visitor may read changed for `asset_library--asset_library`, `brand_kit--brand_kit`, `canvas_page--canvas_page`, `crop_type--crop_type`, `dashboard--dashboard`, `date_format--date_format`, `easy_email--default`, `easy_email_override--easy_email_override` and 25 more

## Oracle reads

- 28 added: `GET /canvas/api/v0/site-data`, `GET /canvas/content-api?requestUri=%2F`, `GET /canvas/content-api?requestUri=%2Fabout-canvas`, `GET /canvas/content-api?requestUri=%2Fcanvas`, `GET /canvas/content-api?requestUri=%2Fhome`, `GET /canvas/content-api?requestUri=%2Fnope`, `GET /canvas/content-api?requestUri=%2Fpage%2F2`, `GET /canvas/content-api?requestUri=%2Fplain-note` and 20 more

## Oracle writes, by status

No change.
