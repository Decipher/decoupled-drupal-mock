<?php

/**
 * @file
 * What the Haven preset adds to the content every Drupal CMS preset shares.
 *
 * Run with: drush php:script content.php
 *
 * An edit to the About us page that is auto-saved and not published: a
 * preview shows it, and a visitor does not. Its heading sits two levels deep,
 * in a side-by-side hero inside a section.
 */

use Drupal\canvas\AutoSave\AutoSaveManager;

$about = '77976984-9b0b-4eaf-aeaa-e3762aeb1f47';
$heading = '7a65b1ef-2878-4a6d-8269-a166c727b0ce';

$pages = \Drupal::entityTypeManager()->getStorage('canvas_page')->loadByProperties(['uuid' => $about]);
$page = reset($pages);
if (!$page) {
  throw new \Exception("Haven's About us page, $about, is not on the site.");
}
$tree = $page->getComponentTree()->getValue();
$found = FALSE;
foreach ($tree as &$item) {
  if ($item['uuid'] === $heading) {
    $inputs = is_string($item['inputs']) ? json_decode($item['inputs'], TRUE) : $item['inputs'];
    $item['inputs'] = ['heading_text' => 'Our mission, in draft'] + $inputs;
    $found = TRUE;
  }
}
unset($item);
if (!$found) {
  throw new \Exception("The About us page's mission heading, $heading, is not in its component tree.");
}
$page->setComponentTree($tree);
\Drupal::service(AutoSaveManager::class)->saveEntity($page);
