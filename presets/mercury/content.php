<?php

/**
 * @file
 * What the Mercury preset adds to the content every Drupal CMS preset shares.
 *
 * Run with: drush php:script content.php
 *
 * An edit to the Home page that is auto-saved and not published: a preview
 * shows it, and a visitor does not. Its heading sits two levels deep.
 */

use Drupal\canvas\AutoSave\AutoSaveManager;

$home = 'bb5bbbb1-4a16-4b86-bbea-b215ab8096cf';
$heading = '6d9a8a31-2d31-422d-bc1e-01bb662ae2d9';

$pages = \Drupal::entityTypeManager()->getStorage('canvas_page')->loadByProperties(['uuid' => $home]);
$page = reset($pages);
if (!$page) {
  throw new \Exception("Mercury Demo's Home page, $home, is not on the site.");
}
$tree = $page->getComponentTree()->getValue();
$found = FALSE;
foreach ($tree as &$item) {
  if ($item['uuid'] === $heading) {
    $inputs = is_string($item['inputs']) ? json_decode($item['inputs'], TRUE) : $item['inputs'];
    $item['inputs'] = ['heading_text' => 'Visual page building, in draft'] + $inputs;
    $found = TRUE;
  }
}
unset($item);
if (!$found) {
  throw new \Exception("The Home page's heading, $heading, is not in its component tree.");
}
$page->setComponentTree($tree);
\Drupal::service(AutoSaveManager::class)->saveEntity($page);
