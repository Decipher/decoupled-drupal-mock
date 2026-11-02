import { NextDrupal } from 'next-drupal'

/** The client, pointed at whatever the environment says Drupal is. */
export const drupal = new NextDrupal(process.env.NEXT_PUBLIC_DRUPAL_BASE_URL)
