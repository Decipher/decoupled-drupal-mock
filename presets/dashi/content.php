<?php

/**
 * @file
 * What the Dashi preset adds to the content every Drupal CMS preset shares.
 *
 * Run with: drush php:script content.php
 *
 * An edit to the About Dashi page that is auto-saved and not published: a
 * preview shows it, and a visitor does not. Its heading sits three levels
 * deep, in a group inside a grid inside a section.
 */

use Drupal\canvas\AutoSave\AutoSaveManager;

$about = '4badeb29-44c4-4b6d-adb0-1ba35c9f3a0d';
$heading = '8e657d6d-953c-4c02-a06a-48dcea1dd658';

$pages = \Drupal::entityTypeManager()->getStorage('canvas_page')->loadByProperties(['uuid' => $about]);
$page = reset($pages);
if (!$page) {
  throw new \Exception("Dashi's About page, $about, is not on the site.");
}
$tree = $page->getComponentTree()->getValue();
$found = FALSE;
foreach ($tree as &$item) {
  if ($item['uuid'] === $heading) {
    $inputs = is_string($item['inputs']) ? json_decode($item['inputs'], TRUE) : $item['inputs'];
    $item['inputs'] = ['heading_text' => 'About Dashi, in draft'] + $inputs;
    $found = TRUE;
  }
}
unset($item);
if (!$found) {
  throw new \Exception("The About page's heading, $heading, is not in its component tree.");
}
$page->setComponentTree($tree);
\Drupal::service(AutoSaveManager::class)->saveEntity($page);
