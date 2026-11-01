<?php
// The GraphQL Compose schema's mapping onto Drupal: each enabled bundle's type name and query names, and each
// field's SDL name, Drupal field name, SDL type and cardinality, plus the settings the engine answers from.
$em = \Drupal::service('graphql_compose.entity_type_manager');
$fm = \Drupal::service('graphql_compose.field_type_manager');
$settings = \Drupal::config('graphql_compose.settings');
$out = ['server' => NULL, 'endpoint' => NULL, 'settings' => $settings->get('settings'), 'timezone' => \Drupal::config('system.date')->get('timezone.default'), 'types' => [], 'menus' => []];
foreach (\Drupal::entityTypeManager()->getStorage('graphql_server')->loadMultiple() as $server) {
  if ($server->get('schema') === 'graphql_compose') { $out['server'] = $server->id(); $out['endpoint'] = $server->get('endpoint'); }
}
foreach ($em->getPluginInstances() as $plugin) {
  foreach ($plugin->getBundles() as $bundle) {
    $id = $bundle->getEntity()->id();
    $fields = [];
    foreach ($fm->getBundleFields($plugin->getEntityTypeId(), $id) as $field) {
      $fields[$field->getNameSdl()] = ['field' => $field->getFieldName(), 'fieldType' => $field->getFieldType(), 'type' => $field->getTypeSdl(), 'multiple' => $field->isMultiple(), 'required' => $field->isRequired(), 'base' => $field->isBaseField()];
    }
    $out['types'][$plugin->getEntityTypeId() . '--' . $id] = ['type' => $bundle->getTypeSdl(), 'single' => $bundle->getNameSdl(), 'plural' => $bundle->getNamePluralSdl(), 'interfaces' => $plugin->getInterfaces($id), 'queryLoad' => $bundle->isQueryLoadEnabled(), 'routes' => (bool) $bundle->getSetting('routes_enabled'), 'edges' => (bool) $bundle->getSetting('edges_enabled'), 'fields' => $fields];
  }
}
$out['front'] = \Drupal::config('system.site')->get('page.front');
$languages = array_keys(\Drupal::languageManager()->getLanguages());
foreach ($settings->get('entity_config.menu') ?: [] as $menu => $cfg) {
  if (empty($cfg['enabled'])) continue;
  $labels = [];
  foreach ($languages as $langcode) {
    $override = \Drupal::languageManager()->getLanguageConfigOverride($langcode, 'system.menu.' . $menu)->get('label');
    $labels[$langcode] = $override ?: \Drupal::config('system.menu.' . $menu)->get('label');
  }
  $out['menus'][$menu] = ['enum' => strtoupper(preg_replace('/[^a-z0-9]/i', '', $menu)), 'labels' => $labels];
}
foreach ($languages as $langcode) {
  foreach ($languages as $other) {
    $override = \Drupal::languageManager()->getLanguageConfigOverride($langcode, 'language.entity.' . $other)->get('label');
    $out['languages'][$langcode][$other] = $override ?: \Drupal::config('language.entity.' . $other)->get('label');
  }
}
print json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
