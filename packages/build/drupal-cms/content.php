<?php

/**
 * @file
 * What every Drupal CMS preset adds to its site template, after the recipe.
 *
 * Run with: drush php:script content.php
 *
 * The site template brings the content. This adds what a decoupled frontend
 * needs that no template has: where Canvas opens a draft, Canvas's own
 * configuration readable as Druxt reads displays, and a page of components
 * the frontend renders. Every entity gets a uuid derived from its name, so a
 * rebuild of the site gives the same ids and a rebuilt dump differs only
 * where Drupal changed.
 */

use Drupal\canvas\Entity\Component;
use Drupal\canvas\Entity\JavaScriptComponent;

$etm = \Drupal::entityTypeManager();

$uuid = function (string $name): string {
  $hash = md5('decoupled-drupal-mock:drupal-cms:' . $name);
  return sprintf('%s-%s-4%s-8%s-%s', substr($hash, 0, 8), substr($hash, 8, 4), substr($hash, 13, 3), substr($hash, 17, 3), substr($hash, 20, 12));
};

// The frontend the Canvas editor opens a draft in.
\Drupal::configFactory()->getEditable('canvas_headless.settings')
  ->set('frontends', [['url' => 'http://127.0.0.1:3000']])
  ->save();

// Canvas's own configuration, readable through JSON:API as Druxt reads displays.
$druxt = \Drupal::configFactory()->getEditable('druxt.settings');
$resources = $druxt->get('resources');
foreach (['content_template--content_template', 'component--component', 'js_component--js_component', 'page_variant--page_variant'] as $resource) {
  if (!in_array($resource, $resources, TRUE)) {
    $resources[] = $resource;
  }
}
$druxt->set('resources', $resources)->save();

// Components the frontend owns: Canvas sends their props as data, not as markup.
$definitions = [
  'druxt_card' => ['Druxt card', ['title' => ['type' => 'string', 'title' => 'Title', 'examples' => ['Card title']], 'body' => ['type' => 'string', 'title' => 'Body', 'examples' => ['Card body']]], ['content' => ['title' => 'Content']]],
  'druxt_view' => ['Druxt view', ['view_id' => ['type' => 'string', 'title' => 'View', 'examples' => ['content']], 'display_id' => ['type' => 'string', 'title' => 'Display', 'examples' => ['page_1']]], []],
  'druxt_menu' => ['Druxt menu', ['menu' => ['type' => 'string', 'title' => 'Menu', 'examples' => ['main']]], []],
  'druxt_entity' => ['Druxt entity', ['entity_type' => ['type' => 'string', 'title' => 'Entity type', 'examples' => ['node']], 'bundle' => ['type' => 'string', 'title' => 'Bundle', 'examples' => ['page']], 'uuid' => ['type' => 'string', 'title' => 'UUID', 'examples' => ['00000000-0000-0000-0000-000000000000']], 'view_mode' => ['type' => 'string', 'title' => 'View mode', 'examples' => ['teaser']]], []],
];
foreach ($definitions as $id => [$name, $props, $slots]) {
  JavaScriptComponent::create(['machineName' => $id, 'name' => $name, 'status' => TRUE, 'type' => 'external', 'required' => [], 'props' => $props, 'slots' => $slots, 'dataDependencies' => []])->save();
}

// The template's first published node, which the entity component points at.
$nids = $etm->getStorage('node')->getQuery()->accessCheck(FALSE)->condition('status', 1)->sort('nid')->range(0, 1)->execute();
$node = $etm->getStorage('node')->load(reset($nids));

// A page of those components, with one nested in another's slot. Fails the build on a page Canvas would refuse,
// rather than saving half a site.
$card = $uuid('external:card');
$components = [
  ['uuid' => $card, 'component_id' => 'js.druxt_card', 'inputs' => ['title' => 'A Druxt card', 'body' => 'Props arrive as data.']],
  ['uuid' => $uuid('external:menu'), 'component_id' => 'js.druxt_menu', 'parent_uuid' => $card, 'slot' => 'content', 'inputs' => ['menu' => 'main']],
  ['uuid' => $uuid('external:view'), 'component_id' => 'js.druxt_view', 'inputs' => ['view_id' => 'recent_pages', 'display_id' => 'block_recent_pages']],
  ['uuid' => $uuid('external:entity'), 'component_id' => 'js.druxt_entity', 'inputs' => ['entity_type' => 'node', 'bundle' => $node->bundle(), 'uuid' => $node->uuid(), 'view_mode' => 'teaser']],
];
foreach ($components as &$item) {
  $item['component_version'] = Component::load($item['component_id'])->getActiveVersion();
}
unset($item);
$page = $etm->getStorage('canvas_page')->create([
  'uuid' => $uuid('page:external'),
  'title' => 'Frontend components',
  'description' => 'Components the frontend renders, placed in Canvas.',
  'status' => TRUE,
  'path' => ['alias' => '/canvas-external'],
  'components' => $components,
]);
foreach ($page->validate() as $violation) {
  throw new \Exception($violation->getPropertyPath() . ': ' . strip_tags((string) $violation->getMessage()));
}
$page->save();
