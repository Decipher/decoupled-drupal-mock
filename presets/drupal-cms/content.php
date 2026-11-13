<?php

/**
 * @file
 * The content the Drupal CMS preset is recorded from, added after the recipe.
 *
 * Run with: drush php:script content.php
 *
 * Every entity gets a uuid derived from its name, so a rebuild of the site
 * gives the same ids and a rebuilt dump differs only where Drupal changed.
 */

use Drupal\canvas\Entity\Component;
use Drupal\canvas\Entity\ContentTemplate;
use Drupal\canvas\Entity\JavaScriptComponent;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\views\Entity\View;

$etm = \Drupal::entityTypeManager();

$uuid = function (string $name): string {
  $hash = md5('decoupled-drupal-mock:drupal-cms:' . $name);
  return sprintf('%s-%s-4%s-8%s-%s', substr($hash, 0, 8), substr($hash, 8, 4), substr($hash, 13, 3), substr($hash, 17, 3), substr($hash, 20, 12));
};

// Fails the build on a page Canvas would refuse, rather than saving half a site.
$save_page = function (array $values) use ($etm): void {
  foreach ($values['components'] as &$item) {
    $item['component_version'] = Component::load($item['component_id'])->getActiveVersion();
  }
  $page = $etm->getStorage('canvas_page')->create($values);
  $violations = $page->validate();
  foreach ($violations as $violation) {
    throw new \Exception($violation->getPropertyPath() . ': ' . strip_tags((string) $violation->getMessage()));
  }
  $page->save();
};

// The Starter ships its views block component disabled.
Component::load('block.views_block.recent_pages-block_recent_pages')->enable()->save();
// The Starter ships its page template disabled, so a page node renders without Canvas.
ContentTemplate::load('node.page.full')->enable()->save();

// A visitor may read the recent pages view, for DruxtView and Canvas's views block alike.
$view = View::load('recent_pages');
$display = &$view->getDisplay('default');
$display['display_options']['access'] = ['type' => 'perm', 'options' => ['perm' => 'access content']];
$view->save();

// The frontend the Canvas editor opens a draft in.
\Drupal::configFactory()->getEditable('canvas_headless.settings')
  ->set('frontends', [['url' => 'http://127.0.0.1:3000']])
  ->save();

// Canvas's own configuration, readable through JSON:API as Druxt reads displays.
$druxt = \Drupal::configFactory()->getEditable('druxt.settings');
$resources = $druxt->get('resources');
foreach (['content_template--content_template', 'component--component', 'js_component--js_component'] as $resource) {
  if (!in_array($resource, $resources, TRUE)) {
    $resources[] = $resource;
  }
}
$druxt->set('resources', $resources)->save();

// A page node renders through Canvas's content template.
$etm->getStorage('node')->create([
  'uuid' => $uuid('node:about'),
  'type' => 'page',
  'title' => 'About Canvas',
  'moderation_state' => 'published',
  'path' => ['alias' => '/about-canvas', 'pathauto' => 0],
  'field_content' => ['value' => '<p>An ordinary node body.</p>', 'format' => 'content_format'],
])->save();

// A note has no content template: an ordinary Drupal node.
$etm->getStorage('node_type')->create(['type' => 'note', 'name' => 'Note'])->save();
$body = FieldStorageConfig::loadByName('node', 'body');
if (!$body) {
  $body = FieldStorageConfig::create(['field_name' => 'body', 'entity_type' => 'node', 'type' => 'text_with_summary']);
  $body->save();
}
FieldConfig::create(['field_storage' => $body, 'bundle' => 'note', 'label' => 'Body'])->save();
\Drupal::service('entity_display.repository')->getViewDisplay('node', 'note')
  ->setComponent('body', ['type' => 'text_default', 'label' => 'hidden'])
  ->save();
$note = $etm->getStorage('node')->create([
  'uuid' => $uuid('node:note'),
  'type' => 'note',
  'title' => 'A plain note',
  'moderation_state' => 'published',
  'path' => ['alias' => '/plain-note', 'pathauto' => 0],
  'body' => ['value' => '<p>No Canvas here.</p>', 'format' => 'content_format'],
]);
$note->save();

// A Canvas page of the theme's components, with a section whose slots hold more.
$section = $uuid('canvas:section');
$save_page([
  'uuid' => $uuid('page:canvas'),
  'title' => 'A Canvas page',
  'description' => 'Components nested in slots.',
  'status' => TRUE,
  'path' => ['alias' => '/canvas'],
  'components' => [
    ['uuid' => $uuid('canvas:heading'), 'component_id' => 'sdc.mercury.heading', 'inputs' => ['heading_text' => 'Drupal CMS with Canvas', 'level' => 1, 'text_size' => 'heading-responsive-7xl', 'text_color' => 'default', 'align' => 'left']],
    ['uuid' => $uuid('canvas:text'), 'component_id' => 'sdc.mercury.text', 'inputs' => ['text' => '<p>A Canvas page for a <strong>decoupled</strong> frontend.</p>', 'text_size' => 'normal', 'text_color' => 'default']],
    ['uuid' => $section, 'component_id' => 'sdc.mercury.section', 'inputs' => ['width' => '75%', 'columns' => '50-50', 'mobile_columns' => '1', 'margin_block_start' => '48', 'margin_block_end' => '48', 'padding_block_start' => '0', 'padding_block_end' => '0', 'section_header' => TRUE, 'section_footer' => FALSE]],
    ['uuid' => $uuid('canvas:section-heading'), 'component_id' => 'sdc.mercury.heading', 'parent_uuid' => $section, 'slot' => 'header_slot', 'inputs' => ['heading_text' => 'Two cards', 'level' => 2, 'text_size' => 'heading-responsive-4xl', 'text_color' => 'default', 'align' => 'left']],
    ['uuid' => $uuid('canvas:card-1'), 'component_id' => 'sdc.mercury.card', 'parent_uuid' => $section, 'slot' => 'main_slot', 'inputs' => ['heading_text' => 'First card', 'orientation' => 'vertical', 'style' => 'framed', 'background' => 'default', 'level' => 3, 'text' => 'Card one body.', 'url' => '/about-canvas', 'is_text_centered' => FALSE]],
    ['uuid' => $uuid('canvas:card-2'), 'component_id' => 'sdc.mercury.card', 'parent_uuid' => $section, 'slot' => 'main_slot', 'inputs' => ['heading_text' => 'Second card', 'orientation' => 'vertical', 'style' => 'framed', 'background' => 'default', 'level' => 3, 'text' => 'Card two body.', 'is_text_centered' => FALSE]],
    ['uuid' => $uuid('canvas:menu'), 'component_id' => 'block.system_menu_block.main', 'inputs' => ['label' => 'Main navigation', 'label_display' => '0', 'level' => 1, 'depth' => 2, 'expand_all_items' => FALSE]],
    ['uuid' => $uuid('canvas:view'), 'component_id' => 'block.views_block.recent_pages-block_recent_pages', 'inputs' => ['label' => '', 'label_display' => '0', 'views_label' => '', 'items_per_page' => 5]],
  ],
]);

// Components the frontend owns: Canvas sends their props as data, not as markup.
$definitions = [
  'druxt_card' => ['Druxt card', ['title' => ['type' => 'string', 'title' => 'Title', 'examples' => ['Card title']], 'body' => ['type' => 'string', 'title' => 'Body', 'examples' => ['Card body']]], ['content' => ['title' => 'Content']]],
  'druxt_view' => ['Druxt view', ['view_id' => ['type' => 'string', 'title' => 'View', 'examples' => ['content']], 'display_id' => ['type' => 'string', 'title' => 'Display', 'examples' => ['page_1']]], []],
  'druxt_menu' => ['Druxt menu', ['menu' => ['type' => 'string', 'title' => 'Menu', 'examples' => ['main']]], []],
  'druxt_entity' => ['Druxt entity', ['entity_type' => ['type' => 'string', 'title' => 'Entity type', 'examples' => ['node']], 'bundle' => ['type' => 'string', 'title' => 'Bundle', 'examples' => ['note']], 'uuid' => ['type' => 'string', 'title' => 'UUID', 'examples' => ['00000000-0000-0000-0000-000000000000']], 'view_mode' => ['type' => 'string', 'title' => 'View mode', 'examples' => ['teaser']]], []],
];
foreach ($definitions as $id => [$name, $props, $slots]) {
  JavaScriptComponent::create(['machineName' => $id, 'name' => $name, 'status' => TRUE, 'type' => 'external', 'required' => [], 'props' => $props, 'slots' => $slots, 'dataDependencies' => []])->save();
}
$card = $uuid('external:card');
$save_page([
  'uuid' => $uuid('page:external'),
  'title' => 'Frontend components',
  'description' => 'Components the frontend renders, placed in Canvas.',
  'status' => TRUE,
  'path' => ['alias' => '/canvas-external'],
  'components' => [
    ['uuid' => $uuid('external:heading'), 'component_id' => 'sdc.mercury.heading', 'inputs' => ['heading_text' => 'Frontend components', 'level' => 1, 'text_size' => 'heading-responsive-7xl', 'text_color' => 'default', 'align' => 'left']],
    ['uuid' => $card, 'component_id' => 'js.druxt_card', 'inputs' => ['title' => 'A Druxt card', 'body' => 'Props arrive as data.']],
    ['uuid' => $uuid('external:menu'), 'component_id' => 'js.druxt_menu', 'parent_uuid' => $card, 'slot' => 'content', 'inputs' => ['menu' => 'main']],
    ['uuid' => $uuid('external:view'), 'component_id' => 'js.druxt_view', 'inputs' => ['view_id' => 'recent_pages', 'display_id' => 'block_recent_pages']],
    ['uuid' => $uuid('external:entity'), 'component_id' => 'js.druxt_entity', 'inputs' => ['entity_type' => 'node', 'bundle' => 'note', 'uuid' => $note->uuid(), 'view_mode' => 'teaser']],
  ],
]);

// Main menu links, for menu components and DruxtMenu.
$links = $etm->getStorage('menu_link_content');
foreach ([['Canvas', 'internal:/canvas', 0], ['About', 'internal:/about-canvas', 1], ['Note', 'internal:/plain-note', 2]] as [$title, $uri, $weight]) {
  $links->create(['title' => $title, 'link' => ['uri' => $uri], 'menu_name' => 'main', 'weight' => $weight])->save();
}
