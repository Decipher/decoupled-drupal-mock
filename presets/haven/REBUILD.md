# The haven rebuild

`yarn rebuild:summary --write` writes this page from the dump before the rebuild and the dump after it. The pipeline
writes it again and fails when the two differ, so a change to the recordings merges only with this page beside it.

## Drupal

- No build before this one. Core 11.4.12, profile haven
- Added altcha 1.2.1, automatic_updates 4.1.0, autosave_form 1.12.0, canvas 1.12.0, canvas_translate 1.0.0-beta1, captcha 2.0.12, checklistapi 2.1.7, coffee 2.0.1 and 64 more

## Index

- en: added `action--action`, `asset_library--asset_library`, `base_field_override--base_field_override`, `block--block`, `brand_kit--brand_kit`, `canvas_page--canvas_page`, `captcha_point--captcha_point`, `color--color` and 82 more

## Resources

| Type | en |
| --- | --- |
| `asset_library--asset_library` | new, 1 |
| `base_field_override--base_field_override` | new, 1 |
| `block--block` | new, 14 |
| `brand_kit--brand_kit` | new, 1 |
| `canvas_page--canvas_page` | new, 8 |
| `component--component` | new, 80 |
| `content_template--content_template` | new, 7 |
| `crop--focal_point` | new, 22 |
| `crop_type--crop_type` | new, 1 |
| `dashboard--dashboard` | new, 1 |
| `date_format--date_format` | new, 12 |
| `easy_email--default` | new, 1 |
| `easy_email_override--easy_email_override` | new, 10 |
| `easy_email_type--easy_email_type` | new, 10 |
| `eca--eca` | new, 13 |
| `editor--editor` | new, 5 |
| `entity_form_display--entity_form_display` | new, 16 |
| `entity_form_mode--entity_form_mode` | new, 2 |
| `entity_view_display--entity_view_display` | new, 74 |
| `entity_view_mode--entity_view_mode` | new, 47 |
| `field_config--field_config` | new, 46 |
| `field_storage_config--field_storage_config` | new, 25 |
| `file--file` | new, 24 |
| `filter_format--filter_format` | new, 6 |
| `folder--folder` | new, 18 |
| `image_style--image_style` | new, 64 |
| `js_component--js_component` | new, 5 |
| `klaro_app--klaro_app` | new, 29 |
| `klaro_purpose--klaro_purpose` | new, 7 |
| `linkit_profile--linkit_profile` | new, 1 |
| `media--image` | new, 22 |
| `media_type--media_type` | new, 5 |
| `menu--menu` | new, 10 |
| `menu_link_content--menu_link_content` | new, 18 |
| `metatag_defaults--metatag_defaults` | new, 4 |
| `node--blog` | new, 3 |
| `node--page` | new, 2 |
| `node--person_profile` | new, 1 |
| `node--project` | new, 3 |
| `node_type--node_type` | new, 4 |
| `page_variant--page_variant` | new, 1 |
| `path_alias--path_alias` | new, 34 |
| `pathauto_pattern--pathauto_pattern` | new, 4 |
| `pattern--pattern` | new, 1 |
| `responsive_image_style--responsive_image_style` | new, 29 |
| `search_api_index--search_api_index` | new, 1 |
| `search_api_server--search_api_server` | new, 1 |
| `simple_sitemap--simple_sitemap` | new, 2 |
| `simple_sitemap_type--simple_sitemap_type` | new, 2 |
| `symfony_mailer_lite_transport--symfony_mailer_lite_transport` | new, 1 |
| `taxonomy_term--tags` | new, 1 |
| `taxonomy_vocabulary--taxonomy_vocabulary` | new, 1 |
| `user--user` | new, 4 |
| `user_role--user_role` | new, 4 |
| `view--view` | new, 21 |
| `webform--webform` | new, 2 |
| `workflow--workflow` | new, 1 |

## Recorded routes

- 185 added: `GET /canvas/api/v0/site-data`, `GET /canvas/content-api#unauthorized`, `GET /canvas/content-api/entity?id=1&type=canvas_page`, `GET /canvas/content-api/entity?id=1&type=canvas_page#preview`, `GET /canvas/content-api/entity?id=1&type=node`, `GET /canvas/content-api/entity?id=1&type=node#preview`, `GET /canvas/content-api/entity?id=2&type=canvas_page`, `GET /canvas/content-api/entity?id=2&type=canvas_page#preview` and 177 more

## Visitor access

- en: what a visitor may read changed for `asset_library--asset_library`, `base_field_override--base_field_override`, `brand_kit--brand_kit`, `canvas_page--canvas_page`, `crop--focal_point`, `crop_type--crop_type`, `dashboard--dashboard`, `date_format--date_format` and 33 more

## Filter paths

- Recorded for 57 types, where the dump had no record

## Oracle reads

- 50 added: `GET /canvas/api/v0/site-data`, `GET /canvas/content-api?requestUri=%2F`, `GET /canvas/content-api?requestUri=%2Fabout`, `GET /canvas/content-api?requestUri=%2Fblog`, `GET /canvas/content-api?requestUri=%2Fcanvas-external`, `GET /canvas/content-api?requestUri=%2Fdr-alice-grossmann`, `GET /canvas/content-api?requestUri=%2Fhome`, `GET /canvas/content-api?requestUri=%2Fnope` and 42 more

## Oracle writes, by status

No change.
